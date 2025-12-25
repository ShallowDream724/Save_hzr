const { getAiClient } = require('./geminiCore');
const { TokenBucket } = require('./tokenBucket');
const { newId } = require('./ids');
const { isoNow } = require('./time');
const { getModelId } = require('./geminiClient');

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(String(raw || ''));
  } catch (_) {
    return fallback;
  }
}

function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim().length > 0;
}

// Per-user chat RPM limiter (independent of model)
const userBuckets = new Map();
function getUserBucket(userId) {
  const key = String(userId);
  const existing = userBuckets.get(key);
  if (existing) return existing;
  const bucket = new TokenBucket({ capacity: 10, refillPerSec: 10 / 60 });
  userBuckets.set(key, bucket);
  return bucket;
}

function allowUserChat(userId) {
  return getUserBucket(userId).tryConsume(1);
}

// Title generation (cheap model, not counted towards user RPM)
let titleInFlight = 0;
const titleQueue = [];

async function generateTitleFlashLite({ userText, assistantText }) {
  const ai = getAiClient();
  const prompt = `根据下面的对话，为这段对话生成一个非常简短的中文标题（最多 8-12 个字）。只返回标题文本，不要加引号，不要解释。\n\n用户：${userText}\n助手：${assistantText}\n\n标题：`;
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: prompt,
    config: {
      temperature: 0.2,
      topP: 0.95,
      thinkingConfig: { thinkingBudget: -1 },
    },
  });
  const title = res && res.text ? String(res.text).trim() : '';
  return title.replace(/^["'“”]+|["'“”]+$/g, '').trim();
}

function enqueueTitleTask(fn) {
  titleQueue.push(fn);
  pumpTitleQueue();
}

function pumpTitleQueue() {
  if (titleInFlight >= 1) return;
  const fn = titleQueue.shift();
  if (!fn) return;
  titleInFlight += 1;
  Promise.resolve()
    .then(fn)
    .catch(() => {})
    .finally(() => {
      titleInFlight -= 1;
      pumpTitleQueue();
    });
}

function createOrReuseConversation(db, userId, payload) {
  payload = payload && typeof payload === 'object' ? payload : {};
  const scope = isNonEmptyString(payload.scope) ? payload.scope.trim() : 'general';
  const bookId = isNonEmptyString(payload.bookId) ? payload.bookId.trim() : null;
  const chapterId = isNonEmptyString(payload.chapterId) ? payload.chapterId.trim() : null;
  const questionId = isNonEmptyString(payload.questionId) ? payload.questionId.trim() : null;
  const questionKey = isNonEmptyString(payload.questionKey) ? payload.questionKey.trim() : null;
  const modelPref = payload.modelPref === 'pro' || payload.modelPref === 'flash' ? payload.modelPref : 'flash';
  const questionContext = isNonEmptyString(payload.questionContext) ? payload.questionContext.trim() : null;

  if (!['general', 'book', 'question'].includes(scope)) {
    const e = new Error('bad scope');
    e.name = 'BadRequest';
    throw e;
  }

  if (scope === 'question') {
    let row = null;
    if (questionKey) {
      row = db.prepare('SELECT * FROM ai_conversations WHERE user_id=? AND question_key=? LIMIT 1').get(userId, questionKey);
    } else if (bookId && chapterId && questionId) {
      row = db
        .prepare('SELECT * FROM ai_conversations WHERE user_id=? AND scope=\'question\' AND book_id=? AND chapter_id=? AND question_id=? LIMIT 1')
        .get(userId, bookId, chapterId, questionId);
    }
    if (row && row.id) return { conversationId: row.id, reused: true };
  }

  const now = isoNow();
  const conversationId = newId('conv');
  db.prepare(
    `
    INSERT INTO ai_conversations
      (id, user_id, scope, book_id, chapter_id, question_id, question_key, title, model_pref, created_at, updated_at, last_message_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)
  `
  ).run(conversationId, userId, scope, bookId, chapterId, questionId, questionKey, modelPref, now, now);

  if (scope === 'question' && questionContext) {
    // Persist the question context as a system message so multi-device reuse keeps the same grounding.
    // The model will receive it via systemInstruction (see streamConversationReply).
    insertMessage(db, {
      conversationId,
      userId,
      role: 'system',
      contentText: questionContext,
      contentJson: { kind: 'question_context' },
    });
  }

  return { conversationId, reused: false };
}

function listConversations(db, userId, filters) {
  filters = filters && typeof filters === 'object' ? filters : {};
  const scope = isNonEmptyString(filters.scope) ? filters.scope.trim() : null;
  const bookId = isNonEmptyString(filters.bookId) ? filters.bookId.trim() : null;

  let sql = 'SELECT * FROM ai_conversations WHERE user_id=?';
  const params = [userId];
  if (scope) {
    sql += ' AND scope=?';
    params.push(scope);
  }
  if (bookId) {
    sql += ' AND book_id=?';
    params.push(bookId);
  }
  sql += ' ORDER BY COALESCE(last_message_at, updated_at) DESC LIMIT 100';
  return db.prepare(sql).all(...params);
}

function getConversation(db, userId, conversationId) {
  return db.prepare('SELECT * FROM ai_conversations WHERE id=? AND user_id=?').get(conversationId, userId);
}

function getMessages(db, userId, conversationId, limit = 200) {
  return db
    .prepare('SELECT * FROM ai_messages WHERE conversation_id=? AND user_id=? ORDER BY created_at ASC LIMIT ?')
    .all(conversationId, userId, Math.max(1, Math.min(500, Number(limit) || 200)));
}

function insertMessage(db, { conversationId, userId, role, contentText, contentJson }) {
  const now = isoNow();
  const id = newId('msg');
  db.prepare(
    `
    INSERT INTO ai_messages (id, conversation_id, user_id, role, content_text, content_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).run(id, conversationId, userId, role, contentText, contentJson ? JSON.stringify(contentJson) : null, now);

  if (role === 'system') {
    db.prepare('UPDATE ai_conversations SET updated_at=? WHERE id=? AND user_id=?').run(now, conversationId, userId);
  } else {
    db.prepare('UPDATE ai_conversations SET updated_at=?, last_message_at=? WHERE id=? AND user_id=?').run(now, now, conversationId, userId);
  }
  return id;
}

function buildSystemInstruction({ conversation, selectedText, contextText }) {
  const parts = [];
  parts.push('你是一个严谨、耐心的学习助手。回答要清晰、分点、必要时给出公式（LaTeX）。');

  if (conversation && conversation.scope === 'question') {
    const ref = [];
    if (conversation.book_id) ref.push(`bookId=${conversation.book_id}`);
    if (conversation.chapter_id) ref.push(`chapterId=${conversation.chapter_id}`);
    if (conversation.question_id) ref.push(`questionId=${conversation.question_id}`);
    if (conversation.question_key) ref.push(`questionKey=${conversation.question_key}`);
    if (ref.length) parts.push(`当前对话绑定题目：${ref.join(', ')}`);
  }

  if (isNonEmptyString(selectedText)) {
    parts.push(`用户选中引用：\n"""\n${selectedText}\n"""`);
  }

  if (isNonEmptyString(contextText)) {
    parts.push(`题目上下文（用于回答，不要逐字复述）：\n"""\n${contextText}\n"""`);
  }

  return parts.join('\n\n');
}

function toGeminiHistory(messages) {
  const out = [];
  for (const m of messages) {
    if (!m || !m.role) continue;
    const role = m.role === 'assistant' ? 'model' : m.role === 'user' ? 'user' : null;
    if (!role) continue;
    out.push({ role, parts: [{ text: String(m.content_text || '') }] });
  }
  return out;
}

async function streamConversationReply({ db, userId, conversationId, userMessage, selectedText, modelPref, onDelta }) {
  const conv = getConversation(db, userId, conversationId);
  if (!conv) {
    const e = new Error('not found');
    e.name = 'NotFound';
    throw e;
  }

  if (!allowUserChat(userId)) {
    const e = new Error('rate limited');
    e.name = 'RateLimited';
    throw e;
  }

  const requestedModel = modelPref === 'pro' || modelPref === 'flash' ? modelPref : null;
  const effectiveModelPref = requestedModel || (conv.model_pref === 'pro' ? 'pro' : 'flash');
  const modelId = getModelId(effectiveModelPref);

  if (requestedModel && requestedModel !== conv.model_pref) {
    try {
      const now = isoNow();
      db.prepare('UPDATE ai_conversations SET model_pref=?, updated_at=? WHERE id=? AND user_id=?').run(
        requestedModel,
        now,
        conversationId,
        userId
      );
      conv.model_pref = requestedModel;
    } catch (_) {}
  }

  const msgText = String(userMessage || '').trim();
  if (!msgText) {
    const e = new Error('userMessage required');
    e.name = 'BadRequest';
    throw e;
  }

  insertMessage(db, { conversationId, userId, role: 'user', contentText: msgText, contentJson: null });

  const historyRows = getMessages(db, userId, conversationId, 120);
  const history = toGeminiHistory(historyRows);

  let contextText = '';
  for (const m of historyRows) {
    if (m && m.role === 'system' && isNonEmptyString(m.content_text)) {
      contextText = String(m.content_text);
      break;
    }
  }

  const systemInstruction = buildSystemInstruction({ conversation: conv, selectedText, contextText });

  const ai = getAiClient();
  const stream = await ai.models.generateContentStream({
    model: modelId,
    contents: history,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: 'HIGH' },
      temperature: 0.7,
      topP: 0.95,
    },
  });

  let assistantText = '';
  for await (const chunk of stream) {
    const candidate = chunk && chunk.candidates && chunk.candidates[0];
    const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : null;
    if (parts) {
      for (const part of parts) {
        const text = part && typeof part.text === 'string' ? part.text : '';
        if (!text) continue;
        assistantText += text;
        onDelta(text);
      }
      continue;
    }

    const text = chunk && typeof chunk.text === 'string' ? chunk.text : '';
    if (text) {
      assistantText += text;
      onDelta(text);
    }
  }

  assistantText = assistantText.trim();
  if (assistantText) {
    insertMessage(db, { conversationId, userId, role: 'assistant', contentText: assistantText, contentJson: null });

    // Auto-title (best-effort)
    if (!isNonEmptyString(conv.title)) {
      enqueueTitleTask(async () => {
        try {
          const title = await generateTitleFlashLite({ userText: msgText, assistantText });
          if (!title) return;
          const now = isoNow();
          db.prepare('UPDATE ai_conversations SET title=?, updated_at=? WHERE id=? AND user_id=?').run(title, now, conversationId, userId);
        } catch (_) {}
      });
    }
  }

  return { assistantText };
}

module.exports = {
  createOrReuseConversation,
  listConversations,
  getConversation,
  getMessages,
  streamConversationReply,
  safeJsonParse,
};
