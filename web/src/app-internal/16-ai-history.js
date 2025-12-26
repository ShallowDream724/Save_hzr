    /** ---------------------------
     * 8.2.1) AI 历史中心（多端可继续对话）
     * --------------------------- */
    var aiHistory = { loading: false };

    function setAiHistoryHint(text) {
      if (!els.aiHistoryHint) return;
      els.aiHistoryHint.textContent = text ? String(text) : '';
    }

    function openAiHistoryModal() {
      if (!els.aiHistoryModal) return;
      if (!getToken()) {
        showToast('请先登录云同步后使用 AI', { timeoutMs: 2400 });
        updateAuthModalUI();
        switchSyncTab('account');
        if (els.authModal) els.authModal.classList.add('open');
        return;
      }
      els.aiHistoryModal.classList.add('open');
      syncModalScrollLock();
      refreshAiHistoryScopeOptions();
      refreshAiHistory();
    }

    function closeAiHistoryModal() {
      if (!els.aiHistoryModal) return;
      els.aiHistoryModal.classList.remove('open');
      syncModalScrollLock();
      setAiHistoryHint('');
    }

    function bookTitleById(bookId) {
      if (!bookId) return '';
      var books = getBooks();
      for (var i = 0; i < books.length; i++) {
        if (books[i] && books[i].id === bookId) {
          var t = (typeof books[i].title === 'string' && books[i].title.trim()) ? books[i].title.trim() : '';
          return t || '';
        }
      }
      return '';
    }

    function refreshAiHistoryScopeOptions() {
      if (!els.aiHistoryScopeSelect) return;
      var prev = (typeof els.aiHistoryScopeSelect.value === 'string') ? els.aiHistoryScopeSelect.value : '';
      var opts = [{ value: '', label: '全部' }, { value: 'general', label: '通用' }];

      var books = getBooks();
      for (var i = 0; i < books.length; i++) {
        var b = books[i];
        if (!b || !b.id) continue;
        var title = (typeof b.title === 'string' && b.title.trim()) ? b.title.trim() : ('书 ' + shortId(b.id));
        opts.push({ value: 'bookid:' + String(b.id), label: title });
      }

      // Render options (avoid blowing away selection if still valid)
      var html = '';
      for (var j = 0; j < opts.length; j++) {
        html += '<option value="' + escapeAttr(opts[j].value) + '">' + escapeHtml(opts[j].label) + '</option>';
      }
      els.aiHistoryScopeSelect.innerHTML = html;

      // Default: when inside a book, bias to that book’s conversations.
      var desired = prev;
      try {
        if ((!desired || desired === 'book' || desired === 'question') && !homeVisible) {
          var ab = getActiveBook();
          if (ab && ab.id) desired = 'bookid:' + String(ab.id);
        }
      } catch (_) {}

      // Restore selection if possible; otherwise fall back to "全部".
      var found = false;
      for (var k = 0; k < opts.length; k++) if (opts[k].value === desired) { found = true; break; }
      els.aiHistoryScopeSelect.value = found ? desired : '';
    }

    function parseAiHistoryFilter(raw) {
      raw = String(raw || '').trim();
      if (!raw) return { scope: null, bookId: null };
      if (raw === 'general') return { scope: 'general', bookId: null };
      if (raw.indexOf('bookid:') === 0) return { scope: null, bookId: raw.slice('bookid:'.length) };
      // legacy values (kept for backward compatibility)
      if (raw === 'book' || raw === 'question') return { scope: raw, bookId: null };
      return { scope: raw, bookId: null };
    }

    function refreshAiHistory() {
      if (aiHistory.loading) return;
      aiHistory.loading = true;
      setAiHistoryHint('加载中…');

      var sel = (els.aiHistoryScopeSelect && typeof els.aiHistoryScopeSelect.value === 'string') ? els.aiHistoryScopeSelect.value : '';
      var f = parseAiHistoryFilter(sel);
      var parts = [];
      if (f.scope) parts.push('scope=' + encodeURIComponent(String(f.scope)));
      if (f.bookId) parts.push('bookId=' + encodeURIComponent(String(f.bookId)));
      var qs = parts.length ? ('?' + parts.join('&')) : '';

      apiFetch('/api/ai/conversations' + qs, { method: 'GET' })
        .then(function (res) { if (!res.ok) throw new Error('load failed'); return res.json(); })
        .then(function (j) {
          var items = (j && Array.isArray(j.items)) ? j.items : [];
          renderAiHistory(items);
          setAiHistoryHint(items.length ? '' : '暂无对话记录。');
        })
        .catch(function (e) {
          setAiHistoryHint('加载失败：' + (e && e.message ? e.message : '网络错误'));
        })
        .then(function () {
          aiHistory.loading = false;
        });
    }

    function renderAiHistory(items) {
      if (!els.aiHistoryList) return;
      var html = '';
      for (var i = 0; i < items.length; i++) {
        var c = items[i];
        if (!c || !c.id) continue;
        var title = c.title ? String(c.title) : '新对话';
        var meta = [];
        if (c.scope === 'general') {
          meta.push('<span class="ai-history-tag">通用</span>');
        } else {
          var bookName = c.bookId ? (bookTitleById(c.bookId) || ('书 ' + shortId(c.bookId))) : '';
          if (bookName) meta.push('<span class="ai-history-tag">' + escapeHtml(bookName) + '</span>');
          if (c.questionId) meta.push('<span class="ai-history-tag">' + escapeHtml('Q' + String(c.questionId)) + '</span>');
        }
        var t = c.lastMessageAt || c.updatedAt || c.createdAt;
        html += '<div class="ai-history-item" data-id="' + escapeHtml(c.id) + '">' +
          '<div class="ai-history-item-main">' +
            '<div class="ai-history-item-title">' + escapeHtml(title) + '</div>' +
            '<div class="ai-history-item-meta">' + meta.join('') + '</div>' +
          '</div>' +
          '<div class="ai-history-time">' + escapeHtml(formatLocalTime(t)) + '</div>' +
        '</div>';
      }
      els.aiHistoryList.innerHTML = html;
    }

    function startNewAiConversation() {
      if (!getToken()) {
        showToast('请先登录云同步后使用 AI', { timeoutMs: 2400 });
        return;
      }

      var scope = homeVisible ? 'general' : 'book';
      var book = (!homeVisible) ? getActiveBook() : null;

      // Lazy-create: do NOT create server conversation until user sends the first message.
      closeAiHistoryModal();
      aiChat.conversationId = null;
      aiChat.scope = scope;
      aiChat.lastQuestionContext = '';
      aiChat.pendingSelectedText = '';
      renderAiChatQuote();
      try { clearAiMessages(); } catch (_) {}
      try { if (els.aiChatTitle) els.aiChatTitle.textContent = '新对话'; } catch (_) {}
      try { setModelSwitchValue(els.aiChatModelSwitch, 'flash'); } catch (_) {}
      var pref = 'flash';
      try { pref = getModelFromSwitch(els.aiChatModelSwitch, 'flash'); } catch (_) { pref = 'flash'; }
      setPendingCreate({
        scope: scope,
        bookId: (scope === 'book' && book && book.id) ? String(book.id) : null,
        modelPref: pref
      });
      setAiChatHint('输入问题开始对话');
      openAiChatModal();
    }
