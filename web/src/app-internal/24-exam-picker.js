/** ---------------------------
 * 14.1) 考试模式：范围选择
 * --------------------------- */

var examPicker = {
  sel: {}, // chapterId -> true/false
  fold: {} // folderId -> collapsed?
};

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

function examPickerSelectedCount(pool) {
  pool = pool || exam.pool;
  if (!pool) return 0;
  var total = 0;
  function addIfSelected(ch) {
    if (!ch || !ch.id) return;
    if (!examPicker.sel[String(ch.id)]) return;
    total += Number(ch.count) || 0;
  }
  for (var i = 0; i < (pool.folders || []).length; i++) {
    var g = pool.folders[i];
    for (var j = 0; j < (g.chapters || []).length; j++) addIfSelected(g.chapters[j]);
  }
  if (pool.root) for (var k = 0; k < (pool.root.chapters || []).length; k++) addIfSelected(pool.root.chapters[k]);
  return total;
}

function examPickerSetAll(on) {
  on = !!on;
  var ids = examPickerAllChapterIds(exam.pool);
  for (var i = 0; i < ids.length; i++) examPicker.sel[ids[i]] = on;
}

function examPickerFolderStats(folderGroup) {
  var chs = folderGroup && Array.isArray(folderGroup.chapters) ? folderGroup.chapters : [];
  var total = 0;
  var selected = 0;
  for (var i = 0; i < chs.length; i++) {
    var ch = chs[i];
    var cnt = Number(ch && ch.count) || 0;
    total += cnt;
    if (ch && examPicker.sel[String(ch.id)]) selected += cnt;
  }
  return { total: total, selected: selected };
}

function examPickerUpdateUi() {
  if (!els.examPickerView) return;
  var pool = exam.pool;
  if (!pool) return;

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
    var st = examPickerFolderStats(group);
    var cb = el.querySelector('input.exam-folder-check');
    if (cb) {
      cb.indeterminate = st.selected > 0 && st.selected < st.total;
      cb.checked = st.total > 0 && st.selected === st.total;
    }
  }

  // Update totals & clamp N
  var max = examPickerSelectedCount(pool);
  var totalEl = els.examPickerView.querySelector('#examPickerTotal');
  if (totalEl) totalEl.textContent = String(max);
  var maxHintEl = els.examPickerView.querySelector('#examPickerMaxHint');
  if (maxHintEl) maxHintEl.textContent = String(max);

  var input = els.examPickerView.querySelector('#examPickerCountInput');
  if (input) {
    try { input.max = String(max); } catch (_) {}
    var v = Number(input.value);
    if (!Number.isFinite(v)) v = 0;
    if (max <= 0) {
      input.value = '0';
    } else {
      if (v <= 0) v = Math.min(20, max);
      if (v > max) v = max;
      input.value = String(Math.floor(v));
    }
  }

  var startBtn = els.examPickerView.querySelector('#examPickerStartBtn');
  if (startBtn) startBtn.disabled = max <= 0;
}

