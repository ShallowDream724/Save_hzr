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
        var restored = false;
        try {
          var vs = (typeof loadViewState === 'function') ? loadViewState() : null;
          if (vs && vs.bookId) setActiveBook(vs.bookId);
          renderSidebar();
          if (vs && vs.homeVisible === false) {
            hideHomeView();
            if (typeof setTopBarTitle === 'function') setTopBarTitle('请选择章节');
            else if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
            restored = true;

            if (vs.chapterId) {
              var canLoad = false;
              try { canLoad = !!(findChapterById(vs.chapterId) && !isDeleted(vs.chapterId)); } catch (_) { canLoad = false; }
              if (canLoad) loadChapter(vs.chapterId);
            }
          }
        } catch (_) { restored = false; }
        if (!restored) showHomeView();
        tryBootstrapFromCloud().then(function () {
          if (!appData.ui) appData.ui = defaultUi();
          appData.ui = normalizeUi(appData.ui);
          applyUiToDocument();
          applyAppThemeFromActiveBook();
          renderSidebar();
          if (homeVisible) renderHome();
          else if (currentChapterId) loadChapter(currentChapterId);
        });

        initialized = true;
      });
    }
  
    if (document.readyState === 'loading') addEvt(document, 'DOMContentLoaded', initApp);
    else initApp();
