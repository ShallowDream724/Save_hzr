    /** ---------------------------
     * 4) 本地存储
     * --------------------------- */
    function loadLocalData() {
      if (dataLoaded) return;
      dataLoaded = true;
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          appData = defaultAppData();
          return;
        }
        var parsed = JSON.parse(raw);
        // New format: { ui, books, currentBookId }
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.books)) {
          appData = {
            ui: normalizeUi(parsed.ui),
            books: parsed.books.map(normalizeBook),
            currentBookId: (typeof parsed.currentBookId === 'string' && parsed.currentBookId) ? parsed.currentBookId : null
          };
          // Ensure active book exists.
          getActiveBook();
          return;
        }

        // Legacy format (single library) -> migrate into a default book.
        var legacyLib = {
          chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
          folders: Array.isArray(parsed.folders) ? parsed.folders : [],
          layoutMap: isObject(parsed.layoutMap) ? parsed.layoutMap : {},
          deletedChapterIds: Array.isArray(parsed.deletedChapterIds)
            ? parsed.deletedChapterIds
            : (Array.isArray(parsed.deleted) ? parsed.deleted : [])
        };
        var includePresets = hasStaticRefs(legacyLib.layoutMap);
        var migrated = makeBookFromLibrary(legacyLib, '药理学', includePresets);
        appData = {
          ui: normalizeUi(parsed.ui),
          books: [migrated],
          currentBookId: migrated.id
        };
      } catch (e) {
        console.error('Data load error', e);
        appData = defaultAppData();
      }
    }
  
    function saveData() {
      // 本地缓存：可能会因容量不足失败（此时仍然允许继续使用云端同步）
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
      } catch (e) {}
      scheduleCloudSave();
    }

    function ensureDataLoaded() {
      loadLocalData();
    }

    // Persist last view (home vs chapter) across refresh.
    var VIEW_STATE_KEY = 'hzr_view_state_v1';

    function loadViewState() {
      try {
        var raw = localStorage.getItem(VIEW_STATE_KEY);
        if (!raw) return null;
        var j = JSON.parse(raw);
        if (!j || typeof j !== 'object') return null;
        return {
          homeVisible: !!j.homeVisible,
          bookId: (typeof j.bookId === 'string' && j.bookId) ? j.bookId : null,
          chapterId: (typeof j.chapterId === 'string' && j.chapterId) ? j.chapterId : null
        };
      } catch (_) {
        return null;
      }
    }

    function persistViewState() {
      try {
        var payload = {
          homeVisible: !!homeVisible,
          bookId: (appData && typeof appData.currentBookId === 'string' && appData.currentBookId) ? appData.currentBookId : null,
          chapterId: (typeof currentChapterId === 'string' && currentChapterId) ? currentChapterId : null
        };
        localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(payload));
      } catch (_) {}
    }
