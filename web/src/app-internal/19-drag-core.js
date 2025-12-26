    /** ---------------------------
     * 10) 可靠拖拽系统
     * --------------------------- */
    var DRAG_MOUSE_THRESHOLD = 6;     // mouse moved px to start drag
    var TOUCH_CANCEL_THRESHOLD = 18;  // touch moved px during long-press waiting => cancel
    var LONG_PRESS_MS = 300;          // touch long-press delay
    var AUTO_SCROLL_EDGE = 55;        // px near top/bottom triggers autoscroll
    var AUTO_SCROLL_MAX_SPEED = 18;   // px per frame
  
    var drag = {
      mode: 'idle', // idle | pending | dragging
  
      chapterId: null,
      sourceEl: null,
  
      pointerType: null,
      pointerId: null,
  
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
  
      longPressTimer: 0,
  
      ghostEl: null,

      overFolderId: null,
      overFolderEl: null,
      overChapterId: null,
      overChapterEl: null,
      overInsertAfter: false,
  
      autoScrollSpeed: 0,
      autoScrollRaf: 0,
  
      // click suppression window
      suppressClickUntil: 0,
  
      // locks
      pageLock: null,
      sidebarLock: null,
  
      // doc listeners attached?
      docAttached: false
    };
  
    function installGuardsOnce() {
      if (guardsInstalled) return;
      guardsInstalled = true;
  
      // 关键：拖拽时全局阻断“触摸滚动”和“滚轮滚动”
      addEvt(document, 'touchmove', function (e) {
        if (drag.mode === 'dragging') e.preventDefault();
      }, { passive: false, capture: true });
  
      addEvt(document, 'wheel', function (e) {
        if (drag.mode === 'dragging') e.preventDefault();
      }, { passive: false, capture: true });
  
      // iOS 上有时还会触发 gesture（缩放/双指），拖拽时直接禁掉
      addEvt(document, 'gesturestart', function (e) {
        if (drag.mode === 'dragging') e.preventDefault();
      }, { passive: false, capture: true });

      // 移动端长按可能触发 contextmenu（导致拖拽被系统打断）
      addEvt(document, 'contextmenu', function (e) {
        if (drag.mode !== 'idle') e.preventDefault();
      }, { passive: false, capture: true });

      addEvt(document, 'selectstart', function (e) {
        if (drag.mode !== 'idle') e.preventDefault();
      }, { passive: false, capture: true });
    }

    function bindDragStart(el, chapterId) {
      if (SUPPORT_POINTER) {
        addEvt(el, 'pointerdown', function (e) {
          if (e.button !== 0) return;
          // 触摸设备优先走 touchstart/touchmove（更可控；避免 PointerEvents 的 touch-action 限制）
          if ((e.pointerType || 'mouse') === 'touch') return;
          if (e.target && e.target.closest && e.target.closest('.action-icon')) return;
          var isHandle = !!(e.target && e.target.closest && e.target.closest('.drag-handle'));
          if (isHandle) e.preventDefault();
          beginPendingDrag(chapterId, el, e.pointerType || 'mouse', e.pointerId, e.clientX, e.clientY);
          if (isHandle) startDrag(e.clientX, e.clientY);
        }, { passive: false });

        // iOS/移动端：TouchEvents 更稳定
        addEvt(el, 'touchstart', function (e) {
          if (!e.touches || !e.touches[0]) return;
          if (e.target && e.target.closest && e.target.closest('.action-icon')) return;
          var isHandle = !!(e.target && e.target.closest && e.target.closest('.drag-handle'));
          if (isHandle) e.preventDefault();
          var t = e.touches[0];
          beginPendingDrag(chapterId, el, 'touch', 1, t.clientX, t.clientY);
          if (isHandle) startDrag(t.clientX, t.clientY);
        }, { passive: false });
      } else {
        // fallback: mouse + touch
        addEvt(el, 'mousedown', function (e) {
          if (e.button !== 0) return;
          if (e.target && e.target.closest && e.target.closest('.action-icon')) return;
          var isHandle = !!(e.target && e.target.closest && e.target.closest('.drag-handle'));
          beginPendingDrag(chapterId, el, 'mouse', 1, e.clientX, e.clientY);
          if (isHandle) startDrag(e.clientX, e.clientY);
        });

        addEvt(el, 'touchstart', function (e) {
          if (!e.touches || !e.touches[0]) return;
          var isHandle = !!(e.target && e.target.closest && e.target.closest('.drag-handle'));
          if (isHandle) e.preventDefault();
          var t = e.touches[0];
          beginPendingDrag(chapterId, el, 'touch', 1, t.clientX, t.clientY);
          if (isHandle) startDrag(t.clientX, t.clientY);
        }, { passive: false });
      }
    }

    function beginPendingDrag(chapterId, el, pointerType, pointerId, x, y) {
      if (drag.mode !== 'idle') return;
  
      drag.mode = 'pending';
      drag.chapterId = chapterId;
      drag.sourceEl = el;
      drag.pointerType = pointerType;
      drag.pointerId = pointerId;
      drag.startX = x;
      drag.startY = y;
      drag.lastX = x;
      drag.lastY = y;

      attachDocListeners();

      // PointerEvents：尽量捕获 pointer，避免移动端拖到元素外后丢事件
      if (SUPPORT_POINTER && el && el.setPointerCapture && pointerType === 'pen') {
        try { el.setPointerCapture(pointerId); } catch (err) {}
      }

      // touch/pen: long press to start
      if (pointerType === 'touch' || pointerType === 'pen') {
        drag.longPressTimer = window.setTimeout(function () {
          // 进入拖拽使用最新坐标（允许轻微微动）
          startDrag(drag.lastX, drag.lastY);
        }, LONG_PRESS_MS);
      } else {
        drag.longPressTimer = 0; // mouse no timer
      }
    }
  
    function attachDocListeners() {
      if (drag.docAttached) return;
      drag.docAttached = true;

      if (drag.pointerType === 'touch') {
        addEvt(document, 'touchmove', onDocTouchMove, { passive: false });
        addEvt(document, 'touchend', onDocTouchEnd, { passive: false });
        addEvt(document, 'touchcancel', onDocTouchEnd, { passive: false });
      } else if (SUPPORT_POINTER) {
        addEvt(document, 'pointermove', onDocPointerMove, { passive: false });
        addEvt(document, 'pointerup', onDocPointerUp, { passive: false });
        addEvt(document, 'pointercancel', onDocPointerUp, { passive: false });
      } else {
        addEvt(document, 'mousemove', onDocMouseMove);
        addEvt(document, 'mouseup', onDocMouseUp);
        addEvt(document, 'touchmove', onDocTouchMove, { passive: false });
        addEvt(document, 'touchend', onDocTouchEnd, { passive: false });
        addEvt(document, 'touchcancel', onDocTouchEnd, { passive: false });
      }
    }

    function detachDocListeners() {
      if (!drag.docAttached) return;
      drag.docAttached = false;

      // 直接清理所有可能的监听，避免 pointerType 先被置空导致漏卸载
      rmEvt(document, 'touchmove', onDocTouchMove, { passive: false });
      rmEvt(document, 'touchend', onDocTouchEnd, { passive: false });
      rmEvt(document, 'touchcancel', onDocTouchEnd, { passive: false });

      rmEvt(document, 'mousemove', onDocMouseMove);
      rmEvt(document, 'mouseup', onDocMouseUp);

      if (SUPPORT_POINTER) {
        rmEvt(document, 'pointermove', onDocPointerMove, { passive: false });
        rmEvt(document, 'pointerup', onDocPointerUp, { passive: false });
        rmEvt(document, 'pointercancel', onDocPointerUp, { passive: false });
      }
    }
  
    function dist(x1, y1, x2, y2) {
      var dx = x2 - x1, dy = y2 - y1;
      return Math.sqrt(dx * dx + dy * dy);
    }
  
    // PointerEvents path
    function onDocPointerMove(e) {
      if (drag.mode === 'idle') return;
      if (e.pointerId !== drag.pointerId) return;
  
      var x = e.clientX, y = e.clientY;
      drag.lastX = x; drag.lastY = y;
  
      if (drag.mode === 'pending') {
        if (drag.pointerType === 'touch' || drag.pointerType === 'pen') {
          if (dist(drag.startX, drag.startY, x, y) > TOUCH_CANCEL_THRESHOLD) {
            cancelPending();
          }
        } else {
          if (dist(drag.startX, drag.startY, x, y) > DRAG_MOUSE_THRESHOLD) {
            startDrag(x, y);
          }
        }
        return;
      }
  
      if (drag.mode === 'dragging') {
        e.preventDefault();
        onDragMove(x, y);
      }
    }
  
    function onDocPointerUp(e) {
      if (drag.mode === 'idle') return;
      if (e.pointerId !== drag.pointerId) return;
  
      if (drag.mode === 'pending') {
        cancelPending();
        return;
      }
      if (drag.mode === 'dragging') {
        finishDrag(e.clientX, e.clientY);
      }
    }
  
    // Fallback path (no PointerEvent)
    function onDocMouseMove(e) {
      if (drag.mode === 'idle') return;
      if (drag.pointerType !== 'mouse') return;
  
      var x = e.clientX, y = e.clientY;
      drag.lastX = x; drag.lastY = y;
  
      if (drag.mode === 'pending') {
        if (dist(drag.startX, drag.startY, x, y) > DRAG_MOUSE_THRESHOLD) startDrag(x, y);
        return;
      }
      if (drag.mode === 'dragging') onDragMove(x, y);
    }
  
    function onDocMouseUp(e) {
      if (drag.mode === 'idle') return;
      if (drag.pointerType !== 'mouse') return;
  
      if (drag.mode === 'pending') cancelPending();
      else if (drag.mode === 'dragging') finishDrag(e.clientX, e.clientY);
    }
  
    function onDocTouchMove(e) {
      if (drag.mode === 'idle') return;
      if (drag.pointerType !== 'touch') return;
      if (!e.touches || !e.touches[0]) return;
  
      var t = e.touches[0];
      var x = t.clientX, y = t.clientY;
      drag.lastX = x; drag.lastY = y;
  
      if (drag.mode === 'pending') {
        if (dist(drag.startX, drag.startY, x, y) > TOUCH_CANCEL_THRESHOLD) cancelPending();
        return;
      }
      if (drag.mode === 'dragging') {
        e.preventDefault();
        onDragMove(x, y);
      }
    }
  
    function onDocTouchEnd(e) {
      if (drag.mode === 'idle') return;
      if (drag.pointerType !== 'touch') return;
  
      var t = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
      var x = t ? t.clientX : drag.lastX;
      var y = t ? t.clientY : drag.lastY;
  
      if (drag.mode === 'pending') cancelPending();
      else if (drag.mode === 'dragging') finishDrag(x, y);
    }
  
    function cancelPending() {
      if (drag.longPressTimer) window.clearTimeout(drag.longPressTimer);
      drag.longPressTimer = 0;
  
      drag.mode = 'idle';
      drag.chapterId = null;
      drag.sourceEl = null;
      drag.pointerType = null;
      drag.pointerId = null;
  
      detachDocListeners();
    }
