/**
 * 校园网自动登录 — Service Worker (MV3)
 *
 * 协议说明（逆向自 172.30.100.2 Dr.COM / 哆点 ePortal）：
 *   状态：GET /drcom/chkstatus?callback=dr1001&v=<rand>&lang=zh&jsVersion=4.1.3
 *   登录：GET /drcom/login?callback=dr1002&DDDDD=<账号>&upass=<密码>&...
 * 全部为 JSONP，返回形如 dr1001({...}); 需先剥壳再 JSON.parse。
 */

'use strict';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const PORTAL_ORIGIN = 'http://172.30.100.2';
const URL_CHKSTATUS = PORTAL_ORIGIN + '/drcom/chkstatus';
const URL_LOGIN = PORTAL_ORIGIN + '/drcom/login';
const JS_VERSION = '4.1.3';

const ALARM_NAME = 'campus-auto-login';
const DEFAULT_INTERVAL_MIN = 1 / 60;   // 默认 1 秒
// 下限 1 秒。注意：Chrome 官方文档说 alarms 最快 30 秒，但那只对「已打包/商店安装」
// 的扩展生效；开发者模式加载的未打包扩展不受此限制，实测 1 秒可正常触发。
const MIN_INTERVAL_MIN = 1 / 60;
const MAX_INTERVAL_MIN = 60;

const NET_TIMEOUT_MS = 8000;

// 首次运行默认值（仅作初始值，之后完全以 chrome.storage.local 为准）
const DEFAULT_SETTINGS = {
  account: 'REDACTED_CAMPUS_ACCOUNT',
  password: 'REDACTED_CAMPUS_PASSWORD',
  isp: '1',
  intervalMin: DEFAULT_INTERVAL_MIN,   // 在线时的检查间隔
  offlineIntervalMin: 1 / 60,          // 掉线后的检查间隔（默认 1 秒）
  adaptive: true,                      // 自适应：在线慢、掉线快
  autoOnStartup: true,
  contentAutoFill: true,
  instantTrigger: true,
  initialized: true
};

// 失败原因 -> 友好中文提示
const ERROR_MAP = {
  'userid error1': '账号不存在，请检查账号是否填写正确',
  'userid error2': '密码错误，请检查密码',
  'userid error3': '账号被锁定，请联系网络中心',
  'userid error4': '账号已欠费或已停机',
  'userid error5': '账号状态异常，请联系网络中心',
  'userid error6': '该账号已在别处登录',
  'password error': '密码错误，请检查密码',
  'error1': '账号不存在',
  'error2': '密码错误',
  'error3': '账号或密码错误'
};

// 并发保护：防止定时器与手动点击同时发起登录
let running = false;

// 上一次检查的在线状态（用于自适应轮询）。null = 尚未检查过
let lastOnline = null;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 生成随机数，用于 v 参数破缓存 */
function rand() {
  return String(Math.floor(Math.random() * 9000000) + 1000000);
}

/** 当前时间的可读字符串 */
function nowText() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
  );
}

/** 从 JSONP 文本中提取 JSON 对象并解析；失败返回 null */
function parseJsonp(text) {
  if (!text) return null;
  if (typeof text !== 'string') text = String(text);
  const m = text.match(/\(\s*(\{[\s\S]*\})\s*\)/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
}

/** 带超时的 fetch，返回文本 */
async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NET_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: ctrl.signal
    });
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 读取设置（带默认值兜底） */
async function getSettings() {
  let stored = {};
  try {
    stored = await chrome.storage.local.get(null);
  } catch (e) {
    stored = {};
  }
  if (!stored || typeof stored !== 'object') stored = {};
  const s = {
    account: typeof stored.account === 'string' && stored.account ? stored.account : DEFAULT_SETTINGS.account,
    password: typeof stored.password === 'string' && stored.password ? stored.password : DEFAULT_SETTINGS.password,
    isp: stored.isp ? String(stored.isp) : DEFAULT_SETTINGS.isp,
    intervalMin: clampInterval(stored.intervalMin),
    offlineIntervalMin: clampInterval(
      stored.offlineIntervalMin === undefined ? DEFAULT_SETTINGS.offlineIntervalMin : stored.offlineIntervalMin),
    adaptive: stored.adaptive === undefined ? DEFAULT_SETTINGS.adaptive : !!stored.adaptive,
    autoOnStartup: stored.autoOnStartup === undefined ? DEFAULT_SETTINGS.autoOnStartup : !!stored.autoOnStartup,
    contentAutoFill: stored.contentAutoFill === undefined ? DEFAULT_SETTINGS.contentAutoFill : !!stored.contentAutoFill,
    instantTrigger: stored.instantTrigger === undefined ? DEFAULT_SETTINGS.instantTrigger : !!stored.instantTrigger,
    initialized: !!stored.initialized
  };
  return s;
}

