    /** ---------------------------
     * 12.1) UI 绑定：布局/侧边栏/通用关闭
     * --------------------------- */
    var uiLayoutBound = false;

    function uiIsCompactLayout() {
      var coarse = false;
      try { coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (_) { coarse = false; }
      return window.innerWidth <= 1024 || coarse;
    }

    function uiOpenSidebar() {
      if (!els.sidebar) return;
      if (uiIsCompactLayout()) els.sidebar.classList.add('active');
      else document.body.classList.remove('sidebar-collapsed');
      uiUpdateCollapseIcon();
    }

    function uiCloseSidebar() {
      if (!els.sidebar) return;
      if (uiIsCompactLayout()) els.sidebar.classList.remove('active');
      else document.body.classList.add('sidebar-collapsed');
      uiUpdateCollapseIcon();
    }

    function uiToggleSidebar() {
      if (!els.sidebar) return;
      if (uiIsCompactLayout()) els.sidebar.classList.toggle('active');
      else document.body.classList.toggle('sidebar-collapsed');
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
        var fabDrag = { active: false, moved: false, pid: null, startX: 0, startY: 0, left: 0, top: 0 };

        function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
        function placeFab(left, top) {
          var w = 52, h = 52;
          var maxL = Math.max(0, window.innerWidth - w - 8);
          var maxT = Math.max(0, window.innerHeight - h - 8);
          var l = clamp(left, 8, maxL);
          var t = clamp(top, 8, maxT);
          els.fabMenu.style.left = l + 'px';
          els.fabMenu.style.top = t + 'px';
          els.fabMenu.style.right = 'auto';
          els.fabMenu.style.bottom = 'auto';
          return { left: l, top: t };
        }

        // restore
        try {
          var raw = localStorage.getItem(FAB_KEY);
          if (raw) {
            var j = JSON.parse(raw);
            if (j && typeof j.left === 'number' && typeof j.top === 'number') placeFab(j.left, j.top);
          }
        } catch (_) {}

        addEvt(els.fabMenu, 'pointerdown', function (e) {
          if (!e || e.button !== 0) return;
          fabDrag.active = true;
          fabDrag.moved = false;
          fabDrag.pid = e.pointerId;
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
          if (!fabDrag.moved && (Math.abs(dx) + Math.abs(dy) > 6)) fabDrag.moved = true;
          if (!fabDrag.moved) return;
          var pos = placeFab(fabDrag.left + dx, fabDrag.top + dy);
          try { localStorage.setItem(FAB_KEY, JSON.stringify(pos)); } catch (_) {}
        }, { passive: false });

        function endFab(e) {
          if (!fabDrag.active || fabDrag.pid !== e.pointerId) return;
          fabDrag.active = false;
          try { els.fabMenu.releasePointerCapture(e.pointerId); } catch (_) {}
          if (!fabDrag.moved) {
            // Home page: use the same draggable hamburger as a HUD toggle
            if (homeVisible) {
              try {
                var hud = document.querySelector('.home-hud');
                if (hud && hud.classList) hud.classList.toggle('collapsed');
              } catch (_) {}
              return;
            }
            uiToggleSidebar();
          }
        }
        addEvt(els.fabMenu, 'pointerup', endFab, { passive: true });
        addEvt(els.fabMenu, 'pointercancel', endFab, { passive: true });
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
