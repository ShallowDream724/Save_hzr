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
  