function clampInterval(v) {
  // 用 parseFloat 以支持 0.5 分钟（30 秒）
  let n = parseFloat(v);
  if (!Number.isFinite(n)) n = DEFAULT_INTERVAL_MIN;
  if (n < MIN_INTERVAL_MIN) n = MIN_INTERVAL_MIN;
  if (n > MAX_INTERVAL_MIN) n = MAX_INTERVAL_MIN;
  return n;
}

/** 把分钟数显示成人话：1/60 -> "1 秒"，0.5 -> "30 秒"，1 -> "1 分钟" */
function formatInterval(min) {
  if (min < 1) return Math.round(min * 60) + ' 秒';
  return min + ' 分钟';
}

/** 把结果写入 storage（popup / options 直接读这里） */
async function saveResult(result) {
  try {
    await chrome.storage.local.set({ lastResult: result });
  } catch (e) {
    // 忽略
  }
}

function ok(message, online) {
  return { ok: true, online: !!online, message: message, time: nowText() };
}

function fail(message, online) {
  return { ok: false, online: !!online, message: message, time: nowText() };
}

// ---------------------------------------------------------------------------
// 门户交互
// ---------------------------------------------------------------------------

/**
 * 查询在线状态。
 * @returns {{reachable: boolean, online: boolean, raw: object|null, message: string}}
 */
async function checkStatus() {
  const url = URL_CHKSTATUS + '?callback=dr1001&v=' + rand() + '&lang=zh&jsVersion=' + JS_VERSION;
  let text;
  try {
    text = await fetchText(url);
  } catch (e) {
    return { reachable: false, online: false, raw: null, message: '不在校园网内 / 门户不可达' };
  }
  const data = parseJsonp(text);
  if (!data) {
    // 网络通但返回不是预期的 JSONP
    return { reachable: true, online: false, raw: null, message: '门户返回数据无法解析（可能认证页已变更）' };
  }
  const online = Number(data.result) === 1;
  return {
    reachable: true,
    online: online,
    raw: data,
    message: online ? '当前已在线' : '当前未登录'
  };
}

/** 把门户返回的失败原因翻译成中文 */
function friendlyError(data) {
  const raw = [];
  if (data && data.msga) raw.push(String(data.msga));
  if (data && data.msg) raw.push(String(data.msg));
  const joined = raw.join(' ').trim();
  const key = joined.toLowerCase();
  if (key) {
    for (const k of Object.keys(ERROR_MAP)) {
      if (key.indexOf(k) !== -1) return ERROR_MAP[k];
    }
  }
  return joined ? '登录失败：' + joined : '登录失败：账号或密码错误';
}

/** 执行登录，返回统一结果对象 */
async function doLogin(settings) {
  const acct = String(settings.account || '').trim();
  const pwd = String(settings.password || '');

  if (!acct) return fail('未填写账号，请先在设置页填写', false);
  if (!pwd) return fail('未填写密码，请先在设置页填写', false);

  const url =
    URL_LOGIN + '?callback=dr1002' +
    '&DDDDD=' + encodeURIComponent(acct) +
    '&upass=' + encodeURIComponent(pwd) +
    '&0MKKey=123456' +
    '&R1=0' +
    '&R2=' +
    '&R3=' + encodeURIComponent(settings.isp || '1') +
    '&R6=0' +
    '&para=00' +
    '&v6ip=' +
    '&terminal_type=1' +
    '&lang=zh-cn' +
    '&jsVersion=' + JS_VERSION;

  let text;
  try {
    text = await fetchText(url);
  } catch (e) {
    return fail('不在校园网内 / 门户不可达', false);
  }

  const data = parseJsonp(text);
  if (!data) {
    // 部分版本直接返回 ok 纯文本
    if (/ok/i.test(text)) return ok('登录成功', true);
    return fail('门户返回数据无法解析（可能认证页已变更）', false);
  }

  const code = String(data.result);
  if (code === '1' || code.toLowerCase() === 'ok') {
    return ok('登录成功', true);
  }
  return fail(friendlyError(data), false);
}

