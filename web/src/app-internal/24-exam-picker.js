/** ---------------------------
 * 14.1) 考试模式：范围选择
 * --------------------------- */

var examPicker = {
  sel: {}, // chapterId -> true/false
  fold: {}, // folderId -> collapsed?
  mode: 'all' // all | wrong | new | review
};

function examPickerNormalizeMode(mode) {
  mode = (typeof mode === 'string' && mode) ? String(mode) : 'all';
  if (!(mode === 'all' || mode === 'wrong' || mode === 'new' || mode === 'review')) mode = 'all';
  return mode;
}

var examPickerCountsCache = {
  sig: '',
  mode: 'all',
  byChapter: null, // { chapterId: count }
  byFolder: null, // { folderId: count }, root uses '__root__'
  total: 0,
  reviewNextAt: 0,
  reviewHasAny: false,
  reviewNextByChapter: null // { chapterId: nextAtMs }
};

function examPickerCountsSignature(book, pool, mode) {
  try {
    var bookId = book && book.id ? String(book.id) : '';
    var upd = (book && book.updatedAt) ? String(book.updatedAt || '') : '';
    var total = pool ? (Number(pool.total) || 0) : 0;
    return bookId + '|' + String(mode || '') + '|' + upd + '|' + String(total);
  } catch (_) {
    return String(mode || '') + '|0';
  }
}

function examPickerGetModeCounts(pool, mode) {
  pool = pool || exam.pool;
  mode = examPickerNormalizeMode(mode);
  var book = getActiveBook();
  var sig = examPickerCountsSignature(book, pool, mode);
  if (examPickerCountsCache.sig === sig && examPickerCountsCache.mode === mode && examPickerCountsCache.byChapter) return examPickerCountsCache;

  var byChapter = {};
  var byFolder = {};
  var total = 0;
  var now = Date.now ? Date.now() : new Date().getTime();
  var nextAt = Infinity;
  var hasAny = false;
  var nextByChapter = (mode === 'review') ? {} : null;

  function getRec(cid, qid) {
    try { if (typeof studyGetRec === 'function') return studyGetRec(cid, qid, book); } catch (_) {}
    return null;
  }

  function countChapter(ch) {
    if (!ch || !ch.id) return 0;
    var cid = String(ch.id);
    if (mode === 'all') {
      var c0 = Number(ch.count) || 0;
      byChapter[cid] = c0;
      return c0;
    }

    var qs = Array.isArray(ch.questions) ? ch.questions : [];
    var n = 0;
    var minCh = Infinity;
    for (var i = 0; i < qs.length; i++) {
      var qref = qs[i];
      if (!qref || !qref.qid) continue;
      var qid = String(qref.qid);
      if (!qid) continue;

      var rec = getRec(cid, qid);
      if (mode === 'wrong') {
        if (rec && Number(rec.s) === 1) n += 1;
      } else if (mode === 'new') {
        if (!rec) n += 1;
      } else if (mode === 'review') {
        if (!rec) continue;
        var t = Number(rec.n);
        if (!Number.isFinite(t) || t <= 0) continue;
        hasAny = true;
        if (t <= now) n += 1;
        else {
          if (t < nextAt) nextAt = t;
          if (t < minCh) minCh = t;
        }
      }
    }
    byChapter[cid] = n;
    if (mode === 'review' && nextByChapter && minCh < Infinity) nextByChapter[cid] = minCh;
    return n;
  }

  function addFolder(folderId, chapters) {
    var sum = 0;
    for (var i = 0; i < (chapters || []).length; i++) sum += countChapter(chapters[i]);
    byFolder[String(folderId)] = sum;
    total += sum;
  }

  for (var f = 0; f < (pool && pool.folders ? pool.folders.length : 0); f++) {
    var g = pool.folders[f];
    if (!g) continue;
    addFolder(g.id, g.chapters || []);
  }
  if (pool && pool.root) addFolder('__root__', pool.root.chapters || []);

  examPickerCountsCache.sig = sig;
  examPickerCountsCache.mode = mode;
  examPickerCountsCache.byChapter = byChapter;
  examPickerCountsCache.byFolder = byFolder;
  examPickerCountsCache.total = total;
  examPickerCountsCache.reviewNextAt = (nextAt < Infinity) ? nextAt : 0;
  examPickerCountsCache.reviewHasAny = !!hasAny;
  examPickerCountsCache.reviewNextByChapter = nextByChapter;
  return examPickerCountsCache;
}

