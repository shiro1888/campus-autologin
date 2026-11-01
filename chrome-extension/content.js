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
 *   3) 点击登录按钮；若 4 秒后仍未上线，则用同源 fetch 兜底登录
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

  /** 告诉后台记录一次结果 */
  function report(r) {
    try {
      chrome.runtime.sendMessage({ type: 'contentResult', result: r }, function () {
        void chrome.runtime.lastError;   // 后台没醒也无所谓
      });
    } catch (e) {
      /* 忽略 */
    }
  }

  /**
   * 带编码自适应的文本拉取。
   * 优先遵循响应头声明的 charset（含 utf-8），声明缺失/解码失败时再回退
   * gbk -> gb18030 -> utf-8。门户 ePortal 接口可能声明 utf-8，若一律 gbk 优先
   * 会把 utf-8 字节误解成乱码（GBK 对多数 utf-8 序列不会抛错）。
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
          const charset = m ? m[1].toLowerCase() : '';
          const candidates = [];
          const pushEnc = function (enc) {
            const k = (enc === 'utf8') ? 'utf-8' : enc;
            if (candidates.indexOf(k) === -1) candidates.push(k);
          };
          if (charset) pushEnc(charset);
          pushEnc('gbk');
          pushEnc('gb18030');
          pushEnc('utf-8');
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < candidates.length; i++) {
            try {
              return new TextDecoder(candidates[i], { fatal: true }).decode(bytes);
            } catch (e) {
              /* 编码不匹配，换下一个 */
            }
          }
          return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
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
    // 1. 宵禁 / 夜间断网判断：
    //    支持正常中文关键字，以及 GBK「本时段禁止使用」被旧脚本或错误 UTF-8 解码后
    //    形成的乱码签名（如 \u02b1(ʱ) 与 \u03bd(ν) 伴随 \ufffd 菱形问号）。
    if (
      low.indexOf('本时段禁止使用') !== -1 ||
      low.indexOf('禁止使用') !== -1 ||
      low.indexOf('时段') !== -1 ||
      low.indexOf('禁止上网') !== -1 ||
      /[\u02b1][\s\S]{0,3}[\u03bd]/.test(s) ||
      /ʱ[\s\S]{0,3}ν/.test(s) ||
      /[\ufffd].*ʱ/.test(s)
    ) {
      return '当前时段禁止使用校园网（夜间断网/宵禁时段）';
    }
    if (low.indexOf('userid error2') !== -1 || low.indexOf('password error') !== -1 || low.indexOf('error2') !== -1) {
      return '密码错误，请检查密码';
    }
    if (low.indexOf('userid error1') !== -1 || low.indexOf('error1') !== -1) {
      return '账号不存在，请检查账号';
    }
    if (low.indexOf('userid error3') !== -1) {
      return '账号已被锁定，请联系网络中心';
    }
    if (low.indexOf('userid error4') !== -1 || low.indexOf('out of service') !== -1) {
      return '账号已欠费或已停机';
    }
    // 2. 若仍残留有  (U+FFFD) 或未识别乱码，不要直接展示给用户造成困惑
    if (/[\ufffd]/.test(s)) {
      return '认证失败（可能处于夜间断网时段或账号密码有误）';
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
          const rawMsg = d.msga || d.msg || '';
          return { ok: code === '1' || code.toLowerCase() === 'ok', msg: formatErrMsg(rawMsg) };
        }
        if (/Dr\.COMWebLoginID_3/.test(t)) return { ok: true, msg: '' };
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

  /** 在门户页面顶部显示现代浮动指示条 */
  function showHud(text, state) {
    try {
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
          'background:rgba(15, 23, 42, 0.92)',
          'backdrop-filter:blur(12px)',
          '-webkit-backdrop-filter:blur(12px)',
          'color:#ffffff',
          'padding:9px 18px',
          'border-radius:30px',
          'font-family:-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", sans-serif',
          'font-size:13px',
          'font-weight:600',
          'box-shadow:0 10px 25px -5px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.18)',
          'display:flex',
          'align-items:center',
          'gap:9px',
          'transition:all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          'pointer-events:none'
        ].join(';');
        document.body.appendChild(hud);
      }
      const icon = state === 'success' ? '✓' : (state === 'error' ? '✗' : '⚡');
      const iconBg = state === 'success' ? '#10b981' : (state === 'error' ? '#ef4444' : '#3b82f6');
      // 只把「结构」交给 innerHTML，动态文本一律用 textContent 赋值。
      // text 里可能含门户返回的内容（如登录失败原因 r.msg），而门户是明文 HTTP，
      // 同网段可被篡改 —— 若直接拼进 innerHTML，等价于把任意 HTML/JS 注入门户页面
      // （实测 <img src=x onerror=...> 会真的执行）。
      hud.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:' + iconBg + ';color:#fff;font-size:11px;font-weight:bold;"></span> <span></span>';
      const iconEl = hud.firstElementChild;
      if (iconEl) iconEl.textContent = icon;
      const textEl = hud.lastElementChild;
      if (textEl) textEl.textContent = String(text == null ? '' : text);
      if (state === 'success' || state === 'error') {
        setTimeout(function () {
          if (!hud) return;
          hud.style.opacity = '0';
          hud.style.transform = 'translateX(-50%) translateY(-10px)';
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
        function release() {
          try { chrome.runtime.sendMessage({ type: 'releaseAuthLock', token: token }); } catch (e) {}
        }
        var p = fn();
        if (p && typeof p.then === 'function') {
          p.finally(release);
        } else {
          release();
        }
      });
    } catch (e) {
      fn();
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
          // 锁由 Web Locks 在回调返回的 Promise 结束后自动释放，
          // 因此这里不需要（也无法）手工释放，更不会在用户浏览器里留残留。
          withLock(function () {
            return new Promise(function (resolveFlow) {
              // 拿到锁后再复查一次在线状态：等待表单期间后台 alarm 可能已完成登录，
              // 若此刻已在线就不要再提交表单（会把刚建立的会话踢下线）。
              checkStatus().catch(function () { return false; }).then(function (alreadyOnline) {
                if (alreadyOnline) {
                  done = true;
                  hideHud();
                  report({ ok: true, online: true, message: '页面加载时已在线，无需登录' });
                  resolveFlow();
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
                  resolveFlow();
                  return;
                }

                report({ ok: false, state: 'submitted', online: false, message: '已自动填写并提交登录表单，等待网关响应…' });

              // 兜底：5.0 秒后仍未上线且无明确错误，再用同源 fetch 尝试一次
              setTimeout(function () {
                if (done) { resolveFlow(); return; }
                if (detectPageError()) {
                  done = true;
                  showHud('登录失败：网关返回错误提示', 'error');
                  report({ ok: false, online: false, message: '登录失败：网关返回错误提示' });
                  resolveFlow();
                  return;
                }
                checkStatus().then(function (ok) {
                  if (ok) {
                    done = true;
                    showHud('校园网认证成功！已在线', 'success');
                    report({ ok: true, online: true, message: '登录成功，已确认在线' });
                    resolveFlow();
                    return;
                  }
                  if (detectPageError()) {
                    done = true;
                    showHud('登录失败：网关返回错误提示', 'error');
                    report({ ok: false, online: false, message: '登录失败：网关返回错误提示' });
                    resolveFlow();
                    return;
                  }
                  // 兜底登录前复查「手动注销」标志：用户在等待期间点了注销时不得再把人登回。
                  getSettings().then(function (fresh) {
                    if (fresh.paused) {
                      done = true;
                      report({ ok: false, online: false, message: '已手动注销，取消兜底登录' });
                      resolveFlow();
                      return;
                    }
                    directLogin(s.account, s.password, s.isp).then(function (r) {
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
                      resolveFlow();
                    }).catch(function () {
                      resolveFlow();   // 异常也要结束流程，让锁释放
                    });
                  }).catch(function () {
                    resolveFlow();
                  });
                }).catch(function () {
                  resolveFlow();
                });
              }, 5000);
              });
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
