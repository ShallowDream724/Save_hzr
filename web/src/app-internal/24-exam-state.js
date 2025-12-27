/** ---------------------------
 * 14) 考试模式：状态/持久化/抽题
 * --------------------------- */

var EXAM_STORE_KEY = 'hzr_exam_state_v1';

var exam = {
  active: false,
  phase: 'idle', // idle | picker | running | result
  bookId: null,
  bookTitle: '',
  returnState: null,

  // picker model (in-memory)
  pool: null, // { folders: [{id,title,chapters:[{id,title,count,questions:[{qid,idx}]}],count}], root: {...}, total }

  // running
  selectedChapterIds: [],
  totalQuestions: 0,
  questions: [], // [{ folderId, folderTitle, chapterId, chapterTitle, qid, idx }]
  answers: {}, // key -> { picked, correct }
  correctCount: 0,
  streak: 0,

  // timing
  elapsedMs: 0,
  _tickTimer: 0,
  _tickBase: 0,
  _tickStartAt: 0
};

function examNow() { return Date.now ? Date.now() : new Date().getTime(); }

function examCaptureReturnState() {
  var st = {
    at: new Date().toISOString(),
    homeVisible: !!homeVisible,
    bookId: (appData && typeof appData.currentBookId === 'string' && appData.currentBookId) ? String(appData.currentBookId) : null,
    chapterId: (typeof currentChapterId === 'string' && currentChapterId) ? String(currentChapterId) : null,
    scrollY: 0,
    homeScrollTop: 0
  };
  try { st.scrollY = (typeof getScrollY === 'function') ? Number(getScrollY()) || 0 : 0; } catch (_) { st.scrollY = 0; }
  try {
    var sc = null;
    if (els && els.homeView && els.homeView.querySelector) sc = els.homeView.querySelector('.home-scroll');
    if (!sc) sc = document.querySelector('.home-scroll');
    if (sc) st.homeScrollTop = Number(sc.scrollTop) || 0;
  } catch (_) { st.homeScrollTop = 0; }
  return st;
}

