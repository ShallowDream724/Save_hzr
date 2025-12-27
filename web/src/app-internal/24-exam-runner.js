/** ---------------------------
 * 14.2) 考试模式：答题界面
 * --------------------------- */

var examRunnerBound = false;

function examFindQuestionInChapter(chapter, qref) {
  if (!chapter || !Array.isArray(chapter.questions) || !qref) return null;
  var wantQid = String(qref.qid || '');
  if (!wantQid) return null;

  var idx = (qref.idx !== undefined && qref.idx !== null) ? Number(qref.idx) : NaN;
  if (Number.isFinite(idx) && idx >= 0 && idx < chapter.questions.length) {
    var q0 = chapter.questions[idx];
    if (q0 && examNormalizeQid(q0) === wantQid) return q0;
  }

  for (var i = 0; i < chapter.questions.length; i++) {
    var q = chapter.questions[i];
    if (q && examNormalizeQid(q) === wantQid) return q;
  }
  return null;
}

function examAnsweredCount() {
  var n = 0;
  for (var i = 0; i < (exam.questions || []).length; i++) {
    var key = examQuestionKey(exam.questions[i]);
    if (key && exam.answers && Object.prototype.hasOwnProperty.call(exam.answers, key)) n += 1;
  }
  return n;
}

function examComputeCorrectCount() {
  var n = 0;
  for (var k in (exam.answers || {})) {
    if (!Object.prototype.hasOwnProperty.call(exam.answers, k)) continue;
    if (exam.answers[k] && exam.answers[k].correct) n += 1;
  }
  return n;
}

function examStreakPraise(streak) {
  streak = Number(streak) || 0;
  if (streak <= 0) return '';
  var d = streak % 10;
  if (!(d === 3 || d === 5 || d === 7 || d === 0)) return '';
  if (d === 3) return '三连正确，稳住。';
  if (d === 5) return '五连正确，状态不错。';
  if (d === 7) return '七连正确，很扎实。';
  return streak + ' 连正确，继续保持。';
}

function examEncourageText() {
  var list = [
    '没事，再接再厉。',
    '别慌，下一题拿回来。',
    '稳住，复盘一下就行。',
    '差一点点，继续。'
  ];
  return list[Math.floor(Math.random() * list.length)];
}

function examUpdateRunnerHeader() {
  var total = Number(exam.totalQuestions) || 0;
  var answered = examAnsweredCount();
  var correct = examComputeCorrectCount();
  exam.correctCount = correct;

  var sub = exam.bookTitle ? ('《' + exam.bookTitle + '》 · ') : '';
  sub += '进度 ' + answered + '/' + total + ' · 正确 ' + correct;
  examSetHeader(exam.bookTitle, sub);

  try { if (els.examRestartBtn) els.examRestartBtn.style.display = ''; } catch (_) {}
}

function examCreateOptionLi(opt) {
  var li = document.createElement('li');
  li.className = 'option-item exam-option';
  var lab = opt && opt.label ? String(opt.label).trim() : '';
  li.dataset.label = lab;

  var labEl = document.createElement('span');
  labEl.className = 'option-label';
  labEl.textContent = lab;

  var cont = document.createElement('div');
  cont.className = 'option-content';
  renderMarkdownInto(cont, opt && opt.content, { inline: true });

  var mark = document.createElement('span');
  mark.className = 'exam-opt-mark';

  li.appendChild(labEl);
  li.appendChild(cont);
  li.appendChild(mark);
  return li;
}

