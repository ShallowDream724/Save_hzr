/** ---------------------------
 * 25) 收藏夹 / 星标
 * --------------------------- */

var FAVORITES_CHAPTER_ID = '__favorites__';

function isFavoritesChapterId(id) {
  return String(id || '') === FAVORITES_CHAPTER_ID;
}

function favKey(chapterId, qid) {
  return String(chapterId || '') + '|' + String(qid || '');
}

function favNormalizeQid(q) {
  var qid = (q && q.qid !== undefined && q.qid !== null) ? String(q.qid)
    : (q && q.id !== undefined && q.id !== null) ? String(q.id)
    : '';
  return qid;
}

function getBookFavorites(book) {
  book = book || getActiveBook();
  if (!book || typeof book !== 'object') return {};
  if (!book.favorites || typeof book.favorites !== 'object' || Array.isArray(book.favorites)) book.favorites = {};
  return book.favorites;
}

function favoritesCount(book) {
  var favs = getBookFavorites(book);
  var n = 0;
  for (var k in favs) {
    if (!Object.prototype.hasOwnProperty.call(favs, k)) continue;
    n += 1;
  }
  return n;
}

function listFavoriteEntries(book) {
  var favs = getBookFavorites(book);
  var out = [];
  for (var k in favs) {
    if (!Object.prototype.hasOwnProperty.call(favs, k)) continue;
    var it = favs[k];
    if (!it || typeof it !== 'object') continue;
    var chId = (typeof it.chapterId === 'string' && it.chapterId) ? it.chapterId : '';
    var qid = (typeof it.qid === 'string' && it.qid) ? it.qid : '';
    if (!chId || !qid) continue;
    out.push({
      key: String(k),
      chapterId: chId,
      qid: qid,
      idx: (it.idx !== undefined && it.idx !== null) ? Number(it.idx) : null,
      addedAt: (typeof it.addedAt === 'string' && it.addedAt) ? it.addedAt : ''
    });
  }
  out.sort(function (a, b) {
    var at = a.addedAt || '';
    var bt = b.addedAt || '';
    if (at && bt && at !== bt) return bt.localeCompare(at);
    return String(a.key || '').localeCompare(String(b.key || ''));
  });
  return out;
}

function isFavoriteQuestion(chapterId, qid, book) {
  chapterId = String(chapterId || '');
  qid = String(qid || '');
  if (!chapterId || !qid) return false;
  var favs = getBookFavorites(book);
  var key = favKey(chapterId, qid);
  return !!(favs && Object.prototype.hasOwnProperty.call(favs, key));
}

function favoritesFindQuestionInChapter(chapter, qid, idxHint) {
  if (!chapter || !Array.isArray(chapter.questions)) return null;
  var want = String(qid || '');
  if (!want) return null;

  var idx = (idxHint !== undefined && idxHint !== null) ? Number(idxHint) : NaN;
  if (Number.isFinite(idx) && idx >= 0 && idx < chapter.questions.length) {
    var q0 = chapter.questions[idx];
    if (q0 && favNormalizeQid(q0) === want) return { q: q0, idx: idx };
  }

  for (var i = 0; i < chapter.questions.length; i++) {
    var q = chapter.questions[i];
    if (q && favNormalizeQid(q) === want) return { q: q, idx: i };
  }
  return null;
}

function favoritesResolveQuestion(chapterId, qid, idxHint) {
  chapterId = String(chapterId || '');
  qid = String(qid || '');
  if (!chapterId || !qid) return null;
  var chapter = findChapterById(chapterId);
  if (!chapter) return null;
  var hit = favoritesFindQuestionInChapter(chapter, qid, idxHint);
  if (!hit) return { chapter: chapter, q: null, idx: null };
  return { chapter: chapter, q: hit.q, idx: hit.idx };
}

function toggleFavoriteQuestion(chapterId, qid, idxHint, opts) {
  opts = opts || {};
  var book = getActiveBook();
  if (!book) return { on: false, changed: false };
  chapterId = String(chapterId || '');
  qid = String(qid || '');
  if (!chapterId || !qid) return { on: false, changed: false };

  var favs = getBookFavorites(book);
  var key = favKey(chapterId, qid);
  var had = Object.prototype.hasOwnProperty.call(favs, key);
  var on = !had;

  if (had) {
    try { delete favs[key]; } catch (_) {}
  } else {
    var idx = (idxHint !== undefined && idxHint !== null) ? Number(idxHint) : NaN;
    if (!Number.isFinite(idx)) {
      var res = favoritesResolveQuestion(chapterId, qid, null);
      idx = (res && Number.isFinite(res.idx)) ? res.idx : null;
    }
    favs[key] = {
      chapterId: chapterId,
      qid: qid,
      idx: Number.isFinite(idx) ? idx : null,
      addedAt: new Date().toISOString()
    };
  }

  try { book.updatedAt = new Date().toISOString(); } catch (_) {}
  try { saveData(); } catch (_) {}
  try { if (typeof renderSidebar === 'function') renderSidebar(); } catch (_) {}
  if (!opts.silentToast) {
    try { showToast(on ? '已收藏' : '已取消收藏', { timeoutMs: 1600 }); } catch (_) {}
  }
  return { on: on, changed: true };
}

