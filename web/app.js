/**
 * 药理学复习系统 - Reliable Drag + Full-Structure JSON Import
 * 目标：
 * 1) 移动端长按拖拽，拖拽时“只让侧边栏按需自动滚动”，主页面绝不跟着滚
 * 2) 桌面端按住移动即拖拽（阈值触发），点击灵敏
 * 3) 拖入文件夹：拖到文件夹标题/文件夹内部任意位置都算，并有反馈（高亮文件夹标题）
 * 4) JSON 导入：支持
 *    - 单 sheet：{title, questions}
 *    - 多 sheet：[{title, questions}, ...] 或 {sheets:[...]} / {chapters:[...]}
 *    - 多文件夹多 sheet（树形）：{folders:[{title, sheets:[...]}, ...], sheets:[...]}
 *    - 完整结构（含布局）：{folders, chapters/sheets, layoutMap, deletedChapterIds}
 *
 * 注意：不要求你改 CSS。拖拽幽灵元素用 inline style。
 * 存储 KEY 保持原来的，尽量兼容你已有本地数据。
 */
(function () {
    'use strict';
  
    /** ---------------------------
     * 0) 兼容：passive listener 检测 + 简易封装
     * --------------------------- */
    var supportsPassive = false;
    try {
      var _opts = Object.defineProperty({}, 'passive', {
        get: function () { supportsPassive = true; }
      });
      window.addEventListener('testPassive', null, _opts);
      window.removeEventListener('testPassive', null, _opts);
    } catch (e) {}
  
    function addEvt(target, type, handler, options) {
      if (!target) return;
      if (supportsPassive) target.addEventListener(type, handler, options || false);
      else target.addEventListener(type, handler, (options && options.capture) ? true : false);
    }
    function rmEvt(target, type, handler, options) {
      if (!target) return;
      if (supportsPassive) target.removeEventListener(type, handler, options || false);
      else target.removeEventListener(type, handler, (options && options.capture) ? true : false);
    }
  
    /** ---------------------------
     * 0.1) DOM polyfill：matches/closest（尽量兼容旧浏览器）
     * --------------------------- */
    if (!Element.prototype.matches) {
      Element.prototype.matches =
        Element.prototype.msMatchesSelector ||
        Element.prototype.webkitMatchesSelector ||
        function (s) {
          var matches = (this.document || this.ownerDocument).querySelectorAll(s);
          var i = matches.length;
          while (--i >= 0 && matches.item(i) !== this) {}
          return i > -1;
        };
    }
    if (!Element.prototype.closest) {
      Element.prototype.closest = function (s) {
        var el = this;
        while (el && el.nodeType === 1) {
          if (el.matches(s)) return el;
          el = el.parentElement || el.parentNode;
        }
        return null;
      };
    }
  
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
      return {
        id: (typeof book.id === 'string' && book.id) ? book.id : uid('b'),
        title: (typeof book.title === 'string' && book.title.trim()) ? book.title.trim() : '未命名书',
        theme: theme,
        icon: icon,
        includePresets: !!book.includePresets,
        chapters: Array.isArray(book.chapters) ? book.chapters : [],
        folders: Array.isArray(book.folders) ? book.folders : [],
        layoutMap: (book.layoutMap && typeof book.layoutMap === 'object' && !Array.isArray(book.layoutMap)) ? book.layoutMap : {},
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
      '🧮', '📐', '🧲', '⚙️', '💻', '📊', '📈', '🗺️', '⚖️', '🏛️', '🌱', '🦋', '🌌', '✂'
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

    function makeBookFromLibrary(lib, title, includePresets) {
      lib = (lib && typeof lib === 'object') ? lib : {};
      var b = {
        id: uid('b'),
        title: title || '未命名书',
        includePresets: !!includePresets,
        chapters: Array.isArray(lib.chapters) ? lib.chapters : [],
        folders: Array.isArray(lib.folders) ? lib.folders : [],
        layoutMap: (lib.layoutMap && typeof lib.layoutMap === 'object' && !Array.isArray(lib.layoutMap)) ? lib.layoutMap : {},
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
  
    /** ---------------------------
     * 2) DOM 缓存
     * --------------------------- */
    var els = {};
  
    function cacheEls() {
      els.sidebarList = document.getElementById('chapterList');
      els.questionsContainer = document.getElementById('questionsContainer');
      els.chapterTitle = document.getElementById('currentChapterTitle');
      els.menuToggle = document.getElementById('menuToggle');
      els.homeBtn = document.getElementById('homeBtn');
      els.homeView = document.getElementById('homeView');
      els.booksGrid = document.getElementById('booksGrid');
      els.newBookBtn = document.getElementById('newBookBtn');
      els.importBookBtn = document.getElementById('importBookBtn');
      els.homeSyncBtn = document.getElementById('homeSyncBtn');
      els.homeSavesBtn = document.getElementById('homeSavesBtn');
      els.homeSettingsBtn = document.getElementById('homeSettingsBtn');
      els.homeAiBtn = document.getElementById('homeAiBtn');
      els.sidebar = document.getElementById('sidebar');
      els.sidebarOverlay = document.getElementById('sidebarOverlay');
      els.sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
      els.sidebarHomeTopBtn = document.getElementById('sidebarHomeTopBtn');
      els.fabMenu = document.getElementById('fabMenu');
      els.toastHost = document.getElementById('toastHost');

      els.addFolderBtn = document.getElementById('addFolderBtn');
      els.importBtn = document.getElementById('importBtn');
      els.settingsBtn = document.getElementById('settingsBtn');
      els.syncBtn = document.getElementById('syncBtn');
      els.syncStatus = document.getElementById('syncStatus');
      els.aiImportBtn = document.getElementById('aiImportBtn');
      els.aiHistoryBtn = document.getElementById('aiHistoryBtn');

      els.importModal = document.getElementById('importModal');
      els.importTabFile = document.getElementById('importTabFile');
      els.importTabPaste = document.getElementById('importTabPaste');
      els.importPaneFile = document.getElementById('importPaneFile');
      els.importPanePaste = document.getElementById('importPanePaste');
      els.importFileInput = document.getElementById('importFileInput');
      els.importTextarea = document.getElementById('importTextarea');
      els.cancelImportBtn = document.getElementById('cancelImportBtn');
      els.confirmImportBtn = document.getElementById('confirmImportBtn');
      els.closeImportBtn = document.getElementById('closeImportBtn');

      els.folderModal = document.getElementById('folderModal');
      els.folderNameInput = document.getElementById('folderNameInput');
      els.folderCancelBtn = document.getElementById('folderCancelBtn');
      els.folderCreateBtn = document.getElementById('folderCreateBtn');

      // book modal
      els.bookModal = document.getElementById('bookModal');
      els.bookNameInput = document.getElementById('bookNameInput');
      els.bookThemeChoices = document.getElementById('bookThemeChoices');
      els.bookIconChoices = document.getElementById('bookIconChoices');
      els.bookCancelBtn = document.getElementById('bookCancelBtn');
      els.bookCreateBtn = document.getElementById('bookCreateBtn');

      // auth modal (optional)
      els.authModal = document.getElementById('authModal');
      els.authTabLogin = document.getElementById('authTabLogin');
      els.authTabRegister = document.getElementById('authTabRegister');
      els.authLogoutBtn = document.getElementById('authLogoutBtn');
      els.authUsername = document.getElementById('authUsername');
      els.authPassword = document.getElementById('authPassword');
      els.authHint = document.getElementById('authHint');
      els.syncEnableRow = document.getElementById('syncEnableRow');
      els.enableSyncUploadBtn = document.getElementById('enableSyncUploadBtn');
      els.enableSyncHint = document.getElementById('enableSyncHint');
      els.authCancelBtn = document.getElementById('authCancelBtn');
      els.authSubmitBtn = document.getElementById('authSubmitBtn');

      // sync modal extended UI
      els.syncModalStatus = document.getElementById('syncModalStatus');
      els.syncTabAccount = document.getElementById('syncTabAccount');
      els.syncTabSaves = document.getElementById('syncTabSaves');
      els.syncPaneAccount = document.getElementById('syncPaneAccount');
      els.syncPaneSaves = document.getElementById('syncPaneSaves');
      els.archiveName = document.getElementById('archiveName');
      els.createArchiveBtn = document.getElementById('createArchiveBtn');
      els.refreshSavesBtn = document.getElementById('refreshSavesBtn');
      els.archivesList = document.getElementById('archivesList');
      els.revisionsList = document.getElementById('revisionsList');
      els.savesHint = document.getElementById('savesHint');
      els.savesCloseBtn = document.getElementById('savesCloseBtn');

      // settings modal
      els.settingsModal = document.getElementById('settingsModal');
      els.exportLocalBtn = document.getElementById('exportLocalBtn');
      els.resetUiBtn = document.getElementById('resetUiBtn');
      els.uiAnalysisColor = document.getElementById('uiAnalysisColor');
      els.uiKnowledgeColor = document.getElementById('uiKnowledgeColor');
      els.uiEmphasisColor = document.getElementById('uiEmphasisColor');
      els.uiHighlightPalette = document.getElementById('uiHighlightPalette');
      els.uiHighlightIntensity = document.getElementById('uiHighlightIntensity');
      els.uiHighlightMode = document.getElementById('uiHighlightMode');
      els.resetToDefaultBtn = document.getElementById('resetToDefaultBtn');
      els.settingsCloseBtn = document.getElementById('settingsCloseBtn');
      els.resetHint = document.getElementById('resetHint');

      // AI chat modal
      els.aiChatModal = document.getElementById('aiChatModal');
      els.aiChatTitle = document.getElementById('aiChatTitle');
      els.aiChatModelSelect = document.getElementById('aiChatModelSelect');
      els.aiChatCloseBtn = document.getElementById('aiChatCloseBtn');
      els.aiChatContextWrap = document.getElementById('aiChatContextWrap');
      els.aiChatContextText = document.getElementById('aiChatContextText');
      els.aiChatMessages = document.getElementById('aiChatMessages');
      els.aiChatInput = document.getElementById('aiChatInput');
      els.aiChatSendBtn = document.getElementById('aiChatSendBtn');
      els.aiChatHint = document.getElementById('aiChatHint');

      // AI import modal
      els.aiImportModal = document.getElementById('aiImportModal');
      els.aiImportCloseBtn = document.getElementById('aiImportCloseBtn');
      els.aiImportFilesInput = document.getElementById('aiImportFilesInput');
      els.aiImportFilesList = document.getElementById('aiImportFilesList');
      els.aiImportNoteText = document.getElementById('aiImportNoteText');
      els.aiImportModelSelect = document.getElementById('aiImportModelSelect');
      els.aiImportStartBtn = document.getElementById('aiImportStartBtn');
      els.aiImportProgressFill = document.getElementById('aiImportProgressFill');
      els.aiImportProgressText = document.getElementById('aiImportProgressText');
      els.aiImportQueueText = document.getElementById('aiImportQueueText');
      els.aiImportHint = document.getElementById('aiImportHint');
      els.aiImportResult = document.getElementById('aiImportResult');

      // AI history modal
      els.aiHistoryModal = document.getElementById('aiHistoryModal');
      els.aiHistoryCloseBtn = document.getElementById('aiHistoryCloseBtn');
      els.aiHistoryScopeSelect = document.getElementById('aiHistoryScopeSelect');
      els.aiHistoryNewBtn = document.getElementById('aiHistoryNewBtn');
      els.aiHistoryRefreshBtn = document.getElementById('aiHistoryRefreshBtn');
      els.aiHistoryList = document.getElementById('aiHistoryList');
      els.aiHistoryHint = document.getElementById('aiHistoryHint');
    }
  
    /** ---------------------------
     * 3) 工具
     * --------------------------- */
    function escapeHtml(text) {
      if (text === null || text === undefined) return '';
      return String(text).replace(/[&<>"']/g, function (m) {
        return ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;'
        })[m];
      });
    }

    function hashStr(str) {
      str = String(str || '');
      var h = 5381;
      for (var i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
      return h >>> 0;
    }

    function pickHighlightColor(seed, text) {
      var ui = appData && appData.ui ? normalizeUi(appData.ui) : defaultUi();
      var palette = (ui.highlightPalette && ui.highlightPalette.length) ? ui.highlightPalette : UI_DEFAULTS.highlightPalette;
      if (!palette.length) palette = UI_DEFAULTS.highlightPalette;

      if (ui.highlightMode === 'random') {
        return palette[Math.floor(Math.random() * palette.length)];
      }
      var h = hashStr(String(seed || '') + '|' + String(text || ''));
      return palette[h % palette.length];
    }

    function applyRandomHighlights(rootEl) {
      if (!rootEl || !rootEl.querySelectorAll) return;
      var spans = rootEl.querySelectorAll('span.highlight');
      if (!spans || !spans.length) return;

      var ui = appData && appData.ui ? normalizeUi(appData.ui) : defaultUi();
      var alpha = Number(ui.highlightIntensity);
      if (!Number.isFinite(alpha)) alpha = UI_DEFAULTS.highlightIntensity;

      var seed = (rootEl && rootEl.dataset && rootEl.dataset.hzrSeed) ? rootEl.dataset.hzrSeed : 'seed';

      for (var i = 0; i < spans.length; i++) {
        var el = spans[i];
        if (!el) continue;

        // 如果作者已经指定了颜色，就不改（兼容旧数据）
        if (el.classList && (el.classList.contains('highlight--yellow') ||
            el.classList.contains('highlight--pink') ||
            el.classList.contains('highlight--orange'))) {
          continue;
        }

        var hex = pickHighlightColor(seed, el.textContent || '');
        var bg = rgba(hex, alpha);
        if (!bg) continue;
        el.style.backgroundColor = bg;
        el.dataset.hzrHl = hex;
      }
    }

    function refreshHighlightsInDocument() {
      if (typeof document === 'undefined') return;
      // question cards
      var cards = document.querySelectorAll('.question-card');
      for (var i = 0; i < cards.length; i++) applyRandomHighlights(cards[i]);
      // settings preview (and other modal content)
      if (els.settingsModal) applyRandomHighlights(els.settingsModal);
    }

    function formatInlineEmphasis(html) {
      if (html === null || html === undefined) return '';
      var s = String(html);
      // 支持常见的 Markdown 强调（AI 常写）：**加粗**、__下划线__、*斜体*
      s = s.replace(/\*\*([\s\S]+?)\*\*/g, "<span class='bold-em'>$1</span>");
      s = s.replace(/__([\s\S]+?)__/g, "<span class='underline-em'>$1</span>");
      // 仅匹配单星号，不吞掉 **...**
      s = s.replace(/(^|[^*])\*([^*]+?)\*([^*]|$)/g, "$1<span class='italic-em'>$2</span>$3");
      return s;
    }

    // Markdown + LaTeX (KaTeX) safe renderer (shared by question cards + AI chat)
    var _mdIt = null;
    function getMarkdownIt() {
      if (_mdIt) return _mdIt;
      try {
        if (typeof window !== 'undefined' && typeof window.markdownit === 'function') {
          _mdIt = window.markdownit({
            html: true, // allow legacy highlight spans; sanitized by DOMPurify
            linkify: true,
            breaks: true
          });
        }
      } catch (e) { _mdIt = null; }
      return _mdIt;
    }

    function sanitizeHtmlWithPurify(html) {
      try {
        if (typeof window !== 'undefined' && window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
          return window.DOMPurify.sanitize(String(html || ''), {
            USE_PROFILES: { html: true },
            ADD_ATTR: ['target', 'rel'],
            FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'link', 'meta'],
            FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover'],
          });
        }
      } catch (e) {}
      return String(html || '');
    }

    function renderMathSafe(rootEl) {
      try {
        if (!rootEl) return;
        if (typeof window === 'undefined') return;
        if (typeof window.renderMathInElement !== 'function') return;
        window.renderMathInElement(rootEl, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true },
          ],
          throwOnError: false,
          strict: 'ignore',
        });
      } catch (_) {}
    }

    function renderMarkdownInto(el, mdText, opts) {
      if (!el) return;
      opts = opts || {};
      var raw = (mdText === null || mdText === undefined) ? '' : String(mdText);
      var md = getMarkdownIt();
      var html = md ? (opts.inline ? md.renderInline(raw) : md.render(raw)) : escapeHtml(raw).replace(/\n/g, '<br>');
      html = sanitizeHtmlWithPurify(html);
      el.innerHTML = html;
      // Ensure links are safe
      try {
        var links = el.querySelectorAll ? el.querySelectorAll('a') : null;
        if (links && links.length) {
          for (var i = 0; i < links.length; i++) {
            var a = links[i];
            if (!a) continue;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
          }
        }
      } catch (_) {}
      renderMathSafe(el);
    }
  
    function uid(prefix) {
      prefix = prefix || 'id';
      return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }
  
    function isObject(x) {
      return x && typeof x === 'object' && !Array.isArray(x);
    }

    function normalizeHex(hex) {
      if (typeof hex !== 'string') return null;
      var s = hex.trim();
      if (!s) return null;
      if (s[0] !== '#') s = '#' + s;
      if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null;
      return s.toUpperCase();
    }

    function hexToRgb(hex) {
      var h = normalizeHex(hex);
      if (!h) return null;
      return {
        r: parseInt(h.slice(1, 3), 16),
        g: parseInt(h.slice(3, 5), 16),
        b: parseInt(h.slice(5, 7), 16)
      };
    }

    function rgba(hex, alpha) {
      var c = hexToRgb(hex);
      if (!c) return null;
      var a = Math.max(0, Math.min(1, Number(alpha)));
      return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
    }

    function mixRgb(a, b, t) {
      t = Math.max(0, Math.min(1, t));
      return {
        r: Math.round(a.r + (b.r - a.r) * t),
        g: Math.round(a.g + (b.g - a.g) * t),
        b: Math.round(a.b + (b.b - a.b) * t)
      };
    }

    function rgbToHex(c) {
      var to = function (n) { var s = n.toString(16); return s.length === 1 ? '0' + s : s; };
      return '#' + to(c.r) + to(c.g) + to(c.b);
    }

    function darken(hex, t) {
      var c = hexToRgb(hex);
      if (!c) return hex;
      return rgbToHex(mixRgb(c, { r: 0, g: 0, b: 0 }, Math.max(0, Math.min(1, t)))).toUpperCase();
    }

    function applyUiToDocument() {
      var ui = appData && appData.ui ? normalizeUi(appData.ui) : defaultUi();
      if (!appData.ui) appData.ui = ui;

      var root = document.documentElement;
      root.style.setProperty('--emphasis-color', ui.emphasisColor);

      root.style.setProperty('--analysis-color', ui.analysisColor);
      root.style.setProperty('--analysis-bg-1', rgba(ui.analysisColor, 0.10) || 'rgba(75,143,226,0.10)');
      root.style.setProperty('--analysis-bg-2', rgba(ui.analysisColor, 0.04) || 'rgba(75,143,226,0.04)');
      root.style.setProperty('--analysis-border', rgba(ui.analysisColor, 0.18) || 'rgba(75,143,226,0.18)');
      root.style.setProperty('--analysis-bar', rgba(ui.analysisColor, 0.70) || 'rgba(75,143,226,0.70)');
      root.style.setProperty('--analysis-title', darken(ui.analysisColor, 0.18));

      root.style.setProperty('--knowledge-color', ui.knowledgeColor);
      root.style.setProperty('--knowledge-bg-1', rgba(ui.knowledgeColor, 0.10) || 'rgba(12,84,96,0.10)');
      root.style.setProperty('--knowledge-bg-2', rgba(ui.knowledgeColor, 0.04) || 'rgba(12,84,96,0.04)');
      root.style.setProperty('--knowledge-border', rgba(ui.knowledgeColor, 0.18) || 'rgba(12,84,96,0.18)');
      root.style.setProperty('--knowledge-title', darken(ui.knowledgeColor, 0.10));

      refreshHighlightsInDocument();
    }
  
    function pointInRect(x, y, rect) {
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }
  
    function getScrollY() {
      return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }

    function formatLocalTime(iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function formatDateTag(iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
    }

    function shortId(id) {
      try {
        var s = String(id || '').trim();
        if (!s) return '';
        s = s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (s.length <= 5) return s;
        return s.slice(-5);
      } catch (e) {
        return '';
      }
    }

    function detectPlatformLabel() {
      var ua = '';
      try { ua = String(navigator.userAgent || ''); } catch (e) { ua = ''; }
      var lower = ua.toLowerCase();

      if (lower.indexOf('iphone') !== -1) return 'iPhone';
      if (lower.indexOf('ipad') !== -1) return 'iPad';
      if (lower.indexOf('android') !== -1) {
        // Very rough: Android tablet tends to lack 'mobile'
        return (lower.indexOf('mobile') !== -1) ? 'Android手机' : 'Android平板';
      }
      if (lower.indexOf('windows') !== -1) return 'Windows';
      if (lower.indexOf('macintosh') !== -1 || lower.indexOf('mac os') !== -1) return 'macOS';
      if (lower.indexOf('linux') !== -1) return 'Linux';
      return '未知设备';
    }

    function detectBrowserLabel() {
      var ua = '';
      try { ua = String(navigator.userAgent || ''); } catch (e) { ua = ''; }
      var lower = ua.toLowerCase();
      if (lower.indexOf('edg/') !== -1) return 'Edge';
      if (lower.indexOf('chrome/') !== -1 && lower.indexOf('chromium') === -1) return 'Chrome';
      if (lower.indexOf('safari/') !== -1 && lower.indexOf('chrome/') === -1) return 'Safari';
      if (lower.indexOf('firefox/') !== -1) return 'Firefox';
      return 'Browser';
    }

    function getOrCreateDeviceId() {
      var KEY = 'hzr_device_id_v1';
      try {
        var existing = localStorage.getItem(KEY);
        if (existing && String(existing).trim()) return String(existing).trim();
      } catch (e) {}

      var id = 'd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(KEY, id); } catch (e2) {}
      return id;
    }

    function getDeviceLabel() {
      var name = '';
      try { name = String(localStorage.getItem('hzr_device_name_v1') || '').trim(); } catch (e) { name = ''; }
      var base = detectPlatformLabel() + ' · ' + detectBrowserLabel();
      var sid = shortId(getOrCreateDeviceId());
      var suffix = sid ? ('#' + sid) : '';
      if (name) return name + '（' + base + (suffix ? (' ' + suffix) : '') + '）';
      return base + (suffix ? (' ' + suffix) : '');
    }

    function deviceLabelFromArchive(a) {
      if (!a) return '';
      if (a.deviceLabel && String(a.deviceLabel).trim()) return String(a.deviceLabel).trim();
      return '';
    }

    function escapeAttr(s) {
      return escapeHtml(s).replace(/"/g, '&quot;');
    }

    function bookCoverColors(id) {
      var palette = [
        ['#BFD9FF', '#D8C7FF'], // blue -> lilac
        ['#BFEBDD', '#BFD9FF'], // mint -> blue
        ['#F7B4C9', '#FFD0A6'], // pink -> peach
        ['#FFE08A', '#FFD0A6'], // lemon -> peach
        ['#D8C7FF', '#F7B4C9'], // lilac -> pink
        ['#BFEAF2', '#BFEBDD'], // cyan -> mint
        ['#F2E6D8', '#BFD9FF']  // cream -> blue
      ];
      var h = hashStr(String(id || ''));
      return palette[h % palette.length];
    }

    function downloadJson(filename, obj) {
      try {
        var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        alert('导出失败');
      }
    }

    var toastState = { timer: 0, el: null, action: null, removeTimer: 0 };
    function showToast(message, opts) {
      opts = opts || {};
      if (!els.toastHost) return;

      if (toastState.timer) { window.clearTimeout(toastState.timer); toastState.timer = 0; }
      if (toastState.removeTimer) { window.clearTimeout(toastState.removeTimer); toastState.removeTimer = 0; }
      if (toastState.el && toastState.el.remove) toastState.el.remove();
      toastState.el = null;
      toastState.action = null;

      var el = document.createElement('div');
      el.className = 'toast';
      el.innerHTML = '<div class="toast-msg"></div>';
      el.querySelector('.toast-msg').textContent = String(message || '');

      if (opts.actionText && typeof opts.onAction === 'function') {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast-btn';
        btn.textContent = opts.actionText;
        btn.onclick = function () {
          try { opts.onAction(); } catch (e) {}
          hideToast(true);
        };
        el.appendChild(btn);
      }

      els.toastHost.appendChild(el);
      toastState.el = el;

      var ms = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 5000;
      toastState.timer = window.setTimeout(function () {
        hideToast(false);
      }, ms);
    }

    function hideToast(immediate) {
      immediate = !!immediate;
      if (toastState.timer) { window.clearTimeout(toastState.timer); toastState.timer = 0; }
      if (toastState.removeTimer) { window.clearTimeout(toastState.removeTimer); toastState.removeTimer = 0; }

      var el = toastState.el;
      if (!el) return;

      if (immediate) {
        if (el.remove) el.remove();
        toastState.el = null;
        toastState.action = null;
        return;
      }

      try { el.classList.add('closing'); } catch (_) {}
      toastState.removeTimer = window.setTimeout(function () {
        if (el.remove) el.remove();
        toastState.removeTimer = 0;
        toastState.el = null;
        toastState.action = null;
      }, 180);
      toastState.el = null;
      toastState.action = null;
    }

    function summarizeLibrary(data) {
      if (!data || typeof data !== 'object') return { books: 0, folders: 0, chapters: 0, deleted: 0 };
      // New app format
      if (Array.isArray(data.books)) {
        var books = data.books;
        var totalFolders = 0;
        var totalChapters = 0;
        var totalDeleted = 0;
        for (var i = 0; i < books.length; i++) {
          var b = books[i] || {};
          totalFolders += Array.isArray(b.folders) ? b.folders.length : 0;
          totalChapters += Array.isArray(b.chapters) ? b.chapters.length : 0;
          totalDeleted += Array.isArray(b.deletedChapterIds) ? b.deletedChapterIds.length : 0;
        }
        return { books: books.length, folders: totalFolders, chapters: totalChapters, deleted: totalDeleted };
      }
      // Legacy
      return {
        books: 1,
        folders: Array.isArray(data.folders) ? data.folders.length : 0,
        chapters: Array.isArray(data.chapters) ? data.chapters.length : 0,
        deleted: Array.isArray(data.deletedChapterIds) ? data.deletedChapterIds.length : 0
      };
    }

    function appHasAnyContent(data) {
      if (!data || typeof data !== 'object') return false;
      if (Array.isArray(data.books)) {
        for (var i = 0; i < data.books.length; i++) {
          var b = data.books[i] || {};
          if ((Array.isArray(b.chapters) && b.chapters.length) || (Array.isArray(b.folders) && b.folders.length)) return true;
        }
        return false;
      }
      return (Array.isArray(data.chapters) && data.chapters.length) || (Array.isArray(data.folders) && data.folders.length);
    }

    function hash32(str) {
      try {
        var s = String(str || '');
        var h = 2166136261;
        for (var i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0; // FNV-1a
        }
        return h >>> 0;
      } catch (e) {
        return 0;
      }
    }

    function librarySignature(data) {
      // 用于“是否需要备份”判断：忽略纯 UI 状态（folder.isOpen）+ 忽略全局 UI 配色
      try {
        if (!data || typeof data !== 'object') return '';
        // New app format
        if (Array.isArray(data.books)) {
          var sigApp = {
            books: data.books.map(function (b) {
              b = b || {};
              var deleted = Array.isArray(b.deletedChapterIds) ? b.deletedChapterIds.slice() : [];
              deleted.sort();
              return {
                id: b.id,
                title: b.title,
                includePresets: !!b.includePresets,
                folders: Array.isArray(b.folders) ? b.folders.map(function (f) { return { id: f && f.id, title: f && f.title }; }) : [],
                chapters: Array.isArray(b.chapters) ? b.chapters : [],
                layoutMap: (b.layoutMap && typeof b.layoutMap === 'object') ? b.layoutMap : {},
                deletedChapterIds: deleted
              };
            }),
            currentBookId: data.currentBookId || null
          };
          return JSON.stringify(sigApp);
        }
        // Legacy
        var sig = {
          folders: Array.isArray(data.folders) ? data.folders.map(function (f) { return { id: f && f.id, title: f && f.title }; }) : [],
          chapters: Array.isArray(data.chapters) ? data.chapters : [],
          layoutMap: data.layoutMap && typeof data.layoutMap === 'object' ? data.layoutMap : {},
          deletedChapterIds: Array.isArray(data.deletedChapterIds) ? data.deletedChapterIds.slice() : []
        };
        sig.deletedChapterIds.sort();
        return JSON.stringify(sig);
      } catch (e) {
        return '';
      }
    }
  
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

    /** ---------------------------
     * 4.1) 云端同步（注册/登录 + per-user 数据）
     * --------------------------- */
    var cloud = {
      token: null,
      version: 0,
      savingTimer: 0,
      isSaving: false,
      authMode: 'login', // login | register
      bootstrapDone: false,
      syncEnabled: false,
      remoteEmpty: null,
      bootstrapPromise: null,
      bootstrapFailed: false
    };

    function getToken() {
      if (cloud.token) return cloud.token;
      try { cloud.token = localStorage.getItem(AUTH_TOKEN_KEY) || null; } catch (e) { cloud.token = null; }
      return cloud.token;
    }
    function setToken(token) {
      cloud.token = token || null;
      cloud.version = 0;
      cloud.bootstrapDone = false;
      cloud.syncEnabled = false;
      cloud.remoteEmpty = null;
      cloud.bootstrapFailed = false;
      cloud.bootstrapPromise = null;
      try {
        if (cloud.token) localStorage.setItem(AUTH_TOKEN_KEY, cloud.token);
        else localStorage.removeItem(AUTH_TOKEN_KEY);
      } catch (e) {}
      updateSyncStatus();
    }

    function updateSyncStatus(text) {
      if (!els.syncStatus) return;

      var dot = 'status-dot--off';
      var label = '';

      if (text) {
        label = String(text);
        if (label.indexOf('失败') !== -1) dot = 'status-dot--err';
        else if (label.indexOf('冲突') !== -1) dot = 'status-dot--warn';
        else if (label.indexOf('同步中') !== -1) dot = 'status-dot--warn';
        else dot = getToken() ? 'status-dot--ok' : 'status-dot--off';
      } else {
        var t = getToken();
        if (!t) {
          dot = 'status-dot--off';
          label = '未登录 · 仅本地';
        } else if (cloud.bootstrapFailed) {
          dot = 'status-dot--err';
          label = '已登录 · 同步失败（未启用）';
        } else if (!cloud.bootstrapDone) {
          dot = 'status-dot--warn';
          label = '已登录 · 同步初始化中…';
        } else if (!cloud.syncEnabled) {
          dot = 'status-dot--warn';
          label = '已登录 · 未启用自动同步';
        } else {
          dot = 'status-dot--ok';
          label = '已登录 · 自动同步';
        }
      }

      els.syncStatus.innerHTML = '<span class="status-dot ' + dot + '"></span>' + escapeHtml(label);
      if (els.syncModalStatus) els.syncModalStatus.textContent = getToken() ? '已登录 · 自动同步' : '未登录 · 仅本地';
    }

    function apiFetch(path, options) {
      options = options || {};
      var headers = options.headers || {};
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      var t = getToken();
      if (t) headers['Authorization'] = 'Bearer ' + t;
      headers['X-Device-Id'] = headers['X-Device-Id'] || getOrCreateDeviceId();
      // Header values must be ASCII-safe in fetch; encode label to avoid "Invalid character in header field".
      try {
        headers['X-Device-Label'] = headers['X-Device-Label'] || encodeURIComponent(getDeviceLabel());
      } catch (_) {
        headers['X-Device-Label'] = headers['X-Device-Label'] || '';
      }
      options.headers = headers;
      return fetch(API_BASE + path, options).then(function (res) {
        if (res.status === 401) {
          setToken(null);
          updateSyncStatus('登录失效');
        }
        return res;
      });
    }

    function cloudLoadLibrary() {
      return apiFetch('/api/library', { method: 'GET' }).then(function (res) {
        if (!res.ok) throw new Error('load failed');
        return res.json();
      });
    }

    function cloudSaveLibrary(expectedVersion, force) {
      var headers = {};
      if (typeof expectedVersion === 'number' && !force) headers['If-Match'] = String(expectedVersion);
      if (force) headers['X-Force'] = '1';
      return apiFetch('/api/library' + (force ? '?force=1' : ''), {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify({ data: appData })
      }).then(function (res) {
        if (res.status === 409) return res.json().then(function (j) { var e = new Error('conflict'); e.conflict = j; throw e; });
        if (!res.ok) throw new Error('save failed');
        return res.json();
      });
    }

    function cloudListRevisions() {
      return apiFetch('/api/revisions?limit=3', { method: 'GET' }).then(function (res) {
        if (!res.ok) throw new Error('revisions failed');
        return res.json();
      });
    }

    function cloudRestoreRevision(version) {
      return apiFetch('/api/revisions/' + encodeURIComponent(String(version)) + '/restore', { method: 'POST', body: '{}' })
        .then(function (res) {
          if (!res.ok) throw new Error('restore failed');
          return res.json();
        });
    }

    function cloudListArchives() {
      return apiFetch('/api/archives?limit=50', { method: 'GET' }).then(function (res) {
        if (!res.ok) throw new Error('archives failed');
        return res.json();
      });
    }

    function cloudCreateArchive(name, data) {
      var body = {};
      if (name) body.name = name;
      if (data && typeof data === 'object') body.data = data;
      return apiFetch('/api/archives', { method: 'POST', body: JSON.stringify(body) }).then(function (res) {
        if (!res.ok) throw new Error('archive failed');
        return res.json();
      });
    }

    function cloudDeleteArchive(id) {
      return apiFetch('/api/archives/' + encodeURIComponent(String(id)), { method: 'DELETE' }).then(function (res) {
        if (!res.ok) throw new Error('delete failed');
        return res.json();
      });
    }

    function cloudRestoreArchive(id) {
      return apiFetch('/api/archives/' + encodeURIComponent(String(id)) + '/restore', { method: 'POST', body: '{}' }).then(function (res) {
        if (!res.ok) throw new Error('restore failed');
        return res.json();
      });
    }

    function cloudRenameArchive(id, name) {
      return apiFetch('/api/archives/' + encodeURIComponent(String(id)), { method: 'PATCH', body: JSON.stringify({ name: name }) }).then(function (res) {
        if (res.ok) return res.json();
        // Some proxies block PATCH; retry with POST.
        if (res.status === 404 || res.status === 405) {
          return apiFetch('/api/archives/' + encodeURIComponent(String(id)) + '/rename', { method: 'POST', body: JSON.stringify({ name: name }) }).then(function (res2) {
            if (!res2.ok) throw new Error('rename failed');
            return res2.json();
          });
        }
        throw new Error('rename failed');
      });
    }

    function scheduleCloudSave() {
      if (!getToken()) return;
      if (!cloud.bootstrapDone) return;
      if (!cloud.syncEnabled) return;
      if (cloud.savingTimer) window.clearTimeout(cloud.savingTimer);
      cloud.savingTimer = window.setTimeout(function () {
        cloud.savingTimer = 0;
        doCloudSave();
      }, 1200);
    }

    function doCloudSave() {
      if (!getToken()) return;
      if (!cloud.bootstrapDone) return;
      if (!cloud.syncEnabled) return;
      if (cloud.isSaving) return;
      cloud.isSaving = true;
      updateSyncStatus('同步中…');

      cloudSaveLibrary(cloud.version, false).then(function (r) {
        cloud.version = r.version || cloud.version;
        cloud.isSaving = false;
        updateSyncStatus();
      }).catch(function (err) {
        cloud.isSaving = false;
        if (err && err.message === 'conflict') {
          updateSyncStatus('同步冲突 · 已自动处理');
          // 无弹窗：默认以本机为准覆盖云端，同时服务端会自动把旧云端做成“冲突自动备份”存档
          cloudSaveLibrary(null, true).then(function (r2) {
            cloud.version = r2.version || cloud.version;
            updateSyncStatus();
            showToast('检测到多设备冲突：已自动同步当前设备，旧云端已备份到“存档”。', { timeoutMs: 5200 });
          }).catch(function () {
            updateSyncStatus('同步失败');
            showToast('同步失败：请检查网络/反代配置', { timeoutMs: 5200 });
          });
          return;
        }
        updateSyncStatus('同步失败');
        showToast('同步失败：请检查网络/反代配置', { timeoutMs: 5200 });
      });
    }

    function tryBootstrapFromCloud() {
      if (!getToken()) { updateSyncStatus(); return Promise.resolve(false); }
      if (cloud.bootstrapPromise) return cloud.bootstrapPromise;
      cloud.bootstrapDone = false;
      cloud.bootstrapFailed = false;
      updateSyncStatus('同步中…');

      cloud.bootstrapPromise = cloudLoadLibrary().then(function (j) {
        cloud.version = (j && typeof j.version === 'number') ? j.version : 0;
        var remote = j && j.data ? j.data : null;

        var localHas = appHasAnyContent(appData);
        var remoteHas = appHasAnyContent(remote);

        if (!remote || !remoteHas) {
          // 云端无数据（或为空库）：绝不自动推送本机，也不自动用“空云端”覆盖本机。
          // 用户可在“云同步 -> 账号”里手动点“上传本机到云端（启用同步）”。
          cloud.remoteEmpty = true;
          cloud.syncEnabled = false;
          cloud.bootstrapDone = true;
          updateSyncStatus();
          if (localHas) showToast('云端暂无数据：已保留本机。若要跨设备同步，请在“云同步-账号”里手动启用。', { timeoutMs: 5600 });
          return false;
        }
        cloud.remoteEmpty = false;
        cloud.syncEnabled = true;

        // 云端有数据：默认以云端为准（更安全）
        // 只有“本机与云端内容不同(忽略UI状态)”时才自动备份本机一次，避免每次登录/刷新都刷存档
        if (localHas && remoteHas) {
          var localSig = librarySignature(appData);
          var remoteSig = librarySignature(remote);
          if (localSig && remoteSig && localSig !== remoteSig) {
            try {
              localStorage.setItem('hzr_local_backup_before_cloud_v1', JSON.stringify({ savedAt: new Date().toISOString(), data: appData }));
            } catch (_) {}

            var BOOT_KEY = 'hzr_bootstrap_backup_v3';
            var marker = String(cloud.version) + ':' + String(hash32(localSig)) + ':' + String(hash32(remoteSig));
            var last = null;
            try { last = localStorage.getItem(BOOT_KEY); } catch (_) { last = null; }

            if (last !== marker) {
              try { localStorage.setItem(BOOT_KEY, marker); } catch (_) {}
              var ls = summarizeLibrary(appData);
              var rs = summarizeLibrary(remote);
              var name = '自动备份(登录覆盖前) ' + new Date().toISOString();
              cloudCreateArchive(name, appData).then(function () {
                showToast('检测到本机与云端不同：本机' + ls.chapters + '章/' + ls.folders + '夹，云端' + rs.chapters + '章/' + rs.folders + '夹。本机已备份到“存档”。', { timeoutMs: 5200 });
              }).catch(function () {});
            }
          }
        }

        var keepUi = appData && appData.ui ? normalizeUi(appData.ui) : defaultUi();
        normalizeAppData(remote, keepUi);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); } catch (e) {}
        cloud.bootstrapDone = true;
        updateSyncStatus();
        return true;
      }).catch(function () {
        cloud.bootstrapFailed = true;
        cloud.syncEnabled = false;
        updateSyncStatus('同步失败');
        cloud.bootstrapDone = false;
        return false;
      }).finally(function () {
        cloud.bootstrapPromise = null;
      });
      return cloud.bootstrapPromise;
    }
  
    /** ---------------------------
     * 5) 章节接口（兼容旧 addChapter）
     * --------------------------- */
    window.addChapter = function (title, questions) {
      var id = pushStaticChapter(title, questions);
      if (initialized) renderSidebar();
      return id;
    };

    window.getStaticChapterIds = function () {
      var ids = [];
      for (var i = 0; i < staticData.length; i++) ids.push(staticData[i].id);
      return ids;
    };

    // 将指定章节（可含 static_*）放入某个文件夹（不存在则创建）
    window.addChaptersToFolder = function (folderTitle, chapterIds) {
      ensureDataLoaded();
      var book = getActiveBook();
      if (!folderTitle) folderTitle = '预设题库';

      if (!Array.isArray(chapterIds)) chapterIds = [];

      var changed = false;

      // find or create folder by title
      if (!Array.isArray(book.folders)) book.folders = [];
      var folderId = null;
      for (var i = 0; i < book.folders.length; i++) {
        if (book.folders[i] && book.folders[i].title === folderTitle) {
          folderId = book.folders[i].id;
          break;
        }
      }
      if (!folderId) {
        folderId = uid('f');
        book.folders.push({ id: folderId, title: folderTitle, isOpen: true });
        changed = true;
      }

      if (!isObject(book.layoutMap)) book.layoutMap = {};
      for (var j = 0; j < chapterIds.length; j++) {
        var cid = chapterIds[j];
        if (typeof cid !== 'string' || !cid) continue;
        if (!book.layoutMap[cid]) {
          book.layoutMap[cid] = folderId;
          changed = true;
        }
      }

      if (changed) saveData();
      if (initialized && changed) renderSidebar();
      return folderId;
    };
  
    /** ---------------------------
     * 6) 获取 / 查找章节
     * --------------------------- */
    function isDeleted(id) {
      var book = getActiveBook();
      var del = book.deletedChapterIds || [];
      for (var i = 0; i < del.length; i++) {
        if (del[i] === id) return true;
      }
      return false;
    }
  
    function getAllChapters() {
      var book = getActiveBook();
      var locals = book.chapters || [];
      var all = (book.includePresets ? staticData.concat(locals) : locals.slice());
      var out = [];
      for (var i = 0; i < all.length; i++) {
        if (!isDeleted(all[i].id)) out.push(all[i]);
      }
      return out;
    }
  
    function findChapterById(id) {
      var book = getActiveBook();
      if (book.includePresets) {
        for (var i = 0; i < staticData.length; i++) if (staticData[i].id === id) return staticData[i];
      }
      var chs = book.chapters || [];
      for (var j = 0; j < chs.length; j++) if (chs[j].id === id) return chs[j];
      return null;
    }
  
    /** ---------------------------
     * 7) 渲染侧边栏
     * --------------------------- */
    function renderSidebar() {
      if (!els.sidebarList) return;
      els.sidebarList.innerHTML = '';
  
      var book = getActiveBook();
      var allChapters = getAllChapters();
  
      var folderContents = {};
      var rootChapters = [];
  
      var folders = book.folders || [];
      for (var i = 0; i < folders.length; i++) folderContents[folders[i].id] = [];
  
      for (var k = 0; k < allChapters.length; k++) {
        var ch = allChapters[k];
        var fid = book.layoutMap ? book.layoutMap[ch.id] : null;
        if (fid && folderContents[fid]) folderContents[fid].push(ch);
        else rootChapters.push(ch);
      }
  
      // folders first
      for (var f = 0; f < folders.length; f++) {
        var folderEl = createFolderElement(folders[f]);
        var contentEl = folderEl.querySelector('.folder-content');
  
        var list = folderContents[folders[f].id] || [];
        for (var c = 0; c < list.length; c++) {
          contentEl.appendChild(createChapterElement(list[c]));
        }
        els.sidebarList.appendChild(folderEl);
      }
  
      // root chapters
      for (var r = 0; r < rootChapters.length; r++) {
        els.sidebarList.appendChild(createChapterElement(rootChapters[r]));
      }
    }

    function showHomeView() {
      homeVisible = true;
      currentChapterId = null;
      if (els.homeView) els.homeView.style.display = '';
      if (els.questionsContainer) els.questionsContainer.style.display = 'none';
      if (els.chapterTitle) els.chapterTitle.innerText = '主页';
      try { document.body.classList.add('home-mode'); } catch (_) {}
      try { document.body.classList.remove('home-transitioning'); } catch (_) {}
      setWhiteOverlayVisible(false);
      renderHome();
      renderSidebar(); // keep sidebar in sync (shows active book’s chapters when entering a book)
    }

    function hideHomeView() {
      homeVisible = false;
      if (els.homeView) els.homeView.style.display = 'none';
      if (els.questionsContainer) els.questionsContainer.style.display = '';
      try { document.body.classList.remove('home-mode'); } catch (_) {}
      try { document.body.classList.remove('home-transitioning'); } catch (_) {}
      setWhiteOverlayVisible(false);
    }

    var whiteOverlayEl = null;
    function ensureWhiteOverlay() {
      try {
        if (whiteOverlayEl) return whiteOverlayEl;
        var host = els.homeView || document.body;
        if (!host) host = document.body;
        var el = document.getElementById('whiteOverlay');
        if (!el) {
          el = document.createElement('div');
          el.id = 'whiteOverlay';
          el.className = 'white-overlay';
          host.appendChild(el);
        } else if (host && el.parentElement !== host) {
          host.appendChild(el);
        }
        whiteOverlayEl = el;
        return el;
      } catch (e) { return null; }
    }

    function setWhiteOverlayVisible(on) {
      var el = ensureWhiteOverlay();
      if (!el || !el.classList) return;
      el.classList.toggle('visible', !!on);
    }

    function renderHome() {
      if (!els.booksGrid) return;
      var books = getBooks();
      els.booksGrid.innerHTML = '';
      if (!books.length) {
        els.booksGrid.innerHTML =
          '<div class="home-empty">' +
            '<div class="home-empty-title">还没有书</div>' +
            '<div class="home-empty-desc">点击上方“新建书”或“导入书”，开始整理你的题库。</div>' +
          '</div>';
        return;
      }

      for (var i = 0; i < books.length; i++) {
        (function (b) {
          if (!b) return;
          b = normalizeBook(b);
          var el = document.createElement('div');
          el.className = 'book-container idle ' + bookThemeClass(b);
          el.dataset.bookId = b.id;

          var counts = {
            chapters: Array.isArray(b.chapters) ? b.chapters.length : 0,
            folders: Array.isArray(b.folders) ? b.folders.length : 0
          };

          var introTitle = b.title + '导论';
          var introText = '共 ' + counts.chapters + ' 章 · ' + counts.folders + ' 夹';
          if (b.includePresets) introText += ' · 含预设';

          el.innerHTML =
            '<div class="back-cover"></div>' +
            '<div class="spine"><span class="spine-text"></span></div>' +
            '<div class="text-block">' +
              '<div class="pages-top"></div><div class="pages-right"></div><div class="pages-bottom"></div>' +
              '<div class="first-page">' +
                '<div class="chapter-label">CHAPTER 01</div>' +
                '<h1></h1>' +
                '<p></p>' +
              '</div>' +
            '</div>' +
            '<div class="front-cover">' +
              '<div class="cover-face">' +
                '<h2 class="cover-title"></h2>' +
                '<div class="cover-icon"></div>' +
              '</div>' +
              '<div class="cover-inside"></div>' +
            '</div>' +
            '<button class="book-more" type="button" aria-label="更多">' +
              '<span class="book-more-visual"><i class="fa-solid fa-ellipsis"></i></span>' +
            '</button>' +
            '<div class="book-tooltip"><div class="book-tooltip-row"></div></div>';

          var spineText = el.querySelector('.spine-text');
          if (spineText) spineText.textContent = b.title;
          var coverTitle = el.querySelector('.cover-title');
          if (coverTitle) coverTitle.textContent = b.title;
          var coverIcon = el.querySelector('.cover-icon');
          if (coverIcon) coverIcon.textContent = b.icon || '✚';
          var pageH1 = el.querySelector('.first-page h1');
          if (pageH1) pageH1.textContent = introTitle;
          var pageP = el.querySelector('.first-page p');
          if (pageP) pageP.textContent = introText;

          var tipRow = el.querySelector('.book-tooltip-row');
          if (tipRow) {
            var tags = [];
            tags.push({ text: counts.chapters + ' 章', kind: 'muted' });
            tags.push({ text: counts.folders + ' 夹', kind: 'muted' });
            if (b.includePresets) tags.push({ text: '含预设', kind: 'device' });
            tags.push({ text: '更新：' + (formatDateTag(b.updatedAt) || '—'), kind: 'date' });
            tipRow.innerHTML = tags.map(function (t) { return '<span class="tag tag--' + escapeAttr(t.kind) + '">' + escapeHtml(t.text) + '</span>'; }).join('');
          }

          var moreBtn = el.querySelector('.book-more');
          if (moreBtn) {
            moreBtn.onclick = function (ev) {
              ev.stopPropagation();
              openBookMenu(b, moreBtn, ev ? { x: ev.clientX, y: ev.clientY } : null);
            };
          }

          installBookLongPress(b, el, moreBtn);
          installBookMoreHitZone(b, el, moreBtn);

          el.onclick = function () {
            if (Date.now() < (el.__ignoreClickUntil || 0)) return;
            openBookWithAnimation(b, el);
          };

          els.booksGrid.appendChild(el);
        })(books[i]);
      }
    }

    function installBookLongPress(book, containerEl, moreBtn) {
      try {
        if (!containerEl) return;
        var startX = 0;
        var startY = 0;
        var timer = null;
        var fired = false;

        function clear() {
          if (timer) clearTimeout(timer);
          timer = null;
        }

        containerEl.addEventListener('pointerdown', function (e) {
          if (!e || e.button !== 0) return;
          if (moreBtn && (e.target === moreBtn || (e.target && e.target.closest && e.target.closest('.book-more')))) return;
          if (e.pointerType === 'mouse') return;
          startX = e.clientX;
          startY = e.clientY;
          fired = false;
          clear();
          timer = setTimeout(function () {
            fired = true;
            // Mobile UX: long-press directly opens rename (no extra menu step)
            try { containerEl.__ignoreClickUntil = Date.now() + 650; } catch (_) {}
            openRenameBookModal(book);
          }, 520);
        }, { passive: true });

        containerEl.addEventListener('pointermove', function (e) {
          if (!timer || !e) return;
          if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) clear();
        }, { passive: true });

        containerEl.addEventListener('pointerup', function () { clear(); }, { passive: true });
        containerEl.addEventListener('pointercancel', function () { clear(); }, { passive: true });

        containerEl.addEventListener('click', function (e) {
          if (!fired) return;
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
        }, true);

        // Desktop: right-click opens the edit menu (matches "long-press to edit")
        containerEl.addEventListener('contextmenu', function (e) {
          if (!e) return;
          try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
          try { containerEl.__ignoreClickUntil = Date.now() + 650; } catch (_) {}
          openBookMenu(book, moreBtn || containerEl, { x: e.clientX, y: e.clientY });
        }, true);
      } catch (e) {}
    }

    function installBookMoreHitZone(book, containerEl, moreBtn) {
      try {
        if (!containerEl) return;
        containerEl.addEventListener('pointerup', function (e) {
          if (!e) return;
          if (e.button !== 0) return;
          if (e.pointerType === 'mouse') return; // desktop: precise enough
          if (e.target && e.target.closest && e.target.closest('.book-more')) return;

          var rect = containerEl.getBoundingClientRect();
          var x = e.clientX - rect.left;
          var y = e.clientY - rect.top;
          var zone = Math.min(78, Math.max(56, Math.min(rect.width, rect.height) * 0.28));
          if (x >= rect.width - zone && y >= rect.height - zone) {
            try { containerEl.__ignoreClickUntil = Date.now() + 650; } catch (_) {}
            openBookMenu(book, moreBtn || containerEl, { x: e.clientX, y: e.clientY });
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
          }
        }, true);
      } catch (e) {}
    }

    var bookMenuEl = null;
    function closeBookMenu() {
      if (bookMenuEl && bookMenuEl.remove) bookMenuEl.remove();
      bookMenuEl = null;
    }

    function removeBookById(bookId) {
      if (!bookId) return null;
      var books = getBooks();
      if (!books || books.length <= 1) return null;

      var idx = -1;
      for (var i = 0; i < books.length; i++) {
        if (books[i] && books[i].id === bookId) { idx = i; break; }
      }
      if (idx < 0) return null;

      var removed = books.splice(idx, 1)[0];
      if (appData && appData.currentBookId === bookId) {
        var next = books[Math.min(idx, books.length - 1)];
        appData.currentBookId = next ? next.id : null;
        currentChapterId = null;
      }
      return { index: idx, book: removed };
    }

    function openBookMenu(book, anchorEl, atPoint) {
      closeBookMenu();
      if (!book || !anchorEl) return;

      var menu = document.createElement('div');
      menu.className = 'book-menu';
      menu.innerHTML =
        '<button type="button" data-act="rename">自定义</button>' +
        '<button type="button" data-act="open">打开</button>' +
        '<button type="button" data-act="delete">删除</button>';

      document.body.appendChild(menu);
      bookMenuEl = menu;

      var rect = anchorEl.getBoundingClientRect();
      var ax = rect.right;
      var ayTop = rect.top;
      var ayBottom = rect.bottom;
      if (atPoint && typeof atPoint.x === 'number' && typeof atPoint.y === 'number') {
        ax = atPoint.x;
        ayTop = atPoint.y;
        ayBottom = atPoint.y;
      }

      var left = Math.min(window.innerWidth - menu.offsetWidth - 12, Math.max(12, ax - menu.offsetWidth));
      var preferDown = ayBottom + 8 + menu.offsetHeight <= window.innerHeight - 12;
      var top = preferDown ? (ayBottom + 8) : (ayTop - menu.offsetHeight - 8);
      top = Math.min(window.innerHeight - menu.offsetHeight - 12, Math.max(12, top));
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';

      var onDoc = function (e) {
        if (!bookMenuEl) return;
        if (e && (bookMenuEl === e.target || (e.target && e.target.closest && e.target.closest('.book-menu')))) return;
        closeBookMenu();
        document.removeEventListener('click', onDoc, true);
      };
      document.addEventListener('click', onDoc, true);

      menu.onclick = function (e) {
        var btn = e && e.target && e.target.closest ? e.target.closest('button') : null;
        if (!btn) return;
        var act = btn.getAttribute('data-act');
        closeBookMenu();
        if (act === 'open') {
          openBookWithAnimation(book, anchorEl.closest('.book-container') || anchorEl);
          return;
        }
        if (act === 'rename') {
          openRenameBookModal(book);
          return;
        }
        if (act === 'delete') {
          var books = getBooks();
          if (!books || books.length <= 1) {
            showToast('至少保留一本书');
            return;
          }

          var title = (book && typeof book.title === 'string' && book.title.trim()) ? book.title.trim() : '未命名书';
          var ok = false;
          try { ok = confirm('确定删除《' + title + '》？'); } catch (_) { ok = false; }
          if (!ok) return;

          var removed = removeBookById(book.id);
          if (!removed || !removed.book) {
            showToast('删除失败');
            return;
          }

          saveData();
          renderHome();
          renderSidebar();

          showToast('已删除《' + title + '》', {
            actionText: '撤销',
            timeoutMs: 8000,
            onAction: function () {
              try {
                var list = getBooks();
                if (!Array.isArray(list)) return;
                list.splice(Math.max(0, Math.min(removed.index, list.length)), 0, normalizeBook(removed.book));
                if (appData) appData.currentBookId = removed.book.id;
                saveData();
                renderHome();
                renderSidebar();
              } catch (e) {}
            }
          });
          return;
        }
      };
    }

    var bookModalMode = 'create'; // create | rename
    var bookModalTargetId = null;
    var bookModalTheme = 'blue';
    var bookModalIcon = '✚';

    function ensureBookModalChoiceUIs() {
      if (els.bookThemeChoices && !els.bookThemeChoices.dataset.bound) {
        els.bookThemeChoices.dataset.bound = '1';
        els.bookThemeChoices.addEventListener('click', function (e) {
          var btn = e && e.target && e.target.closest ? e.target.closest('button[data-theme]') : null;
          if (!btn) return;
          var v = btn.getAttribute('data-theme');
          if (!isValidBookTheme(v)) return;
          bookModalTheme = v;
          updateBookModalChoiceSelection();
        });
      }
      if (els.bookIconChoices && !els.bookIconChoices.dataset.bound) {
        els.bookIconChoices.dataset.bound = '1';
        els.bookIconChoices.addEventListener('click', function (e) {
          var btn = e && e.target && e.target.closest ? e.target.closest('button[data-icon]') : null;
          if (!btn) return;
          var v = btn.getAttribute('data-icon');
          if (!isValidBookIcon(v)) return;
          bookModalIcon = v;
          updateBookModalChoiceSelection();
        });
      }
    }

    function renderBookModalChoices() {
      if (els.bookThemeChoices) {
        els.bookThemeChoices.innerHTML = BOOK_THEMES.map(function (t) {
          return (
            '<button type="button" class="choice-btn" data-theme="' + escapeAttr(t.id) + '" aria-label="' + escapeAttr(t.name) + '">' +
              '<span class="choice-dot theme-' + escapeAttr(t.id) + '"></span>' +
              '<span class="choice-label">' + escapeHtml(t.name) + '</span>' +
            '</button>'
          );
        }).join('');
      }
      if (els.bookIconChoices) {
        els.bookIconChoices.innerHTML = BOOK_ICONS.map(function (ico) {
          return (
            '<button type="button" class="choice-btn choice-btn--icon" data-icon="' + escapeAttr(ico) + '" aria-label="' + escapeAttr(ico) + '">' +
              '<span class="choice-icon">' + escapeHtml(ico) + '</span>' +
            '</button>'
          );
        }).join('');
      }
      updateBookModalChoiceSelection();
    }

    function updateBookModalChoiceSelection() {
      try {
        if (els.bookThemeChoices) {
          var themeBtns = els.bookThemeChoices.querySelectorAll('button[data-theme]');
          for (var i = 0; i < themeBtns.length; i++) {
            var btn = themeBtns[i];
            btn.classList.toggle('selected', btn.getAttribute('data-theme') === bookModalTheme);
          }
        }
        if (els.bookIconChoices) {
          var iconBtns = els.bookIconChoices.querySelectorAll('button[data-icon]');
          for (var j = 0; j < iconBtns.length; j++) {
            var ib = iconBtns[j];
            ib.classList.toggle('selected', ib.getAttribute('data-icon') === bookModalIcon);
          }
        }
      } catch (e) {}
    }

    function openBookModalWithMode(mode, book) {
      if (!els.bookModal) return;
      ensureBookModalChoiceUIs();
      renderBookModalChoices();

      bookModalMode = (mode === 'rename') ? 'rename' : 'create';
      bookModalTargetId = (mode === 'rename' && book && book.id) ? book.id : null;

      var title = (mode === 'rename') ? '编辑书' : '新建书';
      var btnText = (mode === 'rename') ? '保存' : '创建';

      var h3 = els.bookModal.querySelector('h3');
      if (h3) h3.textContent = title;
      if (els.bookCreateBtn) els.bookCreateBtn.textContent = btnText;

      if (els.bookNameInput) els.bookNameInput.value = (book && typeof book.title === 'string') ? book.title : '';

      bookModalTheme = (book && typeof book.theme === 'string' && isValidBookTheme(book.theme)) ? book.theme : 'blue';
      bookModalIcon = (book && typeof book.icon === 'string' && isValidBookIcon(book.icon)) ? book.icon : '✚';
      updateBookModalChoiceSelection();

      els.bookModal.classList.add('open');
      try { if (els.bookNameInput) { els.bookNameInput.focus(); els.bookNameInput.select(); } } catch (_) {}
    }

    function openRenameBookModal(book) { openBookModalWithMode('rename', book); }

    function openBookWithAnimation(book, cardEl) {
      if (!book || !cardEl) {
        if (book && book.id) {
          setActiveBook(book.id);
          saveData();
          hideHomeView();
          renderSidebar();
          if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
          if (els.questionsContainer) els.questionsContainer.innerHTML = '';
        }
        return;
      }

      try {
        if (bookOpenAnim && bookOpenAnim.active) return;
        var el = cardEl;

        var rect = el.getBoundingClientRect();
        var originalState = getComputedStyle(el).transform;

        // Find fixed-position containing block (transformed ancestor), so top/left stay "in place".
        var fixedCB = null;
        try {
          var p = el.parentElement;
          while (p && p !== document.body) {
            var cs = getComputedStyle(p);
            var t = cs.transform;
            var f = cs.filter;
            var persp = cs.perspective;
            var bf = '';
            try {
              if (cs.getPropertyValue) {
                bf = cs.getPropertyValue('backdrop-filter') || cs.getPropertyValue('-webkit-backdrop-filter') || '';
              }
            } catch (_) { bf = ''; }
            if ((t && t !== 'none') || (f && f !== 'none') || (persp && persp !== 'none') || (bf && bf !== 'none')) { fixedCB = p; break; }
            p = p.parentElement;
          }
        } catch (_) { fixedCB = null; }
        var cbRect = fixedCB ? fixedCB.getBoundingClientRect() : null;

        var placeholder = el.cloneNode(true);
        placeholder.style.opacity = 0;
        placeholder.style.pointerEvents = 'none';
        if (el.parentElement) el.parentElement.insertBefore(placeholder, el);

        bookOpenAnim = { active: true, el: el, placeholder: placeholder, originalState: originalState };

        try { el.classList.add('book-opening'); } catch (_) {}
        try { el.style.zIndex = '2500'; } catch (_) {}
        // Hide other books immediately to avoid z-order artifacts during the cover flip.
        try { document.body.classList.add('home-transitioning'); } catch (_) {}

        el.style.position = 'fixed';
        // If fixed is relative to a transformed ancestor, offset by its rect.
        var topPx = rect.top;
        var leftPx = rect.left;
        if (cbRect) {
          topPx = rect.top - cbRect.top;
          leftPx = rect.left - cbRect.left;
        }
        el.style.top = topPx + 'px';
        el.style.left = leftPx + 'px';
        el.style.margin = 0;
        el.style.transform = originalState;
        el.classList.remove('idle');

        // force reflow
        el.offsetHeight;

        // Ensure the element is pixel-perfect "in place" after switching to fixed-position.
        // (Some ancestors create a fixed-position containing block via filter/backdrop-filter/perspective.)
        try {
          var rFixed = el.getBoundingClientRect();
          var ax = rect.left - rFixed.left;
          var ay = rect.top - rFixed.top;
          if (Math.abs(ax) > 0.5 || Math.abs(ay) > 0.5) {
            leftPx += ax;
            topPx += ay;
            el.style.left = leftPx + 'px';
            el.style.top = topPx + 'px';
            el.offsetHeight;
          }
        } catch (_) {}

        // Phase 1: straighten + open cover
        el.classList.add('open-state');
        // Phase 1 should be visually "in place": keep screen rect stable while straightening.
        var targetNoTranslate = 'translate3d(0px, 0px, 0px) rotateY(0deg) rotateX(0deg)';
        var dx = 0;
        var dy = 0;
        try {
          el.style.transition = 'none';
          el.style.transform = targetNoTranslate;
          el.offsetHeight;
          var r2 = el.getBoundingClientRect();
          dx = rect.left - r2.left;
          dy = rect.top - r2.top;
        } catch (_) { dx = 0; dy = 0; }

        try {
          el.style.transform = originalState;
          el.offsetHeight;
        } catch (_) {}

        el.style.transition = 'transform 0.5s ease-out';
        el.style.transform = 'translate3d(' + dx + 'px, ' + dy + 'px, 0px) rotateY(0deg) rotateX(0deg)';

        setTimeout(function () {
          if (!bookOpenAnim || !bookOpenAnim.active || bookOpenAnim.el !== el) return;
          el.classList.add('zooming');
          setWhiteOverlayVisible(true);

          var winW = window.innerWidth;
          var winH = window.innerHeight;
          // Target: the *paper page* should cover the whole viewport (avoid edge leaks).
          var pageEl = null;
          try { pageEl = el.querySelector('.first-page'); } catch (_) { pageEl = null; }
          if (!pageEl) pageEl = el;

          var pr = pageEl.getBoundingClientRect();
          var safeW = Math.max(1, pr.width);
          var safeH = Math.max(1, pr.height);
          var scale = Math.max(winW / safeW, winH / safeH) * 1.08;

          var pageCenterX = pr.left + pr.width / 2;
          var pageCenterY = pr.top + pr.height / 2;
          var moveX = (winW / 2) - pageCenterX;
          var moveY = (winH / 2) - pageCenterY;

          el.style.transform = 'translate3d(' + moveX + 'px,' + moveY + 'px, 100px) scale(' + scale + ')';

          setTimeout(function () {
            if (!bookOpenAnim || !bookOpenAnim.active || bookOpenAnim.el !== el) return;
            cleanupBookOpenAnim();
            setActiveBook(book.id);
            saveData();
            hideHomeView();
            renderSidebar();
            if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
            if (els.questionsContainer) els.questionsContainer.innerHTML = '';
            setTimeout(function () {
              setWhiteOverlayVisible(false);
              try { document.body.classList.remove('home-transitioning'); } catch (_) {}
            }, 120);
          }, 1250);
        }, 450);
      } catch (e) {
        cleanupBookOpenAnim();
        setActiveBook(book.id);
        saveData();
        hideHomeView();
        renderSidebar();
        if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
        if (els.questionsContainer) els.questionsContainer.innerHTML = '';
      }
    }

    var bookOpenAnim = null;
    function cleanupBookOpenAnim() {
      try {
        if (!bookOpenAnim) return;
        var el = bookOpenAnim.el;
        var placeholder = bookOpenAnim.placeholder;
        if (placeholder && placeholder.remove) placeholder.remove();
        if (el) {
          try { el.classList.remove('book-opening'); } catch (_) {}
          try { el.style.zIndex = ''; } catch (_) {}
          el.style.position = '';
          el.style.top = '';
          el.style.left = '';
          el.style.margin = '';
          el.style.transform = '';
          el.style.transition = '';
          el.classList.remove('open-state');
          el.classList.remove('zooming');
          el.classList.add('idle');
        }
      } catch (e) {}
      bookOpenAnim = null;
    }
  
    function createFolderElement(folder) {
      var container = document.createElement('div');
      container.className = 'folder-container' + (folder.isOpen ? ' open' : '');
      container.dataset.id = folder.id;
  
      var header = document.createElement('div');
      header.className = 'list-item folder-header';
      header.innerHTML =
        '<div style="display:flex; align-items:center; flex:1; overflow:hidden; pointer-events:none;">' +
          '<i class="fa-solid fa-caret-right folder-arrow"></i>' +
          '<i class="fa-solid fa-folder folder-icon"></i>' +
          '<span class="item-title">' + escapeHtml(folder.title) + '</span>' +
        '</div>' +
        '<div class="item-actions">' +
          '<i class="fa-solid fa-pen action-icon" title="重命名"></i>' +
          '<i class="fa-solid fa-trash action-icon delete" title="删除"></i>' +
        '</div>';
  
      // toggle open
      header.onclick = function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('action-icon')) return;
        folder.isOpen = !folder.isOpen;
        saveData();
        renderSidebar();
      };
  
      // actions
      var actions = header.querySelector('.item-actions');
      if (actions) {
        var renBtn = actions.children[0];
        var delBtn = actions.children[1];
  
        if (renBtn) renBtn.onclick = function (e) {
          e.stopPropagation();
          var name = prompt('重命名:', folder.title);
          if (name) {
            folder.title = name;
            saveData();
            renderSidebar();
          }
        };
  
        if (delBtn) delBtn.onclick = function (e) {
          e.stopPropagation();
          var book = getActiveBook();

          var removedFolder = { id: folder.id, title: folder.title, isOpen: folder.isOpen };
          var moved = [];

          // remove folder
          var newFolders = [];
          for (var i = 0; i < (book.folders || []).length; i++) {
            if (book.folders[i].id !== folder.id) newFolders.push(book.folders[i]);
          }
          book.folders = newFolders;
  
          // cleanup layoutMap
          var map = book.layoutMap || {};
          for (var chId in map) {
            if (map[chId] === folder.id) {
              moved.push(chId);
              delete map[chId];
            }
          }
          book.layoutMap = map;
  
          saveData();
          renderSidebar();

          showToast('已删除文件夹：' + removedFolder.title, {
            actionText: '撤销',
            timeoutMs: 6500,
            onAction: function () {
              book.folders.push(removedFolder);
              if (!book.layoutMap) book.layoutMap = {};
              for (var k = 0; k < moved.length; k++) book.layoutMap[moved[k]] = removedFolder.id;
              saveData();
              renderSidebar();
              showToast('已撤销', { timeoutMs: 2200 });
            }
          });
        };
      }
  
      container.appendChild(header);
  
      var content = document.createElement('div');
      content.className = 'folder-content';
      container.appendChild(content);
  
      return container;
    }
  
    function createChapterElement(chapter) {
      var div = document.createElement('div');
      div.className = 'list-item chapter-item' + (chapter.id === currentChapterId ? ' active' : '');
      div.dataset.id = chapter.id;
  
      // iOS 长按不弹出系统选择/菜单（尽量）
      div.style.webkitTouchCallout = 'none';
  
      var icon = chapter.isStatic
        ? '<i class="fa-solid fa-code" title="预设内容" style="color:#95a5a6;"></i>'
        : '<i class="fa-regular fa-file-lines" title="导入内容" style="color:#7f8c8d;"></i>';
  
      div.innerHTML =
        '<div style="display:flex; align-items:center; gap:8px; overflow:hidden; pointer-events:none;">' +
          icon +
          '<span class="item-title">' + escapeHtml(chapter.title) + '</span>' +
        '</div>' +
        '<div class="item-actions">' +
          '<i class="fa-solid fa-grip-lines drag-handle" title="拖拽"></i>' +
          '<i class="fa-solid fa-trash action-icon delete" title="删除章节"></i>' +
        '</div>';
  
      // click to load (拖拽结束后短时间内忽略 click，防误触)
      div.onclick = function (e) {
        if (e.target && e.target.closest && e.target.closest('.action-icon, .drag-handle')) return;
        if (Date.now() < drag.suppressClickUntil) return;
        loadChapter(chapter.id);
      };
  
      // delete
      var delIcon = div.querySelector('.action-icon.delete');
      if (delIcon) {
        delIcon.onclick = function (e) {
          e.stopPropagation();
          deleteChapter(chapter.id);
        };
      }
  
      // drag bind
      bindDragStart(div, chapter.id);
  
      // prevent context menu
      div.oncontextmenu = function (e) { e.preventDefault(); return false; };
  
      return div;
    }
  
    /** ---------------------------
     * 8) 章节加载与题卡（保持你原逻辑）
     * --------------------------- */
    function loadChapter(id) {
      if (homeVisible) hideHomeView();
      currentChapterId = id;
      var chapter = findChapterById(id);
      if (!chapter || isDeleted(id)) return;
  
      if (els.chapterTitle) els.chapterTitle.innerText = chapter.title;
  
      renderSidebar();
  
      if (els.questionsContainer) {
        els.questionsContainer.innerHTML = '';
        for (var i = 0; i < (chapter.questions || []).length; i++) {
          els.questionsContainer.appendChild(createQuestionCard(chapter.questions[i]));
        }
      }
  
      window.scrollTo(0, 0);
      if (window.innerWidth <= 768 && els.sidebar) els.sidebar.classList.remove('active');
    }
  
    function createQuestionCard(q) {
      var card = document.createElement('div');
      card.className = 'question-card';
      if (q && q.id !== undefined && q.id !== null) card.dataset.hzrSeed = 'q:' + String(q.id);
      if (q && q.id !== undefined && q.id !== null) card.dataset.qid = String(q.id);

      var header = document.createElement('div');
      header.className = 'q-header';

      var idEl = document.createElement('span');
      idEl.className = 'q-id';
      idEl.textContent = (q && q.id !== undefined && q.id !== null) ? String(q.id) : '';

      var textEl = document.createElement('div');
      textEl.className = 'q-text';
      renderMarkdownInto(textEl, q && q.text);

      var aiBtn = document.createElement('button');
      aiBtn.className = 'ai-ask-btn';
      aiBtn.type = 'button';
      aiBtn.title = '问 AI';
      aiBtn.textContent = '问AI';

      header.appendChild(idEl);
      header.appendChild(textEl);
      header.appendChild(aiBtn);
      card.appendChild(header);

      var ul = document.createElement('ul');
      ul.className = 'options-list';
      for (var i = 0; i < (q.options || []).length; i++) {
        var opt = q.options[i];
        var li = document.createElement('li');
        var isCorrect = opt && opt.label === q.answer;
        li.className = 'option-item ' + (isCorrect ? 'correct' : '');

        var lab = document.createElement('span');
        lab.className = 'option-label';
        lab.textContent = opt && opt.label ? String(opt.label) : '';

        var cont = document.createElement('div');
        cont.className = 'option-content';
        renderMarkdownInto(cont, opt && opt.content, { inline: true });

        li.appendChild(lab);
        li.appendChild(cont);

        if (isCorrect) {
          var icon = document.createElement('i');
          icon.className = 'fa-solid fa-check';
          icon.style.marginLeft = 'auto';
          icon.style.color = 'green';
          li.appendChild(icon);
        }

        ul.appendChild(li);
      }
      card.appendChild(ul);

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

      if (q && q.knowledge) {
        var details = document.createElement('details');
        details.className = 'knowledge-details';

        var summary = document.createElement('summary');
        summary.className = 'knowledge-summary';
        var bookI = document.createElement('i');
        bookI.className = 'fa-solid fa-book-medical';
        summary.appendChild(bookI);
        summary.appendChild(document.createTextNode(' 知识点：' + String(q.knowledgeTitle || '相关考点')));

        var kCont = document.createElement('div');
        kCont.className = 'knowledge-content';
        renderMarkdownInto(kCont, q.knowledge);

        details.appendChild(summary);
        details.appendChild(kCont);
        card.appendChild(details);
      }

      applyRandomHighlights(card);
      return card;
    }

    /** ---------------------------
     * 8.1) 题目快捷问 AI（首版：轻量 modal + SSE 流式）
     * --------------------------- */
    var aiChat = {
      conversationId: null,
      scope: null,
      busy: false,
      lastQuestionContext: '',
      pendingSelectedText: ''
    };

    function htmlToText(html) {
      try {
        var div = document.createElement('div');
        div.innerHTML = String(html || '');
        return (div.textContent || div.innerText || '').trim();
      } catch (_) {
        return String(html || '').trim();
      }
    }

    function buildQuestionContextText(book, chapter, q) {
      var out = [];
      if (book && book.title) out.push('书：' + String(book.title));
      if (chapter && chapter.title) out.push('章节：' + String(chapter.title));
      if (q && (q.id !== undefined && q.id !== null)) out.push('题号：' + String(q.id));
      out.push('');
      out.push('【题目】');
      out.push(htmlToText(q && q.text));
      out.push('');
      out.push('【选项】');
      for (var i = 0; i < (q && q.options ? q.options.length : 0); i++) {
        var opt = q.options[i];
        if (!opt) continue;
        out.push(String(opt.label || '') + '. ' + htmlToText(opt.content));
      }
      out.push('');
      out.push('【答案】' + String((q && q.answer) ? q.answer : ''));
      if (q && q.explanation) {
        out.push('');
        out.push('【解析】');
        out.push(htmlToText(q.explanation));
      }
      if (q && q.knowledge) {
        out.push('');
        out.push('【知识点】' + String(q.knowledgeTitle || ''));
        out.push(htmlToText(q.knowledge));
      }
      return out.join('\n').trim();
    }

    function setAiChatHint(text) {
      if (!els.aiChatHint) return;
      els.aiChatHint.textContent = text ? String(text) : '';
    }

    function openAiChatModal() {
      if (!els.aiChatModal) return;
      hideAiSelBtn();
      els.aiChatModal.classList.add('open');
      try { if (els.aiChatInput) els.aiChatInput.focus(); } catch (_) {}
    }

    function closeAiChatModal() {
      if (!els.aiChatModal) return;
      els.aiChatModal.classList.remove('open');
      aiChat.busy = false;
      setAiChatHint('');
    }

    function clearAiMessages() {
      if (!els.aiChatMessages) return;
      els.aiChatMessages.innerHTML = '';
    }

    function appendAiBubble(role, text) {
      if (!els.aiChatMessages) return null;
      var wrap = document.createElement('div');
      wrap.className = 'ai-msg ' + role;
      var bubble = document.createElement('div');
      bubble.className = 'ai-bubble ' + role;
      renderMarkdownInto(bubble, String(text || ''));
      wrap.appendChild(bubble);
      els.aiChatMessages.appendChild(wrap);
      try { els.aiChatMessages.scrollTop = els.aiChatMessages.scrollHeight; } catch (_) {}
      return bubble;
    }

    function renderAiConversation(conv, messages) {
      if (els.aiChatTitle) els.aiChatTitle.textContent = (conv && conv.title) ? String(conv.title) : 'AI 对话';
      if (els.aiChatModelSelect) els.aiChatModelSelect.value = (conv && conv.modelPref) ? String(conv.modelPref) : 'flash';

      // Pull question context from the first system message if present.
      var contextText = '';
      for (var i = 0; i < (messages || []).length; i++) {
        var m = messages[i];
        if (m && m.role === 'system' && m.text) { contextText = String(m.text); break; }
      }
      if (!contextText) contextText = aiChat.lastQuestionContext || '';
      if (els.aiChatContextText) els.aiChatContextText.textContent = contextText;
      if (els.aiChatContextWrap) {
        if (contextText) els.aiChatContextWrap.style.display = '';
        else els.aiChatContextWrap.style.display = 'none';
      }

      clearAiMessages();
      for (var j = 0; j < (messages || []).length; j++) {
        var msg = messages[j];
        if (!msg || !msg.role) continue;
        if (msg.role === 'system') continue; // shown in context panel
        appendAiBubble(msg.role === 'assistant' ? 'assistant' : 'user', msg.text || '');
      }
    }

    function loadAiConversation(conversationId) {
      return apiFetch('/api/ai/conversations/' + encodeURIComponent(String(conversationId)), { method: 'GET' })
        .then(function (res) {
          if (!res.ok) throw new Error('load conversation failed');
          return res.json();
        })
        .then(function (j) {
          aiChat.conversationId = j && j.conversation ? j.conversation.id : conversationId;
          renderAiConversation(j.conversation, j.messages || []);
          return j;
        });
    }

    function consumeEventStream(res, onEvent) {
      if (!res || !res.body || !res.body.getReader || typeof TextDecoder === 'undefined') {
        return res.text().then(function (t) { onEvent('error', { message: t || 'no stream' }); });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buf = '';

      function parseBlock(block) {
        var lines = block.split(/\r?\n/);
        var ev = 'message';
        var data = '';
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line) continue;
          if (line[0] === ':') continue;
          if (line.indexOf('event:') === 0) ev = line.slice(6).trim();
          else if (line.indexOf('data:') === 0) data += line.slice(5).trim();
        }
        if (!data) return;
        var obj = null;
        try { obj = JSON.parse(data); } catch (_) { obj = { text: data }; }
        onEvent(ev, obj);
      }

      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += decoder.decode(r.value, { stream: true });
          var parts = buf.split(/\n\n/);
          buf = parts.pop();
          for (var i = 0; i < parts.length; i++) parseBlock(parts[i]);
          return pump();
        });
      }
      return pump();
    }

    function sendAiChatMessage() {
      if (aiChat.busy) return;
      if (!aiChat.conversationId) { showToast('未建立对话', { timeoutMs: 1800 }); return; }
      var msg = (els.aiChatInput && typeof els.aiChatInput.value === 'string') ? els.aiChatInput.value.trim() : '';
      if (!msg) return;

      var modelPref = (els.aiChatModelSelect && els.aiChatModelSelect.value) ? String(els.aiChatModelSelect.value) : 'flash';
      var selText = aiChat.pendingSelectedText ? String(aiChat.pendingSelectedText) : '';
      aiChat.pendingSelectedText = '';

      if (els.aiChatInput) els.aiChatInput.value = '';
      setAiChatHint('AI 思考中…');

      appendAiBubble('user', msg);
      var assistantBubble = appendAiBubble('assistant', '');
      aiChat.busy = true;
      if (els.aiChatSendBtn) els.aiChatSendBtn.disabled = true;

      apiFetch('/api/ai/conversations/' + encodeURIComponent(String(aiChat.conversationId)) + '/messages/stream', {
        method: 'POST',
        body: JSON.stringify({ userMessage: msg, selectedText: selText, modelPref: modelPref })
      }).then(function (res) {
        return consumeEventStream(res, function (event, data) {
          if (event === 'delta') {
            var t = (data && typeof data.text === 'string') ? data.text : '';
            if (!t) return;
            assistantBubble._raw = (assistantBubble._raw || '') + t;
            assistantBubble.innerHTML = escapeHtml(assistantBubble._raw).replace(/\n/g, '<br>');
            try { if (els.aiChatMessages) els.aiChatMessages.scrollTop = els.aiChatMessages.scrollHeight; } catch (_) {}
            return;
          }
          if (event === 'error') {
            var m = (data && data.message) ? String(data.message) : '请求失败';
            setAiChatHint('失败：' + m);
            return;
          }
          if (event === 'done') {
            setAiChatHint('');
          }
        });
      }).catch(function (e) {
        setAiChatHint('失败：' + (e && e.message ? e.message : '网络错误'));
      }).then(function () {
        aiChat.busy = false;
        if (els.aiChatSendBtn) els.aiChatSendBtn.disabled = false;
        // Refresh from server (keeps multi-device consistent)
        return loadAiConversation(aiChat.conversationId).catch(function () {});
      });
    }

    function openAiChatForQuestionId(qid) {
      var selectedText = arguments.length > 1 ? arguments[1] : '';
      var token = getToken();
      if (!token) {
        showToast('请先登录云同步后使用 AI', { timeoutMs: 2400 });
        updateAuthModalUI();
        switchSyncTab('account');
        if (els.authModal) els.authModal.classList.add('open');
        return;
      }

      var chapter = findChapterById(currentChapterId);
      if (!chapter || !Array.isArray(chapter.questions)) { showToast('未找到题目', { timeoutMs: 1800 }); return; }

      var q = null;
      for (var i = 0; i < chapter.questions.length; i++) {
        if (String(chapter.questions[i].id) === String(qid)) { q = chapter.questions[i]; break; }
      }
      if (!q) { showToast('未找到题目', { timeoutMs: 1800 }); return; }

      var book = getActiveBook();
      var ctx = buildQuestionContextText(book, chapter, q);
      aiChat.lastQuestionContext = ctx;
      aiChat.scope = 'question';
      aiChat.pendingSelectedText = selectedText ? String(selectedText) : '';

      setAiChatHint('建立对话…');
      openAiChatModal();

      var modelPref = (els.aiChatModelSelect && els.aiChatModelSelect.value) ? String(els.aiChatModelSelect.value) : 'flash';
      apiFetch('/api/ai/conversations', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'question',
          bookId: book && book.id ? String(book.id) : null,
          chapterId: chapter && chapter.id ? String(chapter.id) : null,
          questionId: (q && q.id !== undefined && q.id !== null) ? String(q.id) : null,
          questionKey: (book && book.id ? String(book.id) : '') + '|' + (chapter && chapter.id ? String(chapter.id) : '') + '|' + String(qid),
          modelPref: modelPref,
          questionContext: ctx
        })
      }).then(function (res) {
        if (!res.ok) throw new Error('create conversation failed');
        return res.json();
      }).then(function (j) {
        if (!j || !j.conversationId) throw new Error('bad response');
        aiChat.conversationId = j.conversationId;
        return loadAiConversation(aiChat.conversationId);
      }).then(function () {
        if (aiChat.pendingSelectedText) setAiChatHint('已引用选中内容（发送时会带给 AI）');
        else setAiChatHint('');
      }).catch(function (e) {
        setAiChatHint('失败：' + (e && e.message ? e.message : '请求失败'));
      });
    }

    /** ---------------------------
     * 8.2) 书内拍照导入（<=9 张，后端异步队列）
     * --------------------------- */
    var aiImport = {
      files: [],
      jobId: null,
      pollTimer: 0,
      eventsAbort: null,
      dragFrom: null
    };

    function setAiImportHint(text) {
      if (!els.aiImportHint) return;
      els.aiImportHint.textContent = text ? String(text) : '';
    }

    function setAiImportProgress(pct, text) {
      if (els.aiImportProgressFill) els.aiImportProgressFill.style.width = String(Math.max(0, Math.min(100, pct || 0))) + '%';
      if (els.aiImportProgressText) els.aiImportProgressText.textContent = text ? String(text) : '';
    }

    function setAiImportQueueText(text) {
      if (!els.aiImportQueueText) return;
      els.aiImportQueueText.textContent = text ? String(text) : '';
    }

    function clearAiImportResult() {
      if (!els.aiImportResult) return;
      els.aiImportResult.innerHTML = '';
    }

    function renderAiImportFiles() {
      if (!els.aiImportFilesList) return;
      var html = '';
      for (var i = 0; i < aiImport.files.length; i++) {
        var it = aiImport.files[i];
        if (!it || !it.file) continue;
        html += '<div class="ai-import-file" data-idx="' + i + '" draggable="true">' +
          '<span class="ai-import-file-idx">' + (i + 1) + '</span>' +
          '<img class="ai-import-thumb" src="' + escapeHtml(it.url || '') + '" alt="preview">' +
          '<span class="ai-import-file-name">' + escapeHtml(it.name || it.file.name || ('image_' + (i + 1))) + '</span>' +
          '<button class="ai-import-move-up" type="button" title="上移">↑</button>' +
          '<button class="ai-import-move-down" type="button" title="下移">↓</button>' +
          '<button class="ai-import-file-remove" type="button" title="移除">移除</button>' +
        '</div>';
      }
      els.aiImportFilesList.innerHTML = html;
    }

    function addAiImportFiles(fileList) {
      var list = fileList && fileList.length ? fileList : [];
      for (var i = 0; i < list.length; i++) {
        if (aiImport.files.length >= 9) break;
        var f = list[i];
        if (!f) continue;
        var type = String(f.type || '');
        if (type && type.indexOf('image/') !== 0) continue;
        var url = '';
        try { url = URL.createObjectURL(f); } catch (_) { url = ''; }
        aiImport.files.push({ id: uid('img'), file: f, name: f.name || ('image_' + (aiImport.files.length + 1) + '.png'), url: url });
      }
      if (aiImport.files.length > 9) aiImport.files = aiImport.files.slice(0, 9);
      renderAiImportFiles();
    }

    function clearAiImportFiles() {
      try {
        for (var i = 0; i < aiImport.files.length; i++) {
          var it = aiImport.files[i];
          if (it && it.url) {
            try { URL.revokeObjectURL(it.url); } catch (_) {}
          }
        }
      } catch (_) {}
      aiImport.files = [];
      renderAiImportFiles();
    }

    function clearAiImportJobPolling() {
      if (aiImport.pollTimer) {
        try { clearInterval(aiImport.pollTimer); } catch (_) {}
        aiImport.pollTimer = 0;
      }
    }

    function stopAiImportEvents() {
      if (aiImport.eventsAbort) {
        try { aiImport.eventsAbort.abort(); } catch (_) {}
      }
      aiImport.eventsAbort = null;
    }

    function openAiImportModal() {
      if (!els.aiImportModal) return;
      if (!getToken()) {
        showToast('请先登录云同步后使用 AI 导入', { timeoutMs: 2400 });
        updateAuthModalUI();
        switchSyncTab('account');
        if (els.authModal) els.authModal.classList.add('open');
        return;
      }
      if (homeVisible) {
        showToast('请先进入一本书再导入', { timeoutMs: 2200 });
        return;
      }
      clearAiImportJobPolling();
      stopAiImportEvents();
      clearAiImportFiles();
      aiImport.jobId = null;
      if (els.aiImportNoteText) els.aiImportNoteText.value = '';
      setAiImportProgress(0, '未开始');
      setAiImportQueueText('');
      setAiImportHint('');
      clearAiImportResult();
      els.aiImportModal.classList.add('open');

      // If there is an active job for this book (multi-device), attach to it.
      try {
        var book = getActiveBook();
        if (book && book.id) maybeAttachActiveImportJob(String(book.id));
      } catch (_) {}
    }

    function closeAiImportModal() {
      if (!els.aiImportModal) return;
      els.aiImportModal.classList.remove('open');
      clearAiImportJobPolling();
      stopAiImportEvents();
    }

    function fetchWithAuth(path, options) {
      options = options || {};
      var headers = options.headers || {};
      var t = getToken();
      if (t) headers['Authorization'] = 'Bearer ' + t;
      headers['X-Device-Id'] = headers['X-Device-Id'] || getOrCreateDeviceId();
      try {
        headers['X-Device-Label'] = headers['X-Device-Label'] || encodeURIComponent(getDeviceLabel());
      } catch (_) {
        headers['X-Device-Label'] = headers['X-Device-Label'] || '';
      }
      options.headers = headers;
      return fetch(API_BASE + path, options);
    }

    function statusLabel(s) {
      s = String(s || '');
      if (s === 'queued') return '排队中';
      if (s === 'running') return '识别中';
      if (s === 'finalizing') return '归并中';
      if (s === 'writing') return '写入中';
      if (s === 'done') return '完成';
      if (s === 'done_with_errors') return '完成(有失败页)';
      if (s === 'failed') return '失败';
      return s || '';
    }

    function renderAiImportResultFromJob(job) {
      if (!els.aiImportResult) return;
      var result = job && job.result ? job.result : null;
      if (!result || !result.insertedChapters || !result.insertedChapters.length) {
        els.aiImportResult.innerHTML = '';
        return;
      }
      var html = '';
      for (var i = 0; i < result.insertedChapters.length; i++) {
        var ch = result.insertedChapters[i];
        if (!ch || !ch.id) continue;
        html += '<div class="ai-import-result-item" data-chid="' + escapeHtml(ch.id) + '">' +
          '<div class="ai-import-result-title">' + escapeHtml(ch.title || ch.id) + '</div>' +
          '<button class="ai-import-open-btn" type="button">打开</button>' +
        '</div>';
      }
      els.aiImportResult.innerHTML = html;
    }

    function mergeRemoteAiChaptersIntoLocal(remoteData, bookId, jobId) {
      try {
        if (!remoteData || !remoteData.books || !bookId) return 0;
        var books = getBooks();
        var localBook = null;
        for (var i = 0; i < books.length; i++) if (books[i] && books[i].id === bookId) { localBook = books[i]; break; }
        if (!localBook) return 0;

        var remoteBook = null;
        for (var j = 0; j < remoteData.books.length; j++) {
          var b = remoteData.books[j];
          if (b && b.id === bookId) { remoteBook = b; break; }
        }
        if (!remoteBook) return 0;

        if (!Array.isArray(localBook.chapters)) localBook.chapters = [];
        if (!Array.isArray(remoteBook.chapters)) return 0;

        var localIds = new Set();
        for (var k = 0; k < localBook.chapters.length; k++) {
          var cid = localBook.chapters[k] && localBook.chapters[k].id ? String(localBook.chapters[k].id) : '';
          if (cid) localIds.add(cid);
        }
        var tomb = new Set();
        if (Array.isArray(localBook.deletedChapterIds)) {
          for (var t = 0; t < localBook.deletedChapterIds.length; t++) tomb.add(String(localBook.deletedChapterIds[t]));
        }

        var added = 0;
        var prefix = jobId ? ('ai_' + String(jobId) + '_') : 'ai_';
        for (var m = 0; m < remoteBook.chapters.length; m++) {
          var ch = remoteBook.chapters[m];
          var id = ch && ch.id ? String(ch.id) : '';
          if (!id || id.indexOf(prefix) !== 0) continue;
          if (tomb.has(id)) continue;
          if (localIds.has(id)) continue;
          localBook.chapters.push(ch);
          localIds.add(id);
          added += 1;
        }
        return added;
      } catch (_) {
        return 0;
      }
    }

    function pullCloudAiUpdatesForJob(bookId, jobId) {
      if (!getToken()) return Promise.resolve(false);
      return cloudLoadLibrary().then(function (j) {
        if (!j || !j.data) return false;
        var added = mergeRemoteAiChaptersIntoLocal(j.data, bookId, jobId);
        if (typeof j.version === 'number') cloud.version = j.version;
        if (added > 0) {
          saveData();
          renderSidebar();
          if (homeVisible) renderHome();
        }
        return added > 0;
      }).catch(function () { return false; });
    }

    function applyAiImportSnapshot(payload) {
      var job = payload && payload.job ? payload.job : null;
      if (!job || !job.progress) return;

      var p = job.progress;
      var total = Number(p.totalPages) || 0;
      var done = Number(p.donePages) || 0;
      var ok = Number(p.okPages) || 0;
      var fail = Number(p.failedPages) || 0;
      var pct = total > 0 ? Math.round((done / total) * 100) : 0;
      setAiImportProgress(pct, statusLabel(p.status) + ' · ' + done + '/' + total + '（成功 ' + ok + '，失败 ' + fail + '）');

      if (p.status === 'queued' || p.status === 'running' || p.status === 'finalizing' || p.status === 'writing') {
        var eta = (p.etaMin !== undefined && p.etaMin !== null) ? String(p.etaMin) : '';
        setAiImportQueueText('排队：前面 ' + String(p.aheadUsers || 0) + ' 位用户 · 预计 ' + (eta ? eta + ' 分钟' : '计算中…'));
      } else {
        setAiImportQueueText('');
      }

      if (job.status === 'done' || job.status === 'done_with_errors' || job.status === 'failed') {
        renderAiImportResultFromJob(job);
      }

      if (p.status === 'done' || p.status === 'done_with_errors' || p.status === 'failed') {
        clearAiImportJobPolling();
        stopAiImportEvents();
        if (p.status === 'done') setAiImportHint('完成：已写入题库。');
        else if (p.status === 'done_with_errors') setAiImportHint('完成但有失败页：可稍后重试导入。');
        else setAiImportHint('失败：请稍后重试。');

        // Best-effort pull remote AI chapters into local UI so the user can see them immediately.
        try {
          var b = getActiveBook();
          if (b && b.id && aiImport.jobId) pullCloudAiUpdatesForJob(String(b.id), String(aiImport.jobId));
        } catch (_) {}
      }
    }

    function subscribeAiImportJobEvents(jobId) {
      if (!jobId) return;
      stopAiImportEvents();
      clearAiImportJobPolling();
      aiImport.jobId = jobId;

      try {
        if (typeof AbortController === 'undefined') throw new Error('no AbortController');
        var ac = new AbortController();
        aiImport.eventsAbort = ac;
        fetchWithAuth('/api/ai/jobs/' + encodeURIComponent(String(jobId)) + '/events', { method: 'GET', signal: ac.signal })
          .then(function (res) {
            if (!res.ok) throw new Error('events failed');
            return consumeEventStream(res, function (event, data) {
              if (event === 'snapshot' && data) applyAiImportSnapshot(data);
            });
          })
          .catch(function () {
            // Fallback to polling if streaming is blocked by proxy/browser.
            pollAiImportJob(jobId);
            aiImport.pollTimer = setInterval(function () { pollAiImportJob(jobId); }, 2000);
          });
      } catch (_) {
        pollAiImportJob(jobId);
        aiImport.pollTimer = setInterval(function () { pollAiImportJob(jobId); }, 2000);
      }
    }

    function maybeAttachActiveImportJob(bookId) {
      if (!bookId) return;
      apiFetch('/api/ai/jobs?bookId=' + encodeURIComponent(String(bookId)), { method: 'GET' })
        .then(function (res) { if (!res.ok) throw new Error('jobs failed'); return res.json(); })
        .then(function (j) {
          var items = j && Array.isArray(j.items) ? j.items : [];
          for (var i = 0; i < items.length; i++) {
            var job = items[i];
            if (!job || !job.id) continue;
            if (job.status === 'queued' || job.status === 'running' || job.status === 'finalizing' || job.status === 'writing') {
              aiImport.jobId = job.id;
              setAiImportHint('检测到进行中的导入任务：已自动接入进度。');
              subscribeAiImportJobEvents(job.id);
              return;
            }
          }
        })
        .catch(function () {});
    }

    function pollAiImportJob(jobId) {
      if (!jobId) return;
      return apiFetch('/api/ai/jobs/' + encodeURIComponent(String(jobId)), { method: 'GET' })
        .then(function (res) { if (!res.ok) throw new Error('job load failed'); return res.json(); })
        .then(function (j) {
          if (j && j.job && j.job.id) aiImport.jobId = j.job.id;
          applyAiImportSnapshot(j);
          return j;
        })
        .catch(function (e) {
          setAiImportHint('状态获取失败：' + (e && e.message ? e.message : '网络错误'));
        });
    }

    function startAiImport() {
      if (!getToken()) {
        showToast('请先登录云同步', { timeoutMs: 2200 });
        return;
      }
      if (homeVisible) {
        showToast('请先进入一本书再导入', { timeoutMs: 2200 });
        return;
      }
      var book = getActiveBook();
      if (!book || !book.id) { showToast('未找到书', { timeoutMs: 1800 }); return; }
      if (!aiImport.files.length) { showToast('请先选择图片（最多 9 张）', { timeoutMs: 2200 }); return; }

      var model = (els.aiImportModelSelect && els.aiImportModelSelect.value) ? String(els.aiImportModelSelect.value) : 'flash';
      var noteText = (els.aiImportNoteText && typeof els.aiImportNoteText.value === 'string') ? els.aiImportNoteText.value : '';

      var fd = new FormData();
      fd.append('bookId', String(book.id));
      fd.append('model', model);
      fd.append('noteText', noteText || '');
      for (var i = 0; i < aiImport.files.length; i++) {
        var it = aiImport.files[i];
        if (!it || !it.file) continue;
        fd.append('images', it.file, it.name || it.file.name || ('page_' + (i + 1) + '.png'));
      }

      setAiImportHint('提交中…');
      setAiImportProgress(0, '提交中…');

      fetchWithAuth('/api/ai/book-import', { method: 'POST', body: fd })
        .then(function (res) {
          return res.json().then(function (j) { return { res: res, json: j }; });
        })
        .then(function (x) {
          if (x.res.status === 409 && x.json && x.json.jobId) {
            aiImport.jobId = x.json.jobId;
            setAiImportHint('已有进行中的导入任务，已切换到该任务。');
            return aiImport.jobId;
          }
          if (!x.res.ok) {
            var msg = (x.json && (x.json.message || x.json.error)) ? String(x.json.message || x.json.error) : '提交失败';
            throw new Error(msg);
          }
          if (!x.json || !x.json.jobId) throw new Error('bad response');
          aiImport.jobId = x.json.jobId;
          setAiImportHint('已提交：后台处理中…');
          return aiImport.jobId;
        })
        .then(function (jobId) {
          // Prefer SSE for real-time progress; fallback to polling inside subscribe.
          subscribeAiImportJobEvents(jobId);
        })
        .catch(function (e) {
          setAiImportHint('失败：' + (e && e.message ? e.message : '提交失败'));
          setAiImportProgress(0, '未开始');
        });
    }

    /** ---------------------------
     * 8.2.1) AI 历史中心（多端可继续对话）
     * --------------------------- */
    var aiHistory = { loading: false };

    function setAiHistoryHint(text) {
      if (!els.aiHistoryHint) return;
      els.aiHistoryHint.textContent = text ? String(text) : '';
    }

    function openAiHistoryModal() {
      if (!els.aiHistoryModal) return;
      if (!getToken()) {
        showToast('请先登录云同步后使用 AI', { timeoutMs: 2400 });
        updateAuthModalUI();
        switchSyncTab('account');
        if (els.authModal) els.authModal.classList.add('open');
        return;
      }
      els.aiHistoryModal.classList.add('open');
      refreshAiHistory();
    }

    function closeAiHistoryModal() {
      if (!els.aiHistoryModal) return;
      els.aiHistoryModal.classList.remove('open');
      setAiHistoryHint('');
    }

    function scopeLabel(scope) {
      if (scope === 'question') return '题目';
      if (scope === 'book') return '书';
      return '通用';
    }

    function refreshAiHistory() {
      if (aiHistory.loading) return;
      aiHistory.loading = true;
      setAiHistoryHint('加载中…');

      var scope = (els.aiHistoryScopeSelect && typeof els.aiHistoryScopeSelect.value === 'string') ? els.aiHistoryScopeSelect.value.trim() : '';
      var qs = scope ? ('?scope=' + encodeURIComponent(scope)) : '';

      apiFetch('/api/ai/conversations' + qs, { method: 'GET' })
        .then(function (res) { if (!res.ok) throw new Error('load failed'); return res.json(); })
        .then(function (j) {
          var items = (j && Array.isArray(j.items)) ? j.items : [];
          renderAiHistory(items);
          setAiHistoryHint(items.length ? '' : '暂无对话记录。');
        })
        .catch(function (e) {
          setAiHistoryHint('加载失败：' + (e && e.message ? e.message : '网络错误'));
        })
        .then(function () {
          aiHistory.loading = false;
        });
    }

    function renderAiHistory(items) {
      if (!els.aiHistoryList) return;
      var html = '';
      for (var i = 0; i < items.length; i++) {
        var c = items[i];
        if (!c || !c.id) continue;
        var title = c.title ? String(c.title) : '新对话';
        var meta = [];
        meta.push('<span class="ai-history-tag">' + escapeHtml(scopeLabel(c.scope)) + '</span>');
        if (c.bookId) meta.push('<span class="ai-history-tag">' + escapeHtml('book:' + shortId(c.bookId)) + '</span>');
        if (c.questionId) meta.push('<span class="ai-history-tag">' + escapeHtml('q:' + String(c.questionId)) + '</span>');
        var t = c.lastMessageAt || c.updatedAt || c.createdAt;
        html += '<div class="ai-history-item" data-id="' + escapeHtml(c.id) + '">' +
          '<div class="ai-history-item-main">' +
            '<div class="ai-history-item-title">' + escapeHtml(title) + '</div>' +
            '<div class="ai-history-item-meta">' + meta.join('') + '</div>' +
          '</div>' +
          '<div class="ai-history-time">' + escapeHtml(formatLocalTime(t)) + '</div>' +
        '</div>';
      }
      els.aiHistoryList.innerHTML = html;
    }

    function startNewAiConversation() {
      if (!getToken()) {
        showToast('请先登录云同步后使用 AI', { timeoutMs: 2400 });
        return;
      }

      var scope = homeVisible ? 'general' : 'book';
      var book = (!homeVisible) ? getActiveBook() : null;

      setAiHistoryHint('创建对话…');
      apiFetch('/api/ai/conversations', {
        method: 'POST',
        body: JSON.stringify({
          scope: scope,
          bookId: (scope === 'book' && book && book.id) ? String(book.id) : null,
          modelPref: 'flash'
        })
      }).then(function (res) {
        if (!res.ok) throw new Error('create failed');
        return res.json();
      }).then(function (j) {
        if (!j || !j.conversationId) throw new Error('bad response');
        closeAiHistoryModal();
        aiChat.conversationId = j.conversationId;
        openAiChatModal();
        return loadAiConversation(j.conversationId);
      }).catch(function (e) {
        setAiHistoryHint('创建失败：' + (e && e.message ? e.message : '网络错误'));
      });
    }

    /** ---------------------------
     * 8.3) 选中引用快捷问 AI（浮动按钮）
     * --------------------------- */
    var aiSel = { btn: null, qid: null, text: '', timer: 0 };

    function ensureAiSelBtn() {
      if (aiSel.btn) return aiSel.btn;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ai-sel-btn';
      btn.textContent = '问AI';
      btn.onclick = function () {
        var qid = aiSel.qid;
        var txt = aiSel.text;
        hideAiSelBtn();
        if (!qid || !txt) return;
        openAiChatForQuestionId(qid, txt);
      };
      document.body.appendChild(btn);
      aiSel.btn = btn;
      return btn;
    }

    function hideAiSelBtn() {
      if (!aiSel.btn) return;
      aiSel.btn.style.display = 'none';
      aiSel.qid = null;
      aiSel.text = '';
    }

    function scheduleAiSelUpdate() {
      if (aiSel.timer) {
        try { clearTimeout(aiSel.timer); } catch (_) {}
        aiSel.timer = 0;
      }
      aiSel.timer = setTimeout(updateAiSelBtn, 120);
    }

    function updateAiSelBtn() {
      aiSel.timer = 0;
      if (!window.getSelection) { hideAiSelBtn(); return; }
      var sel = null;
      try { sel = window.getSelection(); } catch (_) { sel = null; }
      if (!sel || sel.isCollapsed) { hideAiSelBtn(); return; }
      var text = String(sel.toString() || '').trim();
      if (!text || text.length < 2) { hideAiSelBtn(); return; }

      var node = sel.anchorNode || sel.focusNode;
      var el = null;
      if (node && node.nodeType === 3) el = node.parentElement;
      else el = node;
      if (!el || !el.closest) { hideAiSelBtn(); return; }
      var card = el.closest('.question-card');
      if (!card || !card.dataset || !card.dataset.qid) { hideAiSelBtn(); return; }

      var rect = null;
      try {
        var range = sel.rangeCount ? sel.getRangeAt(0) : null;
        rect = range ? range.getBoundingClientRect() : null;
      } catch (_) { rect = null; }
      if (!rect) { hideAiSelBtn(); return; }

      var btn = ensureAiSelBtn();
      aiSel.qid = String(card.dataset.qid);
      aiSel.text = text;

      var left = rect.right + 10;
      var top = rect.top - 8;
      var bw = 54;
      var bh = 34;
      left = Math.max(8, Math.min(window.innerWidth - bw - 8, left));
      top = Math.max(8, Math.min(window.innerHeight - bh - 8, top));
      btn.style.left = left + 'px';
      btn.style.top = top + 'px';
      btn.style.display = 'block';
    }
  
    /** ---------------------------
     * 9) 删除章节（static/local 一视同仁）
     * --------------------------- */
    function deleteChapter(id) {
      var book = getActiveBook();
      var prevFolder = (book.layoutMap && book.layoutMap[id]) ? book.layoutMap[id] : null;
      var wasCurrent = currentChapterId === id;

      var localIndex = -1;
      var localChapter = null;
      for (var i = 0; i < (book.chapters || []).length; i++) {
        if (book.chapters[i].id === id) { localIndex = i; localChapter = book.chapters[i]; break; }
      }

      if (localIndex !== -1) {
        var kept = [];
        for (var j = 0; j < book.chapters.length; j++) {
          if (book.chapters[j].id !== id) kept.push(book.chapters[j]);
        }
        book.chapters = kept;
      } else {
        if (!book.deletedChapterIds) book.deletedChapterIds = [];
        if (book.deletedChapterIds.indexOf(id) === -1) book.deletedChapterIds.push(id);
      }

      if (book.layoutMap && book.layoutMap[id]) delete book.layoutMap[id];

      if (wasCurrent) {
        currentChapterId = null;
        if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
        if (els.questionsContainer) els.questionsContainer.innerHTML = '';
      }

      saveData();
      renderSidebar();

      var chObj = localChapter || findChapterById(id) || { id: id, title: '章节' };
      showToast('已删除：' + (chObj.title || '章节'), {
        actionText: '撤销',
        timeoutMs: 6500,
        onAction: function () {
          if (localChapter) {
            var idx = localIndex;
            if (idx < 0 || idx > book.chapters.length) idx = book.chapters.length;
            book.chapters.splice(idx, 0, localChapter);
          } else {
            var del = book.deletedChapterIds || [];
            var next = [];
            for (var k = 0; k < del.length; k++) if (del[k] !== id) next.push(del[k]);
            book.deletedChapterIds = next;
          }

          if (prevFolder) {
            if (!book.layoutMap) book.layoutMap = {};
            book.layoutMap[id] = prevFolder;
          }

          saveData();
          renderSidebar();
          if (wasCurrent) loadChapter(id);
          showToast('已撤销', { timeoutMs: 2200 });
        }
      });
    }
  
    /** ---------------------------
     * 10) 可靠拖拽系统
     * --------------------------- */
    var DRAG_MOUSE_THRESHOLD = 6;     // mouse moved px to start drag
    var TOUCH_CANCEL_THRESHOLD = 18;  // touch moved px during long-press waiting => cancel
    var LONG_PRESS_MS = 300;          // touch long-press delay
    var AUTO_SCROLL_EDGE = 55;        // px near top/bottom triggers autoscroll
    var AUTO_SCROLL_MAX_SPEED = 18;   // px per frame
  
    var drag = {
      mode: 'idle', // idle | pending | dragging
  
      chapterId: null,
      sourceEl: null,
  
      pointerType: null,
      pointerId: null,
  
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
  
      longPressTimer: 0,
  
      ghostEl: null,

      overFolderId: null,
      overFolderEl: null,
  
      autoScrollSpeed: 0,
      autoScrollRaf: 0,
  
      // click suppression window
      suppressClickUntil: 0,
  
      // locks
      pageLock: null,
      sidebarLock: null,
  
      // doc listeners attached?
      docAttached: false
    };
  
    function installGuardsOnce() {
      if (guardsInstalled) return;
      guardsInstalled = true;
  
      // 关键：拖拽时全局阻断“触摸滚动”和“滚轮滚动”
      addEvt(document, 'touchmove', function (e) {
        if (drag.mode === 'dragging') e.preventDefault();
      }, { passive: false, capture: true });
  
      addEvt(document, 'wheel', function (e) {
        if (drag.mode === 'dragging') e.preventDefault();
      }, { passive: false, capture: true });
  
      // iOS 上有时还会触发 gesture（缩放/双指），拖拽时直接禁掉
      addEvt(document, 'gesturestart', function (e) {
        if (drag.mode === 'dragging') e.preventDefault();
      }, { passive: false, capture: true });

      // 移动端长按可能触发 contextmenu（导致拖拽被系统打断）
      addEvt(document, 'contextmenu', function (e) {
        if (drag.mode !== 'idle') e.preventDefault();
      }, { passive: false, capture: true });

      addEvt(document, 'selectstart', function (e) {
        if (drag.mode !== 'idle') e.preventDefault();
      }, { passive: false, capture: true });
    }

    function bindDragStart(el, chapterId) {
      if (SUPPORT_POINTER) {
        addEvt(el, 'pointerdown', function (e) {
          if (e.button !== 0) return;
          // 触摸设备优先走 touchstart/touchmove（更可控；避免 PointerEvents 的 touch-action 限制）
          if ((e.pointerType || 'mouse') === 'touch') return;
          if (e.target && e.target.closest && e.target.closest('.action-icon')) return;
          var isHandle = !!(e.target && e.target.closest && e.target.closest('.drag-handle'));
          if (isHandle) e.preventDefault();
          beginPendingDrag(chapterId, el, e.pointerType || 'mouse', e.pointerId, e.clientX, e.clientY);
          if (isHandle) startDrag(e.clientX, e.clientY);
        }, { passive: false });

        // iOS/移动端：TouchEvents 更稳定
        addEvt(el, 'touchstart', function (e) {
          if (!e.touches || !e.touches[0]) return;
          if (e.target && e.target.closest && e.target.closest('.action-icon')) return;
          var isHandle = !!(e.target && e.target.closest && e.target.closest('.drag-handle'));
          if (isHandle) e.preventDefault();
          var t = e.touches[0];
          beginPendingDrag(chapterId, el, 'touch', 1, t.clientX, t.clientY);
          if (isHandle) startDrag(t.clientX, t.clientY);
        }, { passive: false });
      } else {
        // fallback: mouse + touch
        addEvt(el, 'mousedown', function (e) {
          if (e.button !== 0) return;
          if (e.target && e.target.closest && e.target.closest('.action-icon')) return;
          var isHandle = !!(e.target && e.target.closest && e.target.closest('.drag-handle'));
          beginPendingDrag(chapterId, el, 'mouse', 1, e.clientX, e.clientY);
          if (isHandle) startDrag(e.clientX, e.clientY);
        });

        addEvt(el, 'touchstart', function (e) {
          if (!e.touches || !e.touches[0]) return;
          var isHandle = !!(e.target && e.target.closest && e.target.closest('.drag-handle'));
          if (isHandle) e.preventDefault();
          var t = e.touches[0];
          beginPendingDrag(chapterId, el, 'touch', 1, t.clientX, t.clientY);
          if (isHandle) startDrag(t.clientX, t.clientY);
        }, { passive: false });
      }
    }

    function beginPendingDrag(chapterId, el, pointerType, pointerId, x, y) {
      if (drag.mode !== 'idle') return;
  
      drag.mode = 'pending';
      drag.chapterId = chapterId;
      drag.sourceEl = el;
      drag.pointerType = pointerType;
      drag.pointerId = pointerId;
      drag.startX = x;
      drag.startY = y;
      drag.lastX = x;
      drag.lastY = y;

      attachDocListeners();

      // PointerEvents：尽量捕获 pointer，避免移动端拖到元素外后丢事件
      if (SUPPORT_POINTER && el && el.setPointerCapture && pointerType === 'pen') {
        try { el.setPointerCapture(pointerId); } catch (err) {}
      }

      // touch/pen: long press to start
      if (pointerType === 'touch' || pointerType === 'pen') {
        drag.longPressTimer = window.setTimeout(function () {
          // 进入拖拽使用最新坐标（允许轻微微动）
          startDrag(drag.lastX, drag.lastY);
        }, LONG_PRESS_MS);
      } else {
        drag.longPressTimer = 0; // mouse no timer
      }
    }
  
    function attachDocListeners() {
      if (drag.docAttached) return;
      drag.docAttached = true;

      if (drag.pointerType === 'touch') {
        addEvt(document, 'touchmove', onDocTouchMove, { passive: false });
        addEvt(document, 'touchend', onDocTouchEnd, { passive: false });
        addEvt(document, 'touchcancel', onDocTouchEnd, { passive: false });
      } else if (SUPPORT_POINTER) {
        addEvt(document, 'pointermove', onDocPointerMove, { passive: false });
        addEvt(document, 'pointerup', onDocPointerUp, { passive: false });
        addEvt(document, 'pointercancel', onDocPointerUp, { passive: false });
      } else {
        addEvt(document, 'mousemove', onDocMouseMove);
        addEvt(document, 'mouseup', onDocMouseUp);
        addEvt(document, 'touchmove', onDocTouchMove, { passive: false });
        addEvt(document, 'touchend', onDocTouchEnd, { passive: false });
        addEvt(document, 'touchcancel', onDocTouchEnd, { passive: false });
      }
    }

    function detachDocListeners() {
      if (!drag.docAttached) return;
      drag.docAttached = false;

      // 直接清理所有可能的监听，避免 pointerType 先被置空导致漏卸载
      rmEvt(document, 'touchmove', onDocTouchMove, { passive: false });
      rmEvt(document, 'touchend', onDocTouchEnd, { passive: false });
      rmEvt(document, 'touchcancel', onDocTouchEnd, { passive: false });

      rmEvt(document, 'mousemove', onDocMouseMove);
      rmEvt(document, 'mouseup', onDocMouseUp);

      if (SUPPORT_POINTER) {
        rmEvt(document, 'pointermove', onDocPointerMove, { passive: false });
        rmEvt(document, 'pointerup', onDocPointerUp, { passive: false });
        rmEvt(document, 'pointercancel', onDocPointerUp, { passive: false });
      }
    }
  
    function dist(x1, y1, x2, y2) {
      var dx = x2 - x1, dy = y2 - y1;
      return Math.sqrt(dx * dx + dy * dy);
    }
  
    // PointerEvents path
    function onDocPointerMove(e) {
      if (drag.mode === 'idle') return;
      if (e.pointerId !== drag.pointerId) return;
  
      var x = e.clientX, y = e.clientY;
      drag.lastX = x; drag.lastY = y;
  
      if (drag.mode === 'pending') {
        if (drag.pointerType === 'touch' || drag.pointerType === 'pen') {
          if (dist(drag.startX, drag.startY, x, y) > TOUCH_CANCEL_THRESHOLD) {
            cancelPending();
          }
        } else {
          if (dist(drag.startX, drag.startY, x, y) > DRAG_MOUSE_THRESHOLD) {
            startDrag(x, y);
          }
        }
        return;
      }
  
      if (drag.mode === 'dragging') {
        e.preventDefault();
        onDragMove(x, y);
      }
    }
  
    function onDocPointerUp(e) {
      if (drag.mode === 'idle') return;
      if (e.pointerId !== drag.pointerId) return;
  
      if (drag.mode === 'pending') {
        cancelPending();
        return;
      }
      if (drag.mode === 'dragging') {
        finishDrag(e.clientX, e.clientY);
      }
    }
  
    // Fallback path (no PointerEvent)
    function onDocMouseMove(e) {
      if (drag.mode === 'idle') return;
      if (drag.pointerType !== 'mouse') return;
  
      var x = e.clientX, y = e.clientY;
      drag.lastX = x; drag.lastY = y;
  
      if (drag.mode === 'pending') {
        if (dist(drag.startX, drag.startY, x, y) > DRAG_MOUSE_THRESHOLD) startDrag(x, y);
        return;
      }
      if (drag.mode === 'dragging') onDragMove(x, y);
    }
  
    function onDocMouseUp(e) {
      if (drag.mode === 'idle') return;
      if (drag.pointerType !== 'mouse') return;
  
      if (drag.mode === 'pending') cancelPending();
      else if (drag.mode === 'dragging') finishDrag(e.clientX, e.clientY);
    }
  
    function onDocTouchMove(e) {
      if (drag.mode === 'idle') return;
      if (drag.pointerType !== 'touch') return;
      if (!e.touches || !e.touches[0]) return;
  
      var t = e.touches[0];
      var x = t.clientX, y = t.clientY;
      drag.lastX = x; drag.lastY = y;
  
      if (drag.mode === 'pending') {
        if (dist(drag.startX, drag.startY, x, y) > TOUCH_CANCEL_THRESHOLD) cancelPending();
        return;
      }
      if (drag.mode === 'dragging') {
        e.preventDefault();
        onDragMove(x, y);
      }
    }
  
    function onDocTouchEnd(e) {
      if (drag.mode === 'idle') return;
      if (drag.pointerType !== 'touch') return;
  
      var t = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
      var x = t ? t.clientX : drag.lastX;
      var y = t ? t.clientY : drag.lastY;
  
      if (drag.mode === 'pending') cancelPending();
      else if (drag.mode === 'dragging') finishDrag(x, y);
    }
  
    function cancelPending() {
      if (drag.longPressTimer) window.clearTimeout(drag.longPressTimer);
      drag.longPressTimer = 0;
  
      drag.mode = 'idle';
      drag.chapterId = null;
      drag.sourceEl = null;
      drag.pointerType = null;
      drag.pointerId = null;
  
      detachDocListeners();
    }
  
    function lockPageScrollIfTouch() {
      // 只在 touch/pen 时锁住页面（桌面鼠标拖拽不需要锁页面）
      if (!(drag.pointerType === 'touch' || drag.pointerType === 'pen')) return;
      if (drag.pageLock) return;
  
      var y = getScrollY();
      drag.pageLock = {
        scrollY: y,
        bodyPos: document.body.style.position,
        bodyTop: document.body.style.top,
        bodyLeft: document.body.style.left,
        bodyRight: document.body.style.right,
        bodyWidth: document.body.style.width,
        htmlOverflow: document.documentElement.style.overflow
      };
  
      // 组合拳：fixed body + html overflow hidden（对 iOS 更稳）
      document.documentElement.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = (-y) + 'px';
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
    }
  
    function unlockPageScrollIfTouch() {
      if (!drag.pageLock) return;
  
      var lock = drag.pageLock;
      drag.pageLock = null;
  
      document.documentElement.style.overflow = lock.htmlOverflow;
      document.body.style.position = lock.bodyPos;
      document.body.style.top = lock.bodyTop;
      document.body.style.left = lock.bodyLeft;
      document.body.style.right = lock.bodyRight;
      document.body.style.width = lock.bodyWidth;
  
      window.scrollTo(0, lock.scrollY);
    }
  
    function lockSidebarNativeScroll() {
      if (!els.sidebarList) return;
      if (drag.sidebarLock) return;
  
      drag.sidebarLock = {
        overflowY: els.sidebarList.style.overflowY,
        touchAction: els.sidebarList.style.touchAction,
        webkitOverflowScrolling: els.sidebarList.style.webkitOverflowScrolling
      };
  
      // 关键：拖拽中禁用原生滚动，全部由 JS 自动滚动接管
      els.sidebarList.style.overflowY = 'hidden';
      els.sidebarList.style.touchAction = 'none';
      els.sidebarList.style.webkitOverflowScrolling = 'auto';
    }
  
    function unlockSidebarNativeScroll() {
      if (!els.sidebarList) return;
      if (!drag.sidebarLock) return;
  
      var s = drag.sidebarLock;
      drag.sidebarLock = null;
  
      els.sidebarList.style.overflowY = s.overflowY;
      els.sidebarList.style.touchAction = s.touchAction;
      els.sidebarList.style.webkitOverflowScrolling = s.webkitOverflowScrolling;
    }
  
    function createGhost(title, widthHint) {
      var g = document.createElement('div');
      g.className = 'drag-ghost'; // 有 CSS 就用，没有也无所谓（我们用 inline）
      g.textContent = title || '拖拽中...';
  
      // inline 样式：不依赖你的 CSS
      g.style.position = 'fixed';
      g.style.left = '0';
      g.style.top = '0';
      g.style.zIndex = '9999';
      g.style.pointerEvents = 'none';
      g.style.background = '#fff';
      g.style.border = '1px solid #3498db';
      g.style.borderRadius = '8px';
      g.style.boxShadow = '0 10px 25px rgba(0,0,0,0.15)';
      g.style.padding = '10px 12px';
      g.style.fontSize = '14px';
      g.style.fontWeight = '600';
      g.style.opacity = '0.95';
      g.style.maxWidth = '260px';
      g.style.whiteSpace = 'nowrap';
      g.style.overflow = 'hidden';
      g.style.textOverflow = 'ellipsis';
      g.style.transform = 'translate3d(0,0,0)';
  
      if (widthHint) g.style.width = widthHint + 'px';
  
      document.body.appendChild(g);
      return g;
    }
  
    function updateGhostPosition(x, y) {
      if (!drag.ghostEl) return;
      var ox = 12, oy = 12;
      drag.ghostEl.style.transform = 'translate3d(' + (x + ox) + 'px,' + (y + oy) + 'px,0)';
    }
  
    function clearFolderHover() {
      if (drag.overFolderEl) {
        drag.overFolderEl.classList.remove('drag-target');
        drag.overFolderEl = null;
      }
      drag.overFolderId = null;
    }
  
    function hitTestFolder(x, y) {
      if (!els.sidebarList) return;
  
      // 只在侧边栏内部才显示投放反馈
      var sidebarRect = els.sidebar ? els.sidebar.getBoundingClientRect() : null;
      if (!sidebarRect || !pointInRect(x, y, sidebarRect)) {
        clearFolderHover();
        return;
      }
  
      // 避免 elementFromPoint 命中 ghost
      if (drag.ghostEl) drag.ghostEl.style.display = 'none';
      var elBelow = document.elementFromPoint(x, y);
      if (drag.ghostEl) drag.ghostEl.style.display = '';
  
      clearFolderHover();
      if (!elBelow) return;
  
      // 关键：拖到文件夹内部任意元素都算 -> 找最近的 folder-container
      var folderContainer = elBelow.closest('.folder-container');
      if (!folderContainer) return;
  
      folderContainer.classList.add('drag-target');
      drag.overFolderEl = folderContainer;
      drag.overFolderId = folderContainer.dataset.id || null;
    }
  
    function startAutoScrollIfNeeded(y) {
      if (!els.sidebarList) return;
      var rect = els.sidebarList.getBoundingClientRect();
  
      var speed = 0;
      if (y < rect.top + AUTO_SCROLL_EDGE) {
        var t1 = (rect.top + AUTO_SCROLL_EDGE - y) / AUTO_SCROLL_EDGE;
        speed = -Math.ceil(AUTO_SCROLL_MAX_SPEED * Math.min(1, t1));
      } else if (y > rect.bottom - AUTO_SCROLL_EDGE) {
        var t2 = (y - (rect.bottom - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE;
        speed = Math.ceil(AUTO_SCROLL_MAX_SPEED * Math.min(1, t2));
      }
  
      drag.autoScrollSpeed = speed;
  
      if (speed !== 0 && !drag.autoScrollRaf) {
        drag.autoScrollRaf = requestAnimationFrame(autoScrollTick);
      }
      if (speed === 0 && drag.autoScrollRaf) {
        cancelAnimationFrame(drag.autoScrollRaf);
        drag.autoScrollRaf = 0;
      }
    }
  
    function autoScrollTick() {
      if (drag.mode !== 'dragging' || !drag.autoScrollSpeed || !els.sidebarList) {
        drag.autoScrollRaf = 0;
        return;
      }
      els.sidebarList.scrollTop += drag.autoScrollSpeed;
  
      // 列表滚动时，手指不动也要刷新“命中目标”
      hitTestFolder(drag.lastX, drag.lastY);
  
      drag.autoScrollRaf = requestAnimationFrame(autoScrollTick);
    }
  
    function stopAutoScroll() {
      if (drag.autoScrollRaf) cancelAnimationFrame(drag.autoScrollRaf);
      drag.autoScrollRaf = 0;
      drag.autoScrollSpeed = 0;
    }
  
    function startDrag(x, y) {
      if (drag.mode !== 'pending') return;
  
      if (drag.longPressTimer) window.clearTimeout(drag.longPressTimer);
      drag.longPressTimer = 0;
  
      drag.mode = 'dragging';
      drag.suppressClickUntil = Date.now() + 450;
  
      // 振动反馈（支持则振）
      if ((drag.pointerType === 'touch' || drag.pointerType === 'pen') && navigator.vibrate) {
        navigator.vibrate(40);
      }
  
      lockPageScrollIfTouch();
      lockSidebarNativeScroll();

      // 源元素视觉反馈（用你原CSS的 dragging）
      if (drag.sourceEl) drag.sourceEl.classList.add('dragging-source');
  
      var titleEl = drag.sourceEl ? drag.sourceEl.querySelector('.item-title') : null;
      var title = titleEl ? titleEl.textContent : '';
      var widthHint = drag.sourceEl ? drag.sourceEl.getBoundingClientRect().width : null;
      drag.ghostEl = createGhost(title, widthHint);
  
      updateGhostPosition(x, y);
      hitTestFolder(x, y);
      startAutoScrollIfNeeded(y);
    }
  
    function onDragMove(x, y) {
      updateGhostPosition(x, y);
      hitTestFolder(x, y);
      startAutoScrollIfNeeded(y);
    }
  
    function finishDrag(x, y) {
      var chapterId = drag.chapterId;
      var targetFolderId = drag.overFolderId;
  
      var sidebarRect = els.sidebar ? els.sidebar.getBoundingClientRect() : null;
      var droppedInSidebar = sidebarRect ? pointInRect(x, y, sidebarRect) : false;
  
      // 先清理 UI（避免 renderSidebar 时残留 ghost/锁）
      cleanupDragUI();
  
      if (droppedInSidebar && chapterId) {
        var book = getActiveBook();
        if (targetFolderId) {
          if (!book.layoutMap) book.layoutMap = {};
          book.layoutMap[chapterId] = targetFolderId;
        } else {
          // 根目录
          if (book.layoutMap && book.layoutMap[chapterId]) delete book.layoutMap[chapterId];
        }
        saveData();
        renderSidebar();
      }
  
      resetDragState();
    }
  
    function cleanupDragUI() {
      stopAutoScroll();
      clearFolderHover();
  
      if (drag.ghostEl && drag.ghostEl.parentNode) drag.ghostEl.parentNode.removeChild(drag.ghostEl);
      drag.ghostEl = null;

      if (drag.sourceEl) drag.sourceEl.classList.remove('dragging-source');
  
      unlockSidebarNativeScroll();
      unlockPageScrollIfTouch();
    }
  
    function resetDragState() {
      if (drag.longPressTimer) window.clearTimeout(drag.longPressTimer);
      drag.longPressTimer = 0;
  
      drag.mode = 'idle';
      drag.chapterId = null;
      drag.sourceEl = null;
      drag.pointerType = null;
      drag.pointerId = null;
  
      drag.startX = drag.startY = drag.lastX = drag.lastY = 0;
      drag.overFolderId = null;
      drag.overFolderEl = null;

      detachDocListeners();
    }
  
    /** ---------------------------
     * 11) JSON 导入（支持多文件夹/多sheet完整结构）
     * --------------------------- */
    function looksLikeSingleSheet(obj) {
      return isObject(obj) && typeof obj.title === 'string' && Array.isArray(obj.questions);
    }
  
    function normalizeSheetObj(obj, preferId) {
      var out = {
        id: (preferId && typeof obj.id === 'string') ? obj.id : uid('local'),
        title: (obj.title || obj.name || obj.sheetName || '未命名章节'),
        questions: Array.isArray(obj.questions) ? obj.questions : [],
        isStatic: false
      };
      return out;
    }
  
    function normalizeFolderObj(obj, preferId) {
      return {
        id: (preferId && typeof obj.id === 'string') ? obj.id : uid('f'),
        title: (obj.title || obj.name || '未命名文件夹'),
        isOpen: (typeof obj.isOpen === 'boolean') ? obj.isOpen : true
      };
    }
  
    // 将各种输入 JSON 形态“抽象成一个库结构”
    function buildLibraryFromAnyJSON(raw) {
      // unwrap 常见壳
      if (isObject(raw) && isObject(raw.appData)) raw = raw.appData;
      if (isObject(raw) && isObject(raw.data)) raw = raw.data;
  
      // 1) 单 sheet
      if (looksLikeSingleSheet(raw)) {
        return {
          kind: 'single',
          folders: [],
          chapters: [ normalizeSheetObj(raw, false) ],
          layoutMap: {},
          deletedChapterIds: []
        };
      }
  
      // 2) 纯数组 sheets
      if (Array.isArray(raw)) {
        var allOk = true;
        for (var i = 0; i < raw.length; i++) {
          if (!looksLikeSingleSheet(raw[i])) { allOk = false; break; }
        }
        if (allOk) {
          var list = [];
          for (var j = 0; j < raw.length; j++) list.push(normalizeSheetObj(raw[j], false));
          return { kind: 'list', folders: [], chapters: list, layoutMap: {}, deletedChapterIds: [] };
        }
      }

      // 3) 完整结构：带 folders + layoutMap / deleted 等（优先识别）
      if (isObject(raw) && Array.isArray(raw.folders) && (Array.isArray(raw.chapters) || Array.isArray(raw.sheets))) {
        var fullSheets = raw.chapters || raw.sheets;
        var hasLayoutMap = isObject(raw.layoutMap);
        var hasDeleted = Array.isArray(raw.deletedChapterIds) || Array.isArray(raw.deleted);

        if (hasLayoutMap || hasDeleted) {
          // 注意：这里优先“保留 id”，但后续会做去重与 remap
          return {
            kind: 'fullState',
            folders: raw.folders,
            chapters: fullSheets,
            layoutMap: raw.layoutMap || {},
            deletedChapterIds: raw.deletedChapterIds || raw.deleted || []
          };
        }
      }

      // 4) 文件夹树：folders:[{title, sheets:[...]}, ...] + (可选) 根 sheets
      // 注意：如果同时存在根 sheets 和 folders，也应按 tree 解析（避免 folders 被忽略）
      if (isObject(raw) && Array.isArray(raw.folders)) {
        var foldersIn = raw.folders;
        var outFolders = [];
        var outChapters = [];
        var outMap = {};

        for (var fi = 0; fi < foldersIn.length; fi++) {
          var fin = foldersIn[fi] || {};
          var folderObj = normalizeFolderObj(fin, false);
          outFolders.push(folderObj);

          var sheets = fin.sheets || fin.chapters || fin.items || [];
          if (Array.isArray(sheets)) {
            for (var si = 0; si < sheets.length; si++) {
              var sin = sheets[si];
              if (!isObject(sin)) continue;
              // 允许 sheet 既是 {title,questions} 也可能是别名字段
              if (sin.title || sin.name || sin.sheetName) {
                var chObj = normalizeSheetObj({
                  title: sin.title || sin.name || sin.sheetName,
                  questions: Array.isArray(sin.questions) ? sin.questions : (Array.isArray(sin.items) ? sin.items : [])
                }, false);
                outChapters.push(chObj);
                outMap[chObj.id] = folderObj.id;
              }
            }
          }
        }

        // 根目录 sheets（可选）
        var roots = raw.sheets || raw.chapters || [];
        if (Array.isArray(roots)) {
          for (var ri = 0; ri < roots.length; ri++) {
            if (!isObject(roots[ri])) continue;
            if (roots[ri].title || roots[ri].name || roots[ri].sheetName) {
              outChapters.push(normalizeSheetObj(roots[ri], false));
            }
          }
        }

        return { kind: 'tree', folders: outFolders, chapters: outChapters, layoutMap: outMap, deletedChapterIds: [] };
      }

      // 5) 多 sheet（chapters / sheets）- 无 folders 的纯列表
      if (isObject(raw) && (Array.isArray(raw.chapters) || Array.isArray(raw.sheets))) {
        var rootSheets = raw.chapters || raw.sheets;
        var list2 = [];
        for (var k = 0; k < rootSheets.length; k++) {
          if (looksLikeSingleSheet(rootSheets[k]) || isObject(rootSheets[k])) {
            list2.push(normalizeSheetObj(rootSheets[k], false));
          }
        }
        return { kind: 'list', folders: [], chapters: list2, layoutMap: {}, deletedChapterIds: [] };
      }

      return null;
    }
  
    function makeUniqueIdsForImport(lib, overwrite, book) {
      // 目标：避免 chapter/folder 的 id 与 static_* 冲突，避免与现有 local 冲突（merge时）
      // 规则：对导入的 folders/chapters 统一做“去重+重映射”，保持 layoutMap 正确。
      var usedChapterIds = {};
      var usedFolderIds = {};
  
      // static ids always occupied
      if (book && book.includePresets) {
        for (var i = 0; i < staticData.length; i++) usedChapterIds[staticData[i].id] = true;
      }
  
      // merge 时：已有 local/folder 也占用
      if (!overwrite) {
        for (var j = 0; j < ((book && book.chapters) ? book.chapters : []).length; j++) usedChapterIds[book.chapters[j].id] = true;
        for (var k = 0; k < ((book && book.folders) ? book.folders : []).length; k++) usedFolderIds[book.folders[k].id] = true;
      }
  
      var folderIdMap = {}; // old -> new
      var chapterIdMap = {}; // old -> new
  
      // folders
      var newFolders = [];
      for (var f = 0; f < (lib.folders || []).length; f++) {
        var fin = lib.folders[f] || {};
        var oldFid = (typeof fin.id === 'string') ? fin.id : uid('f');
        var nid = oldFid;
  
        while (usedFolderIds[nid]) nid = uid('f');
        usedFolderIds[nid] = true;
        folderIdMap[oldFid] = nid;
  
        newFolders.push(normalizeFolderObj({ id: nid, title: fin.title || fin.name, isOpen: fin.isOpen }, true));
      }
  
      // chapters
      var newChapters = [];
      for (var c = 0; c < (lib.chapters || []).length; c++) {
        var cin = lib.chapters[c] || {};
        var oldCid = (typeof cin.id === 'string') ? cin.id : uid('local');
        var cid = oldCid;
  
        while (usedChapterIds[cid]) cid = uid('local');
        usedChapterIds[cid] = true;
        chapterIdMap[oldCid] = cid;
  
        newChapters.push(normalizeSheetObj({
          id: cid,
          title: cin.title || cin.name || cin.sheetName,
          questions: cin.questions
        }, true));
      }
  
      // layout remap
      var newLayoutMap = {};
      var lm = lib.layoutMap || {};
      for (var oldCh in lm) {
        if (!lm.hasOwnProperty(oldCh)) continue;
        var oldFolder = lm[oldCh];
  
        var mappedCh = chapterIdMap[oldCh];
        var mappedFolder = folderIdMap[oldFolder];
  
        // 如果导入结构中 layoutMap 指向的 folder 不在本次导入 folders 里，也可能是根目录/无效 -> 忽略
        if (mappedCh && mappedFolder) newLayoutMap[mappedCh] = mappedFolder;
      }
  
      // deleted ids remap（如果导入提供了）
      var newDeleted = [];
      var del = lib.deletedChapterIds || [];
      for (var d = 0; d < del.length; d++) {
        var did = del[d];
        if (chapterIdMap[did]) newDeleted.push(chapterIdMap[did]);
        else newDeleted.push(did); // 静态章节删除可能直接是 static_*
      }
  
      return {
        folders: newFolders,
        chapters: newChapters,
        layoutMap: newLayoutMap,
        deletedChapterIds: newDeleted
      };
    }
  
    function importAnyJSON(payload) {
      var lib = buildLibraryFromAnyJSON(payload);
      if (!lib) {
        alert('未识别的JSON结构。\n支持：单章节/多章节/文件夹树/完整结构');
        return;
      }
      var book = getActiveBook();
  
      // 单章节：直接追加并打开
      if (lib.kind === 'single') {
        var one = lib.chapters[0];
        book.chapters.push(one);
        saveData();
        renderSidebar();
        loadChapter(one.id);
        return;
      }
  
      // 多结构：询问覆盖 or 追加
      var overwrite = confirm('检测到多文件夹/多章节结构。\n确定=覆盖当前本地题库\n取消=追加到当前题库');
      var normalized = makeUniqueIdsForImport(lib, overwrite, book);
  
      if (overwrite) {
        book.folders = normalized.folders;
        book.chapters = normalized.chapters;
        book.layoutMap = normalized.layoutMap;
        book.deletedChapterIds = normalized.deletedChapterIds || [];
  
        currentChapterId = null;
        if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
        if (els.questionsContainer) els.questionsContainer.innerHTML = '';
  
        saveData();
        renderSidebar();
        return;
      }
  
      // merge
      for (var i = 0; i < normalized.folders.length; i++) book.folders.push(normalized.folders[i]);
      for (var j = 0; j < normalized.chapters.length; j++) book.chapters.push(normalized.chapters[j]);
      for (var chId in normalized.layoutMap) {
        if (normalized.layoutMap.hasOwnProperty(chId)) book.layoutMap[chId] = normalized.layoutMap[chId];
      }
      // deleted: 合并（去重）
      if (!book.deletedChapterIds) book.deletedChapterIds = [];
      for (var d = 0; d < (normalized.deletedChapterIds || []).length; d++) {
        var did = normalized.deletedChapterIds[d];
        if (book.deletedChapterIds.indexOf(did) === -1) book.deletedChapterIds.push(did);
      }
  
      saveData();
      renderSidebar();
    }

    function importBookFromJSON(payload, fileNameHint) {
      payload = (payload && typeof payload === 'object') ? payload : null;
      if (!payload) { showToast('JSON无效', { timeoutMs: 2000 }); return false; }

      // 1) Whole app export (books[])
      if (Array.isArray(payload.books)) {
        var imported = 0;
        for (var i = 0; i < payload.books.length; i++) {
          var b = payload.books[i];
          if (!b || typeof b !== 'object') continue;
          var lib = {
            folders: Array.isArray(b.folders) ? b.folders : [],
            chapters: Array.isArray(b.chapters) ? b.chapters : [],
            layoutMap: (b.layoutMap && typeof b.layoutMap === 'object' && !Array.isArray(b.layoutMap)) ? b.layoutMap : {},
            deletedChapterIds: Array.isArray(b.deletedChapterIds) ? b.deletedChapterIds : []
          };
          var normalized = makeUniqueIdsForImport(lib, true, { includePresets: false });
          var title = (typeof b.title === 'string' && b.title.trim()) ? b.title.trim() : ('导入书 ' + (imported + 1));
          var nb = makeBookFromLibrary(normalized, title, !!b.includePresets);
          nb.theme = (typeof b.theme === 'string') ? b.theme : 'blue';
          nb.icon = (typeof b.icon === 'string') ? b.icon : '📚';
          nb = normalizeBook(nb);
          getBooks().push(nb);
          imported++;
        }
        if (!imported) { showToast('未找到可导入的书', { timeoutMs: 2200 }); return false; }
        appData.currentBookId = getBooks()[getBooks().length - 1].id;
        saveData();
        if (homeVisible) renderHome();
        showToast('已导入 ' + imported + ' 本书', { timeoutMs: 2400 });
        return true;
      }

      // 2) Seed wrapper / legacy exports may put library under `.data`
      var data = (payload.data && typeof payload.data === 'object') ? payload.data : payload;
      var lib2 = buildLibraryFromAnyJSON(data);
      if (!lib2) { showToast('未识别的书JSON', { timeoutMs: 2200 }); return false; }

      var normalized2 = makeUniqueIdsForImport(lib2, true, { includePresets: false });

      var hint = (typeof fileNameHint === 'string') ? fileNameHint : '';
      hint = hint.replace(/\\.json$/i, '').trim();
      var title2 = (typeof payload.bookTitle === 'string' && payload.bookTitle.trim())
        ? payload.bookTitle.trim()
        : ((typeof payload.title === 'string' && payload.title.trim()) ? payload.title.trim() : (hint || '导入书'));

      var book2 = makeBookFromLibrary(normalized2, title2, false);
      book2.theme = (typeof payload.theme === 'string') ? payload.theme : 'blue';
      book2.icon = (typeof payload.icon === 'string') ? payload.icon : '📚';
      book2 = normalizeBook(book2);
      getBooks().push(book2);
      appData.currentBookId = book2.id;
      saveData();
      if (homeVisible) renderHome();
      showToast('已导入：' + title2, { timeoutMs: 2400 });
      return true;
    }
  
    /** ---------------------------
     * 12) UI 绑定
     * --------------------------- */
    function bindUIOnce() {
      if (uiBound) return;
      uiBound = true;

      function isCompactLayout() {
        var coarse = false;
        try { coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (_) { coarse = false; }
        return window.innerWidth <= 1024 || coarse;
      }

      function openSidebar() {
        if (!els.sidebar) return;
        if (isCompactLayout()) els.sidebar.classList.add('active');
        else document.body.classList.remove('sidebar-collapsed');
      }
      function closeSidebar() {
        if (!els.sidebar) return;
        if (isCompactLayout()) els.sidebar.classList.remove('active');
        else document.body.classList.add('sidebar-collapsed');
      }
      function toggleSidebar() {
        if (!els.sidebar) return;
        if (isCompactLayout()) els.sidebar.classList.toggle('active');
        else document.body.classList.toggle('sidebar-collapsed');
      }

      function updateCollapseIcon() {
        if (!els.sidebarCollapseBtn) return;
        var i = els.sidebarCollapseBtn.querySelector('i');
        if (!i) return;
        if (isCompactLayout()) {
          i.className = 'fa-solid fa-bars';
          els.sidebarCollapseBtn.title = '菜单';
          return;
        }
        var collapsed = document.body.classList.contains('sidebar-collapsed');
        i.className = collapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left';
        els.sidebarCollapseBtn.title = collapsed ? '展开侧边栏' : '折叠侧边栏';
      }

      // 菜单
      if (els.menuToggle && els.sidebar) els.menuToggle.onclick = toggleSidebar;
      if (els.homeBtn) {
        els.homeBtn.onclick = function () {
          showHomeView();
          if (els.sidebar && isCompactLayout()) els.sidebar.classList.remove('active');
        };
      }
      if (els.sidebarHomeTopBtn) {
        els.sidebarHomeTopBtn.onclick = function () {
          showHomeView();
          if (els.sidebar && isCompactLayout()) els.sidebar.classList.remove('active');
        };
      }

      // Home HUD shortcuts (sync / saves / settings)
      if (els.homeSyncBtn) {
        els.homeSyncBtn.onclick = function () {
          updateAuthModalUI();
          switchSyncTab('account');
          if (els.authModal) els.authModal.classList.add('open');
        };
      }
      if (els.homeSavesBtn) {
        els.homeSavesBtn.onclick = function () {
          updateAuthModalUI();
          switchSyncTab(getToken() ? 'saves' : 'account');
          if (els.authModal) els.authModal.classList.add('open');
        };
      }
      if (els.homeSettingsBtn) {
        els.homeSettingsBtn.onclick = function () {
          if (!els.settingsModal) return;
          populateSettingsUi();
          els.settingsModal.classList.add('open');
        };
      }
      if (els.sidebarOverlay && els.sidebar) {
        els.sidebarOverlay.onclick = function () {
          if (isCompactLayout()) els.sidebar.classList.remove('active');
        };
      }
      if (els.sidebarCollapseBtn) {
        els.sidebarCollapseBtn.onclick = function () {
          if (isCompactLayout()) toggleSidebar();
          else document.body.classList.toggle('sidebar-collapsed');
          updateCollapseIcon();
        };
        updateCollapseIcon();
      }

      // 可拖动汉堡按钮（移动端/平板更顺手）
      if (els.fabMenu) {
        var FAB_KEY = 'hzr_fab_pos_v1';
        var fabDrag = { active: false, moved: false, pid: null, startX: 0, startY: 0, left: 0, top: 0 };

        function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
        function placeFab(left, top) {
          var w = 52, h = 52;
          var maxL = Math.max(0, window.innerWidth - w - 8);
          var maxT = Math.max(0, window.innerHeight - h - 8);
          var l = clamp(left, 8, maxL);
          var t = clamp(top, 8, maxT);
          els.fabMenu.style.left = l + 'px';
          els.fabMenu.style.top = t + 'px';
          els.fabMenu.style.right = 'auto';
          els.fabMenu.style.bottom = 'auto';
          return { left: l, top: t };
        }

        try {
          var saved = localStorage.getItem(FAB_KEY);
          if (saved) {
            var p = JSON.parse(saved);
            if (p && typeof p.left === 'number' && typeof p.top === 'number') placeFab(p.left, p.top);
          }
        } catch (e) {}

        addEvt(els.fabMenu, 'pointerdown', function (e) {
          fabDrag.active = true;
          fabDrag.moved = false;
          fabDrag.pid = e.pointerId;
          fabDrag.startX = e.clientX;
          fabDrag.startY = e.clientY;
          var rect = els.fabMenu.getBoundingClientRect();
          fabDrag.left = rect.left;
          fabDrag.top = rect.top;
          try { els.fabMenu.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
        }, { passive: false });

        addEvt(els.fabMenu, 'pointermove', function (e) {
          if (!fabDrag.active || fabDrag.pid !== e.pointerId) return;
          var dx = e.clientX - fabDrag.startX;
          var dy = e.clientY - fabDrag.startY;
          if (!fabDrag.moved && (Math.abs(dx) + Math.abs(dy) > 6)) fabDrag.moved = true;
          if (!fabDrag.moved) return;
          var pos = placeFab(fabDrag.left + dx, fabDrag.top + dy);
          try { localStorage.setItem(FAB_KEY, JSON.stringify(pos)); } catch (_) {}
        }, { passive: false });

        function endFab(e) {
          if (!fabDrag.active || fabDrag.pid !== e.pointerId) return;
          fabDrag.active = false;
          try { els.fabMenu.releasePointerCapture(e.pointerId); } catch (_) {}
          if (!fabDrag.moved) {
            // Home page: use the same draggable hamburger as a HUD toggle
            if (homeVisible) {
              try {
                var hud = document.querySelector('.home-hud');
                if (hud && hud.classList) hud.classList.toggle('collapsed');
              } catch (_) {}
              return;
            }
            toggleSidebar();
          }
        }
        addEvt(els.fabMenu, 'pointerup', endFab, { passive: true });
        addEvt(els.fabMenu, 'pointercancel', endFab, { passive: true });
      }

      // 点击空白立即收起 toast（但不影响 toast 按钮）
      addEvt(document, 'pointerdown', function (e) {
        if (!toastState.el) return;
        if (e.target && e.target.closest && e.target.closest('.toast-btn')) return;
        hideToast();
      }, { passive: true, capture: true });

      // 点击遮罩/空白关闭弹窗
      function bindOverlayClose(modalEl) {
        if (!modalEl) return;
        modalEl.addEventListener('click', function (e) {
          if (e.target !== modalEl) return;
          modalEl.classList.remove('open');
        }, false);
      }
      bindOverlayClose(els.importModal);
      bindOverlayClose(els.folderModal);
      bindOverlayClose(els.bookModal);
      bindOverlayClose(els.authModal);
      bindOverlayClose(els.settingsModal);
      bindOverlayClose(els.aiChatModal);
      bindOverlayClose(els.aiImportModal);
      bindOverlayClose(els.aiHistoryModal);

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
      if (els.aiChatSendBtn) {
        els.aiChatSendBtn.onclick = function () { sendAiChatMessage(); };
      }
      if (els.aiChatInput) {
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
      if (els.aiImportStartBtn) {
        els.aiImportStartBtn.onclick = function () { startAiImport(); };
      }
      if (els.aiImportFilesInput) {
        els.aiImportFilesInput.onchange = function () {
          try { addAiImportFiles(els.aiImportFilesInput.files); } catch (_) {}
          try { els.aiImportFilesInput.value = ''; } catch (_) {}
        };
      }
      if (els.aiImportFilesList) {
        els.aiImportFilesList.addEventListener('click', function (e) {
          var t = e && e.target ? e.target : null;
          if (!t || !t.closest) return;
          var item = t.closest('.ai-import-file');
          if (!item) return;
          var idx = item && item.dataset ? Number(item.dataset.idx) : NaN;
          if (!Number.isFinite(idx)) return;

          if (t.closest('.ai-import-file-remove')) {
            var removed = aiImport.files[idx];
            if (removed && removed.url) { try { URL.revokeObjectURL(removed.url); } catch (_) {} }
            aiImport.files.splice(idx, 1);
            renderAiImportFiles();
            return;
          }

          if (t.closest('.ai-import-move-up')) {
            if (idx <= 0) return;
            var tmp = aiImport.files[idx - 1];
            aiImport.files[idx - 1] = aiImport.files[idx];
            aiImport.files[idx] = tmp;
            renderAiImportFiles();
            return;
          }

          if (t.closest('.ai-import-move-down')) {
            if (idx >= aiImport.files.length - 1) return;
            var tmp2 = aiImport.files[idx + 1];
            aiImport.files[idx + 1] = aiImport.files[idx];
            aiImport.files[idx] = tmp2;
            renderAiImportFiles();
            return;
          }
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
          openAiChatModal();
          setAiChatHint('加载对话…');
          loadAiConversation(id).then(function () { setAiChatHint(''); }).catch(function () { setAiChatHint('加载失败'); });
        }, false);
      }

      // Selection -> floating "ask AI" button
      addEvt(document, 'selectionchange', scheduleAiSelUpdate, { passive: true });
      addEvt(document, 'pointerup', scheduleAiSelUpdate, { passive: true });
      addEvt(window, 'scroll', hideAiSelBtn, { passive: true });

      // ESC：关闭 toast + 弹窗 + 侧边栏（移动端）
      addEvt(document, 'keydown', function (e) {
        if (!e || e.key !== 'Escape') return;
        hideToast();
        if (els.importModal) els.importModal.classList.remove('open');
        if (els.authModal) els.authModal.classList.remove('open');
        if (els.settingsModal) els.settingsModal.classList.remove('open');
        if (els.aiChatModal) els.aiChatModal.classList.remove('open');
        if (els.aiImportModal) els.aiImportModal.classList.remove('open');
        if (els.aiHistoryModal) els.aiHistoryModal.classList.remove('open');
        if (els.sidebar && isCompactLayout()) els.sidebar.classList.remove('active');
      }, { passive: true });

      // 新建文件夹
      if (els.addFolderBtn) {
        els.addFolderBtn.onclick = function () {
          // 桌面折叠态下用户看不到列表，先自动展开
          if (!isCompactLayout() && document.body.classList.contains('sidebar-collapsed')) {
            document.body.classList.remove('sidebar-collapsed');
            updateCollapseIcon();
          }
          if (!els.folderModal) return;
          if (els.folderNameInput) els.folderNameInput.value = '';
          els.folderModal.classList.add('open');
          try { if (els.folderNameInput) els.folderNameInput.focus(); } catch (_) {}
        };
      }

      // 新建书（主页）
      function openCreateBookModal() { openBookModalWithMode('create', null); }

      function submitBookModal() {
        var title = (els.bookNameInput && typeof els.bookNameInput.value === 'string') ? els.bookNameInput.value.trim() : '';
        if (!title) { showToast('请输入书名', { timeoutMs: 1800 }); return; }

        // Create
        if (bookModalMode !== 'rename') {
          var book = makeBookFromLibrary({ chapters: [], folders: [], layoutMap: {}, deletedChapterIds: [] }, title, false);
          book.theme = bookModalTheme;
          book.icon = bookModalIcon;
          book = normalizeBook(book);
          getBooks().push(book);
          appData.currentBookId = book.id;
          saveData();
          if (els.bookModal) els.bookModal.classList.remove('open');
          hideHomeView();
          renderSidebar();
          if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
          if (els.questionsContainer) els.questionsContainer.innerHTML = '';
          showToast('已创建：' + title, { timeoutMs: 2400 });
          return;
        }

        // Rename / edit appearance
        var books = getBooks();
        for (var i = 0; i < books.length; i++) {
          if (books[i] && books[i].id === bookModalTargetId) {
            books[i].title = title;
            books[i].theme = bookModalTheme;
            books[i].icon = bookModalIcon;
            books[i].updatedAt = new Date().toISOString();
            saveData();
            if (els.bookModal) els.bookModal.classList.remove('open');
            if (homeVisible) renderHome();
            renderSidebar();
            showToast('已保存：' + title, { timeoutMs: 2200 });
            return;
          }
        }

        showToast('未找到要编辑的书', { timeoutMs: 2400 });
      }

      if (els.newBookBtn) els.newBookBtn.onclick = openCreateBookModal;
      if (els.importBookBtn) {
        els.importBookBtn.onclick = function () {
          try {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.onchange = function (e) {
              var f = e && e.target && e.target.files ? e.target.files[0] : null;
              if (!f) return;
              var r = new FileReader();
              r.onload = function (ev) {
                try {
                  var data = JSON.parse(ev.target.result);
                  var ok = importBookFromJSON(data, f.name);
                  if (ok) {
                    // After import: open the book immediately (no extra dialogs)
                    hideHomeView();
                    renderSidebar();
                    if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
                    if (els.questionsContainer) els.questionsContainer.innerHTML = '';
                  }
                } catch (err) {
                  showToast('JSON解析失败', { timeoutMs: 2200 });
                }
              };
              r.readAsText(f);
              input.value = '';
            };
            input.click();
          } catch (e) {
            showToast('导入失败', { timeoutMs: 2200 });
          }
        };
      }
      if (els.bookCancelBtn && els.bookModal) els.bookCancelBtn.onclick = function () { els.bookModal.classList.remove('open'); };
      if (els.bookCreateBtn) els.bookCreateBtn.onclick = submitBookModal;
      if (els.bookNameInput) els.bookNameInput.addEventListener('keydown', function (e) { if (e && e.key === 'Enter') submitBookModal(); });

      function switchImportTab(which) {
        if (!els.importPaneFile || !els.importPanePaste) return;
        var isFile = which !== 'paste';
        els.importPaneFile.style.display = isFile ? '' : 'none';
        els.importPanePaste.style.display = isFile ? 'none' : '';
        if (els.importTabFile) els.importTabFile.classList.toggle('active', isFile);
        if (els.importTabPaste) els.importTabPaste.classList.toggle('active', !isFile);
      }

      if (els.importBtn && els.importModal) {
        els.importBtn.onclick = function () {
          switchImportTab('file');
          els.importModal.classList.add('open');
        };
      }
      if (els.importTabFile) els.importTabFile.onclick = function () { switchImportTab('file'); };
      if (els.importTabPaste) els.importTabPaste.onclick = function () { switchImportTab('paste'); };
      if (els.closeImportBtn && els.importModal) els.closeImportBtn.onclick = function () { els.importModal.classList.remove('open'); };

      if (els.importFileInput) {
        els.importFileInput.onchange = function (e) {
          var f = e.target.files && e.target.files[0];
          if (!f) return;
          var r = new FileReader();
          r.onload = function (ev) {
            try {
              var data = JSON.parse(ev.target.result);
              importAnyJSON(data);
              if (els.importModal) els.importModal.classList.remove('open');
            } catch (err) {
              alert('文件无效');
            }
          };
          r.readAsText(f);
          els.importFileInput.value = '';
        };
      }

      if (els.cancelImportBtn && els.importModal) {
        els.cancelImportBtn.onclick = function () { els.importModal.classList.remove('open'); };
      }
      if (els.confirmImportBtn && els.importTextarea && els.importModal) {
        els.confirmImportBtn.onclick = function () {
          try {
            var data = JSON.parse(els.importTextarea.value);
            importAnyJSON(data);
            els.importModal.classList.remove('open');
            els.importTextarea.value = '';
          } catch (e) {
            alert('JSON解析失败');
          }
        };
      }

      function createFolderFromModal() {
        var title = (els.folderNameInput && typeof els.folderNameInput.value === 'string') ? els.folderNameInput.value.trim() : '';
        if (!title) {
          showToast('请输入文件夹名称', { timeoutMs: 1800 });
          return;
        }
        var book = getActiveBook();
        book.folders.push({ id: uid('f'), title: title, isOpen: true });
        saveData();
        renderSidebar();
        if (els.folderModal) els.folderModal.classList.remove('open');
        showToast('已创建文件夹：' + title, { timeoutMs: 2200 });
      }

      if (els.folderCancelBtn && els.folderModal) els.folderCancelBtn.onclick = function () { els.folderModal.classList.remove('open'); };
      if (els.folderCreateBtn) els.folderCreateBtn.onclick = createFolderFromModal;
      if (els.folderNameInput) {
        els.folderNameInput.addEventListener('keydown', function (e) {
          if (e && e.key === 'Enter') createFolderFromModal();
        });
      }

      // 设置
      if (els.settingsBtn) {
        els.settingsBtn.onclick = function () {
          if (!els.settingsModal) return;
          populateSettingsUi();
          if (els.resetHint) els.resetHint.textContent = '';
          if (els.resetToDefaultBtn) els.resetToDefaultBtn.textContent = '重置到默认';
          els.settingsModal.classList.add('open');
        };
      }

      if (els.settingsCloseBtn && els.settingsModal) {
        els.settingsCloseBtn.onclick = function () { els.settingsModal.classList.remove('open'); };
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
        };
      }

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

      // 同步/账号
      if (els.syncBtn && els.authModal) {
        els.syncBtn.onclick = function () {
          updateAuthModalUI();
          // 默认：未登录先看账号；已登录直接看存档
          switchSyncTab(getToken() ? 'saves' : 'account');
          els.authModal.classList.add('open');
        };
      }

      if (els.savesCloseBtn && els.authModal) els.savesCloseBtn.onclick = function () { els.authModal.classList.remove('open'); };

      function updateAuthModalUI() {
        if (!els.authModal) return;
        var loggedIn = !!getToken();
        if (els.authLogoutBtn) els.authLogoutBtn.style.display = loggedIn ? 'inline-block' : 'none';
        if (els.authHint) {
          if (!loggedIn) els.authHint.textContent = '登录后可跨设备同步，并提供自动/手动存档。';
          else if (cloud.bootstrapFailed) els.authHint.textContent = '已登录：同步初始化失败（不会上传本机）。请检查网络/反代配置后重试。';
          else if (!cloud.bootstrapDone) els.authHint.textContent = '已登录：正在从云端拉取数据…（不会上传本机）';
          else if (!cloud.syncEnabled) els.authHint.textContent = '已登录：云同步未启用（为防误覆盖，不会自动上传本机）。';
          else els.authHint.textContent = '已登录：默认拉取云端；之后改动会自动同步到云端（云端每5分钟自动备份）。';
        }

        // Logged-in users should not see the login/register form (avoid confusion).
        if (els.authTabLogin) els.authTabLogin.style.display = loggedIn ? 'none' : '';
        if (els.authTabRegister) els.authTabRegister.style.display = loggedIn ? 'none' : '';
        if (els.authUsername) els.authUsername.style.display = loggedIn ? 'none' : '';
        if (els.authPassword) els.authPassword.style.display = loggedIn ? 'none' : '';
        if (els.authSubmitBtn) els.authSubmitBtn.style.display = loggedIn ? 'none' : '';

        if (els.authTabLogin) els.authTabLogin.classList.toggle('primary', cloud.authMode === 'login');
        if (els.authTabRegister) els.authTabRegister.classList.toggle('primary', cloud.authMode === 'register');

        if (els.syncTabSaves) {
          els.syncTabSaves.disabled = !loggedIn;
          els.syncTabSaves.style.opacity = loggedIn ? '1' : '0.5';
          els.syncTabSaves.style.cursor = loggedIn ? 'pointer' : 'not-allowed';
        }

        if (els.syncEnableRow) {
          var show = loggedIn && cloud.bootstrapDone && !cloud.syncEnabled;
          els.syncEnableRow.style.display = show ? '' : 'none';
          if (els.enableSyncHint) els.enableSyncHint.textContent = '';
        }
      }

      if (els.authTabLogin) els.authTabLogin.onclick = function () { cloud.authMode = 'login'; updateAuthModalUI(); };
      if (els.authTabRegister) els.authTabRegister.onclick = function () { cloud.authMode = 'register'; updateAuthModalUI(); };

      function switchSyncTab(which) {
        if (!els.syncPaneAccount || !els.syncPaneSaves) return;
        var loggedIn = !!getToken();
        if (which === 'saves' && !loggedIn) which = 'account';

        var isAccount = which !== 'saves';
        els.syncPaneAccount.style.display = isAccount ? '' : 'none';
        els.syncPaneSaves.style.display = isAccount ? 'none' : '';

        if (els.syncTabAccount) els.syncTabAccount.classList.toggle('active', isAccount);
        if (els.syncTabSaves) els.syncTabSaves.classList.toggle('active', !isAccount);

        if (!isAccount) refreshSaves();
      }

      if (els.syncTabAccount) els.syncTabAccount.onclick = function () { switchSyncTab('account'); };
      if (els.syncTabSaves) els.syncTabSaves.onclick = function () { switchSyncTab('saves'); };

      if (els.authCancelBtn && els.authModal) {
        els.authCancelBtn.onclick = function () { els.authModal.classList.remove('open'); };
      }

      if (els.authLogoutBtn) {
        els.authLogoutBtn.onclick = function () {
          setToken(null);
          cloud.version = 0;
          cloud.bootstrapDone = false;
          updateSyncStatus();
          updateAuthModalUI();
          showToast('已退出登录（本地数据仍在）', { timeoutMs: 2600 });
          switchSyncTab('account');
        };
      }

      function refreshSaves() {
        if (!els.archivesList || !els.revisionsList) return;
        if (!getToken()) {
          if (els.savesHint) els.savesHint.textContent = '登录后可使用云端存档。';
          els.archivesList.innerHTML = '';
          els.revisionsList.innerHTML = '';
          return;
        }
        if (els.savesHint) els.savesHint.textContent = '加载中…';
        els.archivesList.innerHTML = '';
        els.revisionsList.innerHTML = '';

        Promise.all([cloudListArchives(), cloudListRevisions()]).then(function (results) {
          var archives = (results[0] && results[0].items) ? results[0].items : [];
          var revisions = (results[1] && results[1].items) ? results[1].items : [];

          if (!archives.length) els.archivesList.innerHTML = '<div style="color:#64748b; font-size:0.92rem;">暂无手动存档</div>';
          else {
            for (var i = 0; i < archives.length; i++) {
              (function (a) {
                var row = document.createElement('div');
                row.className = 'save-item';
                row.innerHTML =
                  '<div class="save-meta">' +
                    '<div class="save-name"></div>' +
                    '<div class="save-tags"></div>' +
                    '<div class="save-time"></div>' +
                  '</div>' +
                  '<div class="save-actions">' +
                    '<button class="modal-btn primary" type="button">恢复</button>' +
                    '<button class="modal-btn" type="button">重命名</button>' +
                    '<button class="modal-btn danger" type="button">删除</button>' +
                  '</div>';
                var saveName = row.querySelector('.save-name');
                var saveTags = row.querySelector('.save-tags');
                var saveTime = row.querySelector('.save-time');
                saveName.textContent = a.name || ('存档 #' + a.id);
                saveTime.textContent = formatLocalTime(a.createdAt);

                var tags = [];
                var dateTag = formatDateTag(a.createdAt);
                if (dateTag) tags.push({ text: dateTag, kind: 'date' });
                var deviceTag = deviceLabelFromArchive(a);
                if (deviceTag) tags.push({ text: deviceTag, kind: 'device' });
                else tags.push({ text: '未记录设备', kind: 'muted' });
                if (saveTags) saveTags.innerHTML = tags.map(function (t) {
                  return '<span class="tag tag--' + escapeAttr(t.kind) + '">' + escapeHtml(t.text) + '</span>';
                }).join('');

                var btnRestore = row.querySelectorAll('button')[0];
                var btnRename = row.querySelectorAll('button')[1];
                var btnDelete = row.querySelectorAll('button')[2];

                btnRestore.onclick = function () {
                  var before = appData;
                  cloudRestoreArchive(a.id).then(function () {
                    return cloudLoadLibrary();
                  }).then(function (j) {
                    if (j && j.data) {
                      var keepUi = appData && appData.ui ? normalizeUi(appData.ui) : defaultUi();
                      normalizeAppData(j.data, keepUi);
                      cloud.version = j.version || cloud.version;
                      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); } catch (_) {}
                      renderSidebar();
                      if (currentChapterId) loadChapter(currentChapterId);
                    }
                    showToast('已恢复存档', {
                      actionText: '撤销',
                      timeoutMs: 6500,
                      onAction: function () {
                        appData = before;
                        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); } catch (_) {}
                        renderSidebar();
                        if (currentChapterId) loadChapter(currentChapterId);
                        saveData();
                        showToast('已撤销恢复', { timeoutMs: 2400 });
                      }
                    });
                    updateSyncStatus();
                    refreshSaves();
                  }).catch(function () {
                    showToast('恢复失败', { timeoutMs: 4200 });
                  });
                };

                btnRename.onclick = function () {
                  var currentName = (a.name && String(a.name).trim()) ? String(a.name).trim() : ('存档 #' + a.id);
                  if (row.classList.contains('save-item--editing')) return;
                  row.classList.add('save-item--editing');

                  var input = document.createElement('input');
                  input.className = 'save-rename-input';
                  input.value = currentName;
                  input.maxLength = 80;

                  var old = saveName.textContent;
                  saveName.textContent = '';
                  saveName.appendChild(input);

                  var btnOk = document.createElement('button');
                  btnOk.type = 'button';
                  btnOk.className = 'modal-btn primary';
                  btnOk.textContent = '保存';

                  var btnCancel = document.createElement('button');
                  btnCancel.type = 'button';
                  btnCancel.className = 'modal-btn';
                  btnCancel.textContent = '取消';

                  var actions = row.querySelector('.save-actions');
                  var restoreBtn = btnRestore;
                  var renameBtn = btnRename;
                  var deleteBtn = btnDelete;

                  restoreBtn.style.display = 'none';
                  renameBtn.style.display = 'none';
                  deleteBtn.style.display = 'none';
                  actions.appendChild(btnOk);
                  actions.appendChild(btnCancel);

                  var cleanup = function () {
                    row.classList.remove('save-item--editing');
                    if (btnOk && btnOk.remove) btnOk.remove();
                    if (btnCancel && btnCancel.remove) btnCancel.remove();
                    restoreBtn.style.display = '';
                    renameBtn.style.display = '';
                    deleteBtn.style.display = '';
                    saveName.textContent = old;
                  };

                  var submit = function () {
                    var next = String(input.value || '').trim();
                    if (!next) { showToast('名称不能为空', { timeoutMs: 2200 }); return; }
                    if (next.length > 80) { showToast('名称太长（最多80字）', { timeoutMs: 2400 }); return; }
                    btnOk.disabled = true;
                    cloudRenameArchive(a.id, next).then(function () {
                      showToast('已重命名', { timeoutMs: 2200 });
                      refreshSaves();
                    }).catch(function () {
                      btnOk.disabled = false;
                      showToast('重命名失败', { timeoutMs: 2400 });
                    });
                  };

                  btnOk.onclick = submit;
                  btnCancel.onclick = cleanup;
                  input.onkeydown = function (ev) {
                    if (!ev) return;
                    if (ev.key === 'Enter') submit();
                    else if (ev.key === 'Escape') cleanup();
                  };

                  try { input.focus(); input.select(); } catch (_) {}
                };

                btnDelete.onclick = function () {
                  cloudDeleteArchive(a.id).then(function () {
                    showToast('已删除存档', { timeoutMs: 2600 });
                    refreshSaves();
                  }).catch(function () {
                    showToast('删除失败', { timeoutMs: 2600 });
                  });
                };

                els.archivesList.appendChild(row);
              })(archives[i]);
            }
          }

          if (!revisions.length) els.revisionsList.innerHTML = '<div style="color:#64748b; font-size:0.92rem;">暂无自动存档</div>';
          else {
            for (var r = 0; r < revisions.length; r++) {
              (function (rv) {
                var row2 = document.createElement('div');
                row2.className = 'save-item';
                row2.innerHTML =
                  '<div class="save-meta">' +
                    '<div class="save-name"></div>' +
                    '<div class="save-tags"></div>' +
                    '<div class="save-time"></div>' +
                  '</div>' +
                  '<div class="save-actions">' +
                    '<button class="modal-btn primary" type="button">恢复</button>' +
                  '</div>';
                row2.querySelector('.save-name').textContent = '自动存档 v' + rv.version;
                row2.querySelector('.save-time').textContent = formatLocalTime(rv.savedAt);

                var saveTags2 = row2.querySelector('.save-tags');
                var tags2 = [];
                var dateTag2 = formatDateTag(rv.savedAt);
                if (dateTag2) tags2.push({ text: dateTag2, kind: 'date' });
                if (rv.deviceLabel && String(rv.deviceLabel).trim()) tags2.push({ text: String(rv.deviceLabel).trim(), kind: 'device' });
                else tags2.push({ text: '未记录设备', kind: 'muted' });
                if (saveTags2) saveTags2.innerHTML = tags2.map(function (t) {
                  return '<span class="tag tag--' + escapeAttr(t.kind) + '">' + escapeHtml(t.text) + '</span>';
                }).join('');

                var btn = row2.querySelector('button');
                btn.onclick = function () {
                  var before2 = appData;
                  cloudRestoreRevision(rv.version).then(function () {
                    return cloudLoadLibrary();
                  }).then(function (j) {
                    if (j && j.data) {
                      var keepUi2 = appData && appData.ui ? normalizeUi(appData.ui) : defaultUi();
                      normalizeAppData(j.data, keepUi2);
                      cloud.version = j.version || cloud.version;
                      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); } catch (_) {}
                      renderSidebar();
                      if (currentChapterId) loadChapter(currentChapterId);
                    }
                    showToast('已恢复自动存档', {
                      actionText: '撤销',
                      timeoutMs: 6500,
                      onAction: function () {
                        appData = before2;
                        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appData)); } catch (_) {}
                        renderSidebar();
                        if (currentChapterId) loadChapter(currentChapterId);
                        saveData();
                        showToast('已撤销恢复', { timeoutMs: 2400 });
                      }
                    });
                    updateSyncStatus();
                    refreshSaves();
                  }).catch(function () {
                    showToast('恢复失败', { timeoutMs: 4200 });
                  });
                };

                els.revisionsList.appendChild(row2);
              })(revisions[r]);
            }
          }

          if (els.savesHint) els.savesHint.textContent = '提示：自动存档每 5 分钟生成一次；冲突时会额外生成“冲突自动备份”。';
        }).catch(function () {
          if (els.savesHint) els.savesHint.textContent = '加载失败，请检查网络/反代配置。';
        });
      }

      if (els.refreshSavesBtn) els.refreshSavesBtn.onclick = refreshSaves;
      if (els.createArchiveBtn) {
        els.createArchiveBtn.onclick = function () {
          if (!getToken()) { showToast('请先登录', { timeoutMs: 2200 }); return; }
          var name = els.archiveName ? els.archiveName.value.trim() : '';
          cloudCreateArchive(name || null, appData).then(function () {
            if (els.archiveName) els.archiveName.value = '';
            showToast('已保存存档', { timeoutMs: 2600 });
            refreshSaves();
          }).catch(function () {
            showToast('保存失败', { timeoutMs: 2600 });
          });
        };
      }

      if (els.authSubmitBtn) {
        els.authSubmitBtn.onclick = function () {
          var username = els.authUsername ? els.authUsername.value : '';
          var password = els.authPassword ? els.authPassword.value : '';
          var endpoint = (cloud.authMode === 'register') ? '/api/auth/register' : '/api/auth/login';

          if (els.authHint) els.authHint.textContent = '处理中…';
          apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ username: username, password: password }) })
            .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, status: res.status, json: j }; }); })
            .then(function (r) {
              if (!r.ok || !r.json || !r.json.token) {
                var msg = (r.json && (r.json.error || r.json.message)) ? (r.json.error || r.json.message) : '失败';
                if (els.authHint) els.authHint.textContent = msg;
                return;
              }
              setToken(r.json.token);
              if (els.authHint) els.authHint.textContent = '登录成功，开始同步…';
              tryBootstrapFromCloud().then(function () {
                renderSidebar();
                updateAuthModalUI();
                updateSyncStatus();
                switchSyncTab('saves');
              });
            })
            .catch(function () {
              if (els.authHint) els.authHint.textContent = '网络错误';
            });
        };
      }

      if (els.enableSyncUploadBtn) {
        els.enableSyncUploadBtn.onclick = function () {
          if (!getToken()) { showToast('请先登录', { timeoutMs: 2200 }); return; }
          if (!cloud.bootstrapDone) { showToast('请稍等：同步初始化中…', { timeoutMs: 2600 }); return; }
          if (cloud.syncEnabled) { showToast('云同步已启用', { timeoutMs: 2200 }); return; }

          if (els.enableSyncHint) els.enableSyncHint.textContent = '上传中…';
          updateSyncStatus('同步中…');

          cloudLoadLibrary().then(function (j) {
            var remote = j && j.data ? j.data : null;
            var remoteHas = appHasAnyContent(remote);
            if (remoteHas) {
              cloud.version = (j && typeof j.version === 'number') ? j.version : cloud.version;
              cloud.remoteEmpty = false;
              cloud.syncEnabled = true;
              if (els.enableSyncHint) els.enableSyncHint.textContent = '云端已有数据：已启用同步并默认以云端为准。';
              // 重新走一次引导，确保本机被云端覆盖并自动备份本机
              return tryBootstrapFromCloud().then(function () {
                renderSidebar();
                updateAuthModalUI();
                updateSyncStatus();
              });
            }

            // 云端仍为空：把本机上传为初始云端数据（显式操作）
            cloud.version = (j && typeof j.version === 'number') ? j.version : 0;
            return cloudSaveLibrary(0, false).then(function (r) {
              cloud.version = r && r.version ? r.version : cloud.version;
              cloud.remoteEmpty = false;
              cloud.syncEnabled = true;
              if (els.enableSyncHint) els.enableSyncHint.textContent = '上传完成：已启用云同步。';
              updateAuthModalUI();
              updateSyncStatus();
              showToast('已上传本机并启用云同步', { timeoutMs: 2600 });
            });
          }).catch(function () {
            if (els.enableSyncHint) els.enableSyncHint.textContent = '上传失败：请检查网络/反代配置。';
            cloud.syncEnabled = false;
            updateSyncStatus('同步失败');
          });
        };
      }
    }
  
    /** ---------------------------
     * 13) 启动
     * --------------------------- */
    function initApp() {
      cacheEls();
      if (!els.sidebarList) return;

      Promise.all([loadStaticPresets(), loadDefaultSeed()]).then(function () {
        loadLocalData();
        if (!appData.ui) appData.ui = defaultUi();
        appData.ui = normalizeUi(appData.ui);
        applyUiToDocument();
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
          renderSidebar();
          if (homeVisible) renderHome();
        });

        initialized = true;
      });
    }
  
    if (document.readyState === 'loading') addEvt(document, 'DOMContentLoaded', initApp);
    else initApp();
  
  })();
