    /** ---------------------------
     * 1) 常量 / 数据
     * --------------------------- */
    var STORAGE_KEY = 'pharm_data_v4_1';
    var AUTH_TOKEN_KEY = 'pharm_sync_token_v1';
    var API_BASE = '';
    try {
      var metaApi = (typeof document !== 'undefined') ? document.querySelector('meta[name="hzr-api-base"]') : null;
      if (metaApi && typeof metaApi.content === 'string') API_BASE = metaApi.content.trim();
    } catch (e) {}
    if (!API_BASE && typeof window !== 'undefined' && window.API_BASE) API_BASE = String(window.API_BASE).trim();
    if (API_BASE && API_BASE[API_BASE.length - 1] === '/') API_BASE = API_BASE.slice(0, -1);

    var UI_DEFAULTS = {
      analysisColor: '#4b8fe2',
      knowledgeColor: '#0c5460',
      emphasisColor: '#c54a5a',
      highlightPalette: ['#FFE08A', '#F7B4C9', '#FFD0A6', '#BFEBDD', '#BFD9FF', '#D8C7FF'],
      highlightIntensity: 0.55,
      highlightMode: 'stable' // stable | random
    };

    function defaultUi() {
      return {
        analysisColor: UI_DEFAULTS.analysisColor,
        knowledgeColor: UI_DEFAULTS.knowledgeColor,
        emphasisColor: UI_DEFAULTS.emphasisColor,
        highlightPalette: UI_DEFAULTS.highlightPalette.slice(),
        highlightIntensity: UI_DEFAULTS.highlightIntensity,
        highlightMode: UI_DEFAULTS.highlightMode
      };
    }

    function normalizeUi(ui) {
      if (!ui || typeof ui !== 'object') ui = {};
      var out = defaultUi();
      if (typeof ui.analysisColor === 'string') out.analysisColor = ui.analysisColor;
      if (typeof ui.knowledgeColor === 'string') out.knowledgeColor = ui.knowledgeColor;
      if (typeof ui.emphasisColor === 'string') out.emphasisColor = ui.emphasisColor;
      if (Array.isArray(ui.highlightPalette) && ui.highlightPalette.length) {
        out.highlightPalette = ui.highlightPalette.filter(function (x) { return typeof x === 'string' && x; }).slice(0, 12);
        if (!out.highlightPalette.length) out.highlightPalette = UI_DEFAULTS.highlightPalette.slice();
      }
      var a = Number(ui.highlightIntensity);
      if (Number.isFinite(a)) out.highlightIntensity = Math.max(0.22, Math.min(0.85, a));
      if (ui.highlightMode === 'random' || ui.highlightMode === 'stable') out.highlightMode = ui.highlightMode;
      return out;
    }

    var defaultSeed = null;
    var defaultSeedLoaded = false;
    function loadDefaultSeed() {
      if (defaultSeedLoaded) return Promise.resolve(defaultSeed);
      defaultSeedLoaded = true;
      if (typeof fetch !== 'function') return Promise.resolve(null);
      // Default seed is a renamed local backup JSON:
      // { exportedAt, app, data: { chapters, folders, layoutMap, deletedChapterIds, ui } }
      return fetch('./default.json', { cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (j) {
          if (!j || typeof j !== 'object') return null;
          var data = (j.data && typeof j.data === 'object') ? j.data : j;
          if (!data || typeof data !== 'object') return null;
          if (!Array.isArray(data.chapters) || !Array.isArray(data.folders)) return null;
          if (!data.layoutMap || typeof data.layoutMap !== 'object' || Array.isArray(data.layoutMap)) return null;
          if (!Array.isArray(data.deletedChapterIds)) data.deletedChapterIds = [];
          data.ui = normalizeUi(data.ui);
          defaultSeed = data;
          return defaultSeed;
        })
        .catch(function () { return null; });
    }

    function normalizeBook(book) {
      if (!book || typeof book !== 'object') book = {};
      var theme = (typeof book.theme === 'string' && book.theme) ? book.theme : 'blue';
      if (!isValidBookTheme(theme)) theme = 'blue';

      var icon = (typeof book.icon === 'string' && book.icon) ? book.icon : '✚';
      if (!isValidBookIcon(icon)) icon = '✚';

      var titleOverrides = {};
      if (book.chapterTitleOverrides && typeof book.chapterTitleOverrides === 'object' && !Array.isArray(book.chapterTitleOverrides)) {
        for (var k in book.chapterTitleOverrides) {
          if (!Object.prototype.hasOwnProperty.call(book.chapterTitleOverrides, k)) continue;
          var v = book.chapterTitleOverrides[k];
          if (typeof v !== 'string') continue;
          v = v.trim();
          if (!v) continue;
          titleOverrides[String(k)] = v;
        }
      }
      return {
        id: (typeof book.id === 'string' && book.id) ? book.id : uid('b'),
        title: (typeof book.title === 'string' && book.title.trim()) ? book.title.trim() : '未命名书',
        theme: theme,
        icon: icon,
        includePresets: !!book.includePresets,
        chapters: Array.isArray(book.chapters) ? book.chapters : [],
        folders: Array.isArray(book.folders) ? book.folders : [],
        layoutMap: (book.layoutMap && typeof book.layoutMap === 'object' && !Array.isArray(book.layoutMap)) ? book.layoutMap : {},
        chapterOrder: (book.chapterOrder && typeof book.chapterOrder === 'object' && !Array.isArray(book.chapterOrder)) ? book.chapterOrder : {},
        chapterTitleOverrides: titleOverrides,
        deletedChapterIds: Array.isArray(book.deletedChapterIds) ? book.deletedChapterIds : [],
        createdAt: (typeof book.createdAt === 'string' && book.createdAt) ? book.createdAt : new Date().toISOString(),
        updatedAt: (typeof book.updatedAt === 'string' && book.updatedAt) ? book.updatedAt : new Date().toISOString()
      };
    }

    var BOOK_THEMES = [
      { id: 'blue', name: '深蓝' },
      { id: 'indigo', name: '靛蓝' },
      { id: 'red', name: '酒红' },
      { id: 'rose', name: '玫瑰' },
      { id: 'teal', name: '青绿' },
      { id: 'emerald', name: '翡翠' },
      { id: 'sage', name: '豆绿' },
      { id: 'amber', name: '琥珀' },
      { id: 'cocoa', name: '可可' },
      { id: 'plum', name: '紫罗兰' },
      { id: 'slate', name: '墨灰' },
      { id: 'midnight', name: '夜墨' }
    ];

    var BOOK_ICONS = [
      '✚', '⚕️', '🩺', '💊', '🧬', '🔬', '🧫', '🧪', '🩻', '🩹', '🩸', '🫀', '🧠', '🫁', '🦴', '🏥',
      '🧑‍⚕️', '🧑‍🔬', '🦠','✅','⭐','🧩',
      '🧮', '📐', '🧲', '⚙️', '📊', '📈', '🗺️', '⚖️', '🏛️', '🌱', '🦋', '🌌', '✂'
    ];

    function isValidBookTheme(id) {
      for (var i = 0; i < BOOK_THEMES.length; i++) if (BOOK_THEMES[i].id === id) return true;
      return false;
    }

    function isValidBookIcon(icon) {
      if (typeof icon !== 'string') return false;
      for (var i = 0; i < BOOK_ICONS.length; i++) if (BOOK_ICONS[i] === icon) return true;
      return false;
    }

    function bookThemeClass(book) {
      var id = book && typeof book.theme === 'string' ? book.theme : 'blue';
      if (!isValidBookTheme(id)) id = 'blue';
      return 'theme-' + id;
    }

    function applyAppThemeFromActiveBook() {
      try {
        if (!document.body || !document.body.classList) return;
        for (var i = 0; i < BOOK_THEMES.length; i++) {
          document.body.classList.remove('app-theme-' + BOOK_THEMES[i].id);
        }
        var book = getActiveBook();
        var id = book && typeof book.theme === 'string' ? book.theme : 'blue';
        if (!isValidBookTheme(id)) id = 'blue';
        document.body.classList.add('app-theme-' + id);
      } catch (_) {}
    }

    function makeBookFromLibrary(lib, title, includePresets) {
      lib = (lib && typeof lib === 'object') ? lib : {};
      var b = {
        id: uid('b'),
        title: title || '未命名书',
        includePresets: !!includePresets,
        chapters: Array.isArray(lib.chapters) ? lib.chapters : [],
        folders: Array.isArray(lib.folders) ? lib.folders : [],
        layoutMap: (lib.layoutMap && typeof lib.layoutMap === 'object' && !Array.isArray(lib.layoutMap)) ? lib.layoutMap : {},
        chapterOrder: (lib.chapterOrder && typeof lib.chapterOrder === 'object' && !Array.isArray(lib.chapterOrder)) ? lib.chapterOrder : {},
        chapterTitleOverrides: (lib.chapterTitleOverrides && typeof lib.chapterTitleOverrides === 'object' && !Array.isArray(lib.chapterTitleOverrides)) ? lib.chapterTitleOverrides : {},
        deletedChapterIds: Array.isArray(lib.deletedChapterIds) ? lib.deletedChapterIds : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      return normalizeBook(b);
    }

    function hasStaticRefs(layoutMap) {
      try {
        if (!layoutMap || typeof layoutMap !== 'object') return false;
        for (var k in layoutMap) {
          if (!Object.prototype.hasOwnProperty.call(layoutMap, k)) continue;
          if (String(k).indexOf('static_') === 0) return true;
        }
      } catch (e) {}
      return false;
    }

    function normalizeAppData(obj, keepUi) {
      obj = (obj && typeof obj === 'object') ? obj : {};
      var ui = (keepUi && typeof keepUi === 'object') ? normalizeUi(keepUi) : normalizeUi(obj.ui);

      if (Array.isArray(obj.books)) {
        var books = obj.books.map(normalizeBook);
        var currentBookId = (typeof obj.currentBookId === 'string' && obj.currentBookId) ? obj.currentBookId : (books[0] ? books[0].id : null);
        var out = { ui: ui, books: books, currentBookId: currentBookId };
        // ensure currentBookId exists
        appData = out;
        getActiveBook();
        return appData;
      }

      // Legacy (single library) -> one book
      var legacy = {
        chapters: Array.isArray(obj.chapters) ? obj.chapters : [],
        folders: Array.isArray(obj.folders) ? obj.folders : [],
        layoutMap: isObject(obj.layoutMap) ? obj.layoutMap : {},
        deletedChapterIds: Array.isArray(obj.deletedChapterIds)
          ? obj.deletedChapterIds
          : (Array.isArray(obj.deleted) ? obj.deleted : [])
      };
      var includePresets = hasStaticRefs(legacy.layoutMap);
      var book = makeBookFromLibrary(legacy, '药理学', includePresets);
      appData = { ui: ui, books: [book], currentBookId: book.id };
      return appData;
    }

    function defaultAppData() {
      var ui = defaultUi();

      // Default book seed (药理学) comes from packaged default.json (wrapper).
      var seedBook = null;
      if (defaultSeed && typeof defaultSeed === 'object') {
        seedBook = makeBookFromLibrary(defaultSeed, '药理学', true);
      } else {
        seedBook = makeBookFromLibrary({ chapters: [], folders: [], layoutMap: {}, deletedChapterIds: [] }, '药理学', true);
      }

      return {
        ui: ui,
        books: [seedBook],
        currentBookId: seedBook.id
      };
    }
  
    var staticData = []; // preset chapters (read-only)
    var appData = defaultAppData();
    var currentChapterId = null;
    var homeVisible = false;

    var dataLoaded = false;
    var presetsLoaded = false;

    var initialized = false;
    var uiBound = false;
    var guardsInstalled = false;
  
    var SUPPORT_POINTER = !!window.PointerEvent;

    function pushStaticChapter(title, questions) {
      var id = 'static_' + (staticData.length + 1);
      staticData.push({
        id: id,
        title: title,
        questions: questions,
        isStatic: true
      });
      return id;
    }

    function getBooks() {
      if (!appData || typeof appData !== 'object') return [];
      if (!Array.isArray(appData.books)) appData.books = [];
      return appData.books;
    }

    function getActiveBook() {
      var books = getBooks();
      if (!books.length) {
        var seed = makeBookFromLibrary(defaultSeed || {}, '药理学', true);
        books.push(seed);
        appData.currentBookId = seed.id;
        return seed;
      }
      var id = appData.currentBookId;
      for (var i = 0; i < books.length; i++) if (books[i] && books[i].id === id) return books[i];
      // fallback: first
      appData.currentBookId = books[0].id;
      return books[0];
    }

    function setActiveBook(bookId) {
      var books = getBooks();
      for (var i = 0; i < books.length; i++) {
        if (books[i] && books[i].id === bookId) {
          appData.currentBookId = bookId;
          currentChapterId = null;
          applyAppThemeFromActiveBook();
          try { if (typeof persistViewState === 'function') persistViewState(); } catch (_) {}
          return true;
        }
      }
      return false;
    }

    function loadStaticPresets() {
      if (presetsLoaded) return Promise.resolve(true);
      presetsLoaded = true;

      // CodePen / embed fallback: allow injecting preset chapters via a global
      // window.__PRESET_CHAPTERS__ = [{ title, questions }, ...]
      try {
        if (typeof window !== 'undefined' && Array.isArray(window.__PRESET_CHAPTERS__)) {
          for (var i = 0; i < window.__PRESET_CHAPTERS__.length; i++) {
            var ch = window.__PRESET_CHAPTERS__[i];
            if (ch && typeof ch.title === 'string' && Array.isArray(ch.questions)) {
              pushStaticChapter(ch.title, ch.questions);
            }
          }
          return Promise.resolve(true);
        }
      } catch (e) {}

      if (typeof fetch !== 'function') return Promise.resolve(false);

      return fetch('./presets.json', { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) return null;
          return res.json();
        })
        .then(function (json) {
          if (!json) return false;
          var chapters = null;
          if (Array.isArray(json)) chapters = json;
          else if (json && Array.isArray(json.chapters)) chapters = json.chapters;
          if (!Array.isArray(chapters)) return false;

          for (var i = 0; i < chapters.length; i++) {
            var ch = chapters[i];
            if (ch && typeof ch.title === 'string' && Array.isArray(ch.questions)) {
              pushStaticChapter(ch.title, ch.questions);
            }
          }
          return true;
        })
        .catch(function () { return false; });
    }
  
