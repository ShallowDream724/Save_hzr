    /** ---------------------------
     * 12.2) UI 绑定：书/文件夹
     * --------------------------- */
    var uiBooksBound = false;

    function bindUiBooksOnce() {
      if (uiBooksBound) return;
      uiBooksBound = true;

      // 新建文件夹
      if (els.addFolderBtn) {
        els.addFolderBtn.onclick = function () {
          // 桌面折叠态下用户看不到列表，先自动展开
          if (!uiIsCompactLayout() && document.body.classList.contains('sidebar-collapsed')) {
            document.body.classList.remove('sidebar-collapsed');
            uiUpdateCollapseIcon();
          }
          if (!els.folderModal) return;
          if (els.folderNameInput) els.folderNameInput.value = '';
          els.folderModal.classList.add('open');
          syncModalScrollLock();
          try { if (els.folderNameInput) els.folderNameInput.focus(); } catch (_) {}
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
        syncModalScrollLock();
        showToast('已创建文件夹：' + title, { timeoutMs: 2200 });
      }

      if (els.folderCancelBtn && els.folderModal) els.folderCancelBtn.onclick = function () { els.folderModal.classList.remove('open'); syncModalScrollLock(); };
      if (els.folderCreateBtn) els.folderCreateBtn.onclick = createFolderFromModal;
      if (els.folderNameInput) {
        els.folderNameInput.addEventListener('keydown', function (e) {
          if (e && e.key === 'Enter') createFolderFromModal();
        });
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
          applyAppThemeFromActiveBook();
          if (els.bookModal) els.bookModal.classList.remove('open');
          syncModalScrollLock();
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
            if (appData && appData.currentBookId === bookModalTargetId) applyAppThemeFromActiveBook();
            if (els.bookModal) els.bookModal.classList.remove('open');
            syncModalScrollLock();
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
      if (els.bookCancelBtn && els.bookModal) els.bookCancelBtn.onclick = function () { els.bookModal.classList.remove('open'); syncModalScrollLock(); };
      if (els.bookCreateBtn) els.bookCreateBtn.onclick = submitBookModal;
      if (els.bookNameInput) els.bookNameInput.addEventListener('keydown', function (e) { if (e && e.key === 'Enter') submitBookModal(); });
    }