function examRenderPicker() {
  var book = getActiveBook();
  if (!book || !book.id) return;

  exam.active = true;
  exam.phase = 'picker';
  exam.elapsedMs = 0;
  examUpdateTimerUi();
  examStopTimer();

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
  examPickerSetAll(true);

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
      '<div class="exam-picker-summary">已选题数上限：<b id="examPickerTotal"></b></div>' +
      '<div class="exam-picker-tools">' +
        '<button id="examPickerSelectAllBtn" class="modal-btn" type="button">全选</button>' +
        '<button id="examPickerSelectNoneBtn" class="modal-btn" type="button">全不选</button>' +
      '</div>' +
    '</div>' +
    '<div class="exam-range-tree" id="examRangeTree"></div>' +
    '<div class="exam-picker-footer">' +
      '<div class="exam-count-row">' +
        '<div class="exam-count-label">出题数</div>' +
        '<input id="examPickerCountInput" class="auth-input exam-count-input" type="number" min="1" step="1" inputmode="numeric" />' +
        '<div class="exam-count-hint">最多 <span id="examPickerMaxHint"></span> 题</div>' +
      '</div>' +
      '<div class="modal-actions" style="margin-top:12px;">' +
        '<button id="examPickerStartBtn" class="modal-btn primary" type="button">开始考试</button>' +
      '</div>' +
    '</div>';

  els.examPickerView.appendChild(wrap);

  var tree = wrap.querySelector('#examRangeTree');
  function renderGroup(group, isRoot) {
    if (!group || !Array.isArray(group.chapters) || !group.chapters.length) return;
    var fid = isRoot ? '__root__' : String(group.id);
    var collapsed = !!examPicker.fold[fid];

    var box = document.createElement('div');
    box.className = 'exam-range-folder' + (collapsed ? ' collapsed' : '');
    box.dataset.folderId = fid;

    var title = isRoot ? (group.title || '未分组') : (group.title || '未命名文件夹');
    var st = examPickerFolderStats(group);
    box.innerHTML =
      '<div class="exam-range-row">' +
        '<button class="exam-fold-btn" type="button" aria-label="折叠/展开"><i class="fa-solid fa-caret-right"></i></button>' +
        '<label class="exam-check exam-folder-label">' +
          '<input class="exam-folder-check" type="checkbox" />' +
          '<span class="exam-range-name">' + escapeHtml(String(title)) + '</span>' +
        '</label>' +
        '<span class="exam-range-count">' + st.total + ' 题</span>' +
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

  // Footer default value
  var max = examPickerSelectedCount(pool);
  var input = wrap.querySelector('#examPickerCountInput');
  if (input) input.value = String(Math.min(20, max));
  var maxHint = wrap.querySelector('#examPickerMaxHint');
  if (maxHint) maxHint.textContent = String(max);

  wrap.onclick = function (e) {
    var t = e && e.target ? e.target : null;
    if (!t || !t.closest) return;

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
      for (var ci = 0; ci < (group2.chapters || []).length; ci++) {
        var ch2 = group2.chapters[ci];
        if (!ch2 || !ch2.id) continue;
        examPicker.sel[String(ch2.id)] = on;
      }
      // sync chapter checkboxes inside this folder
      var localCbs = folderEl2.querySelectorAll('input.exam-chapter-check');
      for (var x = 0; x < localCbs.length; x++) localCbs[x].checked = on;
      examPickerUpdateUi();
      return;
    }

    var allBtn = t.closest('#examPickerSelectAllBtn');
    if (allBtn) {
      examPickerSetAll(true);
      var allCbs = wrap.querySelectorAll('input.exam-chapter-check');
      for (var x2 = 0; x2 < allCbs.length; x2++) allCbs[x2].checked = true;
      examPickerUpdateUi();
      return;
    }

    var noneBtn = t.closest('#examPickerSelectNoneBtn');
    if (noneBtn) {
      examPickerSetAll(false);
      var allCbs2 = wrap.querySelectorAll('input.exam-chapter-check');
      for (var x3 = 0; x3 < allCbs2.length; x3++) allCbs2[x3].checked = false;
      examPickerUpdateUi();
      return;
    }

    var startBtn = t.closest('#examPickerStartBtn');
    if (startBtn) {
      var max2 = examPickerSelectedCount(pool);
      var input2 = wrap.querySelector('#examPickerCountInput');
      var want = input2 ? Number(input2.value) : 0;
      if (!Number.isFinite(want)) want = 0;
      want = Math.floor(want);
      if (want <= 0) { showToast('请先选择出题数', { timeoutMs: 2200 }); return; }
      if (want > max2) want = max2;
      if (want <= 0) { showToast('请先选择范围', { timeoutMs: 2200 }); return; }

      exam.selectedChapterIds = examPickerSelectedChapterIds();
      var qs = examBuildQuestionSet(pool, exam.selectedChapterIds, want);
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

      if (typeof examRenderRunner === 'function') examRenderRunner();
      return;
    }
  };

  if (input) {
    input.oninput = function () {
      var max3 = examPickerSelectedCount(pool);
      var v = Number(input.value);
      if (!Number.isFinite(v)) v = 0;
      v = Math.floor(v);
      if (v > max3) v = max3;
      if (v < 0) v = 0;
      input.value = String(v);
    };
  }

  examPickerUpdateUi();
}
