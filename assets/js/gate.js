// ═══════════════════════════════════════════════════════════
// 访问码门槛 · 全站保护
// ★★★ 改访问码只改下面这一行 ★★★
// ═══════════════════════════════════════════════════════════
var GATE_ACCESS_CODE = 'jiajiadiary520'; // ← 改成你自己的访问码

// 提示语（方便以后改）
var GATE_HINT_TEXT = '这是私密页面,请不要转发给他人。如果你没有访问码,请联系站长。';

// 核心参数(颜色、尺寸,方便统一改)
var GATE_THEME = {
  bg:         '#faf8f4',
  cardBg:     '#ffffff',
  accent:     '#3a5a7a',
  accentSoft: '#5b6f8a',
  text:       '#3a3f47',
  textMute:   '#9aa0a8',
  line:       '#e8e3d8',
  danger:     '#b5544a',
  radius:     '10px',
  shadow:     '0 4px 24px rgba(0,0,0,.08)',
  fontSans:   "Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
};

(function () {
  var STORAGE_KEY = 'access_granted';
  var HIDE_STYLE_ID = 'gate-app-hide-style';
  var CSS_ID = 'gate-app-css';
  var hideStyleEl = null;
  var overlayEl = null;
  var exitWidgetEl = null;

  // ---- 最早执行：注入隐藏 body 的样式（防闪烁） ----
  function injectHideStyle() {
    if (document['getElementById'](HIDE_STYLE_ID)) return;
    var s = document['createElement']('style');
    s['id'] = HIDE_STYLE_ID;
    s['textContent'] = 'body{visibility:hidden!important}';
    var head = document['head'] || document['documentElement'];
    head['appendChild'](s);
    hideStyleEl = s;
  }

  // ---- 注入完整 CSS（所有选择器以 .gate-app 开头） ----
  function injectFullCSS() {
    if (document['getElementById'](CSS_ID)) return;
    var s = document['createElement']('style');
    s['id'] = CSS_ID;
    var t = GATE_THEME;
    s['textContent'] = [
      '.gate-app-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:999999;background:' + t['bg'] + ';display:flex;align-items:center;justify-content:center;font-family:' + t['fontSans'] + ';visibility:visible!important}',
      '.gate-app-card{background:' + t['cardBg'] + ';border:1px solid ' + t['line'] + ';border-radius:' + t['radius'] + ';box-shadow:' + t['shadow'] + ';padding:36px 32px;width:90%;max-width:360px;text-align:center}',
      '.gate-app-title{font-size:20px;font-weight:600;color:' + t['text'] + ';margin:0 0 12px}',
      '.gate-app-hint{font-size:13px;color:' + t['textMute'] + ';line-height:1.55;margin:0 0 20px}',
      '.gate-app-input{width:100%;padding:12px 14px;font-size:16px;border:1px solid ' + t['line'] + ';border-radius:8px;color:' + t['text'] + ';background:' + t['cardBg'] + ';outline:none;box-sizing:border-box;font-family:inherit}',
      '.gate-app-input:focus{border-color:' + t['accent'] + '}',
      '.gate-app-btn{width:100%;padding:12px;font-size:15px;font-weight:500;border:none;border-radius:8px;background:' + t['accent'] + ';color:#fff;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;font-family:inherit;margin-top:12px}',
      '.gate-app-btn:active{background:' + t['accentSoft'] + '}',
      '.gate-app-error{color:' + t['danger'] + ';font-size:13px;min-height:20px;margin-top:12px;visibility:hidden}',
      '.gate-app-error.show{visibility:visible}',
      '.gate-app-exit{position:fixed;bottom:16px;right:16px;z-index:999998}',
      '.gate-app-exit-btn{width:36px;height:36px;border:1px solid ' + t['line'] + ';border-radius:50%;background:' + t['cardBg'] + ';color:' + t['textMute'] + ';cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;touch-action:manipulation;-webkit-tap-highlight-color:transparent;box-shadow:' + t['shadow'] + '}',
      '.gate-app-exit-panel{position:absolute;bottom:44px;right:0;background:' + t['cardBg'] + ';border:1px solid ' + t['line'] + ';border-radius:8px;box-shadow:' + t['shadow'] + ';padding:8px;display:none;white-space:nowrap}',
      '.gate-app-exit-panel.show{display:block}',
      '.gate-app-exit-action{display:block;padding:8px 16px;font-size:14px;color:' + t['danger'] + ';border:none;background:none;cursor:pointer;touch-action:manipulation;font-family:inherit}'
    ].join('\n');
    var head = document['head'] || document['documentElement'];
    head['appendChild'](s);
  }

  // ---- 移除隐藏样式 ----
  function removeHideStyle() {
    var el = document['getElementById'](HIDE_STYLE_ID);
    if (el && el['parentNode']) el['parentNode']['removeChild'](el);
    hideStyleEl = null;
  }

  // ---- 创建遮罩 DOM ----
  function createOverlay() {
    if (overlayEl) return;
    overlayEl = document['createElement']('div');
    overlayEl['className'] = 'gate-app-overlay';
    overlayEl['innerHTML'] =
      '<div class="gate-app-card">' +
        '<h2 class="gate-app-title">\u8f93\u5165\u8bbf\u95ee\u7801</h2>' +
        '<p class="gate-app-hint">' + GATE_HINT_TEXT + '</p>' +
        '<input type="password" class="gate-app-input" id="gate-app-input" placeholder="\u8bbf\u95ee\u7801" autocomplete="off" />' +
        '<button type="button" class="gate-app-btn" id="gate-app-submit">\u786e\u8ba4\u8fdb\u5165</button>' +
        '<div class="gate-app-error" id="gate-app-error">\u8bbf\u95ee\u7801\u4e0d\u6b63\u786e</div>' +
      '</div>';
    document['body']['appendChild'](overlayEl);

    var input = document['getElementById']('gate-app-input');
    var btn = document['getElementById']('gate-app-submit');
    var err = document['getElementById']('gate-app-error');

    function verify() {
      var val = input['value'];
      if (val === GATE_ACCESS_CODE) {
        try { localStorage['setItem'](STORAGE_KEY, 'true'); } catch (e) {}
        removeOverlay();
        removeHideStyle();
        createExitWidget();
      } else {
        err['classList']['add']('show');
        input['value'] = '';
        input['focus']();
      }
    }

    btn['addEventListener']('click', verify);
    input['addEventListener']('keydown', function (e) {
      if (e['key'] === 'Enter') verify();
    });

    setTimeout(function () { input['focus'](); }, 100);
  }

  function removeOverlay() {
    if (overlayEl && overlayEl['parentNode']) {
      overlayEl['parentNode']['removeChild'](overlayEl);
    }
    overlayEl = null;
  }

  // ---- 右下角退出按钮 ----
  function createExitWidget() {
    if (exitWidgetEl) return;
    exitWidgetEl = document['createElement']('div');
    exitWidgetEl['className'] = 'gate-app-exit';
    exitWidgetEl['innerHTML'] =
      '<button class="gate-app-exit-btn" id="gate-app-exit-toggle">\u2699</button>' +
      '<div class="gate-app-exit-panel" id="gate-app-exit-panel">' +
        '<button class="gate-app-exit-action" id="gate-app-exit-action">\u9000\u51fa\u8bbf\u95ee</button>' +
      '</div>';
    document['body']['appendChild'](exitWidgetEl);

    var toggle = document['getElementById']('gate-app-exit-toggle');
    var panel = document['getElementById']('gate-app-exit-panel');
    var action = document['getElementById']('gate-app-exit-action');

    toggle['addEventListener']('click', function (e) {
      e['stopPropagation']();
      panel['classList']['toggle']('show');
    });
    document['addEventListener']('click', function () {
      panel['classList']['remove']('show');
    });
    action['addEventListener']('click', function () {
      try { localStorage['removeItem'](STORAGE_KEY); } catch (e) {}
      panel['classList']['remove']('show');
      removeExitWidget();
      injectHideStyle();
      createOverlay();
    });
  }

  function removeExitWidget() {
    if (exitWidgetEl && exitWidgetEl['parentNode']) {
      exitWidgetEl['parentNode']['removeChild'](exitWidgetEl);
    }
    exitWidgetEl = null;
  }

  // ---- 强制兜底：如果 body 还被隐藏了，不管什么原因都强制可见 ----
  function forceBodyVisible() {
    // 1. 删掉残留的 hide-style 标签
    removeHideStyle();
    // 2. 内联 style 兜底（防止某个 .css 文件或内联 style 设了 visibility）
    try {
      if (document['body']) {
        var cur = document['body']['style']['visibility'];
        if (cur && cur !== 'visible') document['body']['style']['visibility'] = '';
      }
    } catch (e) {}
  }

  // ---- 初始化（带重试，防止 DOM 未就绪） ----
  function init(retry) {
    retry = retry || 0;
    if (retry > 50) return;

    if (!document['body']) {
      setTimeout(function () { init(retry + 1); }, 50);
      return;
    }

    injectFullCSS();

    var granted = false;
    try {
      granted = localStorage['getItem'](STORAGE_KEY) === 'true';
    } catch (e) {}

    if (granted) {
      removeHideStyle();
      createExitWidget();
    } else {
      createOverlay();
    }
  }

  // ---- 立即执行：注入隐藏样式（在 head 里就跑，防闪烁） ----
  injectHideStyle();

  // ---- DOM ready 后初始化 ----
  if (document['readyState'] === 'loading') {
    document['addEventListener']('DOMContentLoaded', function () { init(0); });
  } else {
    init(0);
  }

  // ---- BFCACHE / 页面恢复时重新跑 ----
  // iOS Safari / Chrome 在历史导航恢复页面时不重跑 DOMContentLoaded，
  // 但会触发 pageshow。此时可能 hide-style 残留或 body 被意外隐藏。
  document['addEventListener']('pageshow', function (e) {
    forceBodyVisible();
    // 如果有 exit widget 说明已经授权，不需要重新 init
    // 如果没有，再检查一下
    if (!document['getElementById']('gate-app-exit-toggle') &&
        !document['getElementById']('gate-app-submit')) {
      init(0);
    }
  });

  // ---- 页面切回来时（iOS App 切走再回来） ----
  document['addEventListener']('visibilitychange', function () {
    if (!document['hidden']) {
      setTimeout(forceBodyVisible, 50);
    }
  });
})();
