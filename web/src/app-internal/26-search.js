/** ---------------------------
 * 26) 全局搜索（当前书内）
 * - VSCode-like: 分组 + 预览 + 跳转
 * - 性能：索引缓存 + 增量过滤 + 分片扫描
 * --------------------------- */

var searchState = {
  open: false,
  bound: false,
  bookId: null,
  sig: '',
  index: [], // [{chapterId,chapterTitle,folderTitle, qid, qno, idx, text, options, explanation, knowledge, allLower}]
  building: false,
  buildToken: 0,

  query: '',
  lastQuery: '',
  lastHitIdxs: null, // [indexIdx]
  searchToken: 0,
  inputTimer: 0,
  selectedHit: null, // {chapterId,qid}

  // chapterId -> collapsed?
  fold: {}
};

function searchNormalizeQid(q) {
  var qid = (q && q.qid !== undefined && q.qid !== null) ? String(q.qid)
    : (q && q.id !== undefined && q.id !== null) ? String(q.id)
    : '';
  return qid;
}

function searchBookSignature(book, allChapters) {
  try {
    if (!book || !allChapters) return '';
    var totalQuestions = 0;
    for (var i = 0; i < allChapters.length; i++) totalQuestions += (allChapters[i] && Array.isArray(allChapters[i].questions)) ? allChapters[i].questions.length : 0;
    var folders = (book && Array.isArray(book.folders)) ? book.folders : [];
    var s = String(book.id || '') + '|' + allChapters.length + '|' + totalQuestions + '|' + folders.length;
    return s;
  } catch (_) {
    return '';
  }
}

function searchFolderTitleByChapterId(book) {
  var map = {};
  try {
    var folderTitleById = {};
    var folders = (book && Array.isArray(book.folders)) ? book.folders : [];
    for (var i = 0; i < folders.length; i++) folderTitleById[String(folders[i].id)] = String(folders[i].title || '').trim();

    var layout = (book && book.layoutMap && typeof book.layoutMap === 'object' && !Array.isArray(book.layoutMap)) ? book.layoutMap : {};
    for (var chId in layout) {
      if (!Object.prototype.hasOwnProperty.call(layout, chId)) continue;
      var fid = layout[chId] ? String(layout[chId]) : '';
      map[String(chId)] = fid ? (folderTitleById[fid] || '未命名文件夹') : '未分组';
    }
  } catch (_) {}
  return map;
}

function searchSetStatus(text) {
  try {
    if (els.searchStatus) els.searchStatus.textContent = text ? String(text) : '';
  } catch (_) {}
}

function searchSetResultsHtml(html) {
  if (!els.searchResults) return;
  els.searchResults.innerHTML = html || '';
}

function searchEscape(s) { return escapeHtml(String(s || '')); }
function searchEscapeAttr(s) { return escapeAttr(String(s || '')); }

function searchSliceSnippet(raw, lower, qLower) {
  raw = String(raw || '');
  lower = String(lower || '');
  qLower = String(qLower || '');
  if (!raw) return { html: '', hit: false };
  if (!qLower) return { html: searchEscape(raw.slice(0, 120)), hit: false };

  var idx = lower.indexOf(qLower);
  if (idx < 0) return { html: searchEscape(raw.slice(0, 120)), hit: false };

  var ctxBefore = 36;
  var ctxAfter = 64;
  var start = Math.max(0, idx - ctxBefore);
  var end = Math.min(raw.length, idx + qLower.length + ctxAfter);

  var head = raw.slice(start, idx);
  var mid = raw.slice(idx, idx + qLower.length);
  var tail = raw.slice(idx + qLower.length, end);

  // Normalize whitespace for preview.
  head = head.replace(/\s+/g, ' ');
  mid = mid.replace(/\s+/g, ' ');
  tail = tail.replace(/\s+/g, ' ');

  var prefix = (start > 0) ? '…' : '';
  var suffix = (end < raw.length) ? '…' : '';
  var html = searchEscape(prefix + head) + '<mark>' + searchEscape(mid) + '</mark>' + searchEscape(tail + suffix);
  return { html: html, hit: true };
}

