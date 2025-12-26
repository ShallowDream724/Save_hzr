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
      els.settingsDangerZone = document.getElementById('settingsDangerZone');
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
      els.aiChatBox = els.aiChatModal ? els.aiChatModal.querySelector('.ai-chat-box') : null;
      els.aiChatHeader = els.aiChatModal ? els.aiChatModal.querySelector('.ai-chat-header') : null;
      els.aiChatTitle = document.getElementById('aiChatTitle');
      els.aiChatModelSwitch = document.getElementById('aiChatModelSwitch');
      els.aiChatCloseBtn = document.getElementById('aiChatCloseBtn');
      els.aiChatQuote = document.getElementById('aiChatQuote');
      els.aiChatQuoteText = document.getElementById('aiChatQuoteText');
      els.aiChatQuoteClearBtn = document.getElementById('aiChatQuoteClearBtn');
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
      els.aiImportModelSwitch = document.getElementById('aiImportModelSwitch');
      els.aiImportStartBtn = document.getElementById('aiImportStartBtn');
      els.aiImportCancelBtn = document.getElementById('aiImportCancelBtn');
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
  
