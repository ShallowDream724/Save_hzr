    /** ---------------------------
     * 7) 渲染侧边栏
     * --------------------------- */
    function sortChaptersForDisplay(list) {
      if (!Array.isArray(list) || list.length <= 1) return list;

      function parseAiId(id) {
        id = String(id || '');
        if (id.indexOf('ai_') !== 0) return null;
        var last = id.lastIndexOf('_');
        if (last <= 3 || last >= id.length - 1) return null;
        var job = id.slice(3, last);
        var page = Number(id.slice(last + 1));
        if (!Number.isFinite(page)) return null;
        return { job: job, page: page };
      }

      function titleOf(ch) {
        return (ch && typeof ch.title === 'string') ? ch.title.trim() : '';
      }

      list.sort(function (a, b) {
        var aId = a && a.id ? String(a.id) : '';
        var bId = b && b.id ? String(b.id) : '';
        var aAi = parseAiId(aId);
        var bAi = parseAiId(bId);

        if (aAi && bAi) {
          if (aAi.job !== bAi.job) return aAi.job.localeCompare(bAi.job);
          return aAi.page - bAi.page;
        }
        if (aAi && !bAi) return -1;
        if (!aAi && bAi) return 1;

        var at = titleOf(a);
        var bt = titleOf(b);
        var c = '';
        try {
          c = at.localeCompare(bt, 'zh-Hans', { numeric: true, sensitivity: 'base' });
        } catch (_) {
          c = at.localeCompare(bt);
        }
        if (c) return c;
        return aId.localeCompare(bId);
      });

      return list;
    }

    function orderChaptersForContainer(book, list, containerId) {
      if (!Array.isArray(list) || list.length <= 1) return list;
      book = (book && typeof book === 'object') ? book : null;
      var key = containerId ? String(containerId) : 'root';
      var orderMap = (book && book.chapterOrder && typeof book.chapterOrder === 'object' && !Array.isArray(book.chapterOrder))
        ? book.chapterOrder
        : null;
      var manual = orderMap && Array.isArray(orderMap[key]) ? orderMap[key] : null;
      if (!manual || manual.length <= 0) return sortChaptersForDisplay(list);

      // Fallback order is deterministic even when manual order is partial.
      var fallback = list.slice();
      sortChaptersForDisplay(fallback);
      var fallbackIndex = {};
      for (var i = 0; i < fallback.length; i++) {
        var id = fallback[i] && fallback[i].id ? String(fallback[i].id) : '';
        if (id) fallbackIndex[id] = i;
      }

      var manualIndex = {};
      for (var j = 0; j < manual.length; j++) manualIndex[String(manual[j])] = j;

      list.sort(function (a, b) {
        var aId = a && a.id ? String(a.id) : '';
        var bId = b && b.id ? String(b.id) : '';
        var ai = Object.prototype.hasOwnProperty.call(manualIndex, aId) ? manualIndex[aId] : 1e9;
        var bi = Object.prototype.hasOwnProperty.call(manualIndex, bId) ? manualIndex[bId] : 1e9;
        if (ai !== bi) return ai - bi;
        var af = Object.prototype.hasOwnProperty.call(fallbackIndex, aId) ? fallbackIndex[aId] : 1e9;
        var bf = Object.prototype.hasOwnProperty.call(fallbackIndex, bId) ? fallbackIndex[bId] : 1e9;
        return af - bf;
      });

      return list;
    }

    function renderSidebar() {
      if (!els.sidebarList) return;
      els.sidebarList.innerHTML = '';
  
      var book = getActiveBook();
      var allChapters = getAllChapters();

      // Pinned "Favorites" chapter (always on top, above folders).
      try {
        if (typeof createFavoritesSidebarElement === 'function') {
          els.sidebarList.appendChild(createFavoritesSidebarElement());
        }
      } catch (_) {}
  
      var folderContents = {};
      var rootChapters = [];
  
      var folders = book.folders || [];
      for (var i = 0; i < folders.length; i++) folderContents[folders[i].id] = [];
  
      for (var k = 0; k < allChapters.length; k++) {
        var ch = allChapters[k];
        var fid = book.layoutMap ? book.layoutMap[ch.id] : null;
        if (fid && folderContents[fid]) folderContents[fid].push(ch);
        else rootChapters.push(ch);
      }
  
      // folders first
      for (var f = 0; f < folders.length; f++) {
        var folderEl = createFolderElement(folders[f]);
        var contentEl = folderEl.querySelector('.folder-content');
  
        var list = folderContents[folders[f].id] || [];
        orderChaptersForContainer(book, list, folders[f].id);
        for (var c = 0; c < list.length; c++) {
          contentEl.appendChild(createChapterElement(list[c]));
        }
        els.sidebarList.appendChild(folderEl);
      }
  
      // root chapters
      orderChaptersForContainer(book, rootChapters, null);
      for (var r = 0; r < rootChapters.length; r++) {
        els.sidebarList.appendChild(createChapterElement(rootChapters[r]));
      }
    }

    function showHomeView() {
      homeVisible = true;
      currentChapterId = null;
      if (els.homeView) els.homeView.style.display = '';
      if (els.questionsContainer) els.questionsContainer.style.display = 'none';
      if (typeof setTopBarTitle === 'function') setTopBarTitle('主页');
      else if (els.chapterTitle) els.chapterTitle.innerText = '主页';
      try { document.body.classList.add('home-mode'); } catch (_) {}
      try { document.body.classList.remove('home-transitioning'); } catch (_) {}
      setWhiteOverlayVisible(false);
      renderHome();
      renderSidebar(); // keep sidebar in sync (shows active book’s chapters when entering a book)
      if (typeof persistViewState === 'function') persistViewState();
    }

    function hideHomeView() {
      homeVisible = false;
      if (els.homeView) els.homeView.style.display = 'none';
      if (els.questionsContainer) els.questionsContainer.style.display = '';
      try { document.body.classList.remove('home-mode'); } catch (_) {}
      try { document.body.classList.remove('home-transitioning'); } catch (_) {}
      setWhiteOverlayVisible(false);
      if (typeof persistViewState === 'function') persistViewState();
    }

    var whiteOverlayEl = null;
    function ensureWhiteOverlay() {
      try {
        if (whiteOverlayEl) return whiteOverlayEl;
        var host = els.homeView || document.body;
        if (!host) host = document.body;
        var el = document.getElementById('whiteOverlay');
        if (!el) {
          el = document.createElement('div');
          el.id = 'whiteOverlay';
          el.className = 'white-overlay';
          host.appendChild(el);
        } else if (host && el.parentElement !== host) {
          host.appendChild(el);
        }
        whiteOverlayEl = el;
        return el;
      } catch (e) { return null; }
    }

    function setWhiteOverlayVisible(on) {
      var el = ensureWhiteOverlay();
      if (!el || !el.classList) return;
      el.classList.toggle('visible', !!on);
    }

    function renderHome() {
      if (!els.booksGrid) return;
      var books = getBooks();
      els.booksGrid.innerHTML = '';
      if (!books.length) {
        els.booksGrid.innerHTML =
          '<div class="home-empty">' +
            '<div class="home-empty-title">还没有书</div>' +
            '<div class="home-empty-desc">点击上方“新建书”或“导入书”，开始整理你的题库。</div>' +
          '</div>';
        return;
      }

      for (var i = 0; i < books.length; i++) {
        (function (b) {
          if (!b) return;
          b = normalizeBook(b);
          var el = document.createElement('div');
          el.className = 'book-container idle ' + bookThemeClass(b);
          el.dataset.bookId = b.id;

          var counts = {
            chapters: Array.isArray(b.chapters) ? b.chapters.length : 0,
            folders: Array.isArray(b.folders) ? b.folders.length : 0
          };

          var introTitle = b.title + '导论';
          var introText = '共 ' + counts.chapters + ' 章 · ' + counts.folders + ' 夹';
          if (b.includePresets) introText += ' · 含预设';

          el.innerHTML =
            '<div class="back-cover"></div>' +
            '<div class="spine"><span class="spine-text"></span></div>' +
            '<div class="text-block">' +
              '<div class="pages-top"></div><div class="pages-right"></div><div class="pages-bottom"></div>' +
              '<div class="first-page">' +
                '<div class="chapter-label">CHAPTER 01</div>' +
                '<h1></h1>' +
                '<p></p>' +
              '</div>' +
            '</div>' +
            '<div class="front-cover">' +
              '<div class="cover-face">' +
                '<h2 class="cover-title"></h2>' +
                '<div class="cover-icon"></div>' +
              '</div>' +
              '<div class="cover-inside"></div>' +
            '</div>' +
            '<button class="book-more" type="button" aria-label="更多">' +
              '<span class="book-more-visual"><i class="fa-solid fa-ellipsis"></i></span>' +
            '</button>' +
            '<div class="book-tooltip"><div class="book-tooltip-row"></div></div>';

          var spineText = el.querySelector('.spine-text');
          if (spineText) spineText.textContent = b.title;
          var coverTitle = el.querySelector('.cover-title');
          if (coverTitle) coverTitle.textContent = b.title;
          var coverIcon = el.querySelector('.cover-icon');
          if (coverIcon) coverIcon.textContent = b.icon || '✚';
          var pageH1 = el.querySelector('.first-page h1');
          if (pageH1) pageH1.textContent = introTitle;
          var pageP = el.querySelector('.first-page p');
          if (pageP) pageP.textContent = introText;

          var tipRow = el.querySelector('.book-tooltip-row');
          if (tipRow) {
            var tags = [];
            tags.push({ text: counts.chapters + ' 章', kind: 'muted' });
            tags.push({ text: counts.folders + ' 夹', kind: 'muted' });
            if (b.includePresets) tags.push({ text: '含预设', kind: 'device' });
            tags.push({ text: '更新：' + (formatDateTag(b.updatedAt) || '—'), kind: 'date' });
            tipRow.innerHTML = tags.map(function (t) { return '<span class="tag tag--' + escapeAttr(t.kind) + '">' + escapeHtml(t.text) + '</span>'; }).join('');
          }

          var moreBtn = el.querySelector('.book-more');
          if (moreBtn) {
            moreBtn.onclick = function (ev) {
              ev.stopPropagation();
              openBookMenu(b, moreBtn, ev ? { x: ev.clientX, y: ev.clientY } : null);
            };
          }

          installBookLongPress(b, el, moreBtn);
          installBookMoreHitZone(b, el, moreBtn);

          el.onclick = function () {
            if (Date.now() < (el.__ignoreClickUntil || 0)) return;
            openBookWithAnimation(b, el);
          };

          els.booksGrid.appendChild(el);
        })(books[i]);
      }
    }

    function installBookLongPress(book, containerEl, moreBtn) {
      try {
        if (!containerEl) return;
        var startX = 0;
        var startY = 0;
        var timer = null;
        var fired = false;

        function clear() {
          if (timer) clearTimeout(timer);
          timer = null;
        }

        containerEl.addEventListener('pointerdown', function (e) {
          if (!e) return;
          // Touch devices may have `button` undefined/-1; only enforce for real mouse input.
          var pt = e.pointerType || 'mouse';
          if (pt === 'mouse' && e.button !== 0) return;
          if (moreBtn && (e.target === moreBtn || (e.target && e.target.closest && e.target.closest('.book-more')))) {
            // Ensure the 3-dots button is never blocked by the "suppress click after long-press" guard.
            fired = false;
            clear();
            return;
          }
          if (pt === 'mouse') return;
          startX = e.clientX;
          startY = e.clientY;
          fired = false;
          clear();
          timer = setTimeout(function () {
            fired = true;
            // Touch UX: long-press opens the book menu (avoid conflict with rename and match "right-click menu" mental model).
            try { containerEl.__ignoreClickUntil = Date.now() + 650; } catch (_) {}
            try { containerEl.__ignoreCtxUntil = Date.now() + 650; } catch (_) {}
            openBookMenu(book, moreBtn || containerEl, { x: startX, y: startY });
          }, 520);
        }, { passive: true });

        containerEl.addEventListener('pointermove', function (e) {
          if (!timer || !e) return;
          if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) clear();
        }, { passive: true });

        containerEl.addEventListener('pointerup', function () { clear(); }, { passive: true });
        containerEl.addEventListener('pointercancel', function () { clear(); }, { passive: true });

        containerEl.addEventListener('click', function (e) {
          if (!fired) return;
          if (e && e.target && e.target.closest && e.target.closest('.book-more')) return;
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
        }, true);

        // Desktop: right-click opens the edit menu (matches "long-press to edit")
        containerEl.addEventListener('contextmenu', function (e) {
          if (!e) return;
          try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
          if (Date.now() < (containerEl.__ignoreCtxUntil || 0)) return;
          try { containerEl.__ignoreClickUntil = Date.now() + 650; } catch (_) {}
          openBookMenu(book, moreBtn || containerEl, { x: e.clientX, y: e.clientY });
        }, true);
      } catch (e) {}
    }

    function installBookMoreHitZone(book, containerEl, moreBtn) {
      try {
        if (!containerEl) return;
        containerEl.addEventListener('pointerup', function (e) {
          if (!e) return;
          if (e.button !== 0) return;
          if (e.pointerType === 'mouse') return; // desktop: precise enough
          if (e.target && e.target.closest && e.target.closest('.book-more')) return;

          var rect = containerEl.getBoundingClientRect();
          var x = e.clientX - rect.left;
          var y = e.clientY - rect.top;
          var zone = Math.min(78, Math.max(56, Math.min(rect.width, rect.height) * 0.28));
          if (x >= rect.width - zone && y >= rect.height - zone) {
            try { containerEl.__ignoreClickUntil = Date.now() + 650; } catch (_) {}
            openBookMenu(book, moreBtn || containerEl, { x: e.clientX, y: e.clientY });
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
          }
        }, true);
      } catch (e) {}
    }

    var bookMenuEl = null;
    function closeBookMenu() {
      if (bookMenuEl && bookMenuEl.remove) bookMenuEl.remove();
      bookMenuEl = null;
    }

    function removeBookById(bookId) {
      if (!bookId) return null;
      var books = getBooks();
      if (!books || books.length <= 1) return null;

      var idx = -1;
      for (var i = 0; i < books.length; i++) {
        if (books[i] && books[i].id === bookId) { idx = i; break; }
      }
      if (idx < 0) return null;

      var removed = books.splice(idx, 1)[0];
      if (appData && appData.currentBookId === bookId) {
        var next = books[Math.min(idx, books.length - 1)];
        appData.currentBookId = next ? next.id : null;
        currentChapterId = null;
      }
      return { index: idx, book: removed };
    }

    function openBookMenu(book, anchorEl, atPoint) {
      closeBookMenu();
      if (!book || !anchorEl) return;

      var menu = document.createElement('div');
      menu.className = 'book-menu';
      menu.innerHTML =
        '<button type="button" data-act="rename">自定义</button>' +
        '<button type="button" data-act="open">打开</button>' +
        '<button type="button" data-act="exam">考试</button>' +
        '<button type="button" data-act="delete">删除</button>';

      document.body.appendChild(menu);
      bookMenuEl = menu;

      var rect = anchorEl.getBoundingClientRect();
      var ax = rect.right;
      var ayTop = rect.top;
      var ayBottom = rect.bottom;
      if (atPoint && typeof atPoint.x === 'number' && typeof atPoint.y === 'number') {
        ax = atPoint.x;
        ayTop = atPoint.y;
        ayBottom = atPoint.y;
      }

      var left = Math.min(window.innerWidth - menu.offsetWidth - 12, Math.max(12, ax - menu.offsetWidth));
      var preferDown = ayBottom + 8 + menu.offsetHeight <= window.innerHeight - 12;
      var top = preferDown ? (ayBottom + 8) : (ayTop - menu.offsetHeight - 8);
      top = Math.min(window.innerHeight - menu.offsetHeight - 12, Math.max(12, top));
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';

      var onDoc = function (e) {
        if (!bookMenuEl) return;
        if (e && (bookMenuEl === e.target || (e.target && e.target.closest && e.target.closest('.book-menu')))) return;
        closeBookMenu();
        document.removeEventListener('click', onDoc, true);
      };
      document.addEventListener('click', onDoc, true);

      menu.onclick = function (e) {
        var btn = e && e.target && e.target.closest ? e.target.closest('button') : null;
        if (!btn) return;
        var act = btn.getAttribute('data-act');
        closeBookMenu();
        if (act === 'open') {
          openBookWithAnimation(book, anchorEl.closest('.book-container') || anchorEl);
          return;
        }
        if (act === 'rename') {
          openRenameBookModal(book);
          return;
        }
        if (act === 'exam') {
          if (typeof openExamForBookId === 'function') openExamForBookId(book.id);
          else showToast('考试功能未就绪', { timeoutMs: 2000 });
          return;
        }
        if (act === 'delete') {
          var books = getBooks();
          if (!books || books.length <= 1) {
            showToast('至少保留一本书');
            return;
          }

          var title = (book && typeof book.title === 'string' && book.title.trim()) ? book.title.trim() : '未命名书';
          var ok = false;
          try { ok = confirm('确定删除《' + title + '》？'); } catch (_) { ok = false; }
          if (!ok) return;

          var removed = removeBookById(book.id);
          if (!removed || !removed.book) {
            showToast('删除失败');
            return;
          }

          saveData();
          renderHome();
          renderSidebar();

          showToast('已删除《' + title + '》', {
            actionText: '撤销',
            timeoutMs: 8000,
            onAction: function () {
              try {
                var list = getBooks();
                if (!Array.isArray(list)) return;
                list.splice(Math.max(0, Math.min(removed.index, list.length)), 0, normalizeBook(removed.book));
                if (appData) appData.currentBookId = removed.book.id;
                saveData();
                renderHome();
                renderSidebar();
              } catch (e) {}
            }
          });
          return;
        }
      };
    }