function examCreateQuestionCard(qref, idx) {
  var card = document.createElement('div');
  card.className = 'question-card exam-qcard';
  card.dataset.exam = '1';
  card.dataset.examIdx = String(idx);
  card.dataset.examRevealed = '0';
  card.dataset.chapterId = String(qref.chapterId || '');
  card.dataset.qid = String(qref.qid || '');
  if (qref && qref.qid) card.dataset.hzrSeed = 'q:' + String(qref.qid);

  var chapter = findChapterById(qref.chapterId);
  var q = examFindQuestionInChapter(chapter, qref);

  var header = document.createElement('div');
  header.className = 'q-header';

  var idEl = document.createElement('span');
  idEl.className = 'q-id';
  idEl.textContent = String(idx + 1);

  var textEl = document.createElement('div');
  textEl.className = 'q-text';
  if (!q) renderMarkdownInto(textEl, '题目已不存在（可能被删除/覆盖）');
  else renderMarkdownInto(textEl, q.text);

  var actions = document.createElement('div');
  actions.className = 'q-actions';

  var favBtn = document.createElement('button');
  favBtn.className = 'fav-btn';
  favBtn.type = 'button';
  favBtn.title = '收藏';
  favBtn.setAttribute('aria-label', '收藏');
  favBtn.setAttribute('aria-pressed', 'false');
  favBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
  try {
    if (typeof setFavBtnState === 'function') setFavBtnState(favBtn, !!(qref && qref.chapterId && qref.qid && isFavoriteQuestion(qref.chapterId, qref.qid)));
  } catch (_) {}

  header.appendChild(idEl);
  header.appendChild(textEl);
  actions.appendChild(favBtn);
  header.appendChild(actions);
  card.appendChild(header);

  favBtn.onclick = function (e) {
    try { if (e) { e.preventDefault(); e.stopPropagation(); } } catch (_) {}
    if (!qref || !qref.chapterId || !qref.qid) return;
    var res = null;
    try { if (typeof toggleFavoriteQuestion === 'function') res = toggleFavoriteQuestion(qref.chapterId, qref.qid, qref.idx); } catch (_) { res = null; }
    try { if (typeof setFavBtnState === 'function') setFavBtnState(favBtn, !!(res && res.on)); } catch (_) {}
  };

  var ul = document.createElement('ul');
  ul.className = 'options-list exam-options';
  if (q && Array.isArray(q.options)) {
    for (var i = 0; i < q.options.length; i++) ul.appendChild(examCreateOptionLi(q.options[i]));
  }
  card.appendChild(ul);

  applyRandomHighlights(card);
  return card;
}

