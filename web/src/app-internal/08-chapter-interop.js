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
  
