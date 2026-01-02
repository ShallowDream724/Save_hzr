    /** ---------------------------
     * 3) 工具
     * --------------------------- */
    function escapeHtml(text) {
      if (text === null || text === undefined) return '';
      return String(text).replace(/[&<>"']/g, function (m) {
        return ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;'
        })[m];
      });
    }

    function clampTextChars(s, maxChars) {
      s = String(s || '');
      maxChars = Number(maxChars);
      if (!Number.isFinite(maxChars) || maxChars <= 0) return '';
      if (s.length <= maxChars) return s;
      return s.slice(0, maxChars) + '…';
    }

    function topBarTitleMaxChars() {
      var w = 1024;
      try { w = Number(window.innerWidth) || 1024; } catch (_) { w = 1024; }
      if (w <= 720) return 8; // phone: max 8 chars (avoid overflow)
      if (w <= 1024) return 24;
      return 40;
    }

    function setTopBarTitle(fullTitle) {
      if (!els || !els.chapterTitle) return;
      var full = String(fullTitle || '');
      try { els.chapterTitle.dataset.fullTitle = full; } catch (_) {}
      try { els.chapterTitle.title = full; } catch (_) {}
      els.chapterTitle.innerText = clampTextChars(full, topBarTitleMaxChars());
    }

    function refreshTopBarTitleClamp() {
      if (!els || !els.chapterTitle) return;
      var full = '';
      try { full = String(els.chapterTitle.dataset.fullTitle || ''); } catch (_) { full = ''; }
      if (!full) full = String(els.chapterTitle.innerText || '');
      setTopBarTitle(full);
    }

    // Keep the title clamp correct on orientation change / resize.
    (function () {
      var t = null;
      addEvt(window, 'resize', function () {
        if (t) clearTimeout(t);
        t = setTimeout(function () {
          t = null;
          refreshTopBarTitleClamp();
        }, 80);
      }, { passive: true });
    })();

    function hashStr(str) {
      str = String(str || '');
      var h = 5381;
      for (var i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
      return h >>> 0;
    }

    function pickHighlightColor(seed, text) {
      var ui = appData && appData.ui ? normalizeUi(appData.ui) : defaultUi();
      var palette = (ui.highlightPalette && ui.highlightPalette.length) ? ui.highlightPalette : UI_DEFAULTS.highlightPalette;
      if (!palette.length) palette = UI_DEFAULTS.highlightPalette;

      if (ui.highlightMode === 'random') {
        return palette[Math.floor(Math.random() * palette.length)];
      }
      var h = hashStr(String(seed || '') + '|' + String(text || ''));
      return palette[h % palette.length];
    }

    function applyRandomHighlights(rootEl) {
      if (!rootEl || !rootEl.querySelectorAll) return;
      var spans = rootEl.querySelectorAll('span.highlight');
      if (!spans || !spans.length) return;

      var ui = appData && appData.ui ? normalizeUi(appData.ui) : defaultUi();
      var alpha = Number(ui.highlightIntensity);
      if (!Number.isFinite(alpha)) alpha = UI_DEFAULTS.highlightIntensity;

      var seed = (rootEl && rootEl.dataset && rootEl.dataset.hzrSeed) ? rootEl.dataset.hzrSeed : 'seed';

      for (var i = 0; i < spans.length; i++) {
        var el = spans[i];
        if (!el) continue;

        // 如果作者已经指定了颜色，就不改（兼容旧数据）
        if (el.classList && (el.classList.contains('highlight--yellow') ||
            el.classList.contains('highlight--pink') ||
            el.classList.contains('highlight--orange'))) {
          continue;
        }

        var hex = pickHighlightColor(seed, el.textContent || '');
        var bg = rgba(hex, alpha);
        if (!bg) continue;
        el.style.backgroundColor = bg;
        el.dataset.hzrHl = hex;
      }
    }

    function refreshHighlightsInDocument() {
      if (typeof document === 'undefined') return;
      // question cards
      var cards = document.querySelectorAll('.question-card');
      for (var i = 0; i < cards.length; i++) applyRandomHighlights(cards[i]);
      // AI chat (messages + context)
      if (els.aiChatModal) applyRandomHighlights(els.aiChatModal);
      // settings preview (and other modal content)
      if (els.settingsModal) applyRandomHighlights(els.settingsModal);
    }

    function formatInlineEmphasis(html) {
      if (html === null || html === undefined) return '';
      var s = String(html);
      // 支持常见的 Markdown 强调（AI 常写）：**加粗**、__下划线__、*斜体*
      s = s.replace(/\*\*([\s\S]+?)\*\*/g, "<span class='bold-em'>$1</span>");
      s = s.replace(/__([\s\S]+?)__/g, "<span class='underline-em'>$1</span>");
      // 仅匹配单星号，不吞掉 **...**
      s = s.replace(/(^|[^*])\*([^*]+?)\*([^*]|$)/g, "$1<span class='italic-em'>$2</span>$3");
      return s;
    }

    // Markdown + LaTeX (KaTeX) safe renderer (shared by question cards + AI chat)
    var _mdIt = null;
    function getMarkdownIt() {
      if (_mdIt) return _mdIt;
      try {
        if (typeof window !== 'undefined' && typeof window.markdownit === 'function') {
          _mdIt = window.markdownit({
            html: true, // allow legacy highlight spans; sanitized by DOMPurify
            linkify: true,
            breaks: true
          });
        }
      } catch (e) { _mdIt = null; }
      return _mdIt;
    }

    function sanitizeHtmlWithPurify(html) {
      try {
        if (typeof window !== 'undefined' && window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
          return window.DOMPurify.sanitize(String(html || ''), {
            USE_PROFILES: { html: true },
            ADD_ATTR: ['target', 'rel'],
            FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'link', 'meta'],
            FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover'],
          });
        }
      } catch (e) {}
      return String(html || '');
    }

    function escapeNumericPercentInMathDelimiters(text) {
      text = String(text || '');
      if (text.indexOf('%') === -1) return text;

      function esc(body) {
        // Only escape numeric percents like `1.0%` or `0.11 %` -> `1.0\\%`.
        return String(body || '').replace(/([0-9])\s*%/g, '$1\\%');
      }

      // $$...$$
      text = text.replace(/\$\$([\s\S]*?)\$\$/g, function (_, inner) {
        return '$$' + esc(inner) + '$$';
      });

      // \[...\]
      text = text.replace(/\\\[([\s\S]*?)\\\]/g, function (_, inner2) {
        return '\\[' + esc(inner2) + '\\]';
      });

      // \(...\)
      text = text.replace(/\\\(([\s\S]*?)\\\)/g, function (_, inner3) {
        return '\\(' + esc(inner3) + '\\)';
      });

      // $...$ (single-dollar only; skip $$)
      var out = '';
      var inMath = false;
      var buf = '';
      for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        if (!inMath) {
          if (ch === '$') {
            var prev = (i > 0) ? text.charAt(i - 1) : '';
            var next = (i + 1 < text.length) ? text.charAt(i + 1) : '';
            if (prev !== '\\' && next !== '$') {
              inMath = true;
              out += '$';
              buf = '';
              continue;
            }
          }
          out += ch;
        } else {
          if (ch === '$') {
            var prev2 = (i > 0) ? text.charAt(i - 1) : '';
            if (prev2 !== '\\') {
              out += esc(buf) + '$';
              inMath = false;
              buf = '';
              continue;
            }
          }
          buf += ch;
        }
      }
      if (inMath) out += buf;
      return out;
    }

    function renderMathSafe(rootEl) {
      try {
        if (!rootEl) return;
        if (typeof window === 'undefined') return;
        if (typeof window.renderMathInElement !== 'function') return;

        // Fix KaTeX parse failures caused by numeric percents inside math (e.g. `1.0%`).
        // Do it at DOM-text-node level (post-Markdown) so it can't be stripped by Markdown escaping rules.
        try {
          if (typeof document !== 'undefined' && document.createTreeWalker) {
            var walker = document.createTreeWalker(rootEl, 4 /* NodeFilter.SHOW_TEXT */, null, false);
            var n = null;
            while ((n = walker.nextNode())) {
              if (!n || !n.parentElement) continue;
              // Skip code-ish areas and existing KaTeX output.
              var p = n.parentElement;
              if (p.closest && p.closest('code,pre,textarea,.katex')) continue;
              var v = String(n.nodeValue || '');
              if (v.indexOf('%') === -1) continue;
              var next = escapeNumericPercentInMathDelimiters(v);
              if (next !== v) n.nodeValue = next;
            }
          }
        } catch (_) {}

        window.renderMathInElement(rootEl, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true },
          ],
          throwOnError: false,
          strict: 'ignore',
        });
      } catch (_) {}
    }

    function normalizeMathBlocks(raw) {
      var s = (raw === null || raw === undefined) ? '' : String(raw);
      // Normalize CRLF -> LF for consistent parsing.
      s = s.replace(/\r\n/g, '\n');

      function normalizeDisplayBody(body) {
        body = (body === null || body === undefined) ? '' : String(body);
        body = body.replace(/\r\n/g, '\n');
        body = body.trim();

        // Friendly auto-fix: when users write matrices as newline-separated rows without explicit '\\',
        // KaTeX treats newlines as spaces -> rows collapse into a single line.
        // If the formula contains a matrix environment and has newlines but no explicit row breaks,
        // convert line breaks inside that environment into '\\\\'.
        try {
          var m = body.match(/\\begin\{([a-zA-Z*]+matrix)\}([\s\S]*?)\\end\{\1\}/);
          if (m) {
            var env = m[1];
            var inner = m[2] || '';
            if (inner.indexOf('\\\\') === -1 && inner.indexOf('\n') !== -1) {
              inner = inner.replace(/\n+/g, function (nl) { return ' \\\\ '; });
              body = body.replace(m[0], '\\begin{' + env + '}' + inner + '\\end{' + env + '}');
            }
          }
        } catch (_) {}

        // Collapse newlines so delimiters + body stay in the same text node.
        body = body.replace(/\n+/g, ' ');
        body = body.replace(/[ \t]{2,}/g, ' ');

        // Markdown-it will treat `\\` as an escape and reduce it to `\` in rendered HTML.
        // For KaTeX row breaks (especially matrices), we need the final HTML text to still contain `\\`.
        // Doubling the backslashes here makes Markdown keep the intended `\\` after unescaping.
        body = body.replace(/\\\\/g, '\\\\\\\\');
        return body;
      }

      // KaTeX auto-render expects $$...$$ pairs to exist in the same text node.
      // Users (and AI) often write:
      // $$\n\n...formula...\n\n$$
      // which Markdown turns into separate <p> blocks ("$$", "formula", "$$"), breaking display-math rendering.
      // We normalize $$ blocks by collapsing whitespace so delimiters + body stay in the same text node.
      s = s.replace(/\$\$([\s\S]*?)\$\$/g, function (_, inner) {
        return '$$' + normalizeDisplayBody(inner) + '$$';
      });

      // Same for \[ ... \] blocks (display math).
      s = s.replace(/\\\[([\s\S]*?)\\\]/g, function (_, inner2) {
        return '\\[' + normalizeDisplayBody(inner2) + '\\]';
      });

      return s;
    }

    function normalizePlainTextTables(raw) {
      var s = (raw === null || raw === undefined) ? '' : String(raw);
      s = s.replace(/\r\n/g, '\n');

      // Only attempt when there are multiple lines and some obvious column separators.
      if (s.indexOf('\n') === -1) return s;
      if (!/(\t|  {1,}|\u3000)/.test(s)) return s;

      function trimRight(x) { return String(x || '').replace(/[ \t]+$/g, ''); }
      function isListLine(line) {
        var t = String(line || '').trim();
        if (!t) return false;
        // Ordered list: "1." / "1)" / "1、"
        if (/^\d{1,3}\s*(?:[.)]|、)\s+/.test(t)) return true;
        // Unordered list: "-" / "*" / "+"
        if (/^(?:[-*+])\s+/.test(t)) return true;
        return false;
      }
      function isNumericish(cell) {
        var t = String(cell || '').trim();
        if (!t) return false;
        // Must contain a digit; allow common symbols in stats tables.
        return /[0-9]/.test(t) && /^[0-9\s.+\-/%~≤≥<>×x·:()（）]+$/.test(t.replace(/,/g, ''));
      }

      function splitCells(line) {
        var t = trimRight(line).trim();
        if (!t) return null;
        // Already a markdown table row
        if (t.indexOf('|') !== -1) return null;

        // Prefer tab
        if (t.indexOf('\t') !== -1) {
          var a = t.split(/\t+/).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
          if (a.length >= 2) return a;
        }

        // Prefer multi-space or ideographic space
        if (/(\u3000| {2,})/.test(t)) {
          var b = t.split(/(?:\u3000+| {2,})/).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
          if (b.length >= 2) return b;
        }

        // Last resort: single-space split, but only if this looks numeric-heavy (avoid sentences).
        var parts = t.split(/ +/).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
        if (parts.length >= 3) {
          var nums = 0;
          for (var i = 0; i < parts.length; i++) if (isNumericish(parts[i])) nums++;
          if (nums >= 2) return parts;
        }
        return null;
      }

      function escapePipe(cell) { return String(cell || '').replace(/\|/g, '\\|').trim(); }

      function convertBlockToMarkdownTable(blockText) {
        var lines = String(blockText || '').split('\n').map(trimRight);
        // Do not convert blocks that look like lists (avoid turning "1. ..." into tables).
        var listLines = 0;
        for (var li = 0; li < lines.length; li++) {
          if (isListLine(lines[li])) listLines++;
        }
        if (listLines >= 2) return null;

        var rows = [];
        for (var i = 0; i < lines.length; i++) {
          var ln = lines[i];
          if (!String(ln || '').trim()) continue;
          if (isListLine(ln)) return null;
          // Avoid converting obvious prose blocks.
          if (String(ln).trim().length > 160 && String(ln).indexOf('\t') === -1 && !/( {2,}|\u3000)/.test(String(ln))) return null;
          var cells = splitCells(ln);
          if (!cells) return null;
          rows.push(cells);
        }
        if (rows.length < 2) return null;

        // Require stable column count.
        var colCount = rows[0].length;
        if (colCount < 2 || colCount > 14) return null;
        for (var r = 1; r < rows.length; r++) if (rows[r].length !== colCount) return null;

        // Reduce false positives: require at least one numeric-ish cell in the whole block.
        var hasNum = false;
        for (var rr = 0; rr < rows.length; rr++) {
          for (var cc = 0; cc < rows[rr].length; cc++) {
            if (isNumericish(rows[rr][cc])) { hasNum = true; break; }
          }
          if (hasNum) break;
        }
        if (!hasNum) return null;

        // Determine if first row is likely a header (wordy) or data (numeric-heavy).
        var firstNum = 0;
        for (var c0 = 0; c0 < colCount; c0++) if (isNumericish(rows[0][c0])) firstNum++;
        var useGenericHeader = firstNum >= Math.ceil(colCount * 0.6);

        var header = useGenericHeader
          ? (function () { var h = []; for (var k = 0; k < colCount; k++) h.push('列' + (k + 1)); return h; })()
          : rows[0];

        var body = useGenericHeader ? rows : rows.slice(1);

        // Alignment: right-align numeric-heavy columns in body.
        var aligns = [];
        for (var col = 0; col < colCount; col++) {
          var num = 0;
          for (var br = 0; br < body.length; br++) if (isNumericish(body[br][col])) num++;
          var ratio = body.length ? (num / body.length) : 0;
          // First column is usually a label/category; keep it left-aligned for readability.
          aligns[col] = (col !== 0 && ratio >= 0.7) ? '---:' : '---';
        }

        function rowToLine(arr) {
          return '| ' + arr.map(escapePipe).join(' | ') + ' |';
        }

        var out = [];
        out.push(rowToLine(header));
        out.push('| ' + aligns.join(' | ') + ' |');
        for (var b = 0; b < body.length; b++) out.push(rowToLine(body[b]));
        return out.join('\n');
      }

      function processOutsideFences(text) {
        // Split into paragraph-ish blocks by blank lines; convert blocks that look like tables.
        var blocks = String(text || '').split(/\n{2,}/);
        for (var i = 0; i < blocks.length; i++) {
          var b = blocks[i];
          // Skip blocks that already contain markdown table separators.
          if (/\n?\s*\|.*\|\s*\n/.test(b) || /\n?\s*[-:| ]{5,}\s*\n/.test(b)) continue;
          var converted = convertBlockToMarkdownTable(b);
          if (converted) blocks[i] = converted;
        }
        return blocks.join('\n\n');
      }

      // Protect fenced code blocks (``` ... ```) and display-math blocks ($$...$$ / \[...\]).
      var out = [];
      var re = /```[\s\S]*?```|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g;
      var last = 0;
      var m = null;
      while ((m = re.exec(s))) {
        out.push(processOutsideFences(s.slice(last, m.index)));
        out.push(m[0]);
        last = m.index + m[0].length;
      }
      out.push(processOutsideFences(s.slice(last)));
      return out.join('');
    }

    function protectDisplayMathBlocks(raw) {
      raw = String(raw || '');
      var blocks = [];
      // Match $$...$$ and \[...\] (display math). Keep as-is to avoid Markdown tables/lists eating inner chars.
      var re = /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g;
      raw = raw.replace(re, function (m) {
        var idx = blocks.length;
        blocks.push(m);
        return 'HZR_MATH_BLOCK_' + idx + '_END';
      });
      return { text: raw, blocks: blocks };
    }

    function restoreProtectedMathBlocks(rootEl, blocks) {
      if (!rootEl || !blocks || !blocks.length) return;
      if (typeof document === 'undefined' || !document.createTreeWalker) return;

      try {
        var walker = document.createTreeWalker(rootEl, 4 /* NodeFilter.SHOW_TEXT */, null, false);
        var n = null;
        while ((n = walker.nextNode())) {
          if (!n || !n.nodeValue) continue;
          var v = String(n.nodeValue);
          if (v.indexOf('HZR_MATH_BLOCK_') === -1) continue;
          v = v.replace(/HZR_MATH_BLOCK_(\d+)_END/g, function (_, d) {
            var i = Number(d);
            return (Number.isFinite(i) && blocks[i] !== undefined) ? String(blocks[i]) : _;
          });
          n.nodeValue = v;
        }
      } catch (_) {}
    }

    function renderMarkdownInto(el, mdText, opts) {
      if (!el) return;
      opts = opts || {};
      var raw = normalizeMathBlocks(mdText);
      if (!opts.inline) raw = normalizePlainTextTables(raw);

      // Protect display-math blocks from Markdown-it (so inner `|`, list markers, etc. won't break them).
      var protectedMath = protectDisplayMathBlocks(raw);
      raw = protectedMath.text;
      var md = getMarkdownIt();
      var html = md ? (opts.inline ? md.renderInline(raw) : md.render(raw)) : escapeHtml(raw).replace(/\n/g, '<br>');

      // Normalize Markdown emphasis tags to our UI styles (fallback when AI uses Markdown **...** / *...*).
      html = String(html || '')
        .replace(/<strong>/g, "<span class='bold-em'>")
        .replace(/<\/strong>/g, '</span>')
        .replace(/<em>/g, "<span class='italic-em'>")
        .replace(/<\/em>/g, '</span>');

      html = sanitizeHtmlWithPurify(html);
      el.innerHTML = html;
      try { restoreProtectedMathBlocks(el, protectedMath.blocks); } catch (_) {}
      // Ensure links are safe
      try {
        var links = el.querySelectorAll ? el.querySelectorAll('a') : null;
        if (links && links.length) {
          for (var i = 0; i < links.length; i++) {
            var a = links[i];
            if (!a) continue;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
          }
        }
      } catch (_) {}
      renderMathSafe(el);
    }
  
    function uid(prefix) {
      prefix = prefix || 'id';
      return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }
  
    function isObject(x) {
      return x && typeof x === 'object' && !Array.isArray(x);
    }

    function normalizeHex(hex) {
      if (typeof hex !== 'string') return null;
      var s = hex.trim();
      if (!s) return null;
      if (s[0] !== '#') s = '#' + s;
      if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null;
      return s.toUpperCase();
    }

    function hexToRgb(hex) {
      var h = normalizeHex(hex);
      if (!h) return null;
      return {
        r: parseInt(h.slice(1, 3), 16),
        g: parseInt(h.slice(3, 5), 16),
        b: parseInt(h.slice(5, 7), 16)
      };
    }

    function rgba(hex, alpha) {
      var c = hexToRgb(hex);
      if (!c) return null;
      var a = Math.max(0, Math.min(1, Number(alpha)));
      return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
    }

    function mixRgb(a, b, t) {
      t = Math.max(0, Math.min(1, t));
      return {
        r: Math.round(a.r + (b.r - a.r) * t),
        g: Math.round(a.g + (b.g - a.g) * t),
        b: Math.round(a.b + (b.b - a.b) * t)
      };
    }

    function rgbToHex(c) {
      var to = function (n) { var s = n.toString(16); return s.length === 1 ? '0' + s : s; };
      return '#' + to(c.r) + to(c.g) + to(c.b);
    }

    function darken(hex, t) {
      var c = hexToRgb(hex);
      if (!c) return hex;
      return rgbToHex(mixRgb(c, { r: 0, g: 0, b: 0 }, Math.max(0, Math.min(1, t)))).toUpperCase();
    }

    function applyUiToDocument() {
      var ui = appData && appData.ui ? normalizeUi(appData.ui) : defaultUi();
      if (!appData.ui) appData.ui = ui;

      var root = document.documentElement;
      root.style.setProperty('--emphasis-color', ui.emphasisColor);
      root.style.setProperty('--emphasis-soft', rgba(ui.emphasisColor, 0.12) || 'rgba(244,63,94,0.12)');
      root.style.setProperty('--emphasis-soft-2', rgba(ui.emphasisColor, 0.08) || 'rgba(244,63,94,0.08)');

      root.style.setProperty('--analysis-color', ui.analysisColor);
      root.style.setProperty('--analysis-bg-1', rgba(ui.analysisColor, 0.10) || 'rgba(75,143,226,0.10)');
      root.style.setProperty('--analysis-bg-2', rgba(ui.analysisColor, 0.04) || 'rgba(75,143,226,0.04)');
      root.style.setProperty('--analysis-border', rgba(ui.analysisColor, 0.18) || 'rgba(75,143,226,0.18)');
      root.style.setProperty('--analysis-bar', rgba(ui.analysisColor, 0.70) || 'rgba(75,143,226,0.70)');
      root.style.setProperty('--analysis-title', darken(ui.analysisColor, 0.18));

      root.style.setProperty('--knowledge-color', ui.knowledgeColor);
      root.style.setProperty('--knowledge-bg-1', rgba(ui.knowledgeColor, 0.10) || 'rgba(12,84,96,0.10)');
      root.style.setProperty('--knowledge-bg-2', rgba(ui.knowledgeColor, 0.04) || 'rgba(12,84,96,0.04)');
      root.style.setProperty('--knowledge-border', rgba(ui.knowledgeColor, 0.18) || 'rgba(12,84,96,0.18)');
      root.style.setProperty('--knowledge-bar', rgba(ui.knowledgeColor, 0.70) || 'rgba(12,84,96,0.70)');
      root.style.setProperty('--knowledge-title', darken(ui.knowledgeColor, 0.10));

      refreshHighlightsInDocument();
    }
  
    function pointInRect(x, y, rect) {
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }
  
    function getScrollY() {
      return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }
