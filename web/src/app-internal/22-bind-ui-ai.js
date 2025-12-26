    /** ---------------------------
     * 12.6) UI 绑定：AI（对话/拍照导入/历史/选中引用）
     * --------------------------- */
    var uiAiBound = false;

    function bindUiAiOnce() {
      if (uiAiBound) return;
      uiAiBound = true;

      // AI chat bindings
      if (els.questionsContainer) {
        els.questionsContainer.addEventListener('click', function (e) {
          var t = e && e.target ? e.target : null;
          if (!t || !t.closest) return;
          var btn = t.closest('.ai-ask-btn');
          if (!btn) return;
          var card = btn.closest('.question-card');
          var qid = (card && card.dataset) ? card.dataset.qid : null;
          if (!qid) return;
          openAiChatForQuestionId(qid);
        }, false);
      }
      if (els.aiChatCloseBtn) {
        els.aiChatCloseBtn.onclick = function () { closeAiChatModal(); };
      }
      if (els.aiChatModelSwitch && !els.aiChatModelSwitch.dataset.bound) {
        els.aiChatModelSwitch.dataset.bound = '1';
        setModelSwitchValue(els.aiChatModelSwitch, 'flash');
        els.aiChatModelSwitch.addEventListener('click', function (e) {
          var btn = e && e.target && e.target.closest ? e.target.closest('button[data-value]') : null;
          if (!btn) return;
          var v = btn.getAttribute('data-value');
          setModelSwitchValue(els.aiChatModelSwitch, v);
        }, false);
      }
      if (els.aiChatHeader && els.aiChatBox && !els.aiChatHeader.dataset.dragBound) {
        els.aiChatHeader.dataset.dragBound = '1';

        var endChatDrag = function (e) {
          if (!aiChatWindow.dragging) return;
          if (e && aiChatWindow.pointerId !== null && e.pointerId !== aiChatWindow.pointerId) return;
          aiChatWindow.dragging = false;
          aiChatWindow.pointerId = null;
          saveAiChatWindowPrefsSoon();
          try { if (els.aiChatHeader && e && e.pointerId) els.aiChatHeader.releasePointerCapture(e.pointerId); } catch (_) {}
        };

        addEvt(els.aiChatHeader, 'pointerdown', function (e) {
          try {
            if (!isFinePointerLayout()) return;
            if (!e || e.button !== 0) return;
            if (e.target && e.target.closest && e.target.closest('button, textarea, input, select, option')) return;
            if (!els.aiChatBox) return;

            e.preventDefault();

            var rect = getAiChatBoxRect();
            if (rect) applyAiChatWindowStyle(rect);

            // After apply style, read current numeric left/top.
            var cur = getAiChatBoxRect();
            if (!cur) return;

            aiChatWindow.dragging = true;
            aiChatWindow.pointerId = e.pointerId;
            aiChatWindow.startX = e.clientX;
            aiChatWindow.startY = e.clientY;
            aiChatWindow.startLeft = cur.left;
            aiChatWindow.startTop = cur.top;

            try { els.aiChatHeader.setPointerCapture(e.pointerId); } catch (_) {}
          } catch (_) {}
        }, { passive: false });

        addEvt(els.aiChatHeader, 'pointermove', function (e) {
          try {
            if (!aiChatWindow.dragging) return;
            if (!e || (aiChatWindow.pointerId !== null && e.pointerId !== aiChatWindow.pointerId)) return;
            if (!els.aiChatBox) return;

            var dx = e.clientX - aiChatWindow.startX;
            var dy = e.clientY - aiChatWindow.startY;

            var r = getAiChatBoxRect();
            if (!r) return;

            var maxL = Math.max(10, (window.innerWidth || 1200) - r.width - 10);
            var maxT = Math.max(10, (window.innerHeight || 800) - r.height - 10);
            var nextL = clamp(aiChatWindow.startLeft + dx, 10, maxL);
            var nextT = clamp(aiChatWindow.startTop + dy, 10, maxT);

            els.aiChatBox.style.left = Math.round(nextL) + 'px';
            els.aiChatBox.style.top = Math.round(nextT) + 'px';
          } catch (_) {}
        }, { passive: true });

        addEvt(els.aiChatHeader, 'pointerup', endChatDrag, { passive: true });
        addEvt(els.aiChatHeader, 'pointercancel', endChatDrag, { passive: true });
      }
      if (els.aiChatBox && typeof ResizeObserver !== 'undefined' && !aiChatWindow.resizeObs) {
        try {
          aiChatWindow.resizeObs = new ResizeObserver(function () {
            if (!els.aiChatModal || !els.aiChatModal.classList.contains('open')) return;
            if (!els.aiChatBox || !els.aiChatBox.classList.contains('ai-floating')) return;
            saveAiChatWindowPrefsSoon();
          });
          aiChatWindow.resizeObs.observe(els.aiChatBox);
        } catch (_) {}
      }
      if (els.aiChatQuoteClearBtn) {
        els.aiChatQuoteClearBtn.onclick = function () {
          aiChat.pendingSelectedText = '';
          renderAiChatQuote();
          setAiChatHint('');
          try { if (els.aiChatInput) els.aiChatInput.focus(); } catch (_) {}
        };
      }
      if (els.aiChatSendBtn) {
        els.aiChatSendBtn.onclick = function () { sendAiChatMessage(); };
      }
      if (els.aiChatInput) {
        addEvt(els.aiChatInput, 'input', function () {
          autoGrowTextarea(els.aiChatInput, 220);
        }, { passive: true });
        addEvt(els.aiChatInput, 'keydown', function (e) {
          if (!e) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendAiChatMessage();
          }
        }, { passive: false });
      }

      // AI import bindings
      if (els.aiImportBtn) {
        els.aiImportBtn.onclick = function () { openAiImportModal(); };
      }
      if (els.aiImportCloseBtn) {
        els.aiImportCloseBtn.onclick = function () { closeAiImportModal(); };
      }
      if (els.aiImportModelSwitch && !els.aiImportModelSwitch.dataset.bound) {
        els.aiImportModelSwitch.dataset.bound = '1';
        setModelSwitchValue(els.aiImportModelSwitch, 'flash');
        els.aiImportModelSwitch.addEventListener('click', function (e) {
          var btn = e && e.target && e.target.closest ? e.target.closest('button[data-value]') : null;
          if (!btn) return;
          var v = btn.getAttribute('data-value');
          setModelSwitchValue(els.aiImportModelSwitch, v);
        }, false);
      }
      if (els.aiImportStartBtn) {
        els.aiImportStartBtn.onclick = function () { startAiImport(); };
      }
      if (els.aiImportCancelBtn) {
        els.aiImportCancelBtn.onclick = function () { cancelAiImportJob(); };
      }
      if (els.aiImportFilesInput) {
        els.aiImportFilesInput.onchange = function () {
          try { addAiImportFiles(els.aiImportFilesInput.files); } catch (_) {}
          try { els.aiImportFilesInput.value = ''; } catch (_) {}
        };
      }
      if (els.aiImportFilesList) {
        els.aiImportFilesList.addEventListener('click', function (e) {
          try {
            var t = e && e.target ? e.target : null;
            if (!t || !t.closest) return;
            var item = t.closest('.ai-import-file');
            if (!item || !item.dataset) return;
            var idx = Number(item.dataset.idx);
            if (!Number.isFinite(idx)) return;

            if (t.classList && t.classList.contains('ai-import-file-remove')) {
              var removed = aiImport.files[idx];
              if (removed && removed.url) { try { URL.revokeObjectURL(removed.url); } catch (_) {} }
              aiImport.files.splice(idx, 1);
              renderAiImportFiles();
              return;
            }
            if (t.classList && t.classList.contains('ai-import-move-up')) {
              if (idx <= 0) return;
              var tmp = aiImport.files[idx - 1];
              aiImport.files[idx - 1] = aiImport.files[idx];
              aiImport.files[idx] = tmp;
              renderAiImportFiles();
              return;
            }
            if (t.classList && t.classList.contains('ai-import-move-down')) {
              if (idx >= aiImport.files.length - 1) return;
              var tmp2 = aiImport.files[idx + 1];
              aiImport.files[idx + 1] = aiImport.files[idx];
              aiImport.files[idx] = tmp2;
              renderAiImportFiles();
              return;
            }
          } catch (_) {}
        }, false);

        // Drag to reorder (desktop)
        els.aiImportFilesList.addEventListener('dragstart', function (e) {
          try {
            var t = e && e.target ? e.target : null;
            if (!t || !t.closest) return;
            var item = t.closest('.ai-import-file');
            if (!item || !item.dataset) return;
            var idx = Number(item.dataset.idx);
            if (!Number.isFinite(idx)) return;
            aiImport.dragFrom = idx;
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(idx));
            }
          } catch (_) {}
        }, false);
        els.aiImportFilesList.addEventListener('dragover', function (e) {
          try { if (e) e.preventDefault(); } catch (_) {}
        }, false);
        els.aiImportFilesList.addEventListener('drop', function (e) {
          try {
            if (e) e.preventDefault();
            var t = e && e.target ? e.target : null;
            if (!t || !t.closest) return;
            var item = t.closest('.ai-import-file');
            if (!item || !item.dataset) return;
            var to = Number(item.dataset.idx);
            var from = aiImport.dragFrom;
            aiImport.dragFrom = null;
            if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;
            var moved = aiImport.files.splice(from, 1)[0];
            aiImport.files.splice(to, 0, moved);
            renderAiImportFiles();
          } catch (_) {}
        }, false);
      }

      // AI import result -> open chapter
      if (els.aiImportResult) {
        els.aiImportResult.addEventListener('click', function (e) {
          var t = e && e.target ? e.target : null;
          if (!t || !t.closest) return;
          var btn = t.closest('.ai-import-open-btn');
          if (!btn) return;
          var item = btn.closest('.ai-import-result-item');
          var chid = item && item.dataset ? item.dataset.chid : null;
          if (!chid) return;
          closeAiImportModal();
          try {
            if (!findChapterById(String(chid))) {
              showToast('章节尚未同步到本机，稍后再试', { timeoutMs: 2200 });
              return;
            }
            loadChapter(String(chid));
          } catch (_) {
            showToast('打开失败', { timeoutMs: 1800 });
          }
        }, false);
      }

      // Ctrl+V paste images into AI import when modal is open (desktop convenience)
      addEvt(document, 'paste', function (e) {
        try {
          if (!els.aiImportModal || !els.aiImportModal.classList.contains('open')) return;
          var cd = e && e.clipboardData ? e.clipboardData : null;
          if (!cd || !cd.items) return;
          var files = [];
          for (var i = 0; i < cd.items.length; i++) {
            var it = cd.items[i];
            if (!it) continue;
            if (it.kind === 'file') {
              var f = it.getAsFile();
              if (f && String(f.type || '').indexOf('image/') === 0) files.push(f);
            }
          }
          if (files.length) {
            addAiImportFiles(files);
            e.preventDefault();
          }
        } catch (_) {}
      }, { passive: false });

      // Drag & drop images into AI import modal
      if (els.aiImportModal) {
        ['dragenter', 'dragover'].forEach(function (type) {
          addEvt(els.aiImportModal, type, function (e) {
            if (!els.aiImportModal.classList.contains('open')) return;
            try { e.preventDefault(); } catch (_) {}
          }, { passive: false });
        });
        addEvt(els.aiImportModal, 'drop', function (e) {
          try {
            if (!els.aiImportModal.classList.contains('open')) return;
            e.preventDefault();
            var dt = e && e.dataTransfer ? e.dataTransfer : null;
            if (!dt || !dt.files) return;
            addAiImportFiles(dt.files);
          } catch (_) {}
        }, { passive: false });
      }

      // AI history bindings
      if (els.aiHistoryBtn) els.aiHistoryBtn.onclick = function () { openAiHistoryModal(); };
      if (els.homeAiBtn) els.homeAiBtn.onclick = function () { openAiHistoryModal(); };
      if (els.aiHistoryCloseBtn) els.aiHistoryCloseBtn.onclick = function () { closeAiHistoryModal(); };
      if (els.aiHistoryRefreshBtn) els.aiHistoryRefreshBtn.onclick = function () { refreshAiHistory(); };
      if (els.aiHistoryNewBtn) els.aiHistoryNewBtn.onclick = function () { startNewAiConversation(); };
      if (els.aiHistoryScopeSelect) els.aiHistoryScopeSelect.onchange = function () { refreshAiHistory(); };
      if (els.aiHistoryList) {
        els.aiHistoryList.addEventListener('click', function (e) {
          var t = e && e.target ? e.target : null;
          if (!t || !t.closest) return;
          var item = t.closest('.ai-history-item');
          if (!item || !item.dataset) return;
          var id = item.dataset.id;
          if (!id) return;
          closeAiHistoryModal();
          aiChat.conversationId = String(id);
          aiChat.pendingSelectedText = '';
          aiChat.lastQuestionContext = '';
          renderAiChatQuote();
          openAiChatModal();
          setAiChatHint('加载对话…');
          loadAiConversation(id).then(function () { setAiChatHint(''); }).catch(function () { setAiChatHint('加载失败'); });
        }, false);
      }

      // Selection -> floating "ask AI" button
      addEvt(document, 'selectionchange', scheduleAiSelUpdate, { passive: true });
      addEvt(document, 'pointerup', scheduleAiSelUpdate, { passive: true });
      addEvt(window, 'scroll', hideAiSelBtn, { passive: true });
    }

