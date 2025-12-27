/** ---------------------------
 * 12.7) UI 绑定：考试模式
 * --------------------------- */

var uiExamBound = false;

function openExamForBookId(bookId) {
  var ret = null;
  try { ret = (typeof examCaptureReturnState === 'function') ? examCaptureReturnState() : null; } catch (_) { ret = null; }
  try { if (typeof closeBookMenu === 'function') closeBookMenu(); } catch (_) {}
  try { if (typeof hideAiSelBtn === 'function') hideAiSelBtn(); } catch (_) {}

  var curBookId = null;
  try { curBookId = (appData && typeof appData.currentBookId === 'string' && appData.currentBookId) ? String(appData.currentBookId) : null; } catch (_) { curBookId = null; }
  if (bookId && String(bookId) !== String(curBookId)) setActiveBook(String(bookId));
  var book = getActiveBook();
  if (!book || !book.id) return;

  // Reset runtime state, but keep saved progress in localStorage.
  examResetState();
  try { exam.returnState = ret; } catch (_) {}
  examInitForBook(book);

  examOpenModal();

  var saved = examLoadSaved(book.id);
  if (saved && typeof examResumeFromSaved === 'function') {
    if (examResumeFromSaved(saved)) return;
  }

  // Cleanup invalid saved state (if any)
  examClearSaved(book.id);
  if (typeof examRenderPicker === 'function') examRenderPicker();
}

function examCloseExitModal() {
  if (!els.examExitModal) return;
  try { els.examExitModal.classList.remove('open'); } catch (_) {}
  try { els.examExitModal.setAttribute('aria-hidden', 'true'); } catch (_) {}
  try { syncModalScrollLock(); } catch (_) {}
}

function examOpenExitModal() {
  if (!els.examExitModal) return;
  var total = Number(exam.totalQuestions) || 0;
  var answered = (typeof examAnsweredCount === 'function') ? examAnsweredCount() : 0;
  var msg = '已答 ' + answered + '/' + total + ' · 用时 ' + examFormatTime(exam.elapsedMs);
  if (els.examExitHint) els.examExitHint.textContent = msg;
  try { els.examExitModal.classList.add('open'); } catch (_) {}
  try { els.examExitModal.setAttribute('aria-hidden', 'false'); } catch (_) {}
  try { syncModalScrollLock(); } catch (_) {}
}

function bindUiExamOnce() {
  if (uiExamBound) return;
  uiExamBound = true;

  if (els.sidebarExamBtn) {
    els.sidebarExamBtn.onclick = function () {
      var book = getActiveBook();
      if (!book || !book.id) return;
      openExamForBookId(book.id);
      if (els.sidebar && typeof uiIsCompactLayout === 'function' && uiIsCompactLayout()) els.sidebar.classList.remove('active');
      if (typeof uiUpdateCollapseIcon === 'function') uiUpdateCollapseIcon();
    };
  }

  if (els.examExitBtn) {
    els.examExitBtn.onclick = function () {
      if (!examIsOpen()) return;

      if (exam.phase === 'picker' || exam.phase === 'idle') {
        examCloseModal();
        return;
      }
      if (exam.phase === 'result') {
        examClearSaved(exam.bookId);
        examCloseModal();
        return;
      }
      // running -> ask keep/discard
      examOpenExitModal();
    };
  }

  if (els.examRestartBtn) {
    els.examRestartBtn.onclick = function () {
      if (!examIsOpen()) return;
      if (exam.phase === 'picker' || exam.phase === 'idle') return;
      var ok = false;
      try { ok = confirm('重新开始会丢失当前进度，确定吗？'); } catch (_) { ok = false; }
      if (!ok) return;
      examClearSaved(exam.bookId);
      examStopTimer();
      if (typeof examRenderPicker === 'function') examRenderPicker();
    };
  }

  if (els.examExitCancelBtn) {
    els.examExitCancelBtn.onclick = function () {
      examCloseExitModal();
    };
  }
  if (els.examExitKeepBtn) {
    els.examExitKeepBtn.onclick = function () {
      examStopTimer();
      examSaveSnapshot();
      examCloseExitModal();
      examCloseModal();
      showToast('已保留考试进度', { timeoutMs: 2200 });
    };
  }
  if (els.examExitDiscardBtn) {
    els.examExitDiscardBtn.onclick = function () {
      examClearSaved(exam.bookId);
      examCloseExitModal();
      examCloseModal();
      showToast('已退出考试', { timeoutMs: 2200 });
    };
  }

  if (els.examExitModal) {
    addEvt(els.examExitModal, 'click', function (e) {
      if (e.target !== els.examExitModal) return;
      examCloseExitModal();
    }, false);
  }
}
