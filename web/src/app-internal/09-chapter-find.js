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

    function applyStaticTitleOverride(book, chapter) {
      if (!book || !chapter || !chapter.id) return chapter;
      if (!(chapter.isStatic || String(chapter.id).indexOf('static_') === 0)) return chapter;
      var m = book.chapterTitleOverrides;
      if (!m || typeof m !== 'object' || Array.isArray(m)) return chapter;
      var t = m[String(chapter.id)];
      if (typeof t !== 'string') return chapter;
      t = t.trim();
      if (!t) return chapter;
      if (chapter.title === t) return chapter;
      // Do not mutate `staticData` (read-only presets); return a shallow copy for UI.
      return {
        id: chapter.id,
        title: t,
        questions: chapter.questions,
        isStatic: true
      };
    }
  
    function getAllChapters() {
      var book = getActiveBook();
      var locals = book.chapters || [];
      var all = (book.includePresets ? staticData.concat(locals) : locals.slice());
      var out = [];
      for (var i = 0; i < all.length; i++) {
        if (!isDeleted(all[i].id)) out.push(applyStaticTitleOverride(book, all[i]));
      }
      return out;
    }
  
    function findChapterById(id) {
      var book = getActiveBook();
      if (book.includePresets) {
        for (var i = 0; i < staticData.length; i++) if (staticData[i].id === id) return applyStaticTitleOverride(book, staticData[i]);
      }
      var chs = book.chapters || [];
      for (var j = 0; j < chs.length; j++) if (chs[j].id === id) return chs[j];
      return null;
    }
  