function setFavBtnState(btn, on) {
  if (!btn) return;
  try { btn.classList.toggle('on', !!on); } catch (_) {}
  try { btn.setAttribute('aria-pressed', on ? 'true' : 'false'); } catch (_) {}
  try {
    var i = btn.querySelector ? btn.querySelector('i') : null;
    if (i) i.className = on ? 'fa-solid fa-star' : 'fa-regular fa-star';
  } catch (_) {}
}

function createFavButton(chapterId, qid, idxHint) {
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fav-btn';
  btn.title = '收藏';
  btn.setAttribute('aria-label', '收藏');
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = '<i class="fa-regular fa-star"></i>';
  setFavBtnState(btn, isFavoriteQuestion(chapterId, qid));

  btn.onclick = function (e) {
    try { if (e) { e.preventDefault(); e.stopPropagation(); } } catch (_) {}
    var res = toggleFavoriteQuestion(chapterId, qid, idxHint);
    setFavBtnState(btn, !!res.on);
  };
  return btn;
}

function createFavoritesSidebarElement() {
  var book = getActiveBook();
  var count = favoritesCount(book);
  var active = (typeof currentChapterId === 'string' && currentChapterId) ? isFavoritesChapterId(currentChapterId) : false;

  var div = document.createElement('div');
  div.className = 'list-item chapter-item favorites-item' + (active ? ' active' : '');
  div.dataset.id = FAVORITES_CHAPTER_ID;
  div.style.webkitTouchCallout = 'none';

  var title = '收藏夹';
  div.innerHTML =
    '<div style="display:flex; align-items:center; gap:8px; overflow:hidden; pointer-events:none; flex:1; min-width:0;">' +
      '<i class="fa-solid fa-star" title="收藏夹" style="color:#f59e0b;"></i>' +
      '<span class="item-title">' + escapeHtml(title) + '</span>' +
    '</div>' +
    '<div class="favorites-count" aria-label="收藏数量">' + String(count) + '</div>';

  div.onclick = function () {
    if (Date.now() < (div.__ignoreClickUntil || 0)) return;
    if (typeof loadChapter === 'function') loadChapter(FAVORITES_CHAPTER_ID);
  };

  div.oncontextmenu = function (e) { try { e.preventDefault(); } catch (_) {} return false; };
  return div;
}

function favoritesGetEligibleForExam(pool) {
  pool = pool || (exam && exam.pool ? exam.pool : null);
  var book = getActiveBook();
  var entries = listFavoriteEntries(book);
  var out = [];
  var seen = {};

  var folderTitleById = {};
  var folders = (book && Array.isArray(book.folders)) ? book.folders : [];
  for (var i = 0; i < folders.length; i++) folderTitleById[String(folders[i].id)] = String(folders[i].title || '').trim();

  function resolveFolderId(chapterId) {
    try {
      var m = (book && book.layoutMap && typeof book.layoutMap === 'object') ? book.layoutMap : null;
      var fid = m ? m[String(chapterId)] : null;
      return fid ? String(fid) : '';
    } catch (_) { return ''; }
  }

  function resolveFromPool(chapterId) {
    if (!pool) return null;
    for (var i = 0; i < (pool.folders || []).length; i++) {
      var g = pool.folders[i];
      for (var j = 0; j < (g.chapters || []).length; j++) {
        var ch = g.chapters[j];
        if (ch && String(ch.id) === String(chapterId)) return { folderId: String(g.id), folderTitle: String(g.title || ''), chapterTitle: String(ch.title || '') };
      }
    }
    if (pool.root) {
      for (var k = 0; k < (pool.root.chapters || []).length; k++) {
        var ch2 = pool.root.chapters[k];
        if (ch2 && String(ch2.id) === String(chapterId)) return { folderId: '', folderTitle: String(pool.root.title || '未分组'), chapterTitle: String(ch2.title || '') };
      }
    }
    return null;
  }

  for (var e = 0; e < entries.length; e++) {
    var it = entries[e];
    var chId = String(it.chapterId || '');
    var qid = String(it.qid || '');
    if (!chId || !qid) continue;

    var res = favoritesResolveQuestion(chId, qid, it.idx);
    if (!res || !res.chapter || !res.q) continue;

    var ok = false;
    try {
      if (typeof examIsEligibleQuestion === 'function') ok = !!examIsEligibleQuestion(res.q);
      else ok = Array.isArray(res.q.options) && res.q.options.length >= 2 && !!String(res.q.answer || '').trim();
    } catch (_) { ok = false; }
    if (!ok) continue;

    var key = favKey(chId, qid);
    if (seen[key]) continue;
    seen[key] = true;

    var meta = resolveFromPool(chId);
    var folderId = meta ? meta.folderId : resolveFolderId(chId);
    var folderTitle = meta ? meta.folderTitle : (folderId ? (folderTitleById[folderId] || '未命名文件夹') : '未分组');
    var chapterTitle = meta ? meta.chapterTitle : String(res.chapter.title || '');

    out.push({
      folderId: folderId,
      folderTitle: folderTitle,
      chapterId: chId,
      chapterTitle: chapterTitle,
      qid: qid,
      idx: (res.idx !== undefined && res.idx !== null) ? res.idx : null
    });
  }

  return out;
}

