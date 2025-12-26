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
        if (typeof setTopBarTitle === 'function') setTopBarTitle('请选择章节');
        else if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
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
  
