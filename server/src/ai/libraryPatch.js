const { isoNow } = require('./time');

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(String(raw || ''));
  } catch (_) {
    return fallback;
  }
}

function isObject(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function normalizeString(v) {
  return typeof v === 'string' ? v : (v === null || v === undefined ? '' : String(v));
}

function normalizeOption(opt) {
  opt = isObject(opt) ? opt : {};
  return {
    label: normalizeString(opt.label).trim(),
    content: normalizeString(opt.content),
  };
}

function normalizeQuestion(q, fallbackId, defaultAi) {
  q = isObject(q) ? q : {};
  const options = ensureArray(q.options).map(normalizeOption).filter((o) => o.label);
  const rawId = q.id !== undefined && q.id !== null ? q.id : null;
  const id = rawId === '' || rawId === null ? fallbackId : rawId;
  return {
    id: id !== undefined && id !== null ? id : '',
    text: normalizeString(q.text),
    options,
    answer: normalizeString(q.answer).trim(),
    explanation: normalizeString(q.explanation),
    knowledgeTitle: normalizeString(q.knowledgeTitle),
    knowledge: normalizeString(q.knowledge),
    __ai: true,
    ai: isObject(q.ai) ? q.ai : (isObject(defaultAi) ? defaultAi : undefined),
  };
}

function findBook(appData, bookId) {
  if (!isObject(appData)) return null;
  const books = ensureArray(appData.books);
  for (const b of books) {
    if (b && typeof b.id === 'string' && b.id === bookId) return b;
  }
  return null;
}

function ensureBook(appData, bookId, bookMeta) {
  if (!isObject(appData)) return null;
  if (!Array.isArray(appData.books)) appData.books = [];

  const existing = findBook(appData, bookId);
  if (existing) return existing;

  const now = isoNow();
  const meta = isObject(bookMeta) ? bookMeta : {};
  const title = typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim() : '未命名书';
  const theme = typeof meta.theme === 'string' && meta.theme.trim() ? meta.theme.trim() : 'blue';
  const icon = typeof meta.icon === 'string' && meta.icon.trim() ? meta.icon.trim() : '✚';
  const includePresets = !!meta.includePresets;

  const book = {
    id: bookId,
    title,
    theme,
    icon,
    includePresets,
    chapters: [],
    folders: [],
    layoutMap: {},
    deletedChapterIds: [],
    createdAt: now,
    updatedAt: now,
  };

  appData.books.push(book);
  return book;
}

function makeChapterId(jobId, pageIndex) {
  return `ai_${String(jobId)}_${String(pageIndex)}`;
}

function mergeAiChapters(currentAppData, incomingAppData) {
  if (!isObject(currentAppData) || !isObject(incomingAppData)) return incomingAppData;
  const currentBooks = ensureArray(currentAppData.books);
  const incomingBooks = ensureArray(incomingAppData.books);

  const incomingById = new Map();
  for (const b of incomingBooks) {
    if (b && typeof b.id === 'string') incomingById.set(b.id, b);
  }

  for (const curBook of currentBooks) {
    if (!curBook || typeof curBook.id !== 'string') continue;
    const inBook = incomingById.get(curBook.id);
    if (!inBook || typeof inBook !== 'object') continue;

    const curChapters = ensureArray(curBook.chapters);
    if (!Array.isArray(inBook.chapters)) inBook.chapters = [];

    const inChapterIds = new Set(inBook.chapters.map((c) => (c && typeof c.id === 'string' ? c.id : '')));
    const inTombstones = new Set(ensureArray(inBook.deletedChapterIds).map((x) => (typeof x === 'string' ? x : String(x))));

    // Preserve tombstones across devices (union).
    const curTombstones = ensureArray(curBook.deletedChapterIds).map((x) => (typeof x === 'string' ? x : String(x)));
    if (!Array.isArray(inBook.deletedChapterIds)) inBook.deletedChapterIds = [];
    const inTombstoneSet = new Set(inBook.deletedChapterIds.map((x) => (typeof x === 'string' ? x : String(x))));
    for (const t of curTombstones) {
      if (t && !inTombstoneSet.has(t)) {
        inBook.deletedChapterIds.push(t);
        inTombstoneSet.add(t);
        inTombstones.add(t);
      }
    }

    // Preserve AI-inserted chapters if missing in incoming (and not tombstoned).
    for (const ch of curChapters) {
      const id = ch && typeof ch.id === 'string' ? ch.id : '';
      if (!id || !id.startsWith('ai_')) continue;
      if (inChapterIds.has(id)) continue;
      if (inTombstones.has(id)) continue;
      inBook.chapters.push(ch);
      inChapterIds.add(id);
    }
  }

  return incomingAppData;
}

function createLibraryPatcher(db) {
  function patchLibrary({ userId, bookId, jobId, pages, bookMeta }) {
    const sortedPages = ensureArray(pages).slice().sort((a, b) => Number(a.pageIndex) - Number(b.pageIndex));

    // Background jobs must not clobber concurrent user saves.
    // Use optimistic concurrency on `libraries.version` and retry a few times.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const row = db.prepare('SELECT data_json, version FROM libraries WHERE user_id = ?').get(userId);
      if (!row || !row.data_json) {
        const e = new Error('no library');
        e.name = 'NoLibrary';
        throw e;
      }

      const currentVersion = typeof row.version === 'number' ? row.version : Number(row.version) || 0;
      const appData = safeJsonParse(row.data_json, null);
      if (!isObject(appData)) throw new Error('library json invalid');

      const book = ensureBook(appData, bookId, bookMeta);
      if (!book) throw new Error('book not found');

      if (!Array.isArray(book.chapters)) book.chapters = [];

      const now = isoNow();
      const insertedChapters = [];
      const existingChapterIds = new Set(book.chapters.map((c) => (c && typeof c.id === 'string' ? c.id : '')));
      const tombstones = new Set(ensureArray(book.deletedChapterIds).map((x) => (typeof x === 'string' ? x : String(x))));

      for (const page of sortedPages) {
        const pageIndex = Number(page.pageIndex);
        if (!Number.isFinite(pageIndex) || pageIndex < 0) continue;

        const chapterId = makeChapterId(jobId, pageIndex);
        if (tombstones.has(chapterId)) continue;
        if (existingChapterIds.has(chapterId)) continue;

        const title = page && typeof page.title === 'string' && page.title.trim() ? page.title.trim() : `导入章节（${pageIndex + 1}）`;
        const questions = ensureArray(page.questions).map((q, idx) =>
          normalizeQuestion(q, idx + 1, { jobId, pageIndex, localIndex: idx })
        );

        const chapter = {
          id: chapterId,
          title,
          questions,
          isStatic: false,
          ai: { jobId, pageIndex, createdAt: now },
          createdAt: now,
          updatedAt: now,
        };

        book.chapters.push(chapter);
        existingChapterIds.add(chapterId);
        insertedChapters.push({ id: chapterId, title, pageIndex });
      }

      const nextVersion = currentVersion + 1;
      const updatedAt = isoNow();
      const payload = JSON.stringify(appData);

      const info = db
        .prepare('UPDATE libraries SET data_json=?, version=?, updated_at=? WHERE user_id=? AND version=?')
        .run(payload, nextVersion, updatedAt, userId, currentVersion);

      if (info && info.changes) return { insertedChapters, version: nextVersion, updatedAt };
    }

    const e = new Error('library updated concurrently; retry later');
    e.name = 'Conflict';
    throw e;
  }

  return { patchLibrary };
}

module.exports = { createLibraryPatcher, makeChapterId, mergeAiChapters };
