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
          if (!els.settingsModal) return;
          populateSettingsUi();
          if (els.resetHint) els.resetHint.textContent = '';
          if (els.resetToDefaultBtn) els.resetToDefaultBtn.textContent = '重置到默认';
          els.settingsModal.classList.add('open');
          syncModalScrollLock();
        };
      }

      if (els.settingsCloseBtn && els.settingsModal) {
        els.settingsCloseBtn.onclick = function () { els.settingsModal.classList.remove('open'); syncModalScrollLock(); };
      }
      if (els.exportLocalBtn) {
        els.exportLocalBtn.onclick = function () {
          var payload = {
            exportedAt: new Date().toISOString(),
            app: '拯救Hzr',
            data: appData
          };
          downloadJson('拯救Hzr-本地备份-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json', payload);
          showToast('已导出本地备份', { timeoutMs: 2600 });
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
          if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
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