function examPickerAllChapterIds(pool) {
  pool = pool || exam.pool;
  var out = [];
  if (!pool) return out;
  for (var i = 0; i < (pool.folders || []).length; i++) {
    var g = pool.folders[i];
    for (var j = 0; j < (g.chapters || []).length; j++) out.push(String(g.chapters[j].id));
  }
  if (pool.root) {
    for (var k = 0; k < (pool.root.chapters || []).length; k++) out.push(String(pool.root.chapters[k].id));
  }
  return out;
}

function examPickerSelectedChapterIds() {
  var ids = [];
  for (var k in examPicker.sel) {
    if (!Object.prototype.hasOwnProperty.call(examPicker.sel, k)) continue;
    if (examPicker.sel[k]) ids.push(String(k));
  }
  return ids;
}

function examPickerComputeLimits(pool) {
  pool = pool || exam.pool;
  if (!pool) return { max: 0, min: 0, favOn: false, favCount: 0 };

  var mode = examPickerNormalizeMode(examPicker && examPicker.mode);
  var counts = examPickerGetModeCounts(pool, mode);

  var favOn = false;
  var favId = (typeof FAVORITES_CHAPTER_ID === 'string' && FAVORITES_CHAPTER_ID) ? FAVORITES_CHAPTER_ID : '';
  try { favOn = !!(favId && examPicker.sel && examPicker.sel[favId]); } catch (_) { favOn = false; }

  var favList = [];
  try { if (typeof favoritesGetEligibleForExam === 'function') favList = favoritesGetEligibleForExam(pool) || []; } catch (_) { favList = []; }
  var favCount = Array.isArray(favList) ? favList.length : 0;

  // 非普通考试：先不支持收藏夹必出（避免与刷题模式冲突）
  if (mode !== 'all') {
    favOn = false;
    if (favId) examPicker.sel[favId] = false;
  }

  var dupByChapter = {};
  if (favOn && favCount) {
    for (var i = 0; i < favList.length; i++) {
      var it = favList[i];
      if (!it || !it.chapterId) continue;
      var cid = String(it.chapterId);
      dupByChapter[cid] = (dupByChapter[cid] || 0) + 1;
    }
  }

  var total = favOn ? favCount : 0;
  function addIfSelected(ch) {
    if (!ch || !ch.id) return;
    if (!examPicker.sel[String(ch.id)]) return;
    var cnt = (counts && counts.byChapter) ? (Number(counts.byChapter[String(ch.id)]) || 0) : 0;
    if (mode === 'all' && favOn && cnt) cnt -= (dupByChapter[String(ch.id)] || 0);
    if (cnt < 0) cnt = 0;
    total += cnt;
  }
  for (var i = 0; i < (pool.folders || []).length; i++) {
    var g = pool.folders[i];
    for (var j = 0; j < (g.chapters || []).length; j++) addIfSelected(g.chapters[j]);
  }
  if (pool.root) for (var k = 0; k < (pool.root.chapters || []).length; k++) addIfSelected(pool.root.chapters[k]);

  var min = total > 0 ? 1 : 0;
  if (mode === 'all' && favOn && favCount > min) min = favCount;

  return { max: total, min: min, favOn: favOn, favCount: favCount, mode: mode };
}

function examPickerSelectedCount(pool) {
  pool = pool || exam.pool;
  return examPickerComputeLimits(pool).max;
}

function examPickerSetAll(on, mode) {
  on = !!on;
  mode = examPickerNormalizeMode(mode || (examPicker && examPicker.mode));
  var counts = (mode === 'all') ? null : examPickerGetModeCounts(exam.pool, mode);
  var ids = examPickerAllChapterIds(exam.pool);
  for (var i = 0; i < ids.length; i++) {
    var cid = ids[i];
    if (on && mode !== 'all') {
      var n = (counts && counts.byChapter) ? (Number(counts.byChapter[String(cid)]) || 0) : 0;
      if (n <= 0) continue;
    }
    examPicker.sel[cid] = on;
  }
}

