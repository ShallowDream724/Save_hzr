/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const { setupUndiciProxyFromEnv, getProxyUrlFromEnv } = require('../src/ai/outboundProxy');
const { finalizeImportJob, getModelId } = require('../src/ai/geminiClient');
const { computeRetryDelayMs } = require('../src/ai/importScheduler/helpers');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseDotEnv(text) {
  const out = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line || line.startsWith('#')) continue;
    const s = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = s.indexOf('=');
    if (eq <= 0) continue;
    const key = s.slice(0, eq).trim();
    let value = s.slice(eq + 1).trim();
    if (!key) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnvFromRepoRoot(repoRoot) {
  const candidates = [path.join(repoRoot, '.env'), path.join(repoRoot, '.env.local')];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, 'utf8');
      const kv = parseDotEnv(raw);
      for (const k of Object.keys(kv)) process.env[k] = kv[k];
      console.log(`[env] loaded: ${path.relative(repoRoot, p)}`);
    } catch (e) {
      console.warn(`[env] failed to load: ${p} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
}

function normalizeProxyUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    u.hash = '';
    u.search = '';
    const out = u.toString().replace(/\/+$/g, '');
    return out;
  } catch (_) {
    return s.replace(/\/+$/g, '');
  }
}

function isGoogleGeminiBaseUrl() {
  const raw =
    process.env.GEMINI_NEXT_GEN_API_BASE_URL ||
    process.env.GEMINI_BASE_URL ||
    process.env.GEMINI_API_BASE_URL;
  const s = String(raw || '').trim();
  if (!s) return true; // default is generativelanguage.googleapis.com
  try {
    const u = new URL(s);
    const host = String(u.host || '').toLowerCase();
    return host.endsWith('generativelanguage.googleapis.com') || host.endsWith('googleapis.com');
  } catch (_) {
    return false;
  }
}

function normalizeAnswerLabels(raw) {
  const s = (raw === undefined || raw === null) ? '' : String(raw);
  const m = s.toUpperCase().match(/[A-Z]/g);
  if (!m || !m.length) return '';
  const seen = new Set();
  const out = [];
  for (const ch of m) {
    if (seen.has(ch)) continue;
    seen.add(ch);
    out.push(ch);
  }
  out.sort();
  return out.join('');
}

function stripMsoImages(md) {
  let s = String(md || '');
  // Remove Word htmlclip image placeholders: ![img](file:///...msohtmlclip...)
  s = s.replace(/!\[[^\]]*?\]\(\s*file:\/\/\/[^)]+\)/gi, '');
  // Collapse excessive spaces on option lines after stripping images.
  s = s.replace(/[ \t]+\n/g, '\n');
  return s;
}

function stripHeadingHashes(line) {
  return String(line || '').replace(/^#+\s*/, '').trim();
}

function isBlank(line) {
  return !String(line || '').trim();
}

function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim().length > 0;
}

function findLineIndex(lines, pred) {
  for (let i = 0; i < lines.length; i++) if (pred(lines[i], i)) return i;
  return -1;
}

function splitInlineOptions(text) {
  const s = String(text || '');
  const re = /([A-Z])[\.\uFF0E、]\s*/g;
  const hits = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    hits.push({ label: m[1], idx: m.index, end: re.lastIndex });
  }
  if (!hits.length) return null;
  if (!(hits.length >= 2 || hits[0].idx === 0)) return null;

  const out = [];
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i];
    const next = hits[i + 1];
    const start = cur.end;
    const end = next ? next.idx : s.length;
    const content = s.slice(start, end).trim();
    out.push({ label: cur.label, content });
  }
  // Require at least 2 options when options are inline mid-line; reduces false positives.
  if (hits.length === 1 && hits[0].idx !== 0) return null;
  return out;
}

function parseChoiceQuestionsFromLines(lines) {
  const out = [];
  let cur = null;
  let curOpt = null;

  function finish() {
    if (!cur) return;
    cur.text = cur.textLines.join('\n').trim();
    delete cur.textLines;
    if (cur.options && cur.options.length) {
      for (const o of cur.options) {
        o.content = (o._lines || []).join('\n').trim();
        delete o._lines;
      }
    } else {
      cur.options = [];
    }
    out.push(cur);
    cur = null;
    curOpt = null;
  }

  for (const raw of lines) {
    const line = String(raw || '').replace(/\s+$/g, '');
    const t = line.trim();
    if (!t) continue;

    // New question
    const qm = t.match(/^(\d+)\.\s*(.*)$/);
    if (qm) {
      finish();
      cur = { num: Number(qm[1]), textLines: [String(qm[2] || '').trim()], options: [], answer: '' };
      curOpt = null;
      continue;
    }

    if (!cur) continue;

    // Option (line-start)
    const om = t.match(/^([A-Z])[\.\uFF0E、]\s*(.*)$/);
    if (om) {
      curOpt = { label: om[1].toUpperCase(), _lines: [String(om[2] || '').trim()] };
      cur.options.push(curOpt);
      continue;
    }

    // Option (inline)
    const inline = splitInlineOptions(t);
    if (inline) {
      for (const it of inline) {
        curOpt = { label: String(it.label || '').toUpperCase(), _lines: [String(it.content || '').trim()] };
        cur.options.push(curOpt);
      }
      continue;
    }

    // Continuations
    if (curOpt) {
      curOpt._lines.push(t);
    } else {
      cur.textLines.push(t);
    }
  }

  finish();
  return out;
}

function parseTextQuestionsFromLines(lines) {
  const out = [];
  let cur = null;

  function finish() {
    if (!cur) return;
    cur.text = cur.textLines.join('\n').trim();
    delete cur.textLines;
    out.push(cur);
    cur = null;
  }

  for (const raw of lines) {
    const line = String(raw || '').replace(/\s+$/g, '');
    const t = line.trim();
    if (!t) continue;

    const qm = t.match(/^(\d+)\.\s*(.*)$/);
    if (qm) {
      finish();
      cur = { num: Number(qm[1]), textLines: [String(qm[2] || '').trim()] };
      continue;
    }

    if (!cur) continue;
    cur.textLines.push(t);
  }

  finish();
  return out;
}

function parseSelection1(mdText) {
  const lines = String(mdText || '').split(/\r?\n/);
  const idxChoice = findLineIndex(lines, (l) => stripHeadingHashes(l).includes('一、选择题'));
  const idxX = findLineIndex(lines, (l) => stripHeadingHashes(l).startsWith('X型题'));
  const idxAns = findLineIndex(lines, (l) => stripHeadingHashes(l).includes('选择题答案'));
  const idxMultiAns = findLineIndex(lines, (l) => stripHeadingHashes(l).includes('多选题答案'));

  const choiceLines = idxChoice >= 0 && idxX > idxChoice ? lines.slice(idxChoice + 1, idxX) : [];
  const xLines = idxX >= 0 && idxAns > idxX ? lines.slice(idxX + 1, idxAns) : [];

  // Single-choice answers (ranges)
  const singleAnsLines = (idxAns >= 0)
    ? lines.slice(idxAns + 1, idxMultiAns > idxAns ? idxMultiAns : lines.length)
    : [];
  const singleAnswerMap = new Map();
  for (const raw of singleAnsLines) {
    const t = String(raw || '').trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s*-\s*(\d+)\s*(.*)$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
    const letters = (String(m[3] || '').toUpperCase().match(/[A-Z]/g) || []);
    const n = b - a + 1;
    if (letters.length < n) continue;
    for (let i = 0; i < n; i++) singleAnswerMap.set(a + i, letters[i]);
  }

  // Multi-choice answers (pairs like 1.ABD 2.DE)
  const multiAnsText = (idxMultiAns >= 0) ? lines.slice(idxMultiAns + 1).join('\n') : '';
  const multiAnswerMap = new Map();
  const re = /(\d+)\s*[\.\uFF0E]\s*([A-Za-z]+)/g;
  let mm;
  while ((mm = re.exec(multiAnsText)) !== null) {
    const n = Number(mm[1]);
    const ans = normalizeAnswerLabels(mm[2]);
    if (Number.isFinite(n) && ans) multiAnswerMap.set(n, ans);
  }

  const singleQs = parseChoiceQuestionsFromLines(choiceLines).map((q) => ({
    id: String(q.num),
    qid: String(q.num),
    text: q.text,
    options: (q.options || []).map((o) => ({ label: o.label, content: o.content })),
    answer: singleAnswerMap.has(q.num) ? String(singleAnswerMap.get(q.num)) : '',
    explanation: '',
    knowledgeTitle: '',
    knowledge: '',
  }));

  const multiQs = parseChoiceQuestionsFromLines(xLines).map((q) => ({
    id: String(q.num),
    qid: String(q.num),
    text: q.text,
    options: (q.options || []).map((o) => ({ label: o.label, content: o.content })),
    answer: multiAnswerMap.has(q.num) ? String(multiAnswerMap.get(q.num)) : '',
    explanation: '',
    knowledgeTitle: '',
    knowledge: '',
  }));

  return {
    chapters: [
      { title: '一、选择题', questions: singleQs },
      { title: 'X型题', questions: multiQs },
    ],
  };
}

function normalizeChapterKey(title) {
  return String(title || '')
    .replace(/^#+\s*/g, '')
    .replace(/\s+/g, '')
    .replace(/[：:]/g, '')
    .trim();
}

function detectChapterHeading(line) {
  const t = stripHeadingHashes(line);
  if (!t) return null;
  if (/^第[一二三四五六七八九十百0-9]+章/.test(t)) return t;
  return null;
}

function detectSectionKind(line) {
  const t = stripHeadingHashes(line).replace(/\s+/g, '');
  if (!t) return null;
  if (t.includes('单项选择题') || t.includes('单选题')) return 'single';
  if (t.includes('多项选择题') || t.includes('多选题')) return 'multi';
  if (t.includes('名词解释')) return 'term';
  if (t.includes('简答题')) return 'short';
  return null;
}

function splitSelection2IntoParts(lines) {
  const idxAns = findLineIndex(lines, (l) => stripHeadingHashes(l).includes('参考答案'));
  if (idxAns < 0) return { questionLines: lines.slice(), answerLines: [] };
  return { questionLines: lines.slice(0, idxAns), answerLines: lines.slice(idxAns + 1) };
}

function collectChapterSections(lines) {
  const chapters = [];
  let cur = null;
  let curSec = null;

  function ensureSec(kind) {
    if (!cur) return;
    if (!cur.sections[kind]) cur.sections[kind] = [];
    curSec = kind;
  }

  for (const raw of lines) {
    const line = String(raw || '');
    const chap = detectChapterHeading(line);
    if (chap) {
      cur = { title: chap, key: normalizeChapterKey(chap), sections: {} };
      chapters.push(cur);
      curSec = null;
      continue;
    }

    const sec = detectSectionKind(line);
    if (sec) {
      ensureSec(sec);
      continue;
    }

    if (!cur || !curSec) continue;
    cur.sections[curSec].push(line);
  }

  return chapters;
}

function parseSelection2Questions(questionLines) {
  const chBlocks = collectChapterSections(questionLines);
  const out = [];
  for (const ch of chBlocks) {
    const single = parseChoiceQuestionsFromLines(ch.sections.single || []);
    const multi = parseChoiceQuestionsFromLines(ch.sections.multi || []);
    const term = parseTextQuestionsFromLines(ch.sections.term || []);
    const short = parseTextQuestionsFromLines(ch.sections.short || []);
    out.push({
      title: ch.title,
      key: ch.key,
      questions: { single, multi, term, short },
    });
  }
  return out;
}

function parseSelection2Answers(answerLines) {
  const chBlocks = collectChapterSections(answerLines);
  const outByKey = new Map();

  function parseNumberedTextBlock(lines2) {
    const items = new Map();
    let cur = null;
    function finish() {
      if (!cur) return;
      items.set(cur.num, cur.lines.join('\n').trim());
      cur = null;
    }
    for (const raw of lines2) {
      const t = String(raw || '').replace(/\s+$/g, '');
      const s = t.trim();
      if (!s) continue;
      if (s.startsWith('#')) continue;
      const m = s.match(/^(\d+)\.\s*(.*)$/);
      if (m) {
        finish();
        cur = { num: Number(m[1]), lines: [String(m[2] || '').trim()] };
        continue;
      }
      if (cur) cur.lines.push(s);
    }
    finish();
    return items;
  }

  function parseAnswerPairs(lines2) {
    const map = new Map();
    const text = lines2.join('\n');
    const re = /(\d+)\s*[\.\uFF0E]\s*([A-Za-z]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = Number(m[1]);
      const ans = normalizeAnswerLabels(m[2]);
      if (Number.isFinite(n) && ans) map.set(n, ans);
    }
    return map;
  }

  for (const ch of chBlocks) {
    outByKey.set(ch.key, {
      title: ch.title,
      key: ch.key,
      single: parseAnswerPairs(ch.sections.single || []),
      multi: parseAnswerPairs(ch.sections.multi || []),
      term: parseNumberedTextBlock(ch.sections.term || []),
      short: parseNumberedTextBlock(ch.sections.short || []),
    });
  }

  return outByKey;
}

function parseSelection2(mdText) {
  const lines = String(mdText || '').split(/\r?\n/);
  const { questionLines, answerLines } = splitSelection2IntoParts(lines);
  const qChapters = parseSelection2Questions(questionLines);
  const aByKey = parseSelection2Answers(answerLines);

  const chapters = [];
  for (const ch of qChapters) {
    const ans = aByKey.get(ch.key) || null;
    const combined = [];

    function pushChoice(typeKey, typeLabel, list, map) {
      for (const q of list) {
        const a = map && map.has(q.num) ? String(map.get(q.num)) : '';
        combined.push({
          id: typeLabel + String(q.num),
          qid: typeKey + '_' + String(q.num),
          text: q.text,
          options: (q.options || []).map((o) => ({ label: o.label, content: o.content })),
          answer: a,
          explanation: '',
          knowledgeTitle: '',
          knowledge: '',
        });
      }
    }

    function pushText(typeKey, typeLabel, list, map) {
      for (const q of list) {
        const a = map && map.has(q.num) ? String(map.get(q.num)) : '';
        combined.push({
          id: typeLabel + String(q.num),
          qid: typeKey + '_' + String(q.num),
          text: q.text,
          options: [],
          answer: a,
          explanation: '',
          knowledgeTitle: '',
          knowledge: '',
        });
      }
    }

    pushChoice('sc', '单选', ch.questions.single || [], ans ? ans.single : null);
    pushChoice('mc', '多选', ch.questions.multi || [], ans ? ans.multi : null);
    pushText('term', '名词', ch.questions.term || [], ans ? ans.term : null);
    pushText('sa', '简答', ch.questions.short || [], ans ? ans.short : null);

    chapters.push({ title: ch.title, questions: combined });
  }

  return { chapters };
}

function parseSelection3(mdText) {
  const cleaned = stripMsoImages(mdText);
  const lines = String(cleaned || '').split(/\r?\n/);
  const questions = [];
  let cur = null;
  let curOpt = null;

  function finish() {
    if (!cur) return;
    cur.text = cur.textLines.join('\n').trim();
    delete cur.textLines;
    if (cur.options && cur.options.length) {
      for (const o of cur.options) o.content = (o._lines || []).join('\n').trim();
    } else cur.options = [];
    for (const o of cur.options) delete o._lines;
    questions.push(cur);
    cur = null;
    curOpt = null;
  }

  for (const raw of lines) {
    const line = String(raw || '').replace(/\s+$/g, '');
    const t = line.trim();
    if (!t) continue;

    if (/^\d+$/.test(t)) {
      finish();
      cur = { num: Number(t), id: t, qid: t, textLines: [], options: [], answer: '', explanation: '', knowledgeTitle: '', knowledge: '' };
      curOpt = null;
      continue;
    }

    if (!cur) continue;

    const am = t.match(/我的答案[:：]\s*([A-Za-z]+)/);
    if (am) {
      cur.answer = normalizeAnswerLabels(am[1]);
      curOpt = null;
      continue;
    }

    // Option line (bullet + label)
    const optLine = t.replace(/^·\s*/, '').trim();
    const om = optLine.match(/^([A-Z])[\.\uFF0E、]\s*(.*)$/i);
    if (om) {
      curOpt = { label: String(om[1]).toUpperCase(), _lines: [String(om[2] || '').trim()] };
      cur.options.push(curOpt);
      continue;
    }

    if (curOpt) curOpt._lines.push(optLine);
    else cur.textLines.push(optLine);
  }

  finish();

  const outQs = questions.map((q) => ({
    id: String(q.num),
    qid: String(q.num),
    text: q.text,
    options: (q.options || []).map((o) => ({ label: o.label, content: o.content })),
    answer: q.answer || '',
    explanation: '',
    knowledgeTitle: '',
    knowledge: '',
  }));

  return { chapters: [{ title: '选择题', questions: outQs }], cleanedText: cleaned };
}

function buildBookLibrary({ parts }) {
  const folders = [];
  const chapters = [];
  const layoutMap = {};

  function newId(prefix, n) {
    return prefix + '_' + String(n).padStart(3, '0');
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const folderId = newId('f', i + 1);
    folders.push({ id: folderId, title: part.folderTitle, isOpen: true });

    for (let j = 0; j < part.chapters.length; j++) {
      const chIn = part.chapters[j];
      const chId = newId('ch', chapters.length + 1);
      chapters.push({
        id: chId,
        title: chIn.title,
        questions: chIn.questions,
        isStatic: false,
      });
      layoutMap[chId] = folderId;
    }
  }

  return {
    folders,
    chapters,
    layoutMap,
    chapterOrder: {},
    chapterTitleOverrides: {},
    favorites: {},
    study: {},
    deletedChapterIds: [],
  };
}

function buildGeminiNoteText() {
  return [
    '请用中文输出解析与知识点（Markdown + LaTeX 友好），并使用我们 UI 的强调样式：',
    '- <span class="highlight">...</span>',
    '- <span class="bold-em">...</span>',
    '- <span class="underline-em">...</span>',
    '',
    '输出结构要求：必须严格保持输入 pages/questions 的结构不变；不要新增/删除/拆分/合并题目。',
    '重要：输入中的 answer 是题库参考答案。',
    '如果你认为参考答案可能错误/有争议，必须在解析开头用高亮写出“警示：参考答案可能有误”，并给出充分理由与更合理的答案（但不要修改 answer 字段）。',
    '如果题干/选项信息不足，请说明缺失信息，不要编造。',
  ].join('\n');
}

async function enrichWithGemini({ parts, concurrency, startIntervalMs, checkpoint }) {
  const noteText = buildGeminiNoteText();
  const batchSize = clampInt(readIntEnv('AI_IMPORT_BATCH_SIZE', 10), 1, 20);

  function normalizeId(raw) {
    if (raw === undefined || raw === null) return '';
    return String(raw).trim();
  }

  function normalizeText(raw) {
    return String(raw || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function applyLearningFields(dst, src) {
    dst.explanation = typeof src.explanation === 'string' ? src.explanation : '';
    dst.knowledgeTitle = typeof src.knowledgeTitle === 'string' ? src.knowledgeTitle : '';
    dst.knowledge = typeof src.knowledge === 'string' ? src.knowledge : '';
  }

  function mergeFinalizeOutputIntoTask({ taskTitle, taskQuestions, outQuestions }) {
    const expected = taskQuestions.length;
    const got = Array.isArray(outQuestions) ? outQuestions.length : 0;

    if (got === expected) {
      for (let qi = 0; qi < expected; qi++) {
        applyLearningFields(taskQuestions[qi], outQuestions[qi] || {});
      }
      return;
    }

    console.warn(`[ai] warning: ${taskTitle} output question count mismatch: got ${got}, want ${expected}; using id-based merge`);
    const outById = new Map();
    const outByText = new Map();
    for (const q of Array.isArray(outQuestions) ? outQuestions : []) {
      const t = normalizeText(q && q.text);
      if (t) {
        if (!outByText.has(t)) outByText.set(t, []);
        outByText.get(t).push(q);
      }

      const id = normalizeId(q && q.id);
      if (!id) continue;
      if (!outById.has(id)) outById.set(id, []);
      outById.get(id).push(q);
    }

    for (const dst of taskQuestions) {
      const id = normalizeId(dst && dst.id);
      const list = id ? outById.get(id) : null;
      let src = list && list.length ? list.shift() : null;
      if (!src) {
        const t = normalizeText(dst && dst.text);
        const tl = t ? outByText.get(t) : null;
        src = tl && tl.length ? tl.shift() : null;
      }
      if (!src) {
        throw new Error(`bad output mapping: missing id=${id || '(empty)'} for ${taskTitle} (got ${got}, want ${expected})`);
      }
      applyLearningFields(dst, src);
    }
  }

  function needsAi(q) {
    return (
      !q ||
      !isNonEmptyString(q.explanation) ||
      !isNonEmptyString(q.knowledgeTitle) ||
      !isNonEmptyString(q.knowledge)
    );
  }

  async function callFinalizeWithRetry(payload) {
    const qCount = (() => {
      const pages = payload && Array.isArray(payload.pages) ? payload.pages : [];
      const qs = pages[0] && Array.isArray(pages[0].questions) ? pages[0].questions : [];
      return qs.length;
    })();

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await finalizeImportJob(payload);
      } catch (e) {
        const name = (e && e.name) ? String(e.name) : '';
        const msg = e instanceof Error ? e.message : String(e);
        const low = String(msg || '').toLowerCase();
        const isAbort = name === 'AbortError' || low.includes('aborterror') || low.includes('aborted');
        if (isAbort && qCount > 1) throw e;

        if (attempt >= 3) throw e;
        const is429 = name === 'RateLimited' || msg.includes('429') || msg.toLowerCase().includes('rate');
        const delay = computeRetryDelayMs(attempt, is429);
        console.warn(`[ai] retry ${attempt + 1}/3 in ${Math.ceil(delay / 1000)}s: ${name || 'Error'} ${msg}`);
        await sleep(delay);
      }
    }
    throw new Error('unreachable');
  }

  const tasks = [];
  let totalQuestions = 0;
  let todoQuestions = 0;
  for (const part of parts) {
    for (const ch of part.chapters) {
      const qs = Array.isArray(ch.questions) ? ch.questions : [];
      totalQuestions += qs.length;
      const todo = qs.filter(needsAi);
      todoQuestions += todo.length;
      for (let i = 0; i < todo.length; i += batchSize) {
        const slice = todo.slice(i, i + batchSize);
        tasks.push({
          title: `${part.folderTitle} / ${ch.title}`,
          questions: slice,
          attempt: 1,
        });
      }
    }
  }

  console.log(`[ai] batches: ${tasks.length} (<=${batchSize} questions each), todo questions: ${todoQuestions}/${totalQuestions}`);
  if (!tasks.length) return;

  const maxAttempts = 3;
  const queue = tasks.slice();
  let doneQuestions = totalQuestions - todoQuestions;
  let wave = 0;

  async function runTask(task) {
    const inputQuestions = task.questions.map((q) => ({
      id: q.id,
      text: q.text,
      options: q.options,
      answer: q.answer,
      explanation: '',
      knowledgeTitle: '',
      knowledge: '',
    }));

    const args = await callFinalizeWithRetry({
      model: 'pro',
      pages: [{ pageIndex: 0, title: task.title, questions: inputQuestions }],
      noteText: `${noteText}\n\n本次输入 questions 数量=${inputQuestions.length}；输出 questions 数量必须完全一致，且顺序与 id 必须保持一致。`,
    });

    const outPages = args && Array.isArray(args.pages) ? args.pages : [];
    const outQs = outPages[0] && Array.isArray(outPages[0].questions) ? outPages[0].questions : [];
    mergeFinalizeOutputIntoTask({ taskTitle: task.title, taskQuestions: task.questions, outQuestions: outQs });
    return true;
  }

  while (queue.length) {
    wave += 1;
    const waveStart = Date.now();
    const chunk = queue.splice(0, concurrency);
    console.log(`[ai] wave ${wave}: done ${doneQuestions}/${totalQuestions}, processing ${chunk.length} batches, remaining ${queue.length}`);

    const promises = [];
    for (let i = 0; i < chunk.length; i++) {
      const task = chunk[i];
      if (i > 0) await sleep(startIntervalMs);
      promises.push(runTask(task));
    }

    const settled = await Promise.allSettled(promises);
    let ok = 0;
    let fail = 0;
    let fatal = null;
    for (let i = 0; i < settled.length; i++) {
      const res = settled[i];
      const task = chunk[i];
      if (res.status === 'fulfilled') {
        ok += 1;
        doneQuestions += task.questions.length;
        continue;
      }

      fail += 1;
      const err = res.reason;
      const msg = err instanceof Error ? err.message : String(err);
      const name = err && err.name ? String(err.name) : '';
      const low = String(msg || '').toLowerCase();
      const isBadOutput = name === 'BadModelOutput' || low.includes('bad output') || low.includes('bad output mapping');
      const isTransportError =
        name === 'AbortError' ||
        name === 'NetworkError' ||
        low.includes('aborterror') ||
        low.includes('aborted') ||
        low.includes('fetch failed') ||
        low.includes('sending request') ||
        low.includes('econnreset') ||
        low.includes('etimedout') ||
        low.includes('socket') ||
        low.includes('tls');

      if ((isBadOutput || isTransportError) && task.questions.length > 1) {
        const mid = Math.ceil(task.questions.length / 2);
        const a = task.questions.slice(0, mid);
        const b = task.questions.slice(mid);
        if (a.length) queue.push({ title: task.title, questions: a, attempt: 1 });
        if (b.length) queue.push({ title: task.title, questions: b, attempt: 1 });
        console.warn(`[ai] split+requeue: ${task.title} ${task.questions.length} -> ${a.length}+${b.length} (${name || 'Error'} ${msg})`);
        continue;
      }

      const nextAttempt = Number(task.attempt || 1) + 1;
      if (nextAttempt <= maxAttempts) {
        queue.push({ ...task, attempt: nextAttempt });
        console.warn(`[ai] retry+requeue: ${task.title} n=${task.questions.length} attempt=${nextAttempt}/${maxAttempts} (${name || 'Error'} ${msg})`);
        continue;
      }

      if (!fatal) fatal = err;
    }

    console.log(`[ai] wave ${wave} done: ok=${ok}, fail=${fail}, remaining ${queue.length}`);

    if (typeof checkpoint === 'function') {
      await checkpoint({ wave, doneQuestions, totalQuestions, remainingBatches: queue.length });
    }

    if (fatal) throw fatal;

    // Enforce per-model RPM: spread request starts across time.
    const rpm = clampInt(readIntEnv('AI_IMPORT_PRO_RPM', 10), 1, 60_000);
    const minWaveMs = Math.ceil((60_000 / rpm) * chunk.length);
    const elapsed = Date.now() - waveStart;
    if (elapsed < minWaveMs) {
      await sleep(minWaveMs - elapsed);
    }
  }
}

function writeJson(p, obj) {
  const dir = path.dirname(p);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function writeText(p, text) {
  const dir = path.dirname(p);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  fs.writeFileSync(p, String(text || ''), 'utf8');
}

function readIntEnv(name, fallback) {
  const raw = process.env[name];
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.floor(n);
  return fallback;
}

function clampInt(n, min, max) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return min;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function safeReadJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[resume] failed to read json: ${p} (${msg})`);
    return null;
  }
}