function searchMakeHit(item, qLower) {
  if (!item) return null;
  qLower = String(qLower || '');

  var fields = [
    { key: 'text', label: '题干', raw: item.text },
    { key: 'options', label: '选项', raw: item.options },
    { key: 'explanation', label: '解析', raw: item.explanation },
    { key: 'knowledge', label: '知识点', raw: item.knowledge }
  ];

  for (var i = 0; i < fields.length; i++) {
    var raw = String(fields[i].raw || '');
    if (!raw) continue;
    var lower = raw.toLowerCase();
    if (lower.indexOf(qLower) < 0) continue;
    var sn = searchSliceSnippet(raw, lower, qLower);
    return {
      chapterId: item.chapterId,
      chapterTitle: item.chapterTitle,
      folderTitle: item.folderTitle,
      qid: item.qid,
      qno: item.qno,
      field: fields[i].label,
      snippetHtml: sn.html
    };
  }

  var fallback = String(item.text || item.options || item.explanation || item.knowledge || '');
  var fbLower = fallback.toLowerCase();
  var sn2 = searchSliceSnippet(fallback, fbLower, qLower);
  return {
    chapterId: item.chapterId,
    chapterTitle: item.chapterTitle,
    folderTitle: item.folderTitle,
    qid: item.qid,
    qno: item.qno,
    field: '内容',
    snippetHtml: sn2.html
  };
}

function searchRenderResults(hits, stats) {
  hits = Array.isArray(hits) ? hits : [];
  stats = stats || {};

  if (!hits.length) {
    var msg = stats && stats.query ? '未找到匹配项。' : '输入关键词开始搜索。';
    searchSetResultsHtml('<div class="search-empty">' + searchEscape(msg) + '</div>');
    return;
  }

  var byChapter = {};
  var order = [];
  for (var i = 0; i < hits.length; i++) {
    var h = hits[i];
    if (!h || !h.chapterId) continue;
    var cid = String(h.chapterId);
    if (!byChapter[cid]) {
      byChapter[cid] = {
        chapterId: cid,
        folderTitle: h.folderTitle || '',
        chapterTitle: h.chapterTitle || '',
        items: []
      };
      order.push(cid);
    }
    byChapter[cid].items.push(h);
  }

  var html = '';
  for (var g = 0; g < order.length; g++) {
    var cid2 = order[g];
	    var group = byChapter[cid2];
	    if (!group || !group.items || !group.items.length) continue;
	    var chapterTitle = String(group.chapterTitle || '').trim() || '未命名章节';
	    var folderTitle = String(group.folderTitle || '').trim() || '未分组';
	    var collapsed = !!(searchState && searchState.fold && searchState.fold[cid2]);

	    html +=
	      '<div class="search-group' + (collapsed ? ' collapsed' : '') + '" data-chapter-id="' + searchEscapeAttr(cid2) + '">' +
	        '<button type="button" class="search-group-head" data-chapter-id="' + searchEscapeAttr(cid2) + '" aria-expanded="' + (collapsed ? 'false' : 'true') + '">' +
	          '<span class="search-group-title" title="' + searchEscapeAttr(folderTitle + ' / ' + chapterTitle) + '">' +
	            '<span class="search-group-folder">' + searchEscape(folderTitle) + '</span>' +
	            '<span class="search-group-sep">/</span>' +
	            '<span class="search-group-chapter">' + searchEscape(chapterTitle) + '</span>' +
	          '</span>' +
	          '<span class="search-group-count">' + group.items.length + '</span>' +
	        '</button>' +
	        '<div class="search-group-items">';

    for (var j = 0; j < group.items.length; j++) {
      var it = group.items[j];
      var qno = (it.qno !== undefined && it.qno !== null && String(it.qno) !== '') ? String(it.qno) : '';
      var title = (qno ? ('#' + qno) : '题目') + (it.field ? (' · ' + it.field) : '');
      html +=
        '<button type="button" class="search-hit" data-chapter-id="' + searchEscapeAttr(it.chapterId) + '" data-qid="' + searchEscapeAttr(it.qid) + '">' +
          // NOTE: <button> only allows phrasing content; use <span> to avoid mobile HTML reflow issues.
          '<span class="search-hit-title">' +
            '<span class="search-hit-qno">' + searchEscape(qno ? ('#' + qno) : '') + '</span>' +
            '<span class="search-hit-field">' + searchEscape(it.field || '') + '</span>' +
          '</span>' +
          '<span class="search-hit-snippet">' + (it.snippetHtml || '') + '</span>' +
        '</button>';
    }

    html += '</div></div>';
  }

  if (stats && stats.truncated) {
    html += '<div class="search-empty">已显示前 ' + searchEscape(String(stats.shown || hits.length)) + ' 条，继续缩小关键词。</div>';
  }

  searchSetResultsHtml(html);
}

