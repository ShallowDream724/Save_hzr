    /** ---------------------------
     * 13) 启动
     * --------------------------- */
    function initApp() {
      cacheEls();
      installModalScrollWatcher();
      if (!els.sidebarList) return;

      Promise.all([loadStaticPresets(), loadDefaultSeed()]).then(function () {
        loadLocalData();
        if (!appData.ui) appData.ui = defaultUi();
        appData.ui = normalizeUi(appData.ui);
        applyUiToDocument();
        applyAppThemeFromActiveBook();
        try {
          if (staticData.length && typeof window.addChaptersToFolder === 'function' && typeof window.getStaticChapterIds === 'function') {
            window.addChaptersToFolder('预设题库', window.getStaticChapterIds());
          }
        } catch (e) {}

        bindUIOnce();
        installGuardsOnce();
        updateSyncStatus();
        renderSidebar();
        showHomeView();
        tryBootstrapFromCloud().then(function () {
          if (!appData.ui) appData.ui = defaultUi();
          appData.ui = normalizeUi(appData.ui);
          applyUiToDocument();
          applyAppThemeFromActiveBook();
          renderSidebar();
          if (homeVisible) renderHome();
        });

        initialized = true;
      });
    }
  
    if (document.readyState === 'loading') addEvt(document, 'DOMContentLoaded', initApp);
    else initApp();
