    /** ---------------------------
     * 12.1) UI 绑定：布局/侧边栏/通用关闭
     * --------------------------- */
    var uiLayoutBound = false;
    var uiToTopBound = false;
    var uiToTopRaf = 0;

    function uiGetScrollY() {
      try { if (typeof getScrollY === 'function') return Number(getScrollY()) || 0; } catch (_) {}
      return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }

    function uiUpdateToTopBtn() {
      if (!els.toTopBtn) return;
      var show = false;
      try {
        var inHomeMode = false;
        try { inHomeMode = !!(document.body && document.body.classList && document.body.classList.contains('home-mode')); } catch (_) { inHomeMode = false; }
        if (!inHomeMode) inHomeMode = !!homeVisible;
        var inExamMode = false;
        try { inExamMode = !!(document.body && document.body.classList && document.body.classList.contains('exam-mode')); } catch (_) { inExamMode = false; }
        if (!inHomeMode && !inExamMode) {
          show = uiGetScrollY() > 420;
        }
      } catch (_) { show = false; }

      try { els.toTopBtn.style.display = show ? 'inline-flex' : 'none'; } catch (_) {}
      if (!show) return;

      // Avoid fighting with FAB: place above it when possible.
      try {
        if (!els.fabMenu || !els.fabMenu.getBoundingClientRect) {
          els.toTopBtn.style.left = '';
          els.toTopBtn.style.top = '';
          els.toTopBtn.style.right = '';
          els.toTopBtn.style.bottom = '';
          return;
        }
        var fab = els.fabMenu.getBoundingClientRect();
        var b = els.toTopBtn.getBoundingClientRect();
        var size = (b && b.width) ? b.width : 48;
        var gap = 12;

        var x = fab.left + (fab.width - size) / 2;
        var y = fab.top - size - gap;

        var maxX = Math.max(8, (window.innerWidth || 1200) - size - 8);
        var maxY = Math.max(8, (window.innerHeight || 800) - size - 8);

        x = Math.max(8, Math.min(maxX, x));
        y = Math.max(8, Math.min(maxY, y));

        // If there's no room above, place to the left.
        if (fab.top < size + gap + 8) {
          x = fab.left - size - gap;
          y = fab.top + (fab.height - size) / 2;
          x = Math.max(8, Math.min(maxX, x));
          y = Math.max(8, Math.min(maxY, y));
        }

        els.toTopBtn.style.left = Math.round(x) + 'px';
        els.toTopBtn.style.top = Math.round(y) + 'px';
        els.toTopBtn.style.right = 'auto';
        els.toTopBtn.style.bottom = 'auto';
      } catch (_) {}
    }

    function uiScheduleToTopUpdate() {
      if (!els.toTopBtn) return;
      if (uiToTopRaf) return;
      uiToTopRaf = (window.requestAnimationFrame || window.setTimeout)(function () {
        uiToTopRaf = 0;
        uiUpdateToTopBtn();
      }, 0);
    }

    function uiIsCompactLayout() {
      var coarse = false;
      try { coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (_) { coarse = false; }
      return window.innerWidth <= 1024 || coarse;
    }

    function uiOpenSidebar() {
      if (!els.sidebar) return;
      if (uiIsCompactLayout()) {
        // Compact layout uses `.sidebar.active`; make sure desktop-only collapse state doesn't block it.
        try { if (document.body && document.body.classList) document.body.classList.remove('sidebar-collapsed'); } catch (_) {}
        els.sidebar.classList.add('active');
      } else {
        // Desktop layout uses `body.sidebar-collapsed`; make sure mobile overlay state doesn't leak.
        try { if (els.sidebar && els.sidebar.classList) els.sidebar.classList.remove('active'); } catch (_) {}
        document.body.classList.remove('sidebar-collapsed');
      }
      uiUpdateCollapseIcon();
    }

    function uiCloseSidebar() {
      if (!els.sidebar) return;
      if (uiIsCompactLayout()) {
        try { if (document.body && document.body.classList) document.body.classList.remove('sidebar-collapsed'); } catch (_) {}
        els.sidebar.classList.remove('active');
      } else {
        try { if (els.sidebar && els.sidebar.classList) els.sidebar.classList.remove('active'); } catch (_) {}
        document.body.classList.add('sidebar-collapsed');
      }
      uiUpdateCollapseIcon();
    }

    function uiToggleSidebar() {
      if (!els.sidebar) return;
      if (uiIsCompactLayout()) {
        try { if (document.body && document.body.classList) document.body.classList.remove('sidebar-collapsed'); } catch (_) {}
        els.sidebar.classList.toggle('active');
      } else {
        try { if (els.sidebar && els.sidebar.classList) els.sidebar.classList.remove('active'); } catch (_) {}
        document.body.classList.toggle('sidebar-collapsed');
      }
      uiUpdateCollapseIcon();
    }

    function uiUpdateCollapseIcon() {
      if (!els.sidebarCollapseBtn) return;
      var i = els.sidebarCollapseBtn.querySelector('i');
      if (!i) return;
      if (uiIsCompactLayout()) {
        i.className = 'fa-solid fa-bars';
        els.sidebarCollapseBtn.title = '菜单';
        return;
      }
      var collapsed = document.body.classList.contains('sidebar-collapsed');
      i.className = collapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left';
      els.sidebarCollapseBtn.title = collapsed ? '展开侧边栏' : '折叠侧边栏';
    }

    function bindUiLayoutOnce() {
      if (uiLayoutBound) return;
      uiLayoutBound = true;

      // 菜单
      if (els.menuToggle && els.sidebar) els.menuToggle.onclick = uiToggleSidebar;
      if (els.homeBtn) {
        els.homeBtn.onclick = function () {
          showHomeView();
          if (els.sidebar && uiIsCompactLayout()) els.sidebar.classList.remove('active');
          uiUpdateCollapseIcon();
        };
      }
      if (els.sidebarHomeTopBtn) {
        els.sidebarHomeTopBtn.onclick = function () {
          showHomeView();
          if (els.sidebar && uiIsCompactLayout()) els.sidebar.classList.remove('active');
          uiUpdateCollapseIcon();
        };
      }

      // Home HUD shortcuts (sync / saves / settings)
      if (els.homeSyncBtn) {
        els.homeSyncBtn.onclick = function () {
          updateAuthModalUI();
          switchSyncTab(getToken() ? 'saves' : 'account');
          if (els.authModal) els.authModal.classList.add('open');
          syncModalScrollLock();
        };
      }
      if (els.homeSettingsBtn) {
        els.homeSettingsBtn.onclick = function () {
          if (typeof window.openSettingsModal === 'function') window.openSettingsModal('home');
          else if (els.settingsModal) {
            populateSettingsUi();
            els.settingsModal.classList.add('open');
            syncModalScrollLock();
          }
        };
      }

      // 侧边栏遮罩：点击空白收回（移动端）
      if (els.sidebarOverlay && els.sidebar) {
        els.sidebarOverlay.onclick = function () {
          if (uiIsCompactLayout()) els.sidebar.classList.remove('active');
          uiUpdateCollapseIcon();
        };
      }

      // 折叠按钮
      if (els.sidebarCollapseBtn) {
        els.sidebarCollapseBtn.onclick = function () {
          uiToggleSidebar();
        };
        uiUpdateCollapseIcon();
      }

      // 可拖动汉堡按钮（移动端/平板更顺手）
      if (els.fabMenu) {
        var FAB_KEY = 'hzr_fab_pos_v1';
        var FAB_DRAG_THRESHOLD = 8; // px; higher to avoid "tap jitter" being treated as drag on touch
        var fabDrag = { active: false, moved: false, pid: null, tid: null, startX: 0, startY: 0, left: 0, top: 0, lastPos: null };

        function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
        function placeFab(left, top) {
          var w = 56, h = 56;
          var maxL = Math.max(0, window.innerWidth - w - 8);
          var maxT = Math.max(0, window.innerHeight - h - 8);
          var l = clamp(left, 8, maxL);
          var t = clamp(top, 8, maxT);
          els.fabMenu.style.left = l + 'px';
          els.fabMenu.style.top = t + 'px';
          els.fabMenu.style.right = 'auto';
          els.fabMenu.style.bottom = 'auto';
          try { uiScheduleToTopUpdate(); } catch (_) {}
          return { left: l, top: t };
        }
        function persistFabPos(pos) {
          if (!pos) return;
          try { localStorage.setItem(FAB_KEY, JSON.stringify(pos)); } catch (_) {}
          try { uiScheduleToTopUpdate(); } catch (_) {}
        }

        // restore
        try {
          var raw = localStorage.getItem(FAB_KEY);
          if (raw) {
            var j = JSON.parse(raw);
            if (j && typeof j.left === 'number' && typeof j.top === 'number') placeFab(j.left, j.top);
          }
        } catch (_) {}

        function onFabTap() {
          // Home page: use the same draggable hamburger as a HUD toggle.
          // NOTE: use DOM class as source of truth to avoid state desync on mobile.
          var inHomeMode = false;
          try { inHomeMode = !!(document.body && document.body.classList && document.body.classList.contains('home-mode')); } catch (_) { inHomeMode = false; }
          if (!inHomeMode) inHomeMode = !!homeVisible;
          if (inHomeMode) {
            try {
              var hud = document.querySelector('.home-hud');
              if (hud && hud.classList) hud.classList.toggle('collapsed');
            } catch (_) {}
            return;
          }
          uiToggleSidebar();
        }

        addEvt(els.fabMenu, 'pointerdown', function (e) {
          if (!e) return;
          if ((e.pointerType || 'mouse') === 'touch') return; // Touch: prefer TouchEvents (more stable)
          // Touch/pen PointerEvent may have `button` undefined/-1 on some Android WebViews;
          // only enforce left-click for real mouse input.
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          fabDrag.active = true;
          fabDrag.moved = false;
          fabDrag.lastPos = null;
          fabDrag.pid = e.pointerId;
          fabDrag.tid = null;
          fabDrag.startX = e.clientX;
          fabDrag.startY = e.clientY;
          var rect = els.fabMenu.getBoundingClientRect();
          fabDrag.left = rect.left;
          fabDrag.top = rect.top;
          try { els.fabMenu.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
        }, { passive: false });

        addEvt(els.fabMenu, 'pointermove', function (e) {
          if (!fabDrag.active || fabDrag.pid !== e.pointerId) return;
          var dx = e.clientX - fabDrag.startX;
          var dy = e.clientY - fabDrag.startY;
          if (!fabDrag.moved && (Math.abs(dx) + Math.abs(dy) > FAB_DRAG_THRESHOLD)) fabDrag.moved = true;
          if (!fabDrag.moved) return;
          fabDrag.lastPos = placeFab(fabDrag.left + dx, fabDrag.top + dy);
          try { e.preventDefault(); } catch (_) {}
        }, { passive: false });

        addEvt(els.fabMenu, 'touchstart', function (e) {
          if (!e || !e.touches || !e.touches[0]) return;
          var t = e.touches[0];
          fabDrag.active = true;
          fabDrag.moved = false;
          fabDrag.lastPos = null;
          fabDrag.pid = null;
          fabDrag.tid = t.identifier;
          fabDrag.startX = t.clientX;
          fabDrag.startY = t.clientY;
          var rect = els.fabMenu.getBoundingClientRect();
          fabDrag.left = rect.left;
          fabDrag.top = rect.top;
          try { e.preventDefault(); } catch (_) {}
        }, { passive: false });

        addEvt(els.fabMenu, 'touchmove', function (e) {
          if (!fabDrag.active || fabDrag.tid === null) return;
          if (!e || !e.touches || !e.touches.length) return;
          var t = null;
          for (var i = 0; i < e.touches.length; i++) {
            if (e.touches[i] && e.touches[i].identifier === fabDrag.tid) { t = e.touches[i]; break; }
          }
          if (!t) return;
          var dx = t.clientX - fabDrag.startX;
          var dy = t.clientY - fabDrag.startY;
          if (!fabDrag.moved && (Math.abs(dx) + Math.abs(dy) > FAB_DRAG_THRESHOLD)) fabDrag.moved = true;
          if (!fabDrag.moved) return;
          fabDrag.lastPos = placeFab(fabDrag.left + dx, fabDrag.top + dy);
          try { e.preventDefault(); } catch (_) {}
        }, { passive: false });

        // Prevent long-press context menu on mobile which can feel like "needs 2s to respond".
        addEvt(els.fabMenu, 'contextmenu', function (e) {
          try { e.preventDefault(); } catch (_) {}
        }, { passive: false });

        function endFab(e) {
          if (!fabDrag.active || fabDrag.pid !== e.pointerId) return;
          fabDrag.active = false;
          try { els.fabMenu.releasePointerCapture(e.pointerId); } catch (_) {}
          if (fabDrag.moved) {
            persistFabPos(fabDrag.lastPos);
            return;
          }
          onFabTap();
        }
        addEvt(els.fabMenu, 'pointerup', endFab, { passive: true });
        addEvt(els.fabMenu, 'pointercancel', endFab, { passive: true });

        function endFabTouch(e) {
          if (!fabDrag.active || fabDrag.tid === null) return;
          var ended = false;
          try {
            if (e && e.changedTouches && e.changedTouches.length) {
              for (var i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i] && e.changedTouches[i].identifier === fabDrag.tid) { ended = true; break; }
              }
            } else {
              ended = true;
            }
          } catch (_) { ended = true; }
          if (!ended) return;
          // If we were dragging, persist the last stable position.
          if (fabDrag.moved) {
            fabDrag.active = false;
            fabDrag.tid = null;
            persistFabPos(fabDrag.lastPos);
            return;
          }
          fabDrag.active = false;
          fabDrag.tid = null;
          try { if (e) e.preventDefault(); } catch (_) {}
          onFabTap();
        }
        addEvt(els.fabMenu, 'touchend', endFabTouch, { passive: false });
        addEvt(els.fabMenu, 'touchcancel', endFabTouch, { passive: false });
      }

      // Chapter view: quick scroll-to-top (appears after scrolling down).
      if (els.toTopBtn && !uiToTopBound) {
        uiToTopBound = true;
        els.toTopBtn.onclick = function () {
          try {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } catch (_) {
            try { window.scrollTo(0, 0); } catch (_) {}
          }
        };
        addEvt(window, 'scroll', uiScheduleToTopUpdate, { passive: true });
        addEvt(window, 'resize', uiScheduleToTopUpdate, { passive: true });
        uiScheduleToTopUpdate();
      }

      // 点击空白立即收起 toast（但不影响 toast 按钮）
      addEvt(document, 'pointerdown', function (e) {
        if (!toastState.el) return;
        if (e.target && e.target.closest && e.target.closest('.toast-btn')) return;
        hideToast();
      }, { passive: true, capture: true });

      // 点击遮罩/空白关闭弹窗
      function bindOverlayClose(modalEl) {
        if (!modalEl) return;
        modalEl.addEventListener('click', function (e) {
          if (e.target !== modalEl) return;
          modalEl.classList.remove('open');
          syncModalScrollLock();
        }, false);
      }
      bindOverlayClose(els.importModal);
      bindOverlayClose(els.folderModal);
      bindOverlayClose(els.bookModal);
      bindOverlayClose(els.authModal);
      bindOverlayClose(els.settingsModal);
      bindOverlayClose(els.aiChatModal);
      bindOverlayClose(els.aiImportModal);
      bindOverlayClose(els.aiHistoryModal);

      // Sticky close "X" inside modal content (follows scroll).
      addEvt(document, 'click', function (e) {
        var t = e && e.target;
        var btn = (t && t.closest) ? t.closest('.modal-close-x') : null;
        if (!btn) return;
        var overlay = btn.closest ? btn.closest('.modal-overlay') : null;
        if (!overlay) return;
        overlay.classList.remove('open');
        syncModalScrollLock();
      }, { passive: true, capture: true });

      // ESC：关闭 toast + 弹窗 + 侧边栏（移动端）
      addEvt(document, 'keydown', function (e) {
        if (!e || e.key !== 'Escape') return;
        hideToast();
        if (els.importModal) els.importModal.classList.remove('open');
        if (els.authModal) els.authModal.classList.remove('open');
        if (els.settingsModal) els.settingsModal.classList.remove('open');
        if (els.aiChatModal) els.aiChatModal.classList.remove('open');
        if (els.aiImportModal) els.aiImportModal.classList.remove('open');
        if (els.aiHistoryModal) els.aiHistoryModal.classList.remove('open');
        syncModalScrollLock();
        if (els.sidebar && uiIsCompactLayout()) els.sidebar.classList.remove('active');
        uiUpdateCollapseIcon();
      }, { passive: true });
    }
