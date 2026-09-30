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
          { account: '', password: '', isp: '1', contentAutoFill: true },
          function (s) {
            resolve({
              account: (s && s.account) || '',
              password: (s && s.password) || '',
              isp: (s && s.isp) || '1',
              enabled: !s || s.contentAutoFill !== false
            });
          }
        );
      } catch (e) {
        resolve({ account: '', password: '', isp: '1', enabled: false });
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

  /** 同源查询在线状态 */
  function checkStatus() {
    return fetch('/drcom/chkstatus?callback=dr1001&v=' + Date.now() + '&lang=zh&jsVersion=' + JS_VERSION, {
      cache: 'no-store',
      credentials: 'include'
    })
      .then(function (r) { return r.text(); })
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
    return fetch(url, { cache: 'no-store', credentials: 'include' })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        const d = parseJsonp(t);
        if (d) {
          const code = String(d.result);
          return { ok: code === '1' || code.toLowerCase() === 'ok', msg: d.msga || d.msg || '' };
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
    // 下拉框
    const sel = document.querySelector('select[name="ISP_select"]');
    if (sel) {
      const opt = sel.querySelector('option[value="' + isp + '"]');
      if (opt) { sel.value = isp; fire(sel); }
      return;
    }
    // 单选按钮组
    const radios = document.querySelectorAll('div[name="ISP_radio"] input[name="network"], div[name="ISP_radio"] input[type="radio"]');
    if (radios && radios.length) {
      for (let i = 0; i < radios.length; i++) {
        if (String(radios[i].value) === String(isp)) {
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

  function main() {
    getSettings().then(function (s) {
      if (!s.enabled || !s.account || !s.password) return;

      checkStatus().then(function (online) {
        if (online) {
          report({ ok: true, online: true, message: '页面加载时已在线，无需登录' });
          return;
        }

        waitForForm(function (found) {
          if (!found) {
            // 页面上没有表单（可能是成功页 / 公告页），不打扰
            return;
          }

          const submitted = fillAndSubmit(s.account, s.password, s.isp);
          if (!submitted) return;

          report({ ok: true, online: false, message: '已自动填写并提交登录表单' });

          // 兜底：4 秒后仍未上线，用同源 fetch 再试一次
          setTimeout(function () {
            if (done) return;
            checkStatus().then(function (ok) {
              if (ok) {
                done = true;
                report({ ok: true, online: true, message: '登录成功，已确认在线' });
                return;
              }
              directLogin(s.account, s.password, s.isp).then(function (r) {
                done = true;
                report({
                  ok: r.ok,
                  online: r.ok,
                  message: r.ok ? '登录成功（兜底请求）' : ('登录失败：' + (r.msg || '账号或密码可能不正确'))
                });
              });
            });
          }, 4000);
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
