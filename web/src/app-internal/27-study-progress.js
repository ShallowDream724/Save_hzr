/** ---------------------------
 * 27) 学习进度（错题 / 未做 / 艾宾浩斯复习）
 * - 数据保存在 book.study（仅记录做过的题）
 * - 设计目标：体积小、写入节流、跨设备同步
 * --------------------------- */

var STUDY_INTERVALS_MS = [
  20 * 60 * 1000,        // 20 min
  8 * 60 * 60 * 1000,    // 8 hours
  1 * 24 * 60 * 60 * 1000, // 1 day
  2 * 24 * 60 * 60 * 1000, // 2 days
  7 * 24 * 60 * 60 * 1000, // 7 days
  15 * 24 * 60 * 60 * 1000, // 15 days
  30 * 24 * 60 * 60 * 1000  // 30 days
];

function studyNow() { return Date.now ? Date.now() : new Date().getTime(); }

function studyKey(chapterId, qid) {
  return String(chapterId || '') + '|' + String(qid || '');
}

function getBookStudy(book) {
  book = book || getActiveBook();
  if (!book || typeof book !== 'object') return {};
  if (!book.study || typeof book.study !== 'object' || Array.isArray(book.study)) book.study = {};
  return book.study;
}

function studyGetRec(chapterId, qid, book) {
  chapterId = String(chapterId || '');
  qid = String(qid || '');
  if (!chapterId || !qid) return null;
  var st = getBookStudy(book);
  var k = studyKey(chapterId, qid);
  return (st && Object.prototype.hasOwnProperty.call(st, k)) ? st[k] : null;
}

function studyIsWrong(chapterId, qid, book) {
  var r = studyGetRec(chapterId, qid, book);
  return !!(r && r.s === 1);
}

function studyIsUnseen(chapterId, qid, book) {
  return !studyGetRec(chapterId, qid, book);
}

function studyIsDue(chapterId, qid, book, nowMs) {
  var r = studyGetRec(chapterId, qid, book);
  if (!r) return false;
  var n = Number(r.n);
  if (!Number.isFinite(n) || n <= 0) return false;
  var now = (nowMs !== undefined && nowMs !== null) ? Number(nowMs) : studyNow();
  if (!Number.isFinite(now)) now = studyNow();
  return n <= now;
}

function studyNextAt(level, correct, nowMs) {
  var now = (nowMs !== undefined && nowMs !== null) ? Number(nowMs) : studyNow();
  if (!Number.isFinite(now)) now = studyNow();

  if (!correct) return now + STUDY_INTERVALS_MS[0];
  level = Number(level) || 0;
  if (level <= 0) return now + STUDY_INTERVALS_MS[0];
  var idx = Math.min(STUDY_INTERVALS_MS.length - 1, Math.max(0, level - 1));
  return now + STUDY_INTERVALS_MS[idx];
}

var studySaveTimer = 0;
function studyScheduleSave() {
  if (studySaveTimer) return;
  studySaveTimer = setTimeout(function () {
    studySaveTimer = 0;
    try { saveData(); } catch (_) {}
  }, 650);
}

function studyUpdateOnAnswer(chapterId, qid, correct) {
  var book = getActiveBook();
  if (!book) return;
  chapterId = String(chapterId || '');
  qid = String(qid || '');
  if (!chapterId || !qid) return;

  var st = getBookStudy(book);
  var k = studyKey(chapterId, qid);
  var rec = (st && Object.prototype.hasOwnProperty.call(st, k) && st[k] && typeof st[k] === 'object') ? st[k] : null;
  if (!rec) rec = { s: 0, w: 0, c: 0, l: 0, t: 0, n: 0 };

  var now = studyNow();
  var ok = !!correct;

  if (ok) {
    rec.s = 2;
    rec.c = (Number(rec.c) || 0) + 1;
    rec.l = Math.min(12, (Number(rec.l) || 0) + 1);
  } else {
    rec.s = 1;
    rec.w = (Number(rec.w) || 0) + 1;
    rec.l = 0;
  }

  rec.t = now;
  rec.n = studyNextAt(rec.l, ok, now);
  st[k] = rec;

  try { book.updatedAt = new Date().toISOString(); } catch (_) {}
  studyScheduleSave();
}

