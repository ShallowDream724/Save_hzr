  
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

    function clearChapterHover() {
      if (drag.overChapterEl) {
        drag.overChapterEl.classList.remove('drag-insert-target');
        drag.overChapterEl.classList.remove('drag-insert-after');
        drag.overChapterEl = null;
      }
      drag.overChapterId = null;
      drag.overInsertAfter = false;
    }
  
    function hitTestFolder(x, y) {
      if (!els.sidebarList) return;
  
      // 只在侧边栏内部才显示投放反馈
      var sidebarRect = els.sidebar ? els.sidebar.getBoundingClientRect() : null;
      if (!sidebarRect || !pointInRect(x, y, sidebarRect)) {
        clearFolderHover();
        clearChapterHover();
        return;
      }
  
      // 避免 elementFromPoint 命中 ghost
      if (drag.ghostEl) drag.ghostEl.style.display = 'none';
      var elBelow = document.elementFromPoint(x, y);
      if (drag.ghostEl) drag.ghostEl.style.display = '';
  
      clearFolderHover();
      clearChapterHover();
      if (!elBelow) return;

      // Chapter insertion target (reorder within container)
      var chapterEl = elBelow.closest ? elBelow.closest('.chapter-item') : null;
      if (chapterEl && chapterEl.dataset && chapterEl.dataset.id) {
        drag.overChapterEl = chapterEl;
        drag.overChapterId = String(chapterEl.dataset.id);
        try {
          var rect = chapterEl.getBoundingClientRect();
          var mid = rect.top + rect.height / 2;
          drag.overInsertAfter = y > mid;
          chapterEl.classList.add('drag-insert-target');
          if (drag.overInsertAfter) chapterEl.classList.add('drag-insert-after');
        } catch (_) {}
      }
  
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
      var targetChapterId = drag.overChapterId;
      var insertAfter = !!drag.overInsertAfter;
  
      var sidebarRect = els.sidebar ? els.sidebar.getBoundingClientRect() : null;
      var droppedInSidebar = sidebarRect ? pointInRect(x, y, sidebarRect) : false;
  
      // 先清理 UI（避免 renderSidebar 时残留 ghost/锁）
      cleanupDragUI();
  
      function ensureChapterOrder(book) {
        if (!book) return;
        if (!book.chapterOrder || typeof book.chapterOrder !== 'object' || Array.isArray(book.chapterOrder)) book.chapterOrder = {};
      }

      function removeFromAllOrders(book, id) {
        if (!book || !book.chapterOrder || typeof book.chapterOrder !== 'object') return;
        var keys = Object.keys(book.chapterOrder);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          var arr = book.chapterOrder[k];
          if (!Array.isArray(arr) || !arr.length) continue;
          var next = [];
          for (var j = 0; j < arr.length; j++) if (String(arr[j]) !== String(id)) next.push(String(arr[j]));
          book.chapterOrder[k] = next;
        }
      }

      function listSidebarChapterIdsForContainer(folderId) {
        if (!els.sidebarList || !els.sidebarList.querySelectorAll) return [];
        var ids = [];
        var items = els.sidebarList.querySelectorAll('.chapter-item');
        var want = folderId ? String(folderId) : null;
        for (var i = 0; i < items.length; i++) {
          var el = items[i];
          if (!el || !el.dataset || !el.dataset.id) continue;
          var inFolder = null;
          try {
            var fc = el.closest ? el.closest('.folder-container') : null;
            inFolder = fc && fc.dataset && fc.dataset.id ? String(fc.dataset.id) : null;
          } catch (_) { inFolder = null; }
          if (want) {
            if (inFolder === want) ids.push(String(el.dataset.id));
          } else {
            if (!inFolder) ids.push(String(el.dataset.id));
          }
        }
        return ids;
      }

      function ensureOrderKey(book, key, folderId) {
        if (!book || !book.chapterOrder) return;
        if (!Array.isArray(book.chapterOrder[key])) book.chapterOrder[key] = listSidebarChapterIdsForContainer(folderId);
        if (!Array.isArray(book.chapterOrder[key])) book.chapterOrder[key] = [];
      }

      function insertIntoOrder(book, folderId, chapterId, beforeId, after) {
        if (!book) return;
        ensureChapterOrder(book);
        removeFromAllOrders(book, chapterId);

        var key = folderId ? String(folderId) : 'root';
        ensureOrderKey(book, key, folderId);

        var arr = book.chapterOrder[key];
        var idStr = String(chapterId);
        var idx = arr.length;
        if (beforeId) {
          var pos = arr.indexOf(String(beforeId));
          if (pos >= 0) idx = pos + (after ? 1 : 0);
        }
        if (idx < 0) idx = 0;
        if (idx > arr.length) idx = arr.length;
        arr.splice(idx, 0, idStr);
      }

      if (droppedInSidebar && chapterId) {
        var book = getActiveBook();
        if (targetFolderId) {
          if (!book.layoutMap) book.layoutMap = {};
          book.layoutMap[chapterId] = targetFolderId;
        } else {
          // 根目录
          if (book.layoutMap && book.layoutMap[chapterId]) delete book.layoutMap[chapterId];
        }

        // Reorder within the destination container when dropping onto a chapter row.
        insertIntoOrder(book, targetFolderId || null, chapterId, targetChapterId, insertAfter);
        saveData();
        renderSidebar();
      }
  
      resetDragState();
    }
  
    function cleanupDragUI() {
      stopAutoScroll();
      clearFolderHover();
      clearChapterHover();
  
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
      drag.overChapterId = null;
      drag.overChapterEl = null;
      drag.overInsertAfter = false;

      detachDocListeners();
    }
  