function searchBuildIndexStart() {
  var book = getActiveBook();
  if (!book || !book.id) return;
  var bookTitle = '';
  try { bookTitle = String(book.title || '').trim(); } catch (_) { bookTitle = ''; }

  var all = getAllChapters();
  var sig = searchBookSignature(book, all);
  if (searchState.bookId === String(book.id) && searchState.sig === sig && Array.isArray(searchState.index) && searchState.index.length) return;

  searchState.bookId = String(book.id);
  searchState.sig = sig;
  searchState.index = [];
  searchState.lastQuery = '';
  searchState.lastHitIdxs = null;
  searchState.fold = {};

  var folderMap = searchFolderTitleByChapterId(book);

  var token = ++searchState.buildToken;
  searchState.building = true;
  searchSetStatus((bookTitle ? ('《' + bookTitle + '》 · ') : '') + '构建索引…');
  searchSetResultsHtml('<div class="search-empty">正在构建索引…</div>');

  var chapters = all;
  var totalQ = 0;
  for (var i = 0; i < chapters.length; i++) totalQ += (chapters[i] && Array.isArray(chapters[i].questions)) ? chapters[i].questions.length : 0;
  var processed = 0;

  var cIdx = 0;
  var qIdx = 0;
  var CHUNK = 260;

  function step() {
    if (token !== searchState.buildToken) return;
    var n = 0;
    while (cIdx < chapters.length && n < CHUNK) {
      var ch = chapters[cIdx];
      if (!ch || !ch.id || !Array.isArray(ch.questions) || !ch.questions.length) { cIdx += 1; qIdx = 0; continue; }
      var chId = String(ch.id);
      var chTitle = String(ch.title || '').trim() || '未命名章节';
      var folderTitle = folderMap[chId] || '未分组';

      while (qIdx < ch.questions.length && n < CHUNK) {
        var q = ch.questions[qIdx];
        var qid = searchNormalizeQid(q);
        if (qid) {
          var qno = (q && q.id !== undefined && q.id !== null) ? String(q.id) : '';
          var text = (q && q.text !== undefined && q.text !== null) ? String(q.text) : '';
          var explanation = (q && q.explanation !== undefined && q.explanation !== null) ? String(q.explanation) : '';
          var knowledge = '';
          if (q && q.knowledge) knowledge = String(q.knowledge);
          if (q && q.knowledgeTitle) knowledge = String(q.knowledgeTitle) + '\n' + knowledge;
          var options = '';
          if (q && Array.isArray(q.options) && q.options.length) {
            var parts = [];
            for (var oi = 0; oi < q.options.length; oi++) {
              var opt = q.options[oi];
              var lab = opt && opt.label ? String(opt.label) : '';
              var cont = opt && opt.content ? String(opt.content) : '';
              if (lab || cont) parts.push(lab + '. ' + cont);
            }
            options = parts.join('\n');
          }
          var allLower = (text + '\n' + options + '\n' + explanation + '\n' + knowledge).toLowerCase();

          searchState.index.push({
            chapterId: chId,
            chapterTitle: chTitle,
            folderTitle: folderTitle,
            qid: qid,
            qno: qno,
            idx: qIdx,
            text: text,
            options: options,
            explanation: explanation,
            knowledge: knowledge,
            allLower: allLower
          });
        }
        qIdx += 1;
        processed += 1;
        n += 1;
      }
      if (qIdx >= ch.questions.length) { cIdx += 1; qIdx = 0; }
    }

    if (token !== searchState.buildToken) return;
    if (cIdx >= chapters.length) {
      searchState.building = false;
      searchSetStatus((bookTitle ? ('《' + bookTitle + '》 · ') : '') + '索引就绪：' + searchState.index.length + ' 题');

      // If user already typed query during build, run it now.
      try {
        var qNow = (els.searchInput && els.searchInput.value !== undefined && els.searchInput.value !== null) ? String(els.searchInput.value || '').trim() : '';
        if (qNow) { searchRunQueryNow(); return; }
      } catch (_) {}

      searchRenderResults([], { query: '' });
      return;
    }

    if (totalQ > 0) {
      var pct = Math.min(99, Math.floor(processed / totalQ * 100));
      searchSetStatus((bookTitle ? ('《' + bookTitle + '》 · ') : '') + '构建索引… ' + pct + '%');
    } else {
      searchSetStatus((bookTitle ? ('《' + bookTitle + '》 · ') : '') + '构建索引…');
    }
    setTimeout(step, 0);
  }

  setTimeout(step, 0);
}

