    /** ---------------------------
     * 0) 兼容：passive listener 检测 + 简易封装
     * --------------------------- */
    var supportsPassive = false;
    try {
      var _opts = Object.defineProperty({}, 'passive', {
        get: function () { supportsPassive = true; }
      });
      window.addEventListener('testPassive', null, _opts);
      window.removeEventListener('testPassive', null, _opts);
    } catch (e) {}
  
    function addEvt(target, type, handler, options) {
      if (!target) return;
      if (supportsPassive) target.addEventListener(type, handler, options || false);
      else target.addEventListener(type, handler, (options && options.capture) ? true : false);
    }
    function rmEvt(target, type, handler, options) {
      if (!target) return;
      if (supportsPassive) target.removeEventListener(type, handler, options || false);
      else target.removeEventListener(type, handler, (options && options.capture) ? true : false);
    }
  
    /** ---------------------------
     * 0.1) DOM polyfill：matches/closest（尽量兼容旧浏览器）
     * --------------------------- */
    if (!Element.prototype.matches) {
      Element.prototype.matches =
        Element.prototype.msMatchesSelector ||
        Element.prototype.webkitMatchesSelector ||
        function (s) {
          var matches = (this.document || this.ownerDocument).querySelectorAll(s);
          var i = matches.length;
          while (--i >= 0 && matches.item(i) !== this) {}
          return i > -1;
        };
    }
    if (!Element.prototype.closest) {
      Element.prototype.closest = function (s) {
        var el = this;
        while (el && el.nodeType === 1) {
          if (el.matches(s)) return el;
          el = el.parentElement || el.parentNode;
        }
        return null;
      };
    }
  
