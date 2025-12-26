    /** ---------------------------
     * 8.1) 题目快捷问 AI（首版：轻量 modal + SSE 流式）
     * --------------------------- */
    var aiChat = {
      conversationId: null,
      scope: null,
      busy: false,
      lastQuestionContext: '',
      pendingSelectedText: ''
    };

    function getModelFromSwitch(switchEl, fallback) {
      var v = '';
      try { v = switchEl && switchEl.dataset && switchEl.dataset.value ? String(switchEl.dataset.value) : ''; } catch (_) { v = ''; }
      if (v === 'flash' || v === 'pro') return v;
      return fallback || 'flash';
    }

    function setModelSwitchValue(switchEl, value) {
      if (!switchEl || !switchEl.querySelectorAll) return;
      var v = (value === 'pro') ? 'pro' : 'flash';
      try { switchEl.dataset.value = v; } catch (_) {}
      var btns = switchEl.querySelectorAll('button[data-value]');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        var on = (b && b.getAttribute && b.getAttribute('data-value') === v);
        try { b.classList.toggle('active', !!on); } catch (_) {}
        try { b.setAttribute('aria-checked', on ? 'true' : 'false'); } catch (_) {}
      }
    }

    function renderAiChatQuote() {
      var txt = aiChat.pendingSelectedText ? String(aiChat.pendingSelectedText) : '';
      if (els.aiChatQuoteText) els.aiChatQuoteText.textContent = txt;
      if (els.aiChatQuote) els.aiChatQuote.style.display = txt ? '' : 'none';
    }

    function autoGrowTextarea(el, maxPx) {
      if (!el) return;
      try {
        el.style.height = 'auto';
        var h = el.scrollHeight || 0;
        if (maxPx && Number.isFinite(maxPx)) h = Math.min(h, maxPx);
        el.style.height = Math.max(44, h) + 'px';
      } catch (_) {}
    }

    var aiChatWindow = {
      dragging: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      startLeft: 0,
      startTop: 0,
      saveTimer: 0,
      resizeObs: null
    };

    function isFinePointerLayout() {
      try {
        if (!window.matchMedia) return false;
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return false;
        // Small screens: keep the chat as a stable sheet (no dragging/resizing), even if a mouse/trackpad exists.
        if (window.matchMedia('(max-width: 899px)').matches) return false;
        return true;
      } catch (_) {
        return false;
      }
    }

    function getAiChatBoxRect() {
      try { return els.aiChatBox ? els.aiChatBox.getBoundingClientRect() : null; } catch (_) { return null; }
    }

    function clamp(n, min, max) {
      n = Number(n);
      if (!Number.isFinite(n)) return min;
      return Math.max(min, Math.min(max, n));
    }

    function applyAiChatWindowStyle(rect) {
      if (!els.aiChatBox || !rect) return;
      var box = els.aiChatBox;
      try {
        box.style.position = 'fixed';
        box.style.left = Math.round(rect.left) + 'px';
        box.style.top = Math.round(rect.top) + 'px';
        box.style.width = Math.round(rect.width) + 'px';
        box.style.height = Math.round(rect.height) + 'px';
        box.style.margin = '0';
        box.style.transform = 'none';
        box.style.maxHeight = 'none';
        box.style.maxWidth = 'none';
        box.classList.add('ai-floating');
      } catch (_) {}
    }

    function saveAiChatWindowPrefsSoon() {
      if (!isFinePointerLayout()) return;
      if (aiChatWindow.saveTimer) return;
      aiChatWindow.saveTimer = window.setTimeout(function () {
        aiChatWindow.saveTimer = 0;
        if (!els.aiChatBox) return;
        if (!els.aiChatModal || !els.aiChatModal.classList.contains('open')) return;
        try {
          var r = els.aiChatBox.getBoundingClientRect();
          var payload = {
            left: Math.round(r.left),
            top: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height)
          };
          localStorage.setItem('hzr_ai_chat_window_v1', JSON.stringify(payload));
        } catch (_) {}
      }, 200);
    }

    function loadAiChatWindowPrefs() {
      if (!isFinePointerLayout()) return null;
      try {
        var raw = localStorage.getItem('hzr_ai_chat_window_v1');
        if (!raw) return null;
        var j = JSON.parse(raw);
        if (!j || typeof j !== 'object') return null;
        var left = Number(j.left), top = Number(j.top), width = Number(j.width), height = Number(j.height);
        if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
        return { left: left, top: top, width: width, height: height };
      } catch (_) {
        return null;
      }
    }

    function applySavedAiChatWindowPrefs() {
      if (!isFinePointerLayout()) return;
      if (!els.aiChatBox) return;
      var j = loadAiChatWindowPrefs();
      if (!j) return;
      var maxW = window.innerWidth || 1200;
      var maxH = window.innerHeight || 800;
      var width = clamp(j.width, 560, Math.max(560, maxW - 20));
      var height = clamp(j.height, 520, Math.max(520, maxH - 20));
      var left = clamp(j.left, 10, Math.max(10, maxW - width - 10));
      var top = clamp(j.top, 10, Math.max(10, maxH - height - 10));
      applyAiChatWindowStyle({ left: left, top: top, width: width, height: height });
    }

    function htmlToText(html) {
      try {
        var div = document.createElement('div');
        div.innerHTML = String(html || '');
        return (div.textContent || div.innerText || '').trim();
      } catch (_) {
        return String(html || '').trim();
      }
    }

    function buildQuestionContextText(book, chapter, q) {
      var out = [];
      if (book && book.title) out.push('书：' + String(book.title));
      if (chapter && chapter.title) out.push('章节：' + String(chapter.title));
      if (q && (q.id !== undefined && q.id !== null)) out.push('题号：' + String(q.id));
      out.push('');
      out.push('【题目】');
      out.push(htmlToText(q && q.text));
      out.push('');
      out.push('【选项】');
      for (var i = 0; i < (q && q.options ? q.options.length : 0); i++) {
        var opt = q.options[i];
        if (!opt) continue;
        out.push(String(opt.label || '') + '. ' + htmlToText(opt.content));
      }
      out.push('');
      out.push('【答案】' + String((q && q.answer) ? q.answer : ''));
      if (q && q.explanation) {
        out.push('');
        out.push('【解析】');
        out.push(htmlToText(q.explanation));
      }
      if (q && q.knowledge) {
        out.push('');
        out.push('【知识点】' + String(q.knowledgeTitle || ''));
        out.push(htmlToText(q.knowledge));
      }
      return out.join('\n').trim();
    }

    function setAiChatHint(text) {
      if (!els.aiChatHint) return;
      var s = text ? String(text) : '';
      els.aiChatHint.textContent = s;
      try { els.aiChatHint.style.display = s ? '' : 'none'; } catch (_) {}
    }

    function openAiChatModal() {
      if (!els.aiChatModal) return;
      hideAiSelBtn();
      els.aiChatModal.classList.add('open');
      syncModalScrollLock();
      applySavedAiChatWindowPrefs();
      renderAiChatQuote();
      autoGrowTextarea(els.aiChatInput, 220);
      try { if (els.aiChatInput) els.aiChatInput.focus(); } catch (_) {}
    }

    function closeAiChatModal() {
      if (!els.aiChatModal) return;
      saveAiChatWindowPrefsSoon();
      els.aiChatModal.classList.remove('open');
      syncModalScrollLock();
      aiChat.busy = false;
      setAiChatHint('');
    }

    function clearAiMessages() {
      if (!els.aiChatMessages) return;
      els.aiChatMessages.innerHTML = '';
    }

    function appendAiBubble(role, text) {
      if (!els.aiChatMessages) return null;
      var wrap = document.createElement('div');
      wrap.className = 'ai-msg ' + role;
      var bubble = document.createElement('div');
      bubble.className = 'ai-bubble ' + role;
      var content = document.createElement('div');
      content.className = 'ai-bubble-content';
      bubble.appendChild(content);
      bubble._contentEl = content;
      renderMarkdownInto(content, String(text || ''));
      wrap.appendChild(bubble);
      els.aiChatMessages.appendChild(wrap);
      try { els.aiChatMessages.scrollTop = els.aiChatMessages.scrollHeight; } catch (_) {}
      return bubble;
    }

    function renderAiConversation(conv, messages) {
      if (els.aiChatTitle) els.aiChatTitle.textContent = (conv && conv.title) ? String(conv.title) : 'AI 对话';
      setModelSwitchValue(els.aiChatModelSwitch, (conv && conv.modelPref) ? String(conv.modelPref) : 'flash');

      // Pull question context from the first system message if present.
      var contextText = '';
      var hasSystemContext = false;
      for (var i = 0; i < (messages || []).length; i++) {
        var m = messages[i];
        if (m && m.role === 'system' && m.text) { contextText = String(m.text); hasSystemContext = true; break; }
      }
      if (!contextText && conv && conv.scope === 'question') contextText = aiChat.lastQuestionContext || '';

      var showContext = !!(conv && conv.scope === 'question' && contextText);
      if (els.aiChatContextText) renderMarkdownInto(els.aiChatContextText, showContext ? contextText : '');
      if (els.aiChatContextWrap) {
        if (showContext) els.aiChatContextWrap.style.display = '';
        else els.aiChatContextWrap.style.display = 'none';
      }

      clearAiMessages();
      for (var j = 0; j < (messages || []).length; j++) {
        var msg = messages[j];
        if (!msg || !msg.role) continue;
        if (msg.role === 'system') continue; // shown in context panel
        appendAiBubble(msg.role === 'assistant' ? 'assistant' : 'user', msg.text || '');
      }
    }

    function loadAiConversation(conversationId) {
      return apiFetch('/api/ai/conversations/' + encodeURIComponent(String(conversationId)), { method: 'GET' })
        .then(function (res) {
          if (!res.ok) throw new Error('load conversation failed');
          return res.json();
        })
        .then(function (j) {
          aiChat.conversationId = j && j.conversation ? j.conversation.id : conversationId;
          renderAiConversation(j.conversation, j.messages || []);
          return j;
        });
    }

    function consumeEventStream(res, onEvent) {
      if (!res || !res.body || !res.body.getReader || typeof TextDecoder === 'undefined') {
        return res.text().then(function (t) { onEvent('error', { message: t || 'no stream' }); });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buf = '';

      function parseBlock(block) {
        var lines = block.split(/\r?\n/);
        var ev = 'message';
        var data = '';
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line) continue;
          if (line[0] === ':') continue;
          if (line.indexOf('event:') === 0) ev = line.slice(6).trim();
          else if (line.indexOf('data:') === 0) data += line.slice(5).trim();
        }
        if (!data) return;
        var obj = null;
        try { obj = JSON.parse(data); } catch (_) { obj = { text: data }; }
        onEvent(ev, obj);
      }

      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += decoder.decode(r.value, { stream: true });
          var parts = buf.split(/\n\n/);
          buf = parts.pop();
          for (var i = 0; i < parts.length; i++) parseBlock(parts[i]);
          return pump();
        });
      }
      return pump();
    }

    function sendAiChatMessage() {
      if (aiChat.busy) return;
      if (!aiChat.conversationId) { showToast('未建立对话', { timeoutMs: 1800 }); return; }
      var msg = (els.aiChatInput && typeof els.aiChatInput.value === 'string') ? els.aiChatInput.value.trim() : '';
      if (!msg) return;

      var modelPref = getModelFromSwitch(els.aiChatModelSwitch, 'flash');
      var selText = aiChat.pendingSelectedText ? String(aiChat.pendingSelectedText) : '';
      aiChat.pendingSelectedText = '';
      renderAiChatQuote();

      if (els.aiChatInput) els.aiChatInput.value = '';
      autoGrowTextarea(els.aiChatInput, 220);
      setAiChatHint('');

      appendAiBubble('user', msg);
      var assistantBubble = appendAiBubble('assistant', '');
      if (assistantBubble) {
        assistantBubble._raw = '';
        try { assistantBubble.dataset.streaming = '1'; } catch (_) {}
        try { assistantBubble.dataset.placeholder = '1'; } catch (_) {}
        try { if (assistantBubble._contentEl) assistantBubble._contentEl.textContent = 'AI 思考中…'; } catch (_) {}
      }
      aiChat.busy = true;
      if (els.aiChatSendBtn) els.aiChatSendBtn.disabled = true;

      apiFetch('/api/ai/conversations/' + encodeURIComponent(String(aiChat.conversationId)) + '/messages/stream', {
        method: 'POST',
        body: JSON.stringify({ userMessage: msg, selectedText: selText, modelPref: modelPref })
      }).then(function (res) {
        return consumeEventStream(res, function (event, data) {
          if (event === 'delta') {
            var t = (data && typeof data.text === 'string') ? data.text : '';
            if (!t) return;
            try { if (assistantBubble && assistantBubble.removeAttribute) assistantBubble.removeAttribute('data-placeholder'); } catch (_) {}
            assistantBubble._raw = (assistantBubble._raw || '') + t;
            var contentEl = assistantBubble._contentEl || assistantBubble;
            try { contentEl.textContent = assistantBubble._raw; } catch (_) {}
            try { if (els.aiChatMessages) els.aiChatMessages.scrollTop = els.aiChatMessages.scrollHeight; } catch (_) {}
            return;
          }
          if (event === 'error') {
            var m = (data && data.message) ? String(data.message) : '请求失败';
            setAiChatHint('失败：' + m);
            try {
              if (assistantBubble && assistantBubble.removeAttribute) {
                assistantBubble.removeAttribute('data-streaming');
                assistantBubble.removeAttribute('data-placeholder');
              }
            } catch (_) {}
            return;
          }
          if (event === 'done') {
            setAiChatHint('');
            try {
              if (assistantBubble && assistantBubble.removeAttribute) {
                assistantBubble.removeAttribute('data-streaming');
                assistantBubble.removeAttribute('data-placeholder');
              }
              if (assistantBubble && (assistantBubble._raw || '').trim()) {
                var contentEl2 = assistantBubble._contentEl || assistantBubble;
                renderMarkdownInto(contentEl2, assistantBubble._raw || '');
              }
            } catch (_) {}
          }
        });
      }).catch(function (e) {
        setAiChatHint('失败：' + (e && e.message ? e.message : '网络错误'));
      }).then(function () {
        aiChat.busy = false;
        if (els.aiChatSendBtn) els.aiChatSendBtn.disabled = false;
        // Refresh from server (keeps multi-device consistent)
        return loadAiConversation(aiChat.conversationId).catch(function () {});
      });
    }

    function openAiChatForQuestionId(qid) {
      var selectedText = arguments.length > 1 ? arguments[1] : '';
      var token = getToken();
      if (!token) {
        showToast('请先登录云同步后使用 AI', { timeoutMs: 2400 });
        updateAuthModalUI();
        switchSyncTab('account');
        if (els.authModal) els.authModal.classList.add('open');
        return;
      }

      var chapter = findChapterById(currentChapterId);
      if (!chapter || !Array.isArray(chapter.questions)) { showToast('未找到题目', { timeoutMs: 1800 }); return; }

      var q = null;
      var qidStr = String(qid);
      var questionId = null;
      for (var i = 0; i < chapter.questions.length; i++) {
        var qq = chapter.questions[i];
        var qqid = (qq && qq.qid !== undefined && qq.qid !== null) ? String(qq.qid)
          : (qq && qq.id !== undefined && qq.id !== null) ? String(qq.id)
          : '';
        if (qqid && qqid === qidStr) { q = qq; questionId = qqid; break; }
      }
      if (!q) { showToast('未找到题目', { timeoutMs: 1800 }); return; }
      if (!questionId) questionId = qidStr;

      var book = getActiveBook();
      var ctx = buildQuestionContextText(book, chapter, q);
      aiChat.lastQuestionContext = ctx;
      aiChat.scope = 'question';
      aiChat.pendingSelectedText = selectedText ? String(selectedText) : '';
      renderAiChatQuote();

      setAiChatHint('建立对话…');
      openAiChatModal();

      var modelPref = getModelFromSwitch(els.aiChatModelSwitch, 'flash');
      apiFetch('/api/ai/conversations', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'question',
          bookId: book && book.id ? String(book.id) : null,
          chapterId: chapter && chapter.id ? String(chapter.id) : null,
          questionId: questionId,
          questionKey: (book && book.id ? String(book.id) : '') + '|' + (chapter && chapter.id ? String(chapter.id) : '') + '|' + String(questionId),
          modelPref: modelPref,
          questionContext: ctx
        })
      }).then(function (res) {
        if (!res.ok) throw new Error('create conversation failed');
        return res.json();
      }).then(function (j) {
        if (!j || !j.conversationId) throw new Error('bad response');
        aiChat.conversationId = j.conversationId;
        return loadAiConversation(aiChat.conversationId);
      }).then(function () {
        if (aiChat.pendingSelectedText) setAiChatHint('已引用选中内容（发送时会带给 AI）');
        else setAiChatHint('');
      }).catch(function (e) {
        setAiChatHint('失败：' + (e && e.message ? e.message : '请求失败'));
      });
    }