function searchRunQueryNow() {
  if (!els.searchInput) return;
  var q = String(els.searchInput.value || '');
  var qTrim = q.trim();
  var qLower = qTrim.toLowerCase();
  searchState.query = qTrim;

  if (!qLower) {
    searchState.lastQuery = '';
    searchState.lastHitIdxs = null;
    searchRenderResults([], { query: '' });
    searchSetStatus(searchState.building ? '构建索引…' : ('索引就绪：' + (searchState.index ? searchState.index.length : 0) + ' 题'));
    return;
  }

  // If index not ready, delay.
  if (searchState.building || !Array.isArray(searchState.index) || !searchState.index.length) {
    searchSetResultsHtml('<div class="search-empty">索引构建中…</div>');
    return;
  }

  var token = ++searchState.searchToken;
  searchSetStatus('搜索中…');

  var base = null;
  var baseKind = 'all';
  if (searchState.lastQuery && qLower.indexOf(searchState.lastQuery) === 0 && Array.isArray(searchState.lastHitIdxs)) {
    base = searchState.lastHitIdxs.slice();
    baseKind = 'filtered';
  }
  if (!base) {
    base = [];
    for (var i = 0; i < searchState.index.length; i++) base.push(i);
  }

  var hits = [];
  var hitIdxs = [];
  var shown = 0;
  var MAX_SHOW = 220;
  var MAX_KEEP = 4000;
  var idx = 0;
  var CHUNK = 520;
  var truncated = false;

  function step() {
    if (token !== searchState.searchToken) return;
    var n = 0;
    while (idx < base.length && n < CHUNK) {
      var ii = base[idx];
      idx += 1;
      n += 1;
      var item = searchState.index[ii];
      if (!item || !item.allLower) continue;
      if (item.allLower.indexOf(qLower) < 0) continue;

      if (hitIdxs.length < MAX_KEEP) hitIdxs.push(ii);
      if (shown < MAX_SHOW) {
        var hit = searchMakeHit(item, qLower);
        if (hit) hits.push(hit);
        shown += 1;
      } else {
        truncated = true;
      }
    }

    if (token !== searchState.searchToken) return;
    if (idx >= base.length) {
      searchState.lastQuery = qLower;
      searchState.lastHitIdxs = hitIdxs;
      var countText = (hitIdxs.length >= MAX_KEEP) ? ('≥' + MAX_KEEP) : String(hitIdxs.length);
      searchSetStatus((baseKind === 'filtered' ? '筛选' : '搜索') + '完成：' + countText + ' 条');
      searchRenderResults(hits, { query: qLower, truncated: truncated, shown: hits.length });
      return;
    }

    // progressive status
    var pct = Math.min(99, Math.floor(idx / Math.max(1, base.length) * 100));
    searchSetStatus('搜索中… ' + pct + '%');
    setTimeout(step, 0);
  }

  setTimeout(step, 0);
}

function searchScheduleRun() {
  if (searchState.inputTimer) {
    try { clearTimeout(searchState.inputTimer); } catch (_) {}
    searchState.inputTimer = 0;
  }
  searchState.inputTimer = setTimeout(function () {
    searchState.inputTimer = 0;
    searchRunQueryNow();
  }, 120);
}

function searchFlashCard(card) {
  if (!card || !card.classList) return;
  try { card.classList.add('search-flash'); } catch (_) {}
  setTimeout(function () {
    try { card.classList.remove('search-flash'); } catch (_) {}
  }, 1200);
}