function examApplyRevealUi(card, qref, q, pickedLabel, opts) {
  opts = opts || {};
  if (!card) return;
  var correctLabel = (q && q.answer !== undefined && q.answer !== null) ? String(q.answer).trim() : '';
  var picked = String(pickedLabel || '').trim();
  var isCorrect = picked && correctLabel && picked === correctLabel;

  try { card.dataset.examRevealed = '1'; } catch (_) {}
  try { card.classList.add('exam-revealed'); } catch (_) {}

  // Add AI button (after reveal only)
  try {
    var header = card.querySelector('.q-header');
    var host = header ? (header.querySelector('.q-actions') || header) : null;
    if (host && !host.querySelector('.ai-ask-btn')) {
      var aiBtn = document.createElement('button');
      aiBtn.className = 'ai-ask-btn';
      aiBtn.type = 'button';
      aiBtn.title = '问 AI';
      aiBtn.textContent = '问AI';
      host.appendChild(aiBtn);
    }
  } catch (_) {}

  // Mark options
  var optEls = card.querySelectorAll('.exam-option');
  for (var i = 0; i < optEls.length; i++) {
    var el = optEls[i];
    var lab = (el && el.dataset) ? String(el.dataset.label || '') : '';
    try { el.classList.remove('correct', 'wrong', 'picked'); } catch (_) {}
    if (lab && lab === correctLabel) { try { el.classList.add('correct'); } catch (_) {} }
    if (lab && picked && lab === picked) { try { el.classList.add('picked'); } catch (_) {} }
    if (lab && picked && lab === picked && lab !== correctLabel) { try { el.classList.add('wrong'); } catch (_) {} }

    var mark = el.querySelector('.exam-opt-mark');
    if (mark) {
      if (lab === correctLabel) mark.innerHTML = '<i class="fa-solid fa-check"></i>';
      else if (lab === picked && lab !== correctLabel) mark.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      else mark.innerHTML = '';
    }
  }

  // Feedback
  var fb = card.querySelector('.exam-feedback');
  if (fb && fb.remove) fb.remove();
  fb = document.createElement('div');
  fb.className = 'exam-feedback ' + (isCorrect ? 'ok' : 'bad');

  var msg = isCorrect ? '正确。' : '错误。';
  var extra = '';
  if (!opts.fromRestore) extra = isCorrect ? examStreakPraise(exam.streak) : examEncourageText();
  if (extra) msg += ' ' + extra;
  fb.textContent = msg;
  card.appendChild(fb);

  // Analysis
  if (q && q.explanation) {
    var box = document.createElement('div');
    box.className = 'analysis-box';

    var title = document.createElement('div');
    title.className = 'analysis-title';
    var light = document.createElement('i');
    light.className = 'fa-solid fa-lightbulb';
    title.appendChild(light);
    title.appendChild(document.createTextNode(' 解析'));

    var content = document.createElement('div');
    content.className = 'analysis-content';
    renderMarkdownInto(content, q.explanation);

    box.appendChild(title);
    box.appendChild(content);
    card.appendChild(box);
  }

  // Knowledge
  if (q && q.knowledge) {
    var details = document.createElement('details');
    details.className = 'knowledge-details';
    details.open = true;

    var summary = document.createElement('summary');
    summary.className = 'knowledge-summary';
    var bookI = document.createElement('i');
    bookI.className = 'fa-solid fa-book-medical';
    summary.appendChild(bookI);

    var titleSpan = document.createElement('span');
    titleSpan.className = 'knowledge-summary-title';
    renderMarkdownInto(titleSpan, '知识点： ' + String(q.knowledgeTitle || '相关考点'), { inline: true });
    summary.appendChild(titleSpan);

    var kCont = document.createElement('div');
    kCont.className = 'knowledge-content';
    renderMarkdownInto(kCont, q.knowledge);

    details.appendChild(summary);
    details.appendChild(kCont);
    card.appendChild(details);
  }

  // Source (after reveal, below knowledge)
  var src = document.createElement('div');
  src.className = 'exam-source';
  var folderName = qref.folderTitle ? String(qref.folderTitle) : '未分组';
  var chapterName = qref.chapterTitle ? String(qref.chapterTitle) : '';
  src.textContent = '出处：' + folderName + (chapterName ? ('\n' + chapterName) : '');
  card.appendChild(src);
}

function examAnswerQuestion(card, qref, pickedLabel) {
  if (!card || !qref || !pickedLabel) return;
  var key = examQuestionKey(qref);
  if (!key) return;
  if (exam.answers && Object.prototype.hasOwnProperty.call(exam.answers, key)) return; // already answered

  var chapter = findChapterById(qref.chapterId);
  var q = examFindQuestionInChapter(chapter, qref);
  if (!q) { showToast('题目已不存在', { timeoutMs: 2000 }); return; }

  var correctLabel = (q.answer !== undefined && q.answer !== null) ? String(q.answer).trim() : '';
  var picked = String(pickedLabel).trim();
  if (!picked) return;
  var isCorrect = picked === correctLabel;

  exam.answers[key] = { picked: picked, correct: isCorrect };
  try { if (typeof studyUpdateOnAnswer === 'function') studyUpdateOnAnswer(qref.chapterId, qref.qid, isCorrect); } catch (_) {}
  if (isCorrect) exam.streak = (Number(exam.streak) || 0) + 1;
  else exam.streak = 0;

  examApplyRevealUi(card, qref, q, picked);
  examUpdateRunnerHeader();
  try { if (typeof examSaveSnapshot === 'function') examSaveSnapshot('running'); } catch (_) {}
  try { if (typeof examMarkViewOpen === 'function') examMarkViewOpen(); } catch (_) {}

  var answered = examAnsweredCount();
  if (answered >= (Number(exam.totalQuestions) || 0) && answered > 0) {
    exam.phase = 'result';
    examStopTimer();
    try { if (typeof examSaveSnapshot === 'function') examSaveSnapshot('result'); } catch (_) {}
    try { if (typeof examMarkViewOpen === 'function') examMarkViewOpen(); } catch (_) {}
    if (typeof examRenderResult === 'function') examRenderResult();
    try {
      var rb = els.examRunnerView ? els.examRunnerView.querySelector('#examResultBox') : null;
      if (rb && rb.scrollIntoView) rb.scrollIntoView({ block: 'start' });
    } catch (_) {}
    showToast('已完成，已出成绩', { timeoutMs: 2200 });
  }
}

