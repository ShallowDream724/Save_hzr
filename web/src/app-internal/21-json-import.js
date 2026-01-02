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
      // AI 常见输出壳（兼容旧引导/第三方工具）
      if (isObject(raw) && isObject(raw.chapter)) raw = raw.chapter;
      if (isObject(raw) && isObject(raw.sheet)) raw = raw.sheet;
  
      // 1) 单 sheet
      if (looksLikeSingleSheet(raw)) {
        return {
          kind: 'single',
          folders: [],
          chapters: [ normalizeSheetObj(raw, false) ],
          layoutMap: {},
          chapterOrder: {},
          chapterTitleOverrides: {},
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
          return { kind: 'list', folders: [], chapters: list, layoutMap: {}, chapterOrder: {}, chapterTitleOverrides: {}, deletedChapterIds: [] };
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
            chapterOrder: (raw.chapterOrder && typeof raw.chapterOrder === 'object' && !Array.isArray(raw.chapterOrder)) ? raw.chapterOrder : {},
            chapterTitleOverrides: (raw.chapterTitleOverrides && typeof raw.chapterTitleOverrides === 'object' && !Array.isArray(raw.chapterTitleOverrides)) ? raw.chapterTitleOverrides : {},
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

        return { kind: 'tree', folders: outFolders, chapters: outChapters, layoutMap: outMap, chapterOrder: {}, chapterTitleOverrides: {}, deletedChapterIds: [] };
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
        return { kind: 'list', folders: [], chapters: list2, layoutMap: {}, chapterOrder: {}, chapterTitleOverrides: {}, deletedChapterIds: [] };
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

      // chapterOrder remap（如果导入提供了）
      var newChapterOrder = {};
      var order = (lib.chapterOrder && typeof lib.chapterOrder === 'object' && !Array.isArray(lib.chapterOrder)) ? lib.chapterOrder : null;
      if (order) {
        for (var key in order) {
          if (!Object.prototype.hasOwnProperty.call(order, key)) continue;
          var arr = order[key];
          if (!Array.isArray(arr)) continue;
          var mappedKey = (String(key) === 'root') ? 'root' : (folderIdMap[String(key)] || null);
          if (!mappedKey) continue;
          var outArr = [];
          var seen = {};
          for (var i = 0; i < arr.length; i++) {
            var oldId = String(arr[i] || '');
            var mappedId = chapterIdMap[oldId] || oldId;
            if (!mappedId) continue;
            if (seen[mappedId]) continue;
            seen[mappedId] = true;
            outArr.push(mappedId);
          }
          newChapterOrder[mappedKey] = outArr;
        }
      }

      // chapterTitleOverrides remap（如果导入提供了）
      var newTitleOverrides = {};
      var ov = (lib.chapterTitleOverrides && typeof lib.chapterTitleOverrides === 'object' && !Array.isArray(lib.chapterTitleOverrides)) ? lib.chapterTitleOverrides : null;
      if (ov) {
        for (var chId in ov) {
          if (!Object.prototype.hasOwnProperty.call(ov, chId)) continue;
          var title = ov[chId];
          if (typeof title !== 'string') continue;
          title = title.trim();
          if (!title) continue;
          var mappedChId = chapterIdMap[String(chId)] || String(chId);
          newTitleOverrides[mappedChId] = title;
        }
      }

      return {
        folders: newFolders,
        chapters: newChapters,
        layoutMap: newLayoutMap,
        chapterOrder: newChapterOrder,
        chapterTitleOverrides: newTitleOverrides,
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
        book.chapterOrder = normalized.chapterOrder || {};
        book.chapterTitleOverrides = normalized.chapterTitleOverrides || {};
        book.deletedChapterIds = normalized.deletedChapterIds || [];
  
        currentChapterId = null;
        if (typeof setTopBarTitle === 'function') setTopBarTitle('请选择章节');
        else if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
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
      if (normalized.chapterOrder && typeof normalized.chapterOrder === 'object') {
        if (!book.chapterOrder || typeof book.chapterOrder !== 'object' || Array.isArray(book.chapterOrder)) book.chapterOrder = {};
        for (var ok in normalized.chapterOrder) {
          if (!Object.prototype.hasOwnProperty.call(normalized.chapterOrder, ok)) continue;
          if (!Array.isArray(normalized.chapterOrder[ok])) continue;
          if (!Array.isArray(book.chapterOrder[ok])) book.chapterOrder[ok] = [];
          var exist = {};
          for (var oi = 0; oi < book.chapterOrder[ok].length; oi++) exist[String(book.chapterOrder[ok][oi])] = true;
          for (var oj = 0; oj < normalized.chapterOrder[ok].length; oj++) {
            var cid = String(normalized.chapterOrder[ok][oj] || '');
            if (!cid || exist[cid]) continue;
            exist[cid] = true;
            book.chapterOrder[ok].push(cid);
          }
        }
      }
      if (normalized.chapterTitleOverrides && typeof normalized.chapterTitleOverrides === 'object') {
        if (!book.chapterTitleOverrides || typeof book.chapterTitleOverrides !== 'object' || Array.isArray(book.chapterTitleOverrides)) book.chapterTitleOverrides = {};
        for (var rk in normalized.chapterTitleOverrides) {
          if (!Object.prototype.hasOwnProperty.call(normalized.chapterTitleOverrides, rk)) continue;
          if (Object.prototype.hasOwnProperty.call(book.chapterTitleOverrides, rk)) continue;
          var rt = normalized.chapterTitleOverrides[rk];
          if (typeof rt !== 'string') continue;
          rt = rt.trim();
          if (!rt) continue;
          book.chapterTitleOverrides[rk] = rt;
        }
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
            chapterOrder: (b.chapterOrder && typeof b.chapterOrder === 'object' && !Array.isArray(b.chapterOrder)) ? b.chapterOrder : {},
            chapterTitleOverrides: (b.chapterTitleOverrides && typeof b.chapterTitleOverrides === 'object' && !Array.isArray(b.chapterTitleOverrides)) ? b.chapterTitleOverrides : {},
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
  