function buildEnrichmentKey(folderTitle, chapterTitle, qid) {
  const a = String(folderTitle || '').trim();
  const b = String(chapterTitle || '').trim();
  const c = String(qid || '').trim();
  if (!a || !b || !c) return '';
  return `${a}|||${b}|||${c}`;
}

function mergeExistingEnrichmentFromDefaultSeed({ repoRoot, parts }) {
  const seedPath = path.join(repoRoot, 'web', 'default_epidemiology.json');
  const seed = safeReadJson(seedPath);
  const data = seed && seed.data && typeof seed.data === 'object' ? seed.data : null;
  const chapters = data && Array.isArray(data.chapters) ? data.chapters : null;
  if (!chapters) return 0;

  const folders = Array.isArray(data.folders) ? data.folders : [];
  const layoutMap = data.layoutMap && typeof data.layoutMap === 'object' ? data.layoutMap : {};
  const folderTitleById = new Map(folders.map((f) => [String(f && f.id), String((f && f.title) || '')]));

  const fieldsByKey = new Map();
  for (const ch of chapters) {
    const chapterId = ch && ch.id !== undefined && ch.id !== null ? String(ch.id) : '';
    const folderId = Object.prototype.hasOwnProperty.call(layoutMap, chapterId) ? layoutMap[chapterId] : '';
    const folderTitle = folderId ? String(folderTitleById.get(String(folderId)) || '') : '';
    const chapterTitle = ch && typeof ch.title === 'string' ? ch.title : '';
    const qs = ch && Array.isArray(ch.questions) ? ch.questions : [];
    for (const q of qs) {
      const qid = q && q.qid !== undefined && q.qid !== null ? String(q.qid) : (q && q.id !== undefined && q.id !== null ? String(q.id) : '');
      const key = buildEnrichmentKey(folderTitle, chapterTitle, qid);
      if (!key) continue;
      const explanation = q && typeof q.explanation === 'string' ? q.explanation : '';
      const knowledgeTitle = q && typeof q.knowledgeTitle === 'string' ? q.knowledgeTitle : '';
      const knowledge = q && typeof q.knowledge === 'string' ? q.knowledge : '';
      if (!isNonEmptyString(explanation) && !isNonEmptyString(knowledgeTitle) && !isNonEmptyString(knowledge)) continue;
      fieldsByKey.set(key, { explanation, knowledgeTitle, knowledge });
    }
  }

  let mergedQuestions = 0;
  for (const part of parts) {
    for (const ch of part.chapters) {
      const qs = Array.isArray(ch.questions) ? ch.questions : [];
      for (const q of qs) {
        const qid = q && q.qid !== undefined && q.qid !== null ? String(q.qid) : (q && q.id !== undefined && q.id !== null ? String(q.id) : '');
        const key = buildEnrichmentKey(part.folderTitle, ch.title, qid);
        const found = key ? fieldsByKey.get(key) : null;
        if (!found) continue;

        let touched = false;
        if (!isNonEmptyString(q.explanation) && isNonEmptyString(found.explanation)) {
          q.explanation = found.explanation;
          touched = true;
        }
        if (!isNonEmptyString(q.knowledgeTitle) && isNonEmptyString(found.knowledgeTitle)) {
          q.knowledgeTitle = found.knowledgeTitle;
          touched = true;
        }
        if (!isNonEmptyString(q.knowledge) && isNonEmptyString(found.knowledge)) {
          q.knowledge = found.knowledge;
          touched = true;
        }
        if (touched) mergedQuestions += 1;
      }
    }
  }

  if (mergedQuestions) console.log(`[resume] merged questions from web/default_epidemiology.json: ${mergedQuestions}`);
  return mergedQuestions;
}

