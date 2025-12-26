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

    function renderMathSafe(rootEl) {
      try {
        if (!rootEl) return;
        if (typeof window === 'undefined') return;
        if (typeof window.renderMathInElement !== 'function') return;
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

      // KaTeX auto-render expects $$...$$ pairs to exist in the same text node.
      // Users (and AI) often write:
      // $$\n\n...formula...\n\n$$
      // which Markdown turns into separate <p> blocks ("$$", "formula", "$$"), breaking display-math rendering.
      // We normalize $$ blocks by removing leading/trailing blank lines and collapsing multiple blank lines.
      s = s.replace(/\$\$([\s\S]*?)\$\$/g, function (_, inner) {
        var body = (inner === null || inner === undefined) ? '' : String(inner);
        body = body.replace(/\r\n/g, '\n');
        body = body.trim();
        body = body.replace(/\n{2,}/g, '\n');
        return '$$\n' + body + '\n$$';
      });

      return s;
    }

    function renderMarkdownInto(el, mdText, opts) {
      if (!el) return;
      opts = opts || {};
      var raw = normalizeMathBlocks(mdText);
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