function searchJumpTo(chapterId, qid) {
  chapterId = String(chapterId || '');
  qid = String(qid || '');
  if (!chapterId || !qid) return;

  try { closeSearchModal(); } catch (_) {}

  try {
    if (typeof loadChapter === 'function') loadChapter(chapterId);
  } catch (_) {}

  // wait for DOM render
  setTimeout(function () {
    try {
      var card = null;
      var list = document.querySelectorAll ? document.querySelectorAll('.question-card[data-qid]') : [];
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (!el || !el.dataset) continue;
        if (String(el.dataset.qid || '') !== qid) continue;
        var cid = el.dataset.chapterId ? String(el.dataset.chapterId) : '';
        if (cid && cid !== chapterId) continue;
        card = el;
        break;
      }
      if (!card && list && list.length) {
        for (var j = 0; j < list.length; j++) {
          var el2 = list[j];
          if (el2 && el2.dataset && String(el2.dataset.qid || '') === qid) { card = el2; break; }
        }
      }
      if (card && card.scrollIntoView) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      searchFlashCard(card);
    } catch (_) {}
  }, 0);
}

function bindSearchOnce() {
  if (searchState.bound) return;
  searchState.bound = true;

  if (els.searchInput) {
    els.searchInput.oninput = function () { searchScheduleRun(); };
    els.searchInput.onkeydown = function (e) {
      if (!e) return;
      if (e.key === 'Enter') {
        var first = els.searchResults ? els.searchResults.querySelector('.search-hit') : null;
        if (first && first.click) { try { e.preventDefault(); } catch (_) {} first.click(); }
      }
    };
  }

  if (els.searchResults) {
	    els.searchResults.onclick = function (e) {
	      var t = e && e.target ? e.target : null;
	      if (!t || !t.closest) return;

	      var head = t.closest('.search-group-head');
	      if (head && head.dataset) {
	        var cid0 = head.dataset.chapterId ? String(head.dataset.chapterId) : '';
	        if (!cid0) return;
	        var group0 = head.closest('.search-group');
	        var willCollapse = true;
	        try { willCollapse = !(!group0 || group0.classList.contains('collapsed')); } catch (_) { willCollapse = true; }
	        try { if (group0) group0.classList.toggle('collapsed', !!willCollapse); } catch (_) {}
	        try { head.setAttribute('aria-expanded', willCollapse ? 'false' : 'true'); } catch (_) {}
	        try { if (searchState.fold) searchState.fold[cid0] = !!willCollapse; } catch (_) {}
	        return;
	      }
	      var btn = t.closest('.search-hit');
	      if (!btn || !btn.dataset) return;
	      var cid = btn.dataset.chapterId ? String(btn.dataset.chapterId) : '';
	      var qid = btn.dataset.qid ? String(btn.dataset.qid) : '';
      if (!cid || !qid) return;
      searchJumpTo(cid, qid);
    };
  }
}

function openSearchModal() {
  if (!els.searchModal) return;
  bindSearchOnce();
  searchState.open = true;
  try { els.searchModal.classList.add('open'); } catch (_) {}
  try { els.searchModal.setAttribute('aria-hidden', 'false'); } catch (_) {}
  try { syncModalScrollLock(); } catch (_) {}

  try { searchBuildIndexStart(); } catch (_) {}
  try {
    if (!searchState.building && Array.isArray(searchState.index) && searchState.index.length) {
      var b = getActiveBook();
      var t = b && b.title ? String(b.title || '').trim() : '';
      searchSetStatus((t ? ('《' + t + '》 · ') : '') + '索引就绪：' + searchState.index.length + ' 题');
    }
  } catch (_) {}
  try {
    if (els.searchInput) els.searchInput.focus();
    if (els.searchInput) els.searchInput.select();
  } catch (_) {}

  // If index already ready and we have query, run immediately.
  try {
    var qNow = (els.searchInput && els.searchInput.value !== undefined && els.searchInput.value !== null) ? String(els.searchInput.value || '').trim() : '';
    if (qNow && !searchState.building && Array.isArray(searchState.index) && searchState.index.length) searchRunQueryNow();
  } catch (_) {}
}

function closeSearchModal() {
  if (!els.searchModal) return;
  searchState.open = false;
  try { els.searchModal.classList.remove('open'); } catch (_) {}
  try { els.searchModal.setAttribute('aria-hidden', 'true'); } catch (_) {}
  try { syncModalScrollLock(); } catch (_) {}
}
