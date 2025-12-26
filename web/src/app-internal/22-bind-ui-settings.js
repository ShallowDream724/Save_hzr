    /** ---------------------------
     * 12.4) UI 绑定：设置（UI 配色 / 备份 / 重置）
     * --------------------------- */
    var uiSettingsBound = false;

    // UI 配色设置
    var highlightOptions = [
      { hex: '#FFE08A', name: '柠檬黄' },
      { hex: '#F7B4C9', name: '樱花粉' },
      { hex: '#FFD0A6', name: '蜜桃橘' },
      { hex: '#BFEBDD', name: '薄荷绿' },
      { hex: '#BFD9FF', name: '雾霾蓝' },
      { hex: '#D8C7FF', name: '淡紫' },
      { hex: '#F2E6D8', name: '奶油米' },
      { hex: '#BFEAF2', name: '浅青' }
    ];

    function populateSettingsUi() {
      if (!appData.ui) appData.ui = defaultUi();
      appData.ui = normalizeUi(appData.ui);

      if (els.uiAnalysisColor) els.uiAnalysisColor.value = normalizeHex(appData.ui.analysisColor) || UI_DEFAULTS.analysisColor;
      if (els.uiKnowledgeColor) els.uiKnowledgeColor.value = normalizeHex(appData.ui.knowledgeColor) || UI_DEFAULTS.knowledgeColor;
      if (els.uiEmphasisColor) els.uiEmphasisColor.value = normalizeHex(appData.ui.emphasisColor) || UI_DEFAULTS.emphasisColor;
      if (els.uiHighlightIntensity) els.uiHighlightIntensity.value = String(appData.ui.highlightIntensity);
      if (els.uiHighlightMode) els.uiHighlightMode.value = appData.ui.highlightMode;

      if (els.uiHighlightPalette) {
        els.uiHighlightPalette.innerHTML = '';
        var selected = {};
        for (var i = 0; i < appData.ui.highlightPalette.length; i++) selected[String(appData.ui.highlightPalette[i]).toUpperCase()] = true;

        for (var j = 0; j < highlightOptions.length; j++) {
          (function (opt) {
            var item = document.createElement('label');
            item.className = 'swatch-item';
            item.title = opt.name + ' ' + opt.hex;

            var sw = document.createElement('span');
            sw.className = 'swatch';
            sw.style.background = opt.hex;

            var ck = document.createElement('input');
            ck.type = 'checkbox';
            ck.checked = !!selected[opt.hex.toUpperCase()];
            ck.onchange = function () {
              var ui = normalizeUi(appData.ui);
              var map = {};
              for (var k = 0; k < ui.highlightPalette.length; k++) map[String(ui.highlightPalette[k]).toUpperCase()] = true;
              if (ck.checked) map[opt.hex.toUpperCase()] = true;
              else delete map[opt.hex.toUpperCase()];
              var next = [];
              for (var m = 0; m < highlightOptions.length; m++) {
                var h = highlightOptions[m].hex.toUpperCase();
                if (map[h]) next.push(h);
              }
              if (!next.length) next = UI_DEFAULTS.highlightPalette.slice();
              ui.highlightPalette = next;
              appData.ui = ui;
              applyUiToDocument();
              saveData();
            };

            item.appendChild(sw);
            item.appendChild(ck);
            els.uiHighlightPalette.appendChild(item);
          })(highlightOptions[j]);
        }
      }

      applyUiToDocument();
    }

    function getSettingsMode(explicitMode) {
      if (explicitMode === 'home' || explicitMode === 'book') return explicitMode;
      return homeVisible ? 'home' : 'book';
    }

    function updateSettingsModalMode(mode) {
      try {
        if (els.settingsModal && els.settingsModal.dataset) els.settingsModal.dataset.mode = mode;
      } catch (_) {}

      if (els.settingsDangerZone) els.settingsDangerZone.style.display = (mode === 'home') ? '' : 'none';
      if (els.exportLocalBtn) els.exportLocalBtn.textContent = (mode === 'home') ? '导出全部备份（JSON）' : '导出本书备份（JSON）';
    }

    function openSettingsModal(explicitMode) {
      if (!els.settingsModal) return;
      populateSettingsUi();
      if (els.resetHint) els.resetHint.textContent = '';
      if (els.resetToDefaultBtn) els.resetToDefaultBtn.textContent = '重置到默认';
      updateSettingsModalMode(getSettingsMode(explicitMode));
      els.settingsModal.classList.add('open');
      syncModalScrollLock();
    }

    function bindUiSettingsOnce() {
      if (uiSettingsBound) return;
      uiSettingsBound = true;

      function onUiChange() {
        if (!appData.ui) appData.ui = defaultUi();
        var ui = normalizeUi(appData.ui);
        if (els.uiAnalysisColor) ui.analysisColor = normalizeHex(els.uiAnalysisColor.value) || ui.analysisColor;
        if (els.uiKnowledgeColor) ui.knowledgeColor = normalizeHex(els.uiKnowledgeColor.value) || ui.knowledgeColor;
        if (els.uiEmphasisColor) ui.emphasisColor = normalizeHex(els.uiEmphasisColor.value) || ui.emphasisColor;
        if (els.uiHighlightIntensity) ui.highlightIntensity = Number(els.uiHighlightIntensity.value);
        if (els.uiHighlightMode) ui.highlightMode = els.uiHighlightMode.value === 'random' ? 'random' : 'stable';
        appData.ui = normalizeUi(ui);
        applyUiToDocument();
        saveData();
      }

      if (els.uiAnalysisColor) els.uiAnalysisColor.oninput = onUiChange;
      if (els.uiKnowledgeColor) els.uiKnowledgeColor.oninput = onUiChange;
      if (els.uiEmphasisColor) els.uiEmphasisColor.oninput = onUiChange;
      if (els.uiHighlightIntensity) els.uiHighlightIntensity.onchange = onUiChange;
      if (els.uiHighlightMode) els.uiHighlightMode.onchange = onUiChange;

      if (els.resetUiBtn) {
        els.resetUiBtn.onclick = function () {
          appData.ui = defaultUi();
          populateSettingsUi();
          saveData();
          showToast('已恢复默认配色', { timeoutMs: 2200 });
        };
      }

      // 设置
      if (els.settingsBtn) {
        els.settingsBtn.onclick = function () {
          openSettingsModal();
        };
      }

      if (els.settingsCloseBtn && els.settingsModal) {
        els.settingsCloseBtn.onclick = function () { els.settingsModal.classList.remove('open'); syncModalScrollLock(); };
      }
      if (els.exportLocalBtn) {
        els.exportLocalBtn.onclick = function () {
          function safeFileName(name) {
            var s = (typeof name === 'string') ? name.trim() : '';
            if (!s) return '未命名书';
            return s.replace(/[\\/:*?"<>|]/g, '-').slice(0, 40) || '未命名书';
          }

          var mode = 'home';
          try { mode = (els.settingsModal && els.settingsModal.dataset && els.settingsModal.dataset.mode) ? els.settingsModal.dataset.mode : mode; } catch (_) {}
          mode = getSettingsMode(mode);

          var ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
          if (mode === 'book') {
            var book = getActiveBook();
            if (!book) { showToast('未找到当前书', { timeoutMs: 2200 }); return; }
            book = normalizeBook(book);
            var payloadBook = {
              exportedAt: new Date().toISOString(),
              app: '拯救Hzr',
              bookTitle: book.title,
              theme: book.theme,
              icon: book.icon,
              includePresets: !!book.includePresets,
              data: {
                folders: Array.isArray(book.folders) ? book.folders : [],
                chapters: Array.isArray(book.chapters) ? book.chapters : [],
                layoutMap: (book.layoutMap && typeof book.layoutMap === 'object' && !Array.isArray(book.layoutMap)) ? book.layoutMap : {},
                chapterOrder: (book.chapterOrder && typeof book.chapterOrder === 'object' && !Array.isArray(book.chapterOrder)) ? book.chapterOrder : {},
                chapterTitleOverrides: (book.chapterTitleOverrides && typeof book.chapterTitleOverrides === 'object' && !Array.isArray(book.chapterTitleOverrides)) ? book.chapterTitleOverrides : {},
                deletedChapterIds: Array.isArray(book.deletedChapterIds) ? book.deletedChapterIds : []
              }
            };
            downloadJson('拯救Hzr-书备份-' + safeFileName(book.title) + '-' + ts + '.json', payloadBook);
            showToast('已导出本书备份', { timeoutMs: 2600 });
            return;
          }

          var books = getBooks();
          var outBooks = [];
          for (var i = 0; i < (books || []).length; i++) {
            var b = books[i];
            if (!b) continue;
            b = normalizeBook(b);
            outBooks.push({
              title: b.title,
              theme: b.theme,
              icon: b.icon,
              includePresets: !!b.includePresets,
              folders: Array.isArray(b.folders) ? b.folders : [],
              chapters: Array.isArray(b.chapters) ? b.chapters : [],
              layoutMap: (b.layoutMap && typeof b.layoutMap === 'object' && !Array.isArray(b.layoutMap)) ? b.layoutMap : {},
              chapterOrder: (b.chapterOrder && typeof b.chapterOrder === 'object' && !Array.isArray(b.chapterOrder)) ? b.chapterOrder : {},
              chapterTitleOverrides: (b.chapterTitleOverrides && typeof b.chapterTitleOverrides === 'object' && !Array.isArray(b.chapterTitleOverrides)) ? b.chapterTitleOverrides : {},
              deletedChapterIds: Array.isArray(b.deletedChapterIds) ? b.deletedChapterIds : []
            });
          }

          var payloadAll = {
            exportedAt: new Date().toISOString(),
            app: '拯救Hzr',
            books: outBooks,
            ui: (appData && appData.ui) ? normalizeUi(appData.ui) : defaultUi()
          };
          downloadJson('拯救Hzr-全部备份-' + ts + '.json', payloadAll);
          showToast('已导出全部备份', { timeoutMs: 2600 });
        };
      }

      if (els.resetToDefaultBtn) {
        var resetArmed = false;
        var resetTimer = 0;
        els.resetToDefaultBtn.onclick = function () {
          if (!resetArmed) {
            resetArmed = true;
            els.resetToDefaultBtn.textContent = '确认重置';
            if (els.resetHint) els.resetHint.textContent = '再次点击“确认重置”将清空自建/导入并恢复预设（云端也会自动同步）。';
            if (resetTimer) window.clearTimeout(resetTimer);
            resetTimer = window.setTimeout(function () {
              resetArmed = false;
              els.resetToDefaultBtn.textContent = '重置到默认';
              if (els.resetHint) els.resetHint.textContent = '';
            }, 6500);
            return;
          }

          resetArmed = false;
          if (resetTimer) window.clearTimeout(resetTimer);
          resetTimer = 0;
          els.resetToDefaultBtn.textContent = '重置到默认';
          if (els.resetHint) els.resetHint.textContent = '';

          var keepUi = appData && appData.ui ? normalizeUi(appData.ui) : defaultUi();
          appData = defaultAppData();
          appData.ui = keepUi;
          currentChapterId = null;
          if (typeof setTopBarTitle === 'function') setTopBarTitle('请选择章节');
          else if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
          if (els.questionsContainer) els.questionsContainer.innerHTML = '';

          try {
            if (staticData.length && typeof window.addChaptersToFolder === 'function' && typeof window.getStaticChapterIds === 'function') {
              window.addChaptersToFolder('预设题库', window.getStaticChapterIds());
            }
          } catch (e) {}

          saveData();
          renderSidebar();
          showHomeView();
          showToast('已重置到默认（可在“存档”找回旧版本）', { timeoutMs: 4200 });
          if (els.settingsModal) els.settingsModal.classList.remove('open');
          syncModalScrollLock();
        };
      }
    }

    try { window.openSettingsModal = openSettingsModal; } catch (_) {}