function examPickerFolderStats(folderGroup, mode, counts) {
  var chs = folderGroup && Array.isArray(folderGroup.chapters) ? folderGroup.chapters : [];
  mode = examPickerNormalizeMode(mode);
  var total = 0;
  var selected = 0;
  for (var i = 0; i < chs.length; i++) {
    var ch = chs[i];
    if (!ch || !ch.id) continue;
    var cid = String(ch.id);
    var n = (counts && counts.byChapter) ? (Number(counts.byChapter[cid]) || 0) : (Number(ch.count) || 0);
    if (mode !== 'all' && n <= 0) continue;
    total += 1;
    if (examPicker.sel[cid]) selected += 1;
  }
  return { total: total, selected: selected };
}

function examPickerModeLabel(mode) {
  mode = examPickerNormalizeMode(mode);
  if (mode === 'wrong') return '错题';
  if (mode === 'new') return '未做';
  if (mode === 'review') return '复习';
  return '考试';
}

function examPickerStartLabel(mode) {
  mode = examPickerNormalizeMode(mode);
  if (mode === 'wrong') return '开始刷错题';
  if (mode === 'new') return '开始刷未做';
  if (mode === 'review') return '开始复习';
  return '开始考试';
}

function examPickerApplyModeUi(pool, mode) {
  if (!els.examPickerView) return;
  pool = pool || exam.pool;
  mode = examPickerNormalizeMode(mode || (examPicker && examPicker.mode));
  if (!pool) return;

  var counts = examPickerGetModeCounts(pool, mode);
  var byChapter = counts && counts.byChapter ? counts.byChapter : {};
  var byFolder = counts && counts.byFolder ? counts.byFolder : {};

  var anyVisible = false;
  var folderEls = els.examPickerView.querySelectorAll('.exam-range-folder');
  for (var i = 0; i < folderEls.length; i++) {
    var fel = folderEls[i];
    if (!fel || !fel.dataset) continue;
    var fid = String(fel.dataset.folderId || '');

    // Favorites row handled elsewhere.
    if (fid === '__fav__') continue;

    var folderCount = (fid && byFolder && Object.prototype.hasOwnProperty.call(byFolder, fid)) ? (Number(byFolder[fid]) || 0) : 0;
    if (mode !== 'all' && folderCount <= 0) {
      try { fel.style.display = 'none'; } catch (_) {}
      continue;
    }
    try { fel.style.display = ''; } catch (_) {}

    // Folder row count
    try {
      var fCountEl = fel.querySelector('.exam-range-row .exam-range-count');
      if (fCountEl) fCountEl.textContent = String(folderCount) + ' 题';
    } catch (_) {}

    // Chapter rows
    var chRows = fel.querySelectorAll('.exam-chapter-row');
    for (var j = 0; j < chRows.length; j++) {
      var row = chRows[j];
      var cb = row ? row.querySelector('input.exam-chapter-check') : null;
      var cid = cb ? String(cb.getAttribute('data-chapter-id') || '') : '';
      if (!cid) continue;
      var n = (byChapter && Object.prototype.hasOwnProperty.call(byChapter, cid)) ? (Number(byChapter[cid]) || 0) : 0;
      if (mode !== 'all' && n <= 0) {
        try { row.style.display = 'none'; } catch (_) {}
        continue;
      }
      anyVisible = true;
      try { row.style.display = ''; } catch (_) {}
      try {
        var cCountEl = row.querySelector('.exam-range-count');
        if (cCountEl) cCountEl.textContent = String(n) + ' 题';
      } catch (_) {}
    }
  }

  // Mode empty hint
  try {
    var emptyEl = els.examPickerView.querySelector('#examModeEmpty');
    if (emptyEl) {
      if (mode === 'all' || anyVisible) {
        emptyEl.style.display = 'none';
        emptyEl.textContent = '';
      } else {
        emptyEl.style.display = '';
        emptyEl.textContent = '暂无' + examPickerModeLabel(mode) + '题目。';
      }
    }
  } catch (_) {}
}

