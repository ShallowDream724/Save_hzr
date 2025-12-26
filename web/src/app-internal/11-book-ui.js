    var bookModalMode = 'create'; // create | rename
    var bookModalTargetId = null;
    var bookModalTheme = 'blue';
    var bookModalIcon = '✚';

    function ensureBookModalChoiceUIs() {
      if (els.bookThemeChoices && !els.bookThemeChoices.dataset.bound) {
        els.bookThemeChoices.dataset.bound = '1';
        els.bookThemeChoices.addEventListener('click', function (e) {
          var btn = e && e.target && e.target.closest ? e.target.closest('button[data-theme]') : null;
          if (!btn) return;
          var v = btn.getAttribute('data-theme');
          if (!isValidBookTheme(v)) return;
          bookModalTheme = v;
          updateBookModalChoiceSelection();
        });
      }
      if (els.bookIconChoices && !els.bookIconChoices.dataset.bound) {
        els.bookIconChoices.dataset.bound = '1';
        els.bookIconChoices.addEventListener('click', function (e) {
          var btn = e && e.target && e.target.closest ? e.target.closest('button[data-icon]') : null;
          if (!btn) return;
          var v = btn.getAttribute('data-icon');
          if (!isValidBookIcon(v)) return;
          bookModalIcon = v;
          updateBookModalChoiceSelection();
        });
      }
    }

    function renderBookModalChoices() {
      if (els.bookThemeChoices) {
        els.bookThemeChoices.innerHTML = BOOK_THEMES.map(function (t) {
          return (
            '<button type="button" class="choice-btn" data-theme="' + escapeAttr(t.id) + '" aria-label="' + escapeAttr(t.name) + '">' +
              '<span class="choice-dot theme-' + escapeAttr(t.id) + '"></span>' +
              '<span class="choice-label">' + escapeHtml(t.name) + '</span>' +
            '</button>'
          );
        }).join('');
      }
      if (els.bookIconChoices) {
        els.bookIconChoices.innerHTML = BOOK_ICONS.map(function (ico) {
          return (
            '<button type="button" class="choice-btn choice-btn--icon" data-icon="' + escapeAttr(ico) + '" aria-label="' + escapeAttr(ico) + '">' +
              '<span class="choice-icon">' + escapeHtml(ico) + '</span>' +
            '</button>'
          );
        }).join('');
      }
      updateBookModalChoiceSelection();
    }

    function updateBookModalChoiceSelection() {
      try {
        if (els.bookThemeChoices) {
          var themeBtns = els.bookThemeChoices.querySelectorAll('button[data-theme]');
          for (var i = 0; i < themeBtns.length; i++) {
            var btn = themeBtns[i];
            btn.classList.toggle('selected', btn.getAttribute('data-theme') === bookModalTheme);
          }
        }
        if (els.bookIconChoices) {
          var iconBtns = els.bookIconChoices.querySelectorAll('button[data-icon]');
          for (var j = 0; j < iconBtns.length; j++) {
            var ib = iconBtns[j];
            ib.classList.toggle('selected', ib.getAttribute('data-icon') === bookModalIcon);
          }
        }
      } catch (e) {}
    }

    function openBookModalWithMode(mode, book) {
      if (!els.bookModal) return;
      ensureBookModalChoiceUIs();
      renderBookModalChoices();

      bookModalMode = (mode === 'rename') ? 'rename' : 'create';
      bookModalTargetId = (mode === 'rename' && book && book.id) ? book.id : null;

      var title = (mode === 'rename') ? '编辑书' : '新建书';
      var btnText = (mode === 'rename') ? '保存' : '创建';

      var h3 = els.bookModal.querySelector('h3');
      if (h3) h3.textContent = title;
      if (els.bookCreateBtn) els.bookCreateBtn.textContent = btnText;

      if (els.bookNameInput) els.bookNameInput.value = (book && typeof book.title === 'string') ? book.title : '';

      bookModalTheme = (book && typeof book.theme === 'string' && isValidBookTheme(book.theme)) ? book.theme : 'blue';
      bookModalIcon = (book && typeof book.icon === 'string' && isValidBookIcon(book.icon)) ? book.icon : '✚';
      updateBookModalChoiceSelection();

      els.bookModal.classList.add('open');
      try { if (els.bookNameInput) { els.bookNameInput.focus(); els.bookNameInput.select(); } } catch (_) {}
    }

    function openRenameBookModal(book) { openBookModalWithMode('rename', book); }

    function openBookWithAnimation(book, cardEl) {
      if (!book || !cardEl) {
        if (book && book.id) {
          setActiveBook(book.id);
          saveData();
          hideHomeView();
          renderSidebar();
          if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
          if (els.questionsContainer) els.questionsContainer.innerHTML = '';
        }
        return;
      }

      try {
        if (bookOpenAnim && bookOpenAnim.active) return;
        var el = cardEl;

        var rect = el.getBoundingClientRect();
        var originalState = getComputedStyle(el).transform;

        // Find fixed-position containing block (transformed ancestor), so top/left stay "in place".
        var fixedCB = null;
        try {
          var p = el.parentElement;
          while (p && p !== document.body) {
            var cs = getComputedStyle(p);
            var t = cs.transform;
            var f = cs.filter;
            var persp = cs.perspective;
            var bf = '';
            try {
              if (cs.getPropertyValue) {
                bf = cs.getPropertyValue('backdrop-filter') || cs.getPropertyValue('-webkit-backdrop-filter') || '';
              }
            } catch (_) { bf = ''; }
            if ((t && t !== 'none') || (f && f !== 'none') || (persp && persp !== 'none') || (bf && bf !== 'none')) { fixedCB = p; break; }
            p = p.parentElement;
          }
        } catch (_) { fixedCB = null; }
        var cbRect = fixedCB ? fixedCB.getBoundingClientRect() : null;

        var placeholder = el.cloneNode(true);
        placeholder.style.opacity = 0;
        placeholder.style.pointerEvents = 'none';
        if (el.parentElement) el.parentElement.insertBefore(placeholder, el);

        bookOpenAnim = { active: true, el: el, placeholder: placeholder, originalState: originalState };

        try { el.classList.add('book-opening'); } catch (_) {}
        try { el.style.zIndex = '2500'; } catch (_) {}
        // Hide other books immediately to avoid z-order artifacts during the cover flip.
        try { document.body.classList.add('home-transitioning'); } catch (_) {}

        el.style.position = 'fixed';
        // If fixed is relative to a transformed ancestor, offset by its rect.
        var topPx = rect.top;
        var leftPx = rect.left;
        if (cbRect) {
          topPx = rect.top - cbRect.top;
          leftPx = rect.left - cbRect.left;
        }
        el.style.top = topPx + 'px';
        el.style.left = leftPx + 'px';
        el.style.margin = 0;
        el.style.transform = originalState;
        el.classList.remove('idle');

        // force reflow
        el.offsetHeight;

        // Ensure the element is pixel-perfect "in place" after switching to fixed-position.
        // (Some ancestors create a fixed-position containing block via filter/backdrop-filter/perspective.)
        try {
          var rFixed = el.getBoundingClientRect();
          var ax = rect.left - rFixed.left;
          var ay = rect.top - rFixed.top;
          if (Math.abs(ax) > 0.5 || Math.abs(ay) > 0.5) {
            leftPx += ax;
            topPx += ay;
            el.style.left = leftPx + 'px';
            el.style.top = topPx + 'px';
            el.offsetHeight;
          }
        } catch (_) {}

        // Phase 1: straighten + open cover
        el.classList.add('open-state');
        // Phase 1 should be visually "in place": keep screen rect stable while straightening.
        var targetNoTranslate = 'translate3d(0px, 0px, 0px) rotateY(0deg) rotateX(0deg)';
        var dx = 0;
        var dy = 0;
        try {
          el.style.transition = 'none';
          el.style.transform = targetNoTranslate;
          el.offsetHeight;
          var r2 = el.getBoundingClientRect();
          dx = rect.left - r2.left;
          dy = rect.top - r2.top;
        } catch (_) { dx = 0; dy = 0; }

        try {
          el.style.transform = originalState;
          el.offsetHeight;
        } catch (_) {}

        el.style.transition = 'transform 0.5s ease-out';
        el.style.transform = 'translate3d(' + dx + 'px, ' + dy + 'px, 0px) rotateY(0deg) rotateX(0deg)';

        setTimeout(function () {
          if (!bookOpenAnim || !bookOpenAnim.active || bookOpenAnim.el !== el) return;
          el.classList.add('zooming');
          setWhiteOverlayVisible(true);

          var winW = window.innerWidth;
          var winH = window.innerHeight;
          // Target: the *paper page* should cover the whole viewport (avoid edge leaks).
          var pageEl = null;
          try { pageEl = el.querySelector('.first-page'); } catch (_) { pageEl = null; }
          if (!pageEl) pageEl = el;

          var pr = pageEl.getBoundingClientRect();
          var safeW = Math.max(1, pr.width);
          var safeH = Math.max(1, pr.height);
          var scale = Math.max(winW / safeW, winH / safeH) * 1.08;

          var pageCenterX = pr.left + pr.width / 2;
          var pageCenterY = pr.top + pr.height / 2;
          var moveX = (winW / 2) - pageCenterX;
          var moveY = (winH / 2) - pageCenterY;

          el.style.transform = 'translate3d(' + moveX + 'px,' + moveY + 'px, 100px) scale(' + scale + ')';

          setTimeout(function () {
            if (!bookOpenAnim || !bookOpenAnim.active || bookOpenAnim.el !== el) return;
            cleanupBookOpenAnim();
            setActiveBook(book.id);
            saveData();
            hideHomeView();
            renderSidebar();
            if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
            if (els.questionsContainer) els.questionsContainer.innerHTML = '';
            setTimeout(function () {
              setWhiteOverlayVisible(false);
              try { document.body.classList.remove('home-transitioning'); } catch (_) {}
            }, 120);
          }, 1250);
        }, 450);
      } catch (e) {
        cleanupBookOpenAnim();
        setActiveBook(book.id);
        saveData();
        hideHomeView();
        renderSidebar();
        if (els.chapterTitle) els.chapterTitle.innerText = '请选择章节';
        if (els.questionsContainer) els.questionsContainer.innerHTML = '';
      }
    }

    var bookOpenAnim = null;
    function cleanupBookOpenAnim() {
      try {
        if (!bookOpenAnim) return;
        var el = bookOpenAnim.el;
        var placeholder = bookOpenAnim.placeholder;
        if (placeholder && placeholder.remove) placeholder.remove();
        if (el) {
          try { el.classList.remove('book-opening'); } catch (_) {}
          try { el.style.zIndex = ''; } catch (_) {}
          el.style.position = '';
          el.style.top = '';
          el.style.left = '';
          el.style.margin = '';
          el.style.transform = '';
          el.style.transition = '';
          el.classList.remove('open-state');
          el.classList.remove('zooming');
          el.classList.add('idle');
        }
      } catch (e) {}
      bookOpenAnim = null;
    }
  
    function createFolderElement(folder) {
      var container = document.createElement('div');
      container.className = 'folder-container' + (folder.isOpen ? ' open' : '');
      container.dataset.id = folder.id;
  
      var header = document.createElement('div');
      header.className = 'list-item folder-header';
      header.innerHTML =
        '<div style="display:flex; align-items:center; flex:1; overflow:hidden; pointer-events:none;">' +
          '<i class="fa-solid fa-caret-right folder-arrow"></i>' +
          '<i class="fa-solid fa-folder folder-icon"></i>' +
          '<span class="item-title">' + escapeHtml(folder.title) + '</span>' +
        '</div>' +
        '<div class="item-actions">' +
          '<i class="fa-solid fa-pen action-icon" title="重命名"></i>' +
          '<i class="fa-solid fa-trash action-icon delete" title="删除"></i>' +
        '</div>';
  
      // toggle open
      header.onclick = function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('action-icon')) return;
        folder.isOpen = !folder.isOpen;
        saveData();
        renderSidebar();
      };
  
      // actions
      var actions = header.querySelector('.item-actions');
      if (actions) {
        var renBtn = actions.children[0];
        var delBtn = actions.children[1];
  
        if (renBtn) renBtn.onclick = function (e) {
          e.stopPropagation();
          var name = prompt('重命名:', folder.title);
          if (name) {
            folder.title = name;
            saveData();
            renderSidebar();
          }
        };
  
        if (delBtn) delBtn.onclick = function (e) {
          e.stopPropagation();
          var book = getActiveBook();

          var removedFolder = { id: folder.id, title: folder.title, isOpen: folder.isOpen };
          var moved = [];

          // remove folder
          var newFolders = [];
          for (var i = 0; i < (book.folders || []).length; i++) {
            if (book.folders[i].id !== folder.id) newFolders.push(book.folders[i]);
          }
          book.folders = newFolders;
  
          // cleanup layoutMap
          var map = book.layoutMap || {};
          for (var chId in map) {
            if (map[chId] === folder.id) {
              moved.push(chId);
              delete map[chId];
            }
          }
          book.layoutMap = map;
  
          saveData();
          renderSidebar();

          showToast('已删除文件夹：' + removedFolder.title, {
            actionText: '撤销',
            timeoutMs: 6500,
            onAction: function () {
              book.folders.push(removedFolder);
              if (!book.layoutMap) book.layoutMap = {};
              for (var k = 0; k < moved.length; k++) book.layoutMap[moved[k]] = removedFolder.id;
              saveData();
              renderSidebar();
              showToast('已撤销', { timeoutMs: 2200 });
            }
          });
        };
      }
  
      container.appendChild(header);
  
      var content = document.createElement('div');
      content.className = 'folder-content';
      container.appendChild(content);
  
      return container;
    }
  
    function createChapterElement(chapter) {
      var div = document.createElement('div');
      div.className = 'list-item chapter-item' + (chapter.id === currentChapterId ? ' active' : '');
      div.dataset.id = chapter.id;
  
      // iOS 长按不弹出系统选择/菜单（尽量）
      div.style.webkitTouchCallout = 'none';
  
      var icon = chapter.isStatic
        ? '<i class="fa-solid fa-code" title="预设内容" style="color:#95a5a6;"></i>'
        : '<i class="fa-regular fa-file-lines" title="导入内容" style="color:#7f8c8d;"></i>';
  
      div.innerHTML =
        '<div style="display:flex; align-items:center; gap:8px; overflow:hidden; pointer-events:none;">' +
          icon +
          '<span class="item-title">' + escapeHtml(chapter.title) + '</span>' +
        '</div>' +
        '<div class="item-actions">' +
          '<i class="fa-solid fa-pen action-icon rename" title="重命名"></i>' +
          '<i class="fa-solid fa-trash action-icon delete" title="删除章节"></i>' +
        '</div>';
  
      // click to load (拖拽结束后短时间内忽略 click，防误触)
      div.onclick = function (e) {
        if (e.target && e.target.closest && e.target.closest('.action-icon, .drag-handle')) return;
        if (Date.now() < drag.suppressClickUntil) return;
        loadChapter(chapter.id);
      };
  
      // delete
      var delIcon = div.querySelector('.action-icon.delete');
      if (delIcon) {
        delIcon.onclick = function (e) {
          e.stopPropagation();
          deleteChapter(chapter.id);
        };
      }

      // rename
      var renameIcon = div.querySelector('.action-icon.rename');
      if (renameIcon) {
        renameIcon.onclick = function (e) {
          e.stopPropagation();
          var book = getActiveBook();
          var cur = (chapter && typeof chapter.title === 'string') ? chapter.title.trim() : '';
          var next = prompt('重命名章节', cur || '未命名章节');
          if (next === null) return;
          next = String(next || '').trim();
          if (!next) {
            showToast('章节名不能为空', { timeoutMs: 2200 });
            return;
          }
          if (next.length > 80) {
            showToast('章节名过长（最多 80 字）', { timeoutMs: 2200 });
            return;
          }

          var id = String(chapter.id || '');
          if (!id) return;

          if (String(id).indexOf('static_') === 0 || chapter.isStatic) {
            if (!book.chapterTitleOverrides || typeof book.chapterTitleOverrides !== 'object' || Array.isArray(book.chapterTitleOverrides)) {
              book.chapterTitleOverrides = {};
            }
            var base = '';
            for (var i = 0; i < staticData.length; i++) {
              if (staticData[i] && staticData[i].id === id) { base = String(staticData[i].title || '').trim(); break; }
            }
            if (base && next === base) delete book.chapterTitleOverrides[id];
            else book.chapterTitleOverrides[id] = next;
          } else {
            var list = book.chapters || [];
            for (var j = 0; j < list.length; j++) {
              if (list[j] && list[j].id === id) {
                list[j].title = next;
                break;
              }
            }
          }

          try { book.updatedAt = new Date().toISOString(); } catch (_) {}
          saveData();
          renderSidebar();
          try {
            if (currentChapterId === id) {
              var ch2 = findChapterById(id);
              if (els.chapterTitle) els.chapterTitle.innerText = (ch2 && ch2.title) ? String(ch2.title) : next;
            }
          } catch (_) {}
        };
      }
  
      // drag bind
      bindDragStart(div, chapter.id);
  
      // prevent context menu
      div.oncontextmenu = function (e) { e.preventDefault(); return false; };
  
      return div;
    }
  