/**
 * 在线状态变化时切换轮询节奏。
 * 只在状态真的翻转时才重建闹钟，避免每次检查都重置计时。
 */
async function maybeSwitchCadence(online) {
  const changed = lastOnline !== online;
  lastOnline = online;
  if (!changed) return;
  try {
    const settings = await getSettings();
    if (!settings.adaptive) return;
    await ensureAlarm();
    console.log('[adaptive] 状态变为 ' + (online ? '在线' : '掉线') +
      '，检查间隔切到 ' +
      formatInterval(clampInterval(online ? settings.intervalMin : settings.offlineIntervalMin)));
  } catch (e) {
    // 忽略
  }
}

/**
 * 主流程：先查状态，未在线则登录，登录后再验证。
 * 永远不抛异常。
 */
async function autoLogin(trigger) {
  const tag = trigger ? '[' + trigger + '] ' : '';
  if (running) {
    return { ok: false, online: false, skipped: true, message: '正在登录中，已跳过本次请求', time: nowText() };
  }
  running = true;
  try {
    const settings = await getSettings();

    // 1) 状态检查
    const st = await checkStatus();
    if (!st.reachable) {
      const r = fail(st.message, false);
      await saveResult(r);
      console.log(tag + '门户不可达');
      // 门户不可达（多半是断网），切到快速重连节奏
      await maybeSwitchCadence(false);
      return r;
    }
    if (st.online) {
      const r = ok('已在线，无需登录', true);
      await saveResult(r);
      console.log(tag + '已在线，跳过登录');
      await maybeSwitchCadence(true);
      return r;
    }

    // 2) 登录
    console.log(tag + '未在线，开始登录：' + settings.account);
    await maybeSwitchCadence(false);
    let r = await doLogin(settings);

    // 3) 登录后二次验证
    if (r.ok) {
      const st2 = await checkStatus();
      if (st2.reachable && !st2.online) {
        r = fail('登录请求已提交，但状态仍未在线（可能密码错误或账号被占用）', false);
      } else {
        r = ok('登录成功，已确认在线', true);
      }
    }

    await saveResult(r);
    console.log(tag + r.message);
    return r;
  } catch (e) {
    // 兜底：任何未预期错误都不能让 Service Worker 挂掉
    const r = fail('发生未知错误：' + (e && e.message ? e.message : String(e)), false);
    try {
      await saveResult(r);
    } catch (e2) {
      // 忽略
    }
    return r;
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------------
// 闹钟与生命周期
// ---------------------------------------------------------------------------

/**
 * 按当前设置创建/更新定时闹钟。
 *
 * 支持自适应：在线时用「常规间隔」，一旦掉线就切到「掉线间隔」快速重连，
 * 重连成功后再切回常规间隔。这样既能秒级恢复，又不会一直高频空转。
 */
async function ensureAlarm(forcePeriod) {
  try {
    const settings = await getSettings();
    let period;
    if (forcePeriod !== undefined && forcePeriod !== null) {
      period = clampInterval(forcePeriod);
    } else if (settings.adaptive && lastOnline === false) {
      period = clampInterval(settings.offlineIntervalMin);
    } else {
      period = clampInterval(settings.intervalMin);
    }

    const existing = await chrome.alarms.get(ALARM_NAME);
    // 周期没变就不重建，避免每次唤醒都重置计时器
    if (existing && Math.abs((existing.periodInMinutes || 0) - period) < 1e-9) {
      return;
    }

    await chrome.alarms.clear(ALARM_NAME);
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: period,
      periodInMinutes: period
    });
    console.log('[alarm] 已设置每 ' + formatInterval(period) + ' 检查一次');
  } catch (e) {
    console.log('[alarm] 创建失败：' + (e && e.message ? e.message : String(e)));
  }
}