function examPickerUpdateUi() {
  if (!els.examPickerView) return;
  var pool = exam.pool;
  if (!pool) return;

  var mode0 = examPickerNormalizeMode(examPicker && examPicker.mode);
  var counts0 = examPickerGetModeCounts(pool, mode0);

  // Update row counts & hide empty groups for mode
  examPickerApplyModeUi(pool, mode0);

  // Update folder checkboxes (checked/indeterminate)
  var folders = els.examPickerView.querySelectorAll('.exam-range-folder');
  for (var i = 0; i < folders.length; i++) {
    var el = folders[i];
    var fid = el.dataset ? el.dataset.folderId : '';
    var group = null;
    if (fid === '__root__') group = pool.root;
    else {
      for (var j = 0; j < (pool.folders || []).length; j++) {
        if (String(pool.folders[j].id) === String(fid)) { group = pool.folders[j]; break; }
      }
    }
    if (!group) continue;
    var st = examPickerFolderStats(group, mode0, counts0);
    var cb = el.querySelector('input.exam-folder-check');
    if (cb) {
      cb.indeterminate = st.selected > 0 && st.selected < st.total;
      cb.checked = st.total > 0 && st.selected === st.total;
    }
  }

  // Update totals & clamp N
  var limits = examPickerComputeLimits(pool);
  var max = limits.max;
  var min = limits.min;
  var mode = limits.mode || mode0;

  // Favorites row
  try {
    var favRow = els.examPickerView.querySelector('.exam-range-fav');
    if (favRow) favRow.style.display = (mode === 'all') ? '' : 'none';
    var favCb = els.examPickerView.querySelector('input.exam-fav-check');
    if (favCb) favCb.checked = !!limits.favOn;
    var favCountEl = els.examPickerView.querySelector('#examFavCount');
    if (favCountEl) favCountEl.textContent = String(limits.favCount);
  } catch (_) {}

  var totalEl = els.examPickerView.querySelector('#examPickerTotal');
  if (totalEl) totalEl.textContent = String(max);
  var maxHintEl = els.examPickerView.querySelector('#examPickerMaxHint');
  if (maxHintEl) maxHintEl.textContent = String(max);
  try {
    var labEl = els.examPickerView.querySelector('#examPickerTotalLabel');
    if (labEl) labEl.textContent = (mode === 'all') ? '已选题数上限：' : ('已选' + examPickerModeLabel(mode) + '上限：');
  } catch (_) {}

  var minWrap = els.examPickerView.querySelector('#examPickerMinWrap');
  var minHintEl = els.examPickerView.querySelector('#examPickerMinHint');
  if (minHintEl) minHintEl.textContent = String(min);
  if (minWrap) {
    try { minWrap.style.display = (mode === 'all' && min > 1) ? '' : 'none'; } catch (_) {}
  }

  var input = els.examPickerView.querySelector('#examPickerCountInput');
  if (input) {
    try { input.max = String(max); } catch (_) {}
    try { input.min = String(min); } catch (_) {}
    var v = Number(input.value);
    if (!Number.isFinite(v)) v = 0;
    if (max <= 0) {
      input.value = '0';
    } else {
      if (v <= 0) v = Math.max(min, Math.min(20, max));
      if (v > max) v = max;
      if (v < min) v = min;
      input.value = String(Math.floor(v));
    }
  }

  var startBtn = els.examPickerView.querySelector('#examPickerStartBtn');
  if (startBtn) {
    startBtn.disabled = max <= 0;
    startBtn.textContent = examPickerStartLabel(mode);
  }

  // Mode hint (especially for review=0)
  try {
	    var hintEl = els.examPickerView.querySelector('#examModeHint');
	    if (hintEl) {
	      var text = '';
	      var totalAll = (counts0 && Number.isFinite(Number(counts0.total))) ? Number(counts0.total) : 0;

	      if (mode === 'wrong') {
	        if (max > 0) text = '仅包含做错过的题。';
	        else text = (totalAll > 0) ? '当前所选范围暂无错题，请调整范围。' : '暂无错题，继续保持。';
	      } else if (mode === 'new') {
	        if (max > 0) text = '仅包含未做过的题，作答后会自动减少。';
	        else text = (totalAll > 0) ? '当前所选范围暂无未做题，请调整范围。' : '暂无未做题（都做过了）。';
	      }
	      else if (mode === 'review') {
	        if (max > 0) text = '到期复习：按艾宾浩斯节奏出题。';
	        else if (totalAll > 0) {
	          text = '当前所选范围暂无到期复习，请调整范围。';
	        }
	        else if (counts0 && counts0.reviewHasAny) {
	          var nextAtSel = 0;
	          try {
	            var ids2 = examPickerSelectedChapterIds();
	            var map2 = (counts0.reviewNextByChapter && typeof counts0.reviewNextByChapter === 'object') ? counts0.reviewNextByChapter : null;
            for (var ii = 0; ii < ids2.length; ii++) {
              var cid4 = String(ids2[ii] || '');
              if (!cid4) continue;
              var t2 = map2 && Object.prototype.hasOwnProperty.call(map2, cid4) ? Number(map2[cid4]) : 0;
              if (!Number.isFinite(t2) || t2 <= 0) continue;
              if (!nextAtSel || t2 < nextAtSel) nextAtSel = t2;
            }
	          } catch (_) {}

	          var nextAtUse = nextAtSel || Number(counts0.reviewNextAt) || 0;
	          if (!Number.isFinite(nextAtUse) || nextAtUse <= 0) {
	            text = '暂无到期复习。';
	          } else {
	            var now2 = Date.now ? Date.now() : new Date().getTime();
	            var diff = Math.max(0, nextAtUse - now2);
	            var mins = Math.max(1, Math.round(diff / 60000));
	            if (nextAtSel) text = '所选范围暂无到期复习，最近一题约在 ' + mins + ' 分钟后。';
	            else text = '当前所选范围暂无复习记录（全书最近约 ' + mins + ' 分钟后）。';
	          }
	        } else {
	          text = '先做几题，首次复习将在 20 分钟后出现。';
	        }
	      }
      hintEl.textContent = text;
      hintEl.style.display = text ? '' : 'none';
    }
  } catch (_) {}

  // Header subtitle
  try {
    if (typeof examSetHeader === 'function') examSetHeader(exam.bookTitle, '选择范围 · ' + examPickerModeLabel(mode));
  } catch (_) {}
}

