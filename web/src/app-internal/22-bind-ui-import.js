    /** ---------------------------
     * 12.3) UI 绑定：JSON 导入（文件/粘贴）
     * --------------------------- */
    var uiImportBound = false;

    function bindUiImportOnce() {
      if (uiImportBound) return;
      uiImportBound = true;

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
          syncModalScrollLock();
        };
      }
      if (els.importTabFile) els.importTabFile.onclick = function () { switchImportTab('file'); };
      if (els.importTabPaste) els.importTabPaste.onclick = function () { switchImportTab('paste'); };
      if (els.closeImportBtn && els.importModal) els.closeImportBtn.onclick = function () { els.importModal.classList.remove('open'); syncModalScrollLock(); };

      if (els.importFileInput) {
        els.importFileInput.onchange = function (e) {
          var f = e && e.target && e.target.files ? e.target.files[0] : null;
          if (!f) return;
          var r = new FileReader();
          r.onload = function (ev) {
            try {
              var data = JSON.parse(ev.target.result);
              importAnyJSON(data);
              if (els.importModal) els.importModal.classList.remove('open');
              syncModalScrollLock();
            } catch (err) {
              alert('文件无效');
            }
          };
          r.readAsText(f);
          els.importFileInput.value = '';
        };
      }

      if (els.cancelImportBtn && els.importModal) {
        els.cancelImportBtn.onclick = function () { els.importModal.classList.remove('open'); syncModalScrollLock(); };
      }
      if (els.confirmImportBtn && els.importTextarea && els.importModal) {
        els.confirmImportBtn.onclick = function () {
          try {
            var data = JSON.parse(els.importTextarea.value);
            importAnyJSON(data);
            els.importModal.classList.remove('open');
            syncModalScrollLock();
            els.importTextarea.value = '';
          } catch (e) {
            alert('JSON解析失败');
          }
        };
      }
    }

