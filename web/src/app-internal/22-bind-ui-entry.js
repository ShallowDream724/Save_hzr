    /** ---------------------------
     * 12) UI 绑定（拆分）
     * --------------------------- */
    function bindUIOnce() {
      if (uiBound) return;
      uiBound = true;

      bindUiLayoutOnce();
      bindUiBooksOnce();
      bindUiImportOnce();
      bindUiSettingsOnce();
      bindUiSyncOnce();
      bindUiAiOnce();
      bindUiExamOnce();
    }