function clearEnrichmentFields(parts) {
  for (const part of parts || []) {
    for (const ch of (part && part.chapters) || []) {
      for (const q of (ch && ch.questions) || []) {
        q.explanation = '';
        q.knowledgeTitle = '';
        q.knowledge = '';
      }
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const skipAi = argv.includes('--skip-ai');
  const forceAi = argv.includes('--force-ai') || argv.includes('--rebuild-ai') || argv.includes('--reset-ai');
  const repoRoot = path.resolve(__dirname, '..', '..');

  loadEnvFromRepoRoot(repoRoot);
  process.env.AI_IMPORT_THINKING_LEVEL = 'HIGH';

  if (isGoogleGeminiBaseUrl()) {
    const enforceProxy = ['1', 'true', 'yes'].includes(String(process.env.AI_ENFORCE_GOOGLE_PROXY || '').trim().toLowerCase());
    const requiredProxy = normalizeProxyUrl(process.env.AI_REQUIRED_GOOGLE_PROXY_URL || 'http://127.0.0.1:10808');
    const proxyFromEnv = normalizeProxyUrl(getProxyUrlFromEnv());
    if (enforceProxy && proxyFromEnv !== requiredProxy) {
      throw new Error(`Google Gemini is configured but required proxy mismatch: want ${requiredProxy}, got ${proxyFromEnv || '(empty)'}`);
    }
    if (proxyFromEnv) {
      const proxyState = setupUndiciProxyFromEnv();
      if (!proxyState || !proxyState.enabled) throw new Error('Proxy setup failed (AI_HTTP_PROXY)');
    } else if (enforceProxy) {
      throw new Error('Google Gemini is configured but proxy is not set (AI_HTTP_PROXY)');
    }
  } else {
    // Non-Google gateways may break with local proxy; ignore proxy env by default.
  }

  const srcDir = path.join(repoRoot, '新题库');
  const file1 = path.join(srcDir, '流行病-选择1_2026-01-01-16_55_08.md');
  const file2 = path.join(srcDir, '流行病_选择2_2026-01-01-16_55_18.md');
  const file3 = path.join(srcDir, '流行病选择题.md');

  const md1 = fs.readFileSync(file1, 'utf8');
  const md2 = fs.readFileSync(file2, 'utf8');
  const md3 = fs.readFileSync(file3, 'utf8');

  const p1 = parseSelection1(md1);
  const p2 = parseSelection2(md2);
  const p3 = parseSelection3(md3);

  // Write cleaned md for the Word-export file (optional, for inspection).
  writeText(path.join(srcDir, 'clean', '流行病选择题.clean.md'), p3.cleanedText);

  const parts = [
    { folderTitle: '流行病-选择1_2026-01-01-16_55_08.md', chapters: p1.chapters },
    { folderTitle: '流行病_选择2_2026-01-01-16_55_18.md', chapters: p2.chapters },
    { folderTitle: '流行病选择题.md', chapters: p3.chapters },
  ];

  if (forceAi) {
    console.warn('[ai] --force-ai: clearing existing explanation/knowledge fields for full regeneration');
    clearEnrichmentFields(parts);
  }

  const lib = buildBookLibrary({ parts });
  console.log(`[build] folders=${lib.folders.length}, chapters=${lib.chapters.length}`);
  console.log(`[build] total questions=${lib.chapters.reduce((n, c) => n + ((c.questions || []).length), 0)}`);

  const exportBook = {
    books: [
      {
        title: '流行病学',
        theme: 'teal',
        icon: '🦠',
        includePresets: false,
        folders: lib.folders,
        chapters: lib.chapters,
        layoutMap: lib.layoutMap,
        chapterOrder: lib.chapterOrder,
        chapterTitleOverrides: lib.chapterTitleOverrides,
        favorites: lib.favorites,
        study: lib.study,
        deletedChapterIds: lib.deletedChapterIds,
      },
    ],
  };

  function writeOutputs() {
    writeJson(path.join(srcDir, '流行病学_导入.json'), exportBook);
    writeJson(path.join(repoRoot, 'web', 'default_epidemiology.json'), {
      exportedAt: new Date().toISOString(),
      app: '拯救Hzr',
      data: {
        chapters: lib.chapters,
        folders: lib.folders,
        layoutMap: lib.layoutMap,
        deletedChapterIds: lib.deletedChapterIds,
      },
    });
  }

  if (!forceAi) mergeExistingEnrichmentFromDefaultSeed({ repoRoot, parts });
  else console.log('[resume] skipped (force-ai)');
  writeOutputs();

  if (skipAi) console.log('[ai] --skip-ai: skipping Gemini enrichment');
  else {
    const rpm = clampInt(readIntEnv('AI_IMPORT_PRO_RPM', 10), 1, 60);
    const maxInFlight = clampInt(readIntEnv('AI_IMPORT_PRO_MAX_IN_FLIGHT', 10), 1, 60);
    const startIntervalMs = clampInt(readIntEnv('AI_IMPORT_MIN_START_INTERVAL_MS', 1000), 0, 60_000);
    const concurrency = clampInt(Math.min(rpm, maxInFlight), 1, 60);

    const modelId = getModelId('pro');
    console.log(`[ai] model=pro (${modelId}), thinking=HIGH, rpm=${rpm}, concurrency=${concurrency}, startIntervalMs=${startIntervalMs}`);
    await enrichWithGemini({
      parts,
      concurrency,
      startIntervalMs,
      checkpoint: ({ wave, doneQuestions, totalQuestions, remainingBatches }) => {
        writeOutputs();
        console.log(`[checkpoint] wave=${wave}, done=${doneQuestions}/${totalQuestions}, remainingBatches=${remainingBatches}`);
      },
    });
  }

  writeOutputs();
  console.log(`[out] 新题库/流行病学_导入.json`);
  console.log(`[out] web/default_epidemiology.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