function examBindRunnerEventsOnce() {
  if (examRunnerBound) return;
  examRunnerBound = true;
  if (!els.examRunnerView) return;

  // Prevent long-press context menu on options (mobile).
  addEvt(els.examRunnerView, 'contextmenu', function (e) {
    try {
      var t = e && e.target ? e.target : null;
      if (!t || !t.closest) return;
      if (!t.closest('.exam-option')) return;
      e.preventDefault();
    } catch (_) {}
  }, { passive: false });

  addEvt(els.examRunnerView, 'click', function (e) {
    var t = e && e.target ? e.target : null;
    if (!t || !t.closest) return;
    if (exam.phase !== 'running') return;
    var opt = t.closest('.exam-option');
    if (!opt) return;
    var card = opt.closest('.question-card');
    if (!card || !card.dataset) return;
    if (card.dataset.examRevealed === '1') return;
    var picked = opt.dataset ? opt.dataset.label : '';
    var idx = Number(card.dataset.examIdx);
    if (!Number.isFinite(idx) || idx < 0 || idx >= exam.questions.length) return;
    examAnswerQuestion(card, exam.questions[idx], picked);
  }, false);
}

function examRenderResult() {
  if (!els.examRunnerView) return;
  var box = els.examRunnerView.querySelector('#examResultBox');
  if (!box) return;
  try { box.style.display = ''; } catch (_) {}

  var total = Number(exam.totalQuestions) || 0;
  var correct = examComputeCorrectCount();
  var score = total > 0 ? Math.ceil(correct / total * 100) : 0;

  box.innerHTML =
    '<div class="exam-result-title">考试完成</div>' +
    '<div class="exam-result-metrics">' +
      '<div class="exam-metric"><div class="exam-metric-label">得分</div><div class="exam-metric-val">' + score + '</div></div>' +
      '<div class="exam-metric"><div class="exam-metric-label">正确</div><div class="exam-metric-val">' + correct + '/' + total + '</div></div>' +
      '<div class="exam-metric"><div class="exam-metric-label">用时</div><div class="exam-metric-val">' + escapeHtml(examFormatTime(exam.elapsedMs)) + '</div></div>' +
    '</div>' +
    '<div class="exam-result-actions">' +
      '<button id="examFinishBtn" class="modal-btn primary" type="button">退出</button>' +
    '</div>';

  var btn = box.querySelector('#examFinishBtn');
  if (btn) {
    btn.onclick = function () {
      examClearSaved(exam.bookId);
      examCloseModal();
    };
  }
}