function examRenderPicker() {
  var book = getActiveBook();
  if (!book || !book.id) return;

  examStopTimer();
  exam.elapsedMs = 0;
  examUpdateTimerUi();
  exam.active = true;
  exam.phase = 'picker';
  try { if (typeof examMarkViewOpen === 'function') examMarkViewOpen(); } catch (_) {}

  examInitForBook(book);
  var pool = exam.pool;

  try {
    if (els.examRunnerView) els.examRunnerView.style.display = 'none';
    if (els.examPickerView) els.examPickerView.style.display = '';
  } catch (_) {}

  examSetHeader(exam.bookTitle, '选择范围');

  if (els.examRestartBtn) els.examRestartBtn.style.display = 'none';

  // default: select all
  examPicker.sel = {};
  examPickerSetAll(true, 'all');
  examPicker.mode = 'all';

  if (!els.examPickerView) return;
  els.examPickerView.innerHTML = '';

  if (!pool || !pool.total) {
    var empty = document.createElement('div');
    empty.className = 'exam-empty';
    empty.innerHTML =
      '<div class="exam-empty-title">暂无可用题目</div>' +
      '<div class="exam-empty-desc">当前书里没有可用的单选题（需要有选项且答案可匹配）。</div>';
    els.examPickerView.appendChild(empty);
    return;
  }

  var wrap = document.createElement('div');
  wrap.className = 'exam-picker';

  wrap.innerHTML =
    '<div class="exam-picker-head">' +
      '<div class="exam-picker-summary"><span id="examPickerTotalLabel">已选题数上限：</span><b id="examPickerTotal"></b></div>' +
      '<div class="exam-picker-tools">' +
        '<button id="examPickerSelectAllBtn" class="modal-btn" type="button">全选</button>' +
        '<button id="examPickerSelectNoneBtn" class="modal-btn" type="button">全不选</button>' +
      '</div>' +
    '</div>' +
    '<div id="examModeEmpty" class="exam-mode-empty" style="display:none;"></div>' +
    '<div class="exam-range-tree" id="examRangeTree"></div>' +
    '<div class="exam-picker-footer">' +
      '<div class="exam-mode-row">' +
        '<div class="exam-count-label">模式</div>' +
        '<div id="examModeTabs" class="exam-mode-tabs" role="tablist" aria-label="刷题模式">' +
          '<button type="button" class="exam-mode-btn active" data-mode="all" role="tab" aria-selected="true">考试</button>' +
          '<button type="button" class="exam-mode-btn" data-mode="wrong" role="tab" aria-selected="false">错题</button>' +
          '<button type="button" class="exam-mode-btn" data-mode="new" role="tab" aria-selected="false">未做</button>' +
          '<button type="button" class="exam-mode-btn" data-mode="review" role="tab" aria-selected="false">复习</button>' +
        '</div>' +
      '</div>' +
      '<div id="examModeHint" class="exam-mode-hint" style="display:none;"></div>' +
      '<div class="exam-count-row">' +
        '<div class="exam-count-label">出题数</div>' +
        '<input id="examPickerCountInput" class="auth-input exam-count-input" type="number" min="1" step="1" inputmode="numeric" />' +
        '<div class="exam-count-hint"><span id="examPickerMinWrap" style="display:none;">最少 <span id="examPickerMinHint"></span> · </span>最多 <span id="examPickerMaxHint"></span> 题</div>' +
      '</div>' +
      '<div class="modal-actions" style="margin-top:12px;">' +
        '<button id="examPickerStartBtn" class="modal-btn primary" type="button">开始考试</button>' +
      '</div>' +
    '</div>';

  els.examPickerView.appendChild(wrap);

  var tree = wrap.querySelector('#examRangeTree');

  // Favorites row (virtual)
  try {
    if (typeof FAVORITES_CHAPTER_ID === 'string' && FAVORITES_CHAPTER_ID) {
      var favBox = document.createElement('div');
      favBox.className = 'exam-range-folder exam-range-fav collapsed';
      favBox.dataset.folderId = '__fav__';
      favBox.innerHTML =
        '<div class="exam-range-row">' +
          '<div class="exam-fav-icon" aria-hidden="true"><i class="fa-solid fa-star"></i></div>' +
          '<label class="exam-check exam-folder-label">' +
            '<input class="exam-fav-check" type="checkbox" />' +
            '<span class="exam-range-name">收藏夹</span>' +
          '</label>' +
          '<span class="exam-range-count"><span id="examFavCount">0</span> 题</span>' +
        '</div>';
      tree.appendChild(favBox);
    }
  } catch (_) {}

  function renderGroup(group, isRoot) {
    if (!group || !Array.isArray(group.chapters) || !group.chapters.length) return;
    var fid = isRoot ? '__root__' : String(group.id);
    var collapsed = !!examPicker.fold[fid];

    var box = document.createElement('div');
    box.className = 'exam-range-folder' + (collapsed ? ' collapsed' : '');
    box.dataset.folderId = fid;

    var title = isRoot ? (group.title || '未分组') : (group.title || '未命名文件夹');
    var qTotal = 0;
    try {
      for (var qq = 0; qq < group.chapters.length; qq++) qTotal += Number(group.chapters[qq] && group.chapters[qq].count) || 0;
    } catch (_) { qTotal = 0; }
    box.innerHTML =
      '<div class="exam-range-row">' +
        '<button class="exam-fold-btn" type="button" aria-label="折叠/展开"><i class="fa-solid fa-caret-right"></i></button>' +
        '<label class="exam-check exam-folder-label">' +
          '<input class="exam-folder-check" type="checkbox" />' +
          '<span class="exam-range-name">' + escapeHtml(String(title)) + '</span>' +
        '</label>' +
        '<span class="exam-range-count">' + qTotal + ' 题</span>' +
      '</div>' +
      '<div class="exam-range-children"></div>';

    var childWrap = box.querySelector('.exam-range-children');
    for (var i = 0; i < group.chapters.length; i++) {
      var ch = group.chapters[i];
      if (!ch || !ch.id) continue;
      var row = document.createElement('label');
      row.className = 'exam-check exam-chapter-row';
      row.innerHTML =
        '<input class="exam-chapter-check" type="checkbox" data-chapter-id="' + escapeAttr(String(ch.id)) + '" />' +
        '<span class="exam-range-name exam-range-name--chapter">' + escapeHtml(String(ch.title || '未命名章节')) + '</span>' +
        '<span class="exam-range-count">' + (Number(ch.count) || 0) + ' 题</span>';
      childWrap.appendChild(row);
    }

    tree.appendChild(box);
  }

  for (var i = 0; i < (pool.folders || []).length; i++) renderGroup(pool.folders[i], false);
  if (pool.root) renderGroup(pool.root, true);

  // init checkboxes
  var chapterCbs = wrap.querySelectorAll('input.exam-chapter-check');
  for (var c = 0; c < chapterCbs.length; c++) {
    var id = chapterCbs[c].dataset ? chapterCbs[c].dataset.chapterId : '';
    if (id) chapterCbs[c].checked = !!examPicker.sel[String(id)];
  }
  var favCbInit = wrap.querySelector('input.exam-fav-check');
  if (favCbInit) {
    var favId = (typeof FAVORITES_CHAPTER_ID === 'string' && FAVORITES_CHAPTER_ID) ? FAVORITES_CHAPTER_ID : '';
    favCbInit.checked = !!(favId && examPicker.sel[favId]);
  }

  // Footer default value
  var limits2 = examPickerComputeLimits(pool);
  var max = limits2.max;
  var input = wrap.querySelector('#examPickerCountInput');
  if (input) {
    var def = Math.min(20, max);
    if (def < limits2.min) def = limits2.min;
    input.value = String(def);
  }
  var maxHint = wrap.querySelector('#examPickerMaxHint');
  if (maxHint) maxHint.textContent = String(max);

  wrap.onclick = function (e) {
    var t = e && e.target ? e.target : null;
    if (!t || !t.closest) return;

    var modeBtn = t.closest('.exam-mode-btn');
    if (modeBtn) {
      var m = modeBtn.getAttribute('data-mode') || 'all';
      if (!(m === 'all' || m === 'wrong' || m === 'new' || m === 'review')) m = 'all';
      examPicker.mode = m;
      var btns = wrap.querySelectorAll('.exam-mode-btn');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        var on = (b && b.getAttribute && b.getAttribute('data-mode') === m);
        try { b.classList.toggle('active', !!on); } catch (_) {}
        try { b.setAttribute('aria-selected', on ? 'true' : 'false'); } catch (_) {}
      }
      examPickerUpdateUi();
      return;
    }

    var foldBtn = t.closest('.exam-fold-btn');
    if (foldBtn) {
      var folderEl = foldBtn.closest('.exam-range-folder');
      if (!folderEl || !folderEl.dataset) return;
      var fid = String(folderEl.dataset.folderId || '');
      examPicker.fold[fid] = !examPicker.fold[fid];
      folderEl.classList.toggle('collapsed', !!examPicker.fold[fid]);
      return;
    }

    var chCb = t.closest('input.exam-chapter-check');
    if (chCb) {
      var cid = chCb.getAttribute('data-chapter-id');
      if (cid) examPicker.sel[String(cid)] = !!chCb.checked;
      examPickerUpdateUi();
      return;
    }

    var favCb = t.closest('input.exam-fav-check');
    if (favCb) {
      var favId = (typeof FAVORITES_CHAPTER_ID === 'string' && FAVORITES_CHAPTER_ID) ? FAVORITES_CHAPTER_ID : '';
      if (favId) examPicker.sel[favId] = !!favCb.checked;
      examPickerUpdateUi();
      return;
    }

    var fCb = t.closest('input.exam-folder-check');
    if (fCb) {
      var folderEl2 = fCb.closest('.exam-range-folder');
      if (!folderEl2 || !folderEl2.dataset) return;
      var fid2 = String(folderEl2.dataset.folderId || '');
      var group2 = null;
      if (fid2 === '__root__') group2 = pool.root;
      else {
        for (var j = 0; j < (pool.folders || []).length; j++) if (String(pool.folders[j].id) === fid2) { group2 = pool.folders[j]; break; }
      }
      if (!group2) return;
      var on = !!fCb.checked;
      var m2 = examPickerNormalizeMode(examPicker && examPicker.mode);
      var counts2 = (m2 === 'all') ? null : examPickerGetModeCounts(pool, m2);
      for (var ci = 0; ci < (group2.chapters || []).length; ci++) {
        var ch2 = group2.chapters[ci];
        if (!ch2 || !ch2.id) continue;
        if (m2 !== 'all') {
          var nn = (counts2 && counts2.byChapter) ? (Number(counts2.byChapter[String(ch2.id)]) || 0) : 0;
          if (nn <= 0) continue;
        }
        examPicker.sel[String(ch2.id)] = on;
      }
      // sync chapter checkboxes inside this folder
      var localCbs = folderEl2.querySelectorAll('input.exam-chapter-check');
      for (var x = 0; x < localCbs.length; x++) {
        var cid2 = localCbs[x] ? String(localCbs[x].getAttribute('data-chapter-id') || '') : '';
        if (!cid2) continue;
        if (m2 !== 'all') {
          var nn2 = (counts2 && counts2.byChapter) ? (Number(counts2.byChapter[cid2]) || 0) : 0;
          if (nn2 <= 0) { localCbs[x].checked = false; continue; }
        }
        localCbs[x].checked = on;
      }
      examPickerUpdateUi();
      return;
    }

    var allBtn = t.closest('#examPickerSelectAllBtn');
    if (allBtn) {
      var mm = examPickerNormalizeMode(examPicker && examPicker.mode);
      examPickerSetAll(true, mm);
      var cc = (mm === 'all') ? null : examPickerGetModeCounts(pool, mm);
      var allCbs = wrap.querySelectorAll('input.exam-chapter-check');
      for (var x2 = 0; x2 < allCbs.length; x2++) {
        var cid3 = allCbs[x2] ? String(allCbs[x2].getAttribute('data-chapter-id') || '') : '';
        if (!cid3) continue;
        if (mm !== 'all') {
          var nn3 = (cc && cc.byChapter) ? (Number(cc.byChapter[cid3]) || 0) : 0;
          if (nn3 <= 0) { allCbs[x2].checked = false; continue; }
        }
        allCbs[x2].checked = true;
      }
      examPickerUpdateUi();
      return;
    }

    var noneBtn = t.closest('#examPickerSelectNoneBtn');
    if (noneBtn) {
      examPickerSetAll(false, 'all');
      var allCbs2 = wrap.querySelectorAll('input.exam-chapter-check');
      for (var x3 = 0; x3 < allCbs2.length; x3++) allCbs2[x3].checked = false;
      examPickerUpdateUi();
      return;
    }

    var startBtn = t.closest('#examPickerStartBtn');
    if (startBtn) {
      var limits3 = examPickerComputeLimits(pool);
      var max2 = limits3.max;
      var min2 = limits3.min;
      exam.mode = limits3.mode || 'all';
      var input2 = wrap.querySelector('#examPickerCountInput');
      var want = input2 ? Number(input2.value) : 0;
      if (!Number.isFinite(want)) want = 0;
      want = Math.floor(want);
      if (want <= 0) { showToast('请先选择出题数', { timeoutMs: 2200 }); return; }
      if (want > max2) want = max2;
      if (want < min2) {
        want = min2;
        try { if (input2) input2.value = String(want); } catch (_) {}
        if ((limits3.mode || 'all') === 'all') showToast('已包含收藏夹，出题数最少 ' + min2, { timeoutMs: 2200 });
      }
      if (want <= 0) { showToast('请先选择范围', { timeoutMs: 2200 }); return; }

      exam.selectedChapterIds = examPickerSelectedChapterIds();
      var qs = examBuildQuestionSet(pool, exam.selectedChapterIds, want, exam.mode);
      if (!qs.length) { showToast('没有可用题目', { timeoutMs: 2200 }); return; }
      if (qs.length < want) showToast('可用题目不足，已出 ' + qs.length + ' 题', { timeoutMs: 2600 });

      exam.questions = qs;
      exam.totalQuestions = qs.length;
      exam.answers = {};
      exam.correctCount = 0;
      exam.streak = 0;
      exam.elapsedMs = 0;
      examUpdateTimerUi();
      exam.phase = 'running';
      examStartTimer();
      try { if (typeof examSaveSnapshot === 'function') examSaveSnapshot('running'); } catch (_) {}
      try { if (typeof examMarkViewOpen === 'function') examMarkViewOpen(); } catch (_) {}

      if (typeof examRenderRunner === 'function') examRenderRunner();
      return;
    }
  };

  if (input) {
    input.oninput = function () {
      var lim = examPickerComputeLimits(pool);
      var max3 = lim.max;
      var min3 = lim.min;
      var v = Number(input.value);
      if (!Number.isFinite(v)) v = 0;
      v = Math.floor(v);
      if (v > max3) v = max3;
      if (v < min3) v = min3;
      input.value = String(v);
    };
  }

  examPickerUpdateUi();
}
