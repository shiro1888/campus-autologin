/**
 * 校园网自动登录 — 内容脚本 (content.js)
 *
 * 作用：当浏览器被校园网门户拦截至 http://172.30.100.2/ 登录页时，
 *       自动读取已保存的账号密码填入表单并点击登录按钮。
 *
 * 为什么需要它：
 *   后台 service worker 直接 fetch 门户接口虽然可行，但部分 Chrome 版本
 *   对 http:// 明文请求或预检请求（PNA）有限制。内容脚本运行在门户页
 *   自身的源里，由页面自己发起同源请求，因此最稳。
 *
 * 本脚本只做三件事：
 *   1) 先查 chkstatus，已在线就直接退出（不打扰用户）
 *   2) 等页面渲染出登录表单，自动填写账号密码、选中运营商
 *   3) 点击登录按钮；若 5 秒后仍未上线，则用同源 fetch 兜底登录
 */

'use strict';

(function () {
  const JS_VERSION = '4.1.3';
  const FILL_TIMEOUT_MS = 20000;   // 等待表单出现的最长时间
  const POLL_MS = 300;

  let done = false;   // 防止重复执行

  // ---------------------------------------------------------------------
  // 工具
  // ---------------------------------------------------------------------

  function parseJsonp(text) {
    if (!text) return null;
    const m = String(text).match(/\(\s*(\{[\s\S]*\})\s*\)/);
    if (!m) return null;
    try {
      return JSON.parse(m[1]);
    } catch (e) {
      return null;
    }
  }

  function getSettings() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(
          { account: '', password: '', isp: '1', contentAutoFill: true, manualLogout: false },
          function (s) {
            resolve({
              account: (s && s.account) || '',
              password: (s && s.password) || '',
              isp: (s && s.isp) || '1',
              enabled: !s || s.contentAutoFill !== false,
              // 用户手动注销后暂停一切自动登录（含本脚本的自动填单），
              // 否则断网被跳转到门户时这里又会把人登回去，注销依然无效。
              paused: !!(s && s.manualLogout)
            });
          }
        );
      } catch (e) {
        resolve({ account: '', password: '', isp: '1', enabled: false, paused: true });
      }
    });
  }

  /**
   * 凭证脱敏：擦除文本中的账号/密码查询参数值（与 background.js 同源规则）。
   *
   * content.js 的 report() 会把消息交给后台落盘（lastResult / eventLogs），
   * 其中 message 可能拼接了门户返回的 msga / msg —— 属于不可控外部文本。
   * 页面本身就在门户源下，若门户（或被篡改的明文 HTTP 响应）回显了含
   * upass= 的 URL，密码会顺着消息写进日志并显示在时间轴与诊断报告里。
   * 在唯一的出口做一次确定性擦除，比在每个调用点各自小心更可靠。
   */
  const URL_CREDENTIAL_RE = /((?:DDDDD|upass|password|passwd|pwd|account)=)([^&\s"']*)/gi;
  function redactCredentials(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(URL_CREDENTIAL_RE, function (m, p1) { return p1 + '***'; });
  }

  /** 告诉后台记录一次结果（message 统一脱敏后再上报） */
  function report(r) {
    try {
      const payload = Object.assign({}, r);
      if (payload.message !== undefined) payload.message = redactCredentials(payload.message);
      chrome.runtime.sendMessage({ type: 'contentResult', result: payload }, function () {
        void chrome.runtime.lastError;   // 后台没醒也无所谓
      });
    } catch (e) {
      /* 忽略 */
    }
  }

  const DECODER_CACHE = {};
  /**
   * 取（并缓存）TextDecoder 实例。
   * 用 `key in DECODER_CACHE` 判断缓存：构造失败时写入 null，若用真值判断
   * 会把它当成未缓存而每次重复尝试构造（与 background.js 保持一致）。
   */
  function getDecoder(enc, fatal) {
    const key = enc + '-' + !!fatal;
    if (key in DECODER_CACHE) return DECODER_CACHE[key];
    if (typeof TextDecoder === 'undefined') return null;
    try {
      DECODER_CACHE[key] = new TextDecoder(enc, { fatal: !!fatal });
    } catch (e) {
      DECODER_CACHE[key] = null;
    }
    return DECODER_CACHE[key];
  }

  /** 归一化编码名：utf8 -> utf-8，统一小写 */
  function normalizeEnc(enc) {
    const e = String(enc || '').toLowerCase().trim();
    return e === 'utf8' ? 'utf-8' : e;
  }

  /**
   * 解码门户响应字节（与 background.js 的 decodePortalBytes 同源逻辑）。
   *
   * 不能只信响应头声明的 charset：GBK 几乎不会解码失败，一旦 UTF-8 内容被
   * 错标成 charset=gbk（网关/代理改写头部），会静默产出「鐧诲綍鎴愬姛」这类
   * 乱码，导致门户中文错误提示与按中文关键字匹配的判定一起失效。
   * 故先用「是否为合法 UTF-8」做结构化判定（真实 GBK 中文几乎不可能是合法
   * UTF-8：其双字节序列的次字节常落在 0x40-0x7E 区，fatal 会直接抛错）。
   */
  function decodePortalBytes(bytes, declaredCharset) {
    const declared = normalizeEnc(declaredCharset);
    let hasNonAscii = false;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] > 0x7f) { hasNonAscii = true; break; }
    }

    // 1) 结构校验 + 优先按 UTF-8 解（覆盖「声明缺失」与「错标 gbk」两种场景）
    if (hasNonAscii) {
      const utf8Dec = getDecoder('utf-8', true);
      if (utf8Dec) {
        try {
          return utf8Dec.decode(bytes);
        } catch (e) {
          /* 不是合法 UTF-8 -> 走下面的声明优先回退链 */
        }
      }
    }

    // 2) 遵循声明，再按 gbk -> gb18030 -> utf-8 回退
    const candidates = [];
    const pushEnc = function (enc) {
      const k = normalizeEnc(enc);
      if (k && candidates.indexOf(k) === -1) candidates.push(k);
    };
    if (declared) pushEnc(declared);
    pushEnc('gbk');
    pushEnc('gb18030');
    pushEnc('utf-8');

    for (let i = 0; i < candidates.length; i++) {
      try {
        const dec = getDecoder(candidates[i], true);
        if (dec) return dec.decode(bytes);
      } catch (e) {
        /* 编码不匹配，换下一个 */
      }
    }
    const fb = getDecoder('utf-8', false);
    return fb ? fb.decode(bytes) : new TextDecoder('utf-8').decode(bytes);
  }

  /**
   * 带编码自适应的文本拉取。
   * 解码策略统一收敛到 decodePortalBytes，见其注释。
   */
  function fetchPortalText(url, timeoutMs = 8000) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    return fetch(url, {
      cache: 'no-store',
      credentials: 'include',
      signal: controller ? controller.signal : undefined
    })
      .then(function (resp) {
        // 超时定时器必须覆盖整个「读取响应体 + 解码」过程：此前在 header 到达时就
        // clearTimeout，若服务器先发 header 再拖住 body，Promise 会永久挂起。
        return resp.arrayBuffer().then(function (buf) {
          const ct = String(resp.headers && resp.headers.get ? (resp.headers.get('content-type') || '') : '');
          const m = /charset\s*=\s*"?([\w-]+)"?/i.exec(ct);
          return decodePortalBytes(new Uint8Array(buf), m ? m[1] : '');
        });
      })
      .finally(function () {
        if (timer) clearTimeout(timer);
      });
  }

  /** 将原生错误原因转换为友好可读文案 */
  function formatErrMsg(rawMsg) {
    const s = String(rawMsg || '').trim();
    if (!s) return '';
    const low = s.toLowerCase();
    // 宵禁 / 夜间断网判断：
    // 此处原有「按 UTF-8 误解码形成的乱码签名」分支（U+02B1 / U+03BD / U+FFFD），
    // 那是 decodePortalBytes 之前的临时兜底。现在字节解码按「是否合法 UTF-8」结构化
    // 判定，多字中文短语（本时段禁止使用 / 密码错误 等，实测 4 种声明下）都能精确还原，
    // 乱码分支已不可达，故移除；保留反而会误伤本就含这些字符的正常文案。
    if (
      low.indexOf('本时段禁止使用') !== -1 ||
      low.indexOf('禁止使用') !== -1 ||
      low.indexOf('时段') !== -1 ||
      low.indexOf('禁止上网') !== -1
    ) {
      return '当前时段禁止使用校园网（夜间断网/宵禁时段）';
    }
    const errorPatterns = [
      [['userid error2', 'password error', 'error2'], '密码错误，请检查密码'],
      [['userid error1', 'error1'], '账号不存在，请检查账号'],
      [['userid error3'], '账号已被锁定，请联系网络中心'],
      [['userid error4', 'out of service'], '账号已欠费或已停机'],
      [['userid error5'], '账号状态异常，请联系网络中心'],
      [['userid error6'], '该账号已在别处登录'],
      [['userid error0', 'error3'], '账号或密码错误'],
      [['supplicant version too low'], '客户端版本过低'],
      [['auth error'], '认证失败']
    ];
    for (let i = 0; i < errorPatterns.length; i++) {
      const keys = errorPatterns[i][0];
      for (let j = 0; j < keys.length; j++) {
        if (low.indexOf(keys[j]) !== -1) return errorPatterns[i][1];
      }
    }
    return s;
  }

  /** 同源查询在线状态 */
  function checkStatus() {
    return fetchPortalText('/drcom/chkstatus?callback=dr1001&v=' + Date.now() + '&lang=zh&jsVersion=' + JS_VERSION)
      .then(function (t) {
        const d = parseJsonp(t);
        return d ? Number(d.result) === 1 : false;
      })
      .catch(function () { return false; });
  }

  /** 同源兜底登录 */
  function directLogin(account, password, isp) {
    const url = '/drcom/login?callback=dr1002' +
      '&DDDDD=' + encodeURIComponent(account) +
      '&upass=' + encodeURIComponent(password) +
      '&0MKKey=123456&R1=0&R2=&R3=' + encodeURIComponent(isp || '1') +
      '&R6=0&para=00&v6ip=&terminal_type=1&lang=zh-cn&jsVersion=' + JS_VERSION;
    return fetchPortalText(url)
      .then(function (t) {
        const d = parseJsonp(t);
        if (d) {
          const code = String(d.result);
          const rawMsg = String(d.msga || d.msg || '');
          // 「该 IP 已经在线」不是失败：门户在说会话是好的（与 background.js 对齐）。
          // 否则兜底登录会把一个本来就成功的会话显示成「登录失败」。
          if (/ip has been online/i.test(rawMsg)) return { ok: true, msg: '' };
          return { ok: code === '1' || code.toLowerCase() === 'ok', msg: formatErrMsg(rawMsg) };
        }
        // 非结构化响应只认明确的成功标记（纯文本 ok / 成功结果页 / 认证成功）。
        // 不能放宽成 /ok/ 子串：错误页里的 "network"、"token" 都含 ok。
        if (/Dr\.COMWebLoginID_3/.test(t) || /^\s*ok[\s;]*$/i.test(t) || t.indexOf('认证成功') !== -1) {
          return { ok: true, msg: '' };
        }
        return { ok: false, msg: '' };
      })
      .catch(function () { return { ok: false, msg: '请求失败' }; });
  }

  // ---------------------------------------------------------------------
  // 填写表单
  // ---------------------------------------------------------------------

  /** 触发 input / change 事件，让依赖 jQuery 的页面感知到值变化 */
  function fire(el) {
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (window.jQuery) window.jQuery(el).trigger('input').trigger('change');
    } catch (e) {
      /* 忽略 */
    }
  }

  function setValue(el, value) {
    if (!el) return false;
    el.value = value;
    fire(el);
    return true;
  }

  /** 选中运营商（单选按钮或下拉框） */
  function selectIsp(isp) {
    if (!isp) return;
    const targetIsp = String(isp);
    // 下拉框。isp 来自 storage（可能被手改 / 恶意导入注入任意字符串），
    // 不能拼进 CSS 选择器 —— 非法选择器会抛 SyntaxError 炸穿整条填单流程
    // （HUD 会卡在 loading 态），改为线性匹配 option 的 value。
    const sel = document.querySelector('select[name="ISP_select"]');
    if (sel) {
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === targetIsp) {
          sel.value = targetIsp;
          fire(sel);
          return;
        }
      }
      return;   // 无匹配项：保持页面默认选择，不误选
    }
    // 单选按钮组
    const radios = document.querySelectorAll('div[name="ISP_radio"] input[name="network"], div[name="ISP_radio"] input[type="radio"]');
    if (radios && radios.length) {
      for (let i = 0; i < radios.length; i++) {
        if (radios[i].value === targetIsp) {
          radios[i].checked = true;
          fire(radios[i]);
          return;
        }
      }
    }
  }

  /** 找到登录按钮 */
  function findLoginButton() {
    return (
      document.querySelector('input[name="0MKKey"]') ||
      document.querySelector('button[name="0MKKey"]') ||
      document.querySelector('input[type="submit"]') ||
      document.querySelector('button[name="authentication"]')
    );
  }

  /**
   * 尝试填写并提交。
   * @returns {boolean} 是否成功找到表单并提交
   */
  function fillAndSubmit(account, password, isp) {
    const userEl = document.querySelector('input[name="DDDDD"]:not([type="hidden"])') ||
      document.querySelector('form[name="f0"] input[name="DDDDD"]') ||
      document.querySelector('input[name="DDDDD"]');
    const passEl = document.querySelector('input[name="upass"]:not([type="hidden"])') ||
      document.querySelector('form[name="f0"] input[name="upass"]') ||
      document.querySelector('input[name="upass"]');

    if (!userEl || !passEl) return false;

    setValue(userEl, account);
    setValue(passEl, password);
    selectIsp(isp);

    const btn = findLoginButton();
    if (!btn) return false;

    // 同步写入隐藏表单 f0，页面逻辑直接读它
    try {
      if (window.document.f0) {
        if (document.f0.DDDDD) document.f0.DDDDD.value = account;
        if (document.f0.upass) document.f0.upass.value = password;
        if (document.f0.R3) document.f0.R3.value = isp || '1';
      }
    } catch (e) {
      /* 忽略 */
    }

    try {
      btn.click();
    } catch (e) {
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------
  // 主流程
  // ---------------------------------------------------------------------

  function waitForForm(cb) {
    const started = Date.now();
    (function poll() {
      if (done) return;
      const hasUser = document.querySelector('input[name="DDDDD"]');
      const hasPass = document.querySelector('input[name="upass"]');
      if (hasUser && hasPass) {
        cb(true);
        return;
      }
      if (Date.now() - started > FILL_TIMEOUT_MS) {
        cb(false);
        return;
      }
      setTimeout(poll, POLL_MS);
    })();
  }

  /** 移除 HUD（加载态卡住时兜底用） */
  function hideHud() {
    try {
      const hud = document.getElementById('campus-login-hud');
      if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    } catch (e) {
      /* 忽略 */
    }
  }

  /** 在门户页面顶部显示现代浮动指示条（灵动岛毛玻璃风格） */
  function showHud(text, state) {
    try {
      let styleEl = document.getElementById('campus-login-hud-style');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'campus-login-hud-style';
        styleEl.textContent = '@keyframes campusHudSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes campusHudIn{from{opacity:0;transform:translateX(-50%) translateY(-12px) scale(0.94)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}';
        (document.head || document.documentElement).appendChild(styleEl);
      }
      let hud = document.getElementById('campus-login-hud');
      if (!hud) {
        hud = document.createElement('div');
        hud.id = 'campus-login-hud';
        hud.style.cssText = [
          'position:fixed',
          'top:20px',
          'left:50%',
          'transform:translateX(-50%)',
          'z-index:2147483647',
          'background:rgba(15, 23, 42, 0.90)',
          'backdrop-filter:blur(18px) saturate(180%)',
          '-webkit-backdrop-filter:blur(18px) saturate(180%)',
          'color:#f8fafc',
          'padding:9px 18px 9px 12px',
          'border-radius:999px',
          'font-family:-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
          'font-size:13px',
          'font-weight:600',
          'letter-spacing:-0.01em',
          'display:flex',
          'align-items:center',
          'gap:10px',
          'animation:campusHudIn 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
          'transition:all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          'pointer-events:none'
        ].join(';');
        document.body.appendChild(hud);
      }
      const isOk = state === 'success';
      const isErr = state === 'error';
      const accentRgba = isOk
        ? 'rgba(16, 185, 129, 0.45)'
        : (isErr ? 'rgba(239, 68, 68, 0.45)' : 'rgba(59, 130, 246, 0.45)');
      const glowRgba = isOk
        ? 'rgba(16, 185, 129, 0.25)'
        : (isErr ? 'rgba(239, 68, 68, 0.25)' : 'rgba(59, 130, 246, 0.25)');
      const iconBg = isOk ? '#10b981' : (isErr ? '#ef4444' : '#2563eb');
      const iconSvg = isOk
        ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : (isErr
          ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
          : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" style="animation:campusHudSpin 0.85s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>');
      hud.style.boxShadow = '0 14px 32px -6px rgba(0,0,0,0.45), 0 0 20px -2px ' + glowRgba + ', 0 0 0 1px ' + accentRgba + ', inset 0 1px 0 rgba(255,255,255,0.16)';
      // 只把静态 SVG 图标结构交给 innerHTML，动态文本一律用 textContent 赋值。
      // text 里可能含门户返回的内容（如登录失败原因 r.msg），而门户是明文 HTTP，
      // 同网段可被篡改 —— 若直接拼进 innerHTML，等价于把任意 HTML/JS 注入门户页面
      // （实测 <img src=x onerror=...> 会真的执行）。
      hud.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:' + iconBg + ';box-shadow:0 0 10px ' + glowRgba + ';flex-shrink:0;">' + iconSvg + '</span><span></span>';
      const textEl = hud.lastElementChild;
      if (textEl) textEl.textContent = String(text == null ? '' : text);
      if (isOk || isErr) {
        setTimeout(function () {
          if (!hud) return;
          hud.style.opacity = '0';
          hud.style.transform = 'translateX(-50%) translateY(-10px) scale(0.95)';
          setTimeout(function () { if (hud && hud.parentNode) hud.parentNode.removeChild(hud); }, 400);
        }, 3200);
      }
    } catch (e) {
      /* 忽略页面环境异常 */
    }
  }

  /**
   * 跨标签轻量互斥：同一时刻只让一个门户标签发起自动认证。
   *
   * 为什么需要：manifest 的 content_scripts 会给**每个**匹配的门户标签独立注入本脚本。
   * 用户同时开着登录页 + 注销页 + 历史标签很常见，这些实例彼此无感知，
   * 会各自提交认证。而门户对同一账号的并发认证会返回「该 IP 已经在线」，
   * 甚至把刚建立的会话踢掉。
   *
   * 协调机制：统一向后台 service worker 请求互斥锁（acquireAuthLock），
   * 彻底避免 HTTP 非安全上下文无法使用 Web Locks 的限制，保证认证操作单飞串行。
   */

  /** 页面上是否已显示明确的认证拒绝或错误文案（避免盲目重试导致账号被锁定） */
  function detectPageError() {
    try {
      const text = (document.body && document.body.innerText) || '';
      const patterns = [
        /账号不存在/i,
        /密码错误/i,
        /账号或密码错误/i,
        /已被锁定/i,
        /账号已欠费/i,
        /停机/i,
        /系统异常|认证异常/i,
        /userid error/i,
        /password error/i
      ];
      for (let i = 0; i < patterns.length; i++) {
        if (patterns[i].test(text)) {
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  /**
   * 跨标签互斥协调机制：
   * 原生 Web Locks 在 HTTP (非安全上下文) 下不可用。
   * 此处统一向 background service worker 请求互斥锁，彻底保证跨标签串行化。
   */
  function withLock(fn) {
    try {
      chrome.runtime.sendMessage({ type: 'acquireAuthLock' }, function (res) {
        if (chrome.runtime.lastError || !res || !res.ok) {
          // 另一个标签或后台正在处理认证，安静退出，避免并发竞态
          return;
        }
        const token = res.token;
        let released = false;
        function release() {
          if (released) return;
          released = true;
          window.removeEventListener('pagehide', release);
          window.removeEventListener('beforeunload', release);
          try {
            chrome.runtime.sendMessage({ type: 'releaseAuthLock', token: token }, function () {
              void chrome.runtime.lastError;
            });
          } catch (e) {}
        }

        // 关键：btn.click() 若触发表单提交，页面会立刻开始导航，旧文档的 JS
        // 上下文被销毁 —— 5 秒后的兜底复查回调与 p.then(release) 都不会执行。
        // 卸载事件是此刻唯一还能运行的代码路径，尝试主动归还锁：多数情况下
        // sendMessage 能在卸载前送达，把后台从 40 秒等待里立刻解放出来。
        // 注意：pagehide 期间 sendMessage 不保证送达（MV3 已知限制），因此
        // 后台「令牌 + 40s 租期」仍是强杀/消息丢失时的最终兜底，二者缺一不可。
        window.addEventListener('pagehide', release);
        window.addEventListener('beforeunload', release);

        let p;
        try {
          p = fn();
        } catch (e) {
          release();
          return;
        }
        if (p && typeof p.then === 'function') {
          // 用两参数 then 而非 finally：既不产生未处理的 rejection，
          // 成功/失败两条路径也都会归还锁。
          p.then(release, release);
        } else {
          release();
        }
      });
    } catch (e) {
      // 扩展上下文失效或消息通道异常时安静退出，避免无锁并发填单提交
    }
  }

  function main() {
    getSettings().then(function (s) {
      if (!s.enabled || !s.account || !s.password) return;
      // 用户手动注销后不要自动填单提交
      if (s.paused) return;

      // 协调：若后台已经在处理登录（running=true）或处于已在线/暂停，则不重复提交
      try {
        chrome.runtime.sendMessage({ type: 'status' }, function (res) {
          if (chrome.runtime.lastError || !res) {
            proceedLocalCheck();
            return;
          }
          if (res.online || res.running || res.manualLogout) {
            if (res.online) {
              report({ ok: true, online: true, message: '页面加载时已在线，无需登录' });
            }
            return;
          }
          proceedWithForm();
        });
      } catch (e) {
        proceedLocalCheck();
      }

      function proceedLocalCheck() {
        checkStatus().then(function (online) {
          if (online) {
            report({ ok: true, online: true, message: '页面加载时已在线，无需登录' });
            return;
          }
          proceedWithForm();
        });
      }

      function proceedWithForm() {
        waitForForm(function (found) {
          if (!found) {
            // 页面上没有表单（可能是成功页 / 公告页），不打扰
            return;
          }

          // 多标签协调：已有标签在认证中就拿不到锁，安静退出。
          // 锁由后台持有（令牌 + 40s 租期），withLock 会在流程结束后携带令牌释放；
          // 即使标签页中途被关闭，租期到期也会自动兜底释放，不会留下残留。
          withLock(async function () {
            // 拿到锁后再复查一次在线状态：等待表单期间后台 alarm 可能已完成登录，
            // 若此刻已在线就不要再提交表单（会把刚建立的会话踢下线）。
            const alreadyOnline = await checkStatus().catch(function () { return false; });
            if (alreadyOnline) {
              done = true;
              hideHud();
              report({ ok: true, online: true, message: '页面加载时已在线，无需登录' });
              return;
            }
            showHud('校园网自动登录：正在提交认证…', 'loading');
            // 兜底：fillAndSubmit 内部任何未预期的 DOM 异常都不能让
            // loading 态 HUD 永久挂在页面上（loading 态不会自动淡出）。
            let submitted = false;
            try {
              submitted = fillAndSubmit(s.account, s.password, s.isp);
            } catch (e) {
              submitted = false;
            }
            if (!submitted) {
              // 找不到登录按钮 / 点击异常。
              // 注意：loading 态的 HUD 不会自动淡出（只有 success/error 才会），
              // 所以这里必须显式收掉，否则页面顶部会永久挂着「正在提交认证…」。
              hideHud();
              return;
            }

            report({ ok: false, state: 'submitted', online: false, message: '已自动填写并提交登录表单，等待网关响应…' });

            // 兜底：5.0 秒后仍未上线且无明确错误，再用同源 fetch 尝试一次
            await new Promise(function (resolveFallback) {
              setTimeout(async function () {
                try {
                  if (done) return;
                  if (detectPageError()) {
                    done = true;
                    showHud('登录失败：网关返回错误提示', 'error');
                    report({ ok: false, online: false, message: '登录失败：网关返回错误提示' });
                    return;
                  }
                  const ok = await checkStatus();
                  if (ok) {
                    done = true;
                    showHud('校园网认证成功！已在线', 'success');
                    report({ ok: true, online: true, message: '登录成功，已确认在线' });
                    return;
                  }
                  if (detectPageError()) {
                    done = true;
                    showHud('登录失败：网关返回错误提示', 'error');
                    report({ ok: false, online: false, message: '登录失败：网关返回错误提示' });
                    return;
                  }
                  // 兜底登录前复查「手动注销」标志：用户在等待期间点了注销时不得再把人登回。
                  const fresh = await getSettings();
                  if (fresh.paused) {
                    done = true;
                    hideHud();
                    report({ ok: false, online: false, message: '已手动注销，取消兜底登录' });
                    return;
                  }
                  const r = await directLogin(s.account, s.password, s.isp);
                  done = true;
                  if (r.ok) {
                    showHud('校园网认证成功！已在线', 'success');
                  } else {
                    const displayMsg = !r.msg ? '登录失败：认证被拒绝' : (
                      r.msg.indexOf('登录失败') === 0 || r.msg.indexOf('当前时段') === 0 || r.msg.indexOf('认证失败') === 0
                        ? r.msg
                        : ('登录失败：' + r.msg)
                    );
                    showHud(displayMsg, 'error');
                  }
                  report({
                    ok: r.ok,
                    online: r.ok,
                    message: r.ok ? '登录成功（兜底请求）' : ('登录失败：' + (r.msg || '认证被拒绝'))
                  });
                } catch (e) {
                  hideHud();
                } finally {
                  resolveFallback();
                }
              }, 5000);
            });
          });
        });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
