    /** ---------------------------
     * 8.3) 选中引用快捷问 AI（浮动按钮）
     * --------------------------- */
    var aiSel = { btn: null, qid: null, text: '', timer: 0 };

    function ensureAiSelBtn() {
      if (aiSel.btn) return aiSel.btn;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ai-sel-btn';
      btn.textContent = '问AI';
      btn.onclick = function () {
        var qid = aiSel.qid;
        var txt = aiSel.text;
        hideAiSelBtn();
        if (!qid || !txt) return;
        openAiChatForQuestionId(qid, txt);
      };
      document.body.appendChild(btn);
      aiSel.btn = btn;
      return btn;
    }

    function hideAiSelBtn() {
      if (!aiSel.btn) return;
      aiSel.btn.style.display = 'none';
      aiSel.qid = null;
      aiSel.text = '';
    }

    function scheduleAiSelUpdate() {
      if (aiSel.timer) {
        try { clearTimeout(aiSel.timer); } catch (_) {}
        aiSel.timer = 0;
      }
      aiSel.timer = setTimeout(updateAiSelBtn, 120);
    }

    function updateAiSelBtn() {
      aiSel.timer = 0;
      if (!window.getSelection) { hideAiSelBtn(); return; }
      var sel = null;
      try { sel = window.getSelection(); } catch (_) { sel = null; }
      if (!sel || sel.isCollapsed) { hideAiSelBtn(); return; }
      var text = String(sel.toString() || '').trim();
      if (!text) { hideAiSelBtn(); return; }
      // Allow single-character selection (common on mobile / CJK), but avoid obvious noise.
      if (text.length === 1) {
        // If it's just punctuation/whitespace-like, ignore.
        if (/^[\s\u200B\u200C\u200D\uFEFF\u3000.,;:!?'"“”‘’()（）【】\[\]{}<>《》、，。；：！？·\-—_~`|\\\/]+$/.test(text)) {
          hideAiSelBtn(); return;
        }
      }

      var node = sel.anchorNode || sel.focusNode;
      var el = null;
      if (node && node.nodeType === 3) el = node.parentElement;
      else el = node;
      if (!el || !el.closest) { hideAiSelBtn(); return; }
      var card = el.closest('.question-card');
      if (!card || !card.dataset || !card.dataset.qid) { hideAiSelBtn(); return; }

      var rect = null;
      try {
        var range = sel.rangeCount ? sel.getRangeAt(0) : null;
        rect = range ? range.getBoundingClientRect() : null;
        if (rect && rect.width === 0 && rect.height === 0 && range && range.getClientRects) {
          var rects = range.getClientRects();
          if (rects && rects.length) rect = rects[0];
        }
      } catch (_) { rect = null; }
      if (!rect) { hideAiSelBtn(); return; }

      var btn = ensureAiSelBtn();
      aiSel.qid = String(card.dataset.qid);
      aiSel.text = text;

      var left = rect.right + 10;
      var top = rect.top - 8;
      var bw = 54;
      var bh = 34;
      left = Math.max(8, Math.min(window.innerWidth - bw - 8, left));
      top = Math.max(8, Math.min(window.innerHeight - bh - 8, top));
      btn.style.left = left + 'px';
      btn.style.top = top + 'px';
      btn.style.display = 'block';
    }
  