/** 首次安装：写入默认账号密码（仅此一次） */
async function initDefaults() {
  try {
    const stored = await chrome.storage.local.get(null);
    const patch = {};
    if (!stored || !stored.initialized) {
      patch.account = DEFAULT_SETTINGS.account;
      patch.password = DEFAULT_SETTINGS.password;
      patch.isp = DEFAULT_SETTINGS.isp;
      patch.intervalMin = DEFAULT_SETTINGS.intervalMin;
      patch.offlineIntervalMin = DEFAULT_SETTINGS.offlineIntervalMin;
      patch.adaptive = true;
      patch.autoOnStartup = true;
      patch.contentAutoFill = true;
      patch.instantTrigger = true;
      patch.initialized = true;
      await chrome.storage.local.set(patch);
      console.log('[init] 已写入首次运行默认账号');
    }
  } catch (e) {
    // 忽略
  }
}

/**
 * 网页加载失败时立刻登录（最快的触发方式）。
 *
 * 校园网断线时，浏览器会把任意 http 请求重定向到门户，或者直接报错。
 * 这里监听这两种情况，一旦发生就马上认证，无需等定时器。
 */
function setupInstantTriggers() {
  if (!chrome.webNavigation) return;

  /** 用户是否开启了瞬时触发（默认开） */
  function enabled() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ instantTrigger: true }, (s) => {
          resolve(!s || s.instantTrigger !== false);
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  // 1) 主框架导航被重定向到门户 -> 说明掉线了
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    const url = details.url || '';
    if (url.indexOf('172.30.100.2') === -1) return;
    enabled().then((on) => {
      if (!on) return;
      console.log('[instant] 检测到跳转到门户，立即登录');
      return autoLogin('掉线跳转');
    }).catch(() => {});
  });

  // 2) 导航失败（DNS/连接错误）-> 也可能是掉线
  chrome.webNavigation.onErrorOccurred.addListener((details) => {
    if (details.frameId !== 0) return;
    enabled().then((on) => {
      if (!on) return;
      return autoLogin('导航失败');
    }).catch(() => {});
  });
}

chrome.runtime.onInstalled.addListener(() => {
  // 异步流程统一 catch，避免未处理的 Promise 拒绝
  initDefaults()
    .then(ensureAlarm)
    .then(() => autoLogin('安装'))
    .catch((e) => console.log('[onInstalled] ' + (e && e.message ? e.message : String(e))));
});

// 瞬时触发器必须在顶层注册：MV3 的 service worker 会休眠，
// 每次唤醒都会重新执行本文件，依赖事件驱动才能被唤醒。
setupInstantTriggers();

chrome.runtime.onStartup.addListener(() => {
  getSettings()
    .then((s) => {
      if (!s.autoOnStartup) {
        console.log('[startup] 未开启开机自动登录');
        return null;
      }
      return autoLogin('启动');
    })
    .catch((e) => console.log('[onStartup] ' + (e && e.message ? e.message : String(e))));
  ensureAlarm().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === ALARM_NAME) {
    autoLogin('定时').catch(() => {});
  }
});

// popup / options 发来的指令
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'login') {
    autoLogin('手动')
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse(fail('发生未知错误：' + (e && e.message ? e.message : String(e)), false)));
    return true; // 异步响应
  }

  if (msg.type === 'status') {
    checkStatus()
      .then((st) => sendResponse(st))
      .catch(() => sendResponse({ reachable: false, online: false, message: '不在校园网内 / 门户不可达' }));
    return true;
  }

  if (msg.type === 'settingsChanged') {
    ensureAlarm()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  // 内容脚本上报的填写/登录结果，仅记录，不重复登录
  if (msg.type === 'contentResult') {
    const r = msg.result || {};
    saveResult({
      ok: !!r.ok,
      online: !!r.online,
      message: String(r.message || '页面自动填写完成'),
      time: nowText(),
      from: '页面脚本'
    })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
});