function examRestoreReturnState() {
  var st = exam.returnState;
  exam.returnState = null;
  if (!st || typeof st !== 'object') return;

  var wantBookId = (typeof st.bookId === 'string' && st.bookId) ? String(st.bookId) : null;
  try {
    var curBookId = (appData && typeof appData.currentBookId === 'string' && appData.currentBookId) ? String(appData.currentBookId) : null;
    if (wantBookId && curBookId !== wantBookId) setActiveBook(wantBookId);
  } catch (_) {}

  // Restore view (home vs chapter) + chapter id
  var wantHome = !!st.homeVisible;
  var wantChapterId = (typeof st.chapterId === 'string' && st.chapterId) ? String(st.chapterId) : null;

  if (wantHome) {
    try { showHomeView(); } catch (_) {}
    // Restore home scroll position after unlock.
    var top = Math.max(0, Number(st.homeScrollTop) || 0);
    setTimeout(function () {
      try {
        var sc = null;
        if (els && els.homeView && els.homeView.querySelector) sc = els.homeView.querySelector('.home-scroll');
        if (!sc) sc = document.querySelector('.home-scroll');
        if (sc) sc.scrollTop = top;
      } catch (_) {}
    }, 0);
    return;
  }

  // Not home: try restore chapter view, else fall back to blank "请选择章节"
  if (wantChapterId) {
    var already = false;
    try {
      var curCh = (typeof currentChapterId === 'string' && currentChapterId) ? String(currentChapterId) : null;
      already = !homeVisible && curCh === wantChapterId;
    } catch (_) { already = false; }

    if (!already) {
      try {
        var ok = !!(findChapterById(wantChapterId) && !isDeleted(wantChapterId));
        if (ok) loadChapter(wantChapterId);
      } catch (_) {}
    }
  } else {
    try { hideHomeView(); } catch (_) {}
    try { currentChapterId = null; } catch (_) {}
    try {
      if (typeof setTopBarTitle === 'function') setTopBarTitle('请选择章节');
      else if (els && els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
    } catch (_) {}
    try { renderSidebar(); } catch (_) {}
  }

  // Restore scroll (chapter view uses window scroll).
  var y = Math.max(0, Number(st.scrollY) || 0);
  setTimeout(function () {
    try { window.scrollTo(0, y); } catch (_) {}
  }, 0);
}

function examResetState() {
  examStopTimer();
  exam.active = false;
  exam.phase = 'idle';
  exam.bookId = null;
  exam.bookTitle = '';
  exam.pool = null;
  exam.selectedChapterIds = [];
  exam.totalQuestions = 0;
  exam.questions = [];
  exam.answers = {};
  exam.correctCount = 0;
  exam.streak = 0;
  exam.elapsedMs = 0;
  exam._tickBase = 0;
  exam._tickStartAt = 0;
  examUpdateTimerUi();
}

function examQuestionKey(ref) {
  if (!ref) return '';
  return String(ref.chapterId || '') + '|' + String(ref.qid || '');
}

function examInitForBook(book) {
  book = book || getActiveBook();
  if (!book || !book.id) return false;
  exam.bookId = String(book.id);
  exam.bookTitle = String(book.title || '').trim() || '未命名书';
  exam.pool = examComputePool(book);
  return true;
}

function examFormatTime(ms) {
  ms = Math.max(0, Number(ms) || 0);
  var s = Math.floor(ms / 1000);
  var hh = Math.floor(s / 3600);
  var mm = Math.floor((s % 3600) / 60);
  var ss = s % 60;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  if (hh > 0) return hh + ':' + pad(mm) + ':' + pad(ss);
  return pad(mm) + ':' + pad(ss);
}

function examSetHeader(bookTitle, subText) {
  try {
    if (els.examHeaderTitle) els.examHeaderTitle.textContent = '考试';
    if (els.examHeaderSub) els.examHeaderSub.textContent = subText ? String(subText) : (bookTitle ? String(bookTitle) : '');
  } catch (_) {}
}

function examUpdateTimerUi() {
  try {
    if (els.examHeaderTimer) els.examHeaderTimer.textContent = examFormatTime(exam.elapsedMs);
  } catch (_) {}
}

function examStartTimer() {
  if (exam._tickTimer) return;
  exam._tickBase = Number(exam.elapsedMs) || 0;
  exam._tickStartAt = examNow();
  exam._tickTimer = setInterval(function () {
    exam.elapsedMs = exam._tickBase + (examNow() - exam._tickStartAt);
    examUpdateTimerUi();
  }, 500);
  examUpdateTimerUi();
}

function examStopTimer() {
  if (!exam._tickTimer) return;
  try { clearInterval(exam._tickTimer); } catch (_) {}
  exam._tickTimer = 0;
  exam.elapsedMs = exam._tickBase + (examNow() - exam._tickStartAt);
  exam._tickBase = exam.elapsedMs;
  exam._tickStartAt = 0;
  examUpdateTimerUi();
}

function examIsOpen() {
  return !!(els.examModal && els.examModal.classList && els.examModal.classList.contains('open'));
}

function examOpenModal() {
  if (!els.examModal) return;
  try { els.examModal.classList.add('open'); } catch (_) {}
  try { document.body.classList.add('exam-mode'); } catch (_) {}
  try { syncModalScrollLock(); } catch (_) {}
  try { if (els.examModal) els.examModal.setAttribute('aria-hidden', 'false'); } catch (_) {}
}

function examCloseModal() {
  examStopTimer();
  try { examRestoreReturnState(); } catch (_) {}
  try { if (typeof hideAiSelBtn === 'function') hideAiSelBtn(); } catch (_) {}
  try { if (els.examExitModal) els.examExitModal.classList.remove('open'); } catch (_) {}
  try { if (els.examModal) els.examModal.classList.remove('open'); } catch (_) {}
  try { document.body.classList.remove('exam-mode'); } catch (_) {}
  try { syncModalScrollLock(); } catch (_) {}
  try { if (els.examModal) els.examModal.setAttribute('aria-hidden', 'true'); } catch (_) {}
}

function examLoadStore() {
  try {
    var raw = localStorage.getItem(EXAM_STORE_KEY);
    if (!raw) return { v: 1, books: {} };
    var j = JSON.parse(raw);
    if (!j || typeof j !== 'object') return { v: 1, books: {} };
    if (!j.books || typeof j.books !== 'object' || Array.isArray(j.books)) j.books = {};
    if (!j.v) j.v = 1;
    return j;
  } catch (_) {
    return { v: 1, books: {} };
  }
}

function examWriteStore(store) {
  try { localStorage.setItem(EXAM_STORE_KEY, JSON.stringify(store)); } catch (_) {}
}

function examLoadSaved(bookId) {
  if (!bookId) return null;
  var store = examLoadStore();
  var s = store && store.books ? store.books[String(bookId)] : null;
  if (!s || typeof s !== 'object') return null;
  if (s.phase !== 'running') return null;
  if (!Array.isArray(s.questions) || !s.questions.length) return null;
  return s;
}

function examClearSaved(bookId) {
  if (!bookId) return;
  var store = examLoadStore();
  try { delete store.books[String(bookId)]; } catch (_) {}
  examWriteStore(store);
}

function examSaveSnapshot() {
  if (!exam.bookId) return;
  var store = examLoadStore();
  store.books[String(exam.bookId)] = {
    v: 1,
    savedAt: new Date().toISOString(),
    phase: 'running',
    elapsedMs: Math.round(Number(exam.elapsedMs) || 0),
    bookTitle: exam.bookTitle || '',
    selectedChapterIds: Array.isArray(exam.selectedChapterIds) ? exam.selectedChapterIds.slice() : [],
    questions: Array.isArray(exam.questions) ? exam.questions.map(function (q) {
      return {
        folderId: q.folderId || null,
        folderTitle: q.folderTitle || '',
        chapterId: q.chapterId || null,
        chapterTitle: q.chapterTitle || '',
        qid: q.qid || '',
        idx: (q.idx !== undefined && q.idx !== null) ? q.idx : null
      };
    }) : [],
    answers: (exam.answers && typeof exam.answers === 'object') ? exam.answers : {},
    correctCount: Number(exam.correctCount) || 0,
    streak: Number(exam.streak) || 0
  };
  examWriteStore(store);
}

function examNormalizeQid(q) {
  var qid = (q && q.qid !== undefined && q.qid !== null) ? String(q.qid)
    : (q && q.id !== undefined && q.id !== null) ? String(q.id)
    : '';
  return qid;
}

function examIsEligibleQuestion(q) {
  if (!q || typeof q !== 'object') return false;
  if (!Array.isArray(q.options) || q.options.length < 2) return false;
  var ans = (q.answer !== undefined && q.answer !== null) ? String(q.answer).trim() : '';
  if (!ans) return false;
  var ok = false;
  for (var i = 0; i < q.options.length; i++) {
    var lab = (q.options[i] && q.options[i].label !== undefined && q.options[i].label !== null) ? String(q.options[i].label).trim() : '';
    if (lab && lab === ans) { ok = true; break; }
  }
  if (!ok) return false;
  var qid = examNormalizeQid(q);
  if (!qid) return false;
  return true;
}

function examShuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function examPickOne(list) {
  if (!Array.isArray(list) || !list.length) return null;
  var idx = Math.floor(Math.random() * list.length);
  return list.splice(idx, 1)[0];
}

function examComputePool(book) {
  book = book || getActiveBook();
  var all = getAllChapters();
  var folderTitleById = {};
  var folders = (book && Array.isArray(book.folders)) ? book.folders : [];
  for (var i = 0; i < folders.length; i++) folderTitleById[String(folders[i].id)] = String(folders[i].title || '').trim();

  var byFolder = {}; // folderId -> { id,title,chapters:[],count }
  var root = { id: '__root__', title: '未分组', chapters: [], count: 0 };

  function getFolderIdForChapter(chId) {
    try {
      var m = (book && book.layoutMap && typeof book.layoutMap === 'object') ? book.layoutMap : null;
      var fid = m ? m[String(chId)] : null;
      return fid ? String(fid) : '';
    } catch (_) { return ''; }
  }

  var total = 0;
  for (var c = 0; c < all.length; c++) {
    var ch = all[c];
    if (!ch || !ch.id || !Array.isArray(ch.questions)) continue;
    var eligible = [];
    for (var qi = 0; qi < ch.questions.length; qi++) {
      var q = ch.questions[qi];
      if (!examIsEligibleQuestion(q)) continue;
      eligible.push({ qid: examNormalizeQid(q), idx: qi });
    }
    if (!eligible.length) continue;

    var chInfo = { id: String(ch.id), title: String(ch.title || '').trim() || '未命名章节', count: eligible.length, questions: eligible };
    total += eligible.length;

    var fid2 = getFolderIdForChapter(ch.id);
    if (fid2) {
      if (!byFolder[fid2]) byFolder[fid2] = { id: fid2, title: folderTitleById[fid2] || '未命名文件夹', chapters: [], count: 0 };
      byFolder[fid2].chapters.push(chInfo);
      byFolder[fid2].count += eligible.length;
    } else {
      root.chapters.push(chInfo);
      root.count += eligible.length;
    }
  }

  var folderList = [];
  for (var k in byFolder) {
    if (!Object.prototype.hasOwnProperty.call(byFolder, k)) continue;
    if (byFolder[k].count > 0) folderList.push(byFolder[k]);
  }

  // Deterministic-ish sort by folder title; chapters keep existing order (sidebar order may differ).
  folderList.sort(function (a, b) {
    try { return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans', { numeric: true, sensitivity: 'base' }); } catch (_) {}
    return String(a.title || '').localeCompare(String(b.title || ''));
  });

  return { folders: folderList, root: root.count > 0 ? root : null, total: total };
}

function examBuildQuestionSet(pool, selectedChapterIds, wantCount) {
  pool = pool || exam.pool;
  if (!pool || !Array.isArray(selectedChapterIds) || !selectedChapterIds.length) return [];

  var selected = {};
  for (var i = 0; i < selectedChapterIds.length; i++) selected[String(selectedChapterIds[i])] = true;

  // Build selected folders snapshot
  var groups = []; // { folderId, folderTitle, chapters:[{id,title,qs:[{qid,idx}]}], total }

  function addGroup(folderId, folderTitle, chapters) {
    var chs = [];
    var total = 0;
    for (var j = 0; j < chapters.length; j++) {
      var ch = chapters[j];
      if (!ch || !selected[String(ch.id)] || !Array.isArray(ch.questions) || !ch.questions.length) continue;
      chs.push({ id: String(ch.id), title: String(ch.title || ''), qs: ch.questions.slice() });
      total += ch.count;
    }
    if (!chs.length || total <= 0) return;
    groups.push({ folderId: folderId, folderTitle: folderTitle, chapters: chs, total: total });
  }

  for (var f = 0; f < (pool.folders || []).length; f++) {
    var g = pool.folders[f];
    addGroup(String(g.id), String(g.title || '未命名文件夹'), g.chapters || []);
  }
  if (pool.root) addGroup('', '未分组', pool.root.chapters || []);
  if (!groups.length) return [];

  var max = 0;
  for (var gg = 0; gg < groups.length; gg++) max += groups[gg].total;
  wantCount = Math.max(0, Math.min(Number(wantCount) || 0, max));
  if (!wantCount) return [];

  // 1) folder allocation (largest remainder, tie randomized)
  var alloc = []; // { idx, n }
  var baseSum = 0;
  for (var a = 0; a < groups.length; a++) {
    var exact = wantCount * groups[a].total / max;
    var base = Math.floor(exact);
    alloc.push({ idx: a, exact: exact, base: base, rem: exact - base });
    baseSum += base;
  }
  var remain = wantCount - baseSum;
  examShuffle(alloc);
  alloc.sort(function (x, y) { return y.rem - x.rem; });
  for (var r = 0; r < alloc.length && remain > 0; r++) {
    var gi = alloc[r].idx;
    if (alloc[r].base >= groups[gi].total) continue;
    alloc[r].base += 1;
    remain -= 1;
  }
  // If still remain due to saturated folders (rare), fill by weighted random.
  while (remain > 0) {
    var candidates = [];
    var wsum = 0;
    for (var t = 0; t < alloc.length; t++) {
      var gi2 = alloc[t].idx;
      var cap = groups[gi2].total - alloc[t].base;
      if (cap <= 0) continue;
      candidates.push({ idx: gi2, w: cap });
      wsum += cap;
    }
    if (!candidates.length || wsum <= 0) break;
    var pick = Math.random() * wsum;
    var chosen = candidates[0].idx;
    for (var tt = 0; tt < candidates.length; tt++) {
      pick -= candidates[tt].w;
      if (pick <= 0) { chosen = candidates[tt].idx; break; }
    }
    for (var u = 0; u < alloc.length; u++) {
      if (alloc[u].idx === chosen) { alloc[u].base += 1; remain -= 1; break; }
    }
  }

  // 2) pick questions inside each folder, try cover chapters
  var out = [];
  for (var gi3 = 0; gi3 < alloc.length; gi3++) {
    var n = alloc[gi3].base;
    if (!n) continue;
    var grp = groups[alloc[gi3].idx];
    if (!grp || !Array.isArray(grp.chapters) || !grp.chapters.length) continue;

    var chapters = grp.chapters.map(function (c) {
      return { id: c.id, title: c.title, qs: c.qs.slice() };
    });

    if (n >= chapters.length) {
      // One per chapter first
      var beforeLen = out.length;
      for (var cc = 0; cc < chapters.length; cc++) {
        var one = examPickOne(chapters[cc].qs);
        if (!one) continue;
        out.push({
          folderId: grp.folderId,
          folderTitle: grp.folderTitle,
          chapterId: chapters[cc].id,
          chapterTitle: chapters[cc].title,
          qid: one.qid,
          idx: one.idx
        });
      }
      var pickedOne = out.length - beforeLen;
      var left = Math.max(0, n - pickedOne);
      var pool2 = [];
      for (var cc2 = 0; cc2 < chapters.length; cc2++) {
        for (var qq2 = 0; qq2 < chapters[cc2].qs.length; qq2++) {
          pool2.push({
            folderId: grp.folderId,
            folderTitle: grp.folderTitle,
            chapterId: chapters[cc2].id,
            chapterTitle: chapters[cc2].title,
            qid: chapters[cc2].qs[qq2].qid,
            idx: chapters[cc2].qs[qq2].idx
          });
        }
      }
      examShuffle(pool2);
      for (var take = 0; take < pool2.length && left > 0; take++, left--) out.push(pool2[take]);
    } else {
      // Too many chapters: random select n chapters, 1 question each (no per-chapter weight)
      examShuffle(chapters);
      chapters = chapters.slice(0, n);
      for (var cc3 = 0; cc3 < chapters.length; cc3++) {
        var one2 = examPickOne(chapters[cc3].qs);
        if (!one2) continue;
        out.push({
          folderId: grp.folderId,
          folderTitle: grp.folderTitle,
          chapterId: chapters[cc3].id,
          chapterTitle: chapters[cc3].title,
          qid: one2.qid,
          idx: one2.idx
        });
      }
    }
  }

  // 3) global shuffle + clamp
  examShuffle(out);
  if (out.length > wantCount) out = out.slice(0, wantCount);
  return out;
}