function examRenderRunner() {
  if (!els.examRunnerView || !els.examPickerView) return;
  examBindRunnerEventsOnce();

  if (exam.phase !== 'result') exam.phase = 'running';
  exam.active = true;
  exam.totalQuestions = Array.isArray(exam.questions) ? exam.questions.length : 0;
  exam.answers = (exam.answers && typeof exam.answers === 'object') ? exam.answers : {};

  els.examPickerView.style.display = 'none';
  els.examRunnerView.style.display = '';

  els.examRunnerView.innerHTML = '';

  var head = document.createElement('div');
  head.className = 'exam-runner-head';
  head.innerHTML =
    '<div class="exam-runner-tip">点击选项作答；出答案后才显示“问AI”。</div>' +
    '<div id="examRunnerStats" class="exam-runner-stats"></div>' +
    '<div id="examResultBox" class="exam-result-box" style="display:none;"></div>';
  els.examRunnerView.appendChild(head);

  var list = document.createElement('div');
  list.className = 'exam-question-list';
  els.examRunnerView.appendChild(list);

  for (var i = 0; i < exam.totalQuestions; i++) list.appendChild(examCreateQuestionCard(exam.questions[i], i));

  // Restore answered UI
  for (var j = 0; j < exam.totalQuestions; j++) {
    var qref = exam.questions[j];
    var key = examQuestionKey(qref);
    if (!key || !exam.answers || !Object.prototype.hasOwnProperty.call(exam.answers, key)) continue;
    var ans = exam.answers[key];
    var card = list.querySelector('.exam-qcard[data-exam-idx="' + String(j) + '"]');
    if (!card) continue;
    var chapter = findChapterById(qref.chapterId);
    var q = examFindQuestionInChapter(chapter, qref);
    if (!q) continue;
    examApplyRevealUi(card, qref, q, ans.picked, { fromRestore: true });
  }

  examUpdateRunnerHeader();

  var answered = examAnsweredCount();
  if (answered >= exam.totalQuestions && answered > 0) {
    exam.phase = 'result';
    examStopTimer();
    var resultBox = els.examRunnerView.querySelector('#examResultBox');
    if (resultBox) resultBox.style.display = '';
    examRenderResult();
    return;
  }

  // scroll to first unanswered
  try {
    for (var k = 0; k < exam.totalQuestions; k++) {
      var qref2 = exam.questions[k];
      var key2 = examQuestionKey(qref2);
      if (key2 && exam.answers && Object.prototype.hasOwnProperty.call(exam.answers, key2)) continue;
      var c2 = list.querySelector('.exam-qcard[data-exam-idx="' + String(k) + '"]');
      if (c2 && c2.scrollIntoView) { c2.scrollIntoView({ block: 'start' }); break; }
    }
  } catch (_) {}
}

function examResumeFromSaved(saved) {
  if (!saved || (saved.phase !== 'running' && saved.phase !== 'result')) return false;
  var book = getActiveBook();
  if (!book || !book.id) return false;
  if (String(book.id) !== String(exam.bookId || book.id)) examInitForBook(book);

  var qs = Array.isArray(saved.questions) ? saved.questions : [];
  var out = [];
  for (var i = 0; i < qs.length; i++) {
    var qref = qs[i];
    if (!qref || !qref.chapterId || !qref.qid) continue;
    var ch = findChapterById(qref.chapterId);
    var q = examFindQuestionInChapter(ch, qref);
    if (!q) continue;
    out.push({
      folderId: qref.folderId || null,
      folderTitle: qref.folderTitle || '',
      chapterId: qref.chapterId,
      chapterTitle: qref.chapterTitle || (ch ? String(ch.title || '') : ''),
      qid: qref.qid,
      idx: qref.idx
    });
  }
  if (!out.length) return false;

  exam.questions = out;
  exam.totalQuestions = out.length;
  exam.selectedChapterIds = Array.isArray(saved.selectedChapterIds) ? saved.selectedChapterIds.slice() : [];
  exam.answers = (saved.answers && typeof saved.answers === 'object') ? saved.answers : {};
  exam.correctCount = Number(saved.correctCount) || 0;
  exam.streak = Number(saved.streak) || 0;
  exam.elapsedMs = Math.max(0, Number(saved.elapsedMs) || 0);

  examUpdateTimerUi();
  exam.phase = (saved.phase === 'result') ? 'result' : 'running';
  if (exam.phase === 'running') examStartTimer();
  examRenderRunner();
  showToast(exam.phase === 'result' ? '已恢复考试结果' : '已恢复上次考试进度', { timeoutMs: 2200 });
  return true;
}
