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

const PORTAL_HOST = '172.30.100.2';
const PORTAL_ORIGIN = 'http://' + PORTAL_HOST;
const URL_CHKSTATUS = PORTAL_ORIGIN + '/drcom/chkstatus';
const URL_LOGIN = PORTAL_ORIGIN + '/drcom/login';
const JS_VERSION = '4.1.3';

const ALARM_NAME = 'campus-auto-login';
const DEFAULT_INTERVAL_MIN = 10 / 60;   // 默认 10 秒（自适应在线巡检，掉线自动切至 1 秒抢修）
// 下限 1 秒。注意：Chrome 官方文档说 alarms 最快 30 秒，但那只对「已打包/商店安装」
// 的扩展生效；开发者模式加载的未打包扩展不受此限制，实测 1 秒可正常触发。
const MIN_INTERVAL_MIN = 1 / 60;
const MAX_INTERVAL_MIN = 60;

// 门户探测失败时的退避参数：前 BACKOFF_GRACE_ATTEMPTS 次仍按掉线间隔快速重试
// （校园网瞬断一般几秒到几十秒），之后指数退避并封顶 BACKOFF_MAX_MIN，
// 避免人不在校园网内（在家 / 热点）时变成每秒一次的无意义空转。
const BACKOFF_MAX_MIN = 1;
const BACKOFF_GRACE_ATTEMPTS = 10;

// 瞬时触发的节流窗口：短时间内的连续导航失败只触发一次
const INSTANT_THROTTLE_MS = 15000;

// 只有「网络层」错误才可能意味着校园网断了。白名单之外的（如 net::ERR_ABORTED
// —— 用户按 ESC 中断加载）一律忽略，否则随便一个打不开的页面都会白唤醒一次门户请求。
const INSTANT_ERROR_WHITELIST = [
  'net::ERR_INTERNET_DISCONNECTED',
  'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_NAME_RESOLUTION_FAILED',
  'net::ERR_ADDRESS_UNREACHABLE',
  'net::ERR_CONNECTION_TIMED_OUT',
  'net::ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_CONNECTION_CLOSED',
  'net::ERR_CONNECTION_FAILED',
  'net::ERR_CONNECTION_ABORTED',
  'net::ERR_NETWORK_CHANGED',
  'net::ERR_NETWORK_ACCESS_DENIED',
  'net::ERR_PROXY_CONNECTION_FAILED',
  'net::ERR_TIMED_OUT',
  'net::ERR_EMPTY_RESPONSE'
];

const NET_TIMEOUT_MS = 8000;

// 首次运行默认值。账号密码留空 —— 绝不写入任何真实凭据，由用户到设置页填写。
const DEFAULT_SETTINGS = {
  account: '',
  password: '',
  isp: '1',
  intervalMin: DEFAULT_INTERVAL_MIN,   // 在线时的检查间隔
  offlineIntervalMin: 1 / 60,          // 掉线后的检查间隔（默认 1 秒）
  adaptive: true,                      // 自适应：在线慢、掉线快
  autoOnStartup: true,
  contentAutoFill: true,
  instantTrigger: true,
  manualLogout: false,                 // 用户手动注销后置真：暂停一切自动登录
  unreachableStreak: 0,                // 连续探测失败次数（用于指数退避）
  authError: false,                    // 上次登录因凭据类错误失败（重试无意义，降频）
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
  'userid error0': '账号或密码错误',
  'password error': '密码错误，请检查密码',
  'error1': '账号不存在',
  'error2': '密码错误',
  'error3': '账号或密码错误',
  // 以下三条是「重试也没用」的凭据类错误，必须显式识别，
  // 否则同一错误码在扩展里会退化成每秒重试（每天上万次注定失败的认证请求）。
  'out of service': '账号已停机，请充值后使用',
  'supplicant version too low': '客户端版本过低',
  'ip has been online': '该 IP 已经在线，无需重复登录',
  'auth error': '认证失败',
  '本时段禁止使用': '当前时段禁止使用校园网（夜间断网/宵禁时段）',
  '禁止使用': '当前时段禁止使用校园网（夜间断网/宵禁时段）',
  '禁止上网': '当前时段禁止上网'
};

// 连接状态机的全部取值（用于校验从 storage 恢复的值是否合法）
const CONN_STATES = ['unknown', 'online', 'offline', 'unreachable', 'unparseable'];

// 并发保护：防止定时器与手动点击同时发起登录，并互斥串行化
let running = false;
let activeAuthOp = null; // 'login' | 'logout' | 'content' | null
let contentLockTimer = null;
let contentLockToken = null;   // 内容脚本认证锁的持有令牌，释放时须校验

// 连接状态机与退避计数（详见 updateConnState 注释）
let connState = 'unknown';
let unreachableStreak = 0;
// 本地记录的本次会话连通起始毫秒时间戳（自愈与准确统计当前在线时长）
let onlineSince = null;

// 已落盘的 streak 值，用于避免重复写入 storage
let lastPersistedStreak = -1;

// 当前闹钟周期（分钟），用于判断是否需要重建定时器
let lastAlarmPeriod = null;

// 运行态恢复的共享 Promise（见 hydrateState）。缓存 Promise 而非布尔标志，
// 是为了让并发调用者等待同一次恢复完成：布尔标志在 await 之前就被置位，
// 第二个调用者会误以为恢复已完成，拿到仍是空的 eventLogs / pingHistory。
let hydrationPromise = null;

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

/** 从网关原始响应中提取有效在线秒数 (优先 actt，回退 oltime；过滤 4294967295 哨兵值) */
function parseGatewayDurationSec(raw) {
  if (!raw) return 0;
  for (const k of ['actt', 'oltime']) {
    const n = parseInt(raw[k], 10);
    if (Number.isFinite(n) && n > 0 && n < 90 * 86400) return n;
  }
  return 0;
}

/** 账号脱敏（日志与调试安全防窥） */
function maskAccount(acc) {
  if (!acc || typeof acc !== 'string') return '';
  const t = acc.trim();
  if (t.length <= 4) return '****';
  if (t.length <= 7) return t.slice(0, 2) + '****' + t.slice(-2);
  return t.slice(0, 3) + '****' + t.slice(-4);
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

/**
 * 校验响应确实是门户的 JSONP，而不是被强制门户拦截后返回的 HTML。
 * 不通过则抛异常，由调用方转成 unparseable 状态。
 */
function validateContentType(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('门户返回空内容');
  const head = t.slice(0, 200).toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.indexOf('<head') !== -1 ||
      head.indexOf('<body') !== -1 || head.indexOf('<?xml') !== -1) {
    throw new Error('门户返回 HTML 页面而非认证数据');
  }
  return true;
}

/**
 * 带超时的 fetch，返回文本。
 *
 * 必须按响应头声明的 charset 解码：门户实测声明 `charset=gbk`
 * （chkstatus 为 application/javascript; charset=gbk），而 fetch 的 resp.text()
 * **一律按 UTF-8** 解码、忽略该声明 —— 于是门户返回的中文（如 msga 错误原因）
 * 会变成 U+FFFD 乱码，导致中文错误提示无法显示、也影响按中文匹配的判定。
 * result/flow 等 ASCII 字段虽不受影响，但既然拿到了声明就应当遵照。
 */
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
    const buf = await resp.arrayBuffer();
    const ct = String(resp.headers && resp.headers.get ? (resp.headers.get('content-type') || '') : '');
    const m = /charset\s*=\s*"?([\w-]+)"?/i.exec(ct);
    const charset = m ? m[1].toLowerCase() : '';
    // 优先遵循响应头声明的 charset（含 utf-8）：门户 :801/eportal 实测声明 utf-8，
    // 若仍强制 gbk 优先，会把 utf-8 字节按 gbk 解出乱码且不抛错，静默错译中文错误提示。
    const candidates = [];
    const pushEnc = (enc) => {
      const k = (enc === 'utf8') ? 'utf-8' : enc;
      if (candidates.indexOf(k) === -1) candidates.push(k);
    };
    if (charset) pushEnc(charset);
    pushEnc('gbk');
    pushEnc('gb18030');
    pushEnc('utf-8');
    const bytes = new Uint8Array(buf);
    for (const enc of candidates) {
      try {
        // fatal: true —— 遇到非法字节序列就抛错，才能"试错"下一个编码。
        // 若用默认的 fatal:false，任何编码都会"成功"并产出 U+FFFD 乱码，
        // 循环第一轮就返回，回退形同虚设（声明缺失/声明错误时必然乱码）。
        return new TextDecoder(enc, { fatal: true }).decode(bytes);
      } catch (e) {
        // 该编码不可用，或字节序列在它下面非法 -> 换下一个
      }
    }
    // 全部失败：按 UTF-8 容错解码，至少不抛异常
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
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
    // 用户手动注销后为 true：暂停一切自动登录，直到用户重新点「立即登录」
    manualLogout: stored.manualLogout === undefined ? DEFAULT_SETTINGS.manualLogout : !!stored.manualLogout,
    // 上次登录因凭据类错误（密码错/账号不存在等）失败 -> 降频重试，不再每秒打门户
    authError: stored.authError === undefined ? DEFAULT_SETTINGS.authError : !!stored.authError,
    // 连续探测失败次数，用于指数退避（区分「不在校园网内」与「确认掉线」）
    unreachableStreak: Math.max(0, parseInt(stored.unreachableStreak, 10) || 0),
    // 上次的连接状态，便于 SW 重启后退避不归零
    connState: CONN_STATES.indexOf(stored.connState) !== -1 ? stored.connState : 'unknown',
    initialized: !!stored.initialized,
    onlineSince: stored.onlineSince ? Number(stored.onlineSince) : null,
    pingHistory: Array.isArray(stored.pingHistory) ? stored.pingHistory : [],
    // 只保留对象条目：storage 可能被手改 / 旧版本残留 / 其他扩展写入 null 等垃圾元素。
    // 这里不过滤的话，垃圾会被原样写回磁盘，且 UI 消费端（时间线 / 诊断报告）
    // 直接读取条目字段时会抛 TypeError。
    eventLogs: Array.isArray(stored.eventLogs)
      ? stored.eventLogs.filter((e) => e && typeof e === 'object' && !Array.isArray(e))
      : []
  };
  return s;
}

/** 写入运行态字段（manualLogout / unreachableStreak / connState / onlineSince） */
async function setState(patch) {
  try {
    await chrome.storage.local.set(patch);
  } catch (e) {
    // 忽略
  }
}

/**
 * 从 storage 恢复运行态。MV3 的 Service Worker 随时会被回收，模块级变量
 * （connState / unreachableStreak / onlineSince）每次唤醒都归零；不恢复的话退避计数会被不断
 * 清零、闹钟退回基础间隔，指数退避就形同虚设。只在首次唤醒时恢复一次。
 */
function hydrateState() {
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    try {
      const s = await getSettings();
      if (connState === 'unknown') connState = s.connState;
      unreachableStreak = Math.max(unreachableStreak, s.unreachableStreak);
      lastPersistedStreak = s.unreachableStreak;
      if (s.onlineSince) onlineSince = s.onlineSince;
      if (Array.isArray(s.pingHistory) && s.pingHistory.length && !pingHistory.length) {
        s.pingHistory.slice(-MAX_PING_HISTORY).forEach((v) => {
          if (typeof v === 'number' && Number.isFinite(v)) pingHistory.push(v);
        });
      }
      if (Array.isArray(s.eventLogs) && s.eventLogs.length && !eventLogs.length) {
        eventLogs = s.eventLogs.slice(0, MAX_EVENT_LOGS);
      }
    } catch (e) {
      // 忽略，按默认值继续
    }
  })();
  return hydrationPromise;
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

/** 更新浏览器工具栏图标角标 (Action Badge) */
function updateActionBadge(online, text) {
  try {
    if (!chrome.action || !chrome.action.setBadgeText) return;
    if (text !== undefined) {
      chrome.action.setBadgeText({ text: text });
      chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
      return;
    }
    if (online) {
      chrome.action.setBadgeText({ text: '' });
    } else {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    }
  } catch (e) {
    // 忽略异常
  }
}

const MAX_EVENT_LOGS = 15;
let eventLogs = [];

/** 把结果写入 storage（popup / options 直接读这里，并维护去重事件时间轴日志） */
async function saveResult(result, trigger) {
  // 所有写日志的入口统一先恢复运行态。MV3 的 SW 随时被回收，冷启动后第一个消息
  // 若直接是 logout / contentResult（在 onStartup、status 之前到达），模块级
  // eventLogs 仍是空数组，直接 set 会把磁盘上的历史日志整段覆盖成 1 条。
  await hydrateState();
  try {
    if (result && result.message) {
      const entry = {
        time: result.time || nowText(),
        message: String(result.message),
        ok: !!result.ok,
        online: !!result.online,
        pending: !!(result.pending || result.state === 'submitted'),
        from: String(trigger || result.from || '后台巡检'),
        count: 1
      };
      const head = eventLogs[0];
      if (head && head.message === entry.message && head.ok === entry.ok && head.online === entry.online) {
        head.time = entry.time;
        head.from = entry.from;
        head.count = (Number(head.count) || 1) + 1;
      } else {
        eventLogs.unshift(entry);
        if (eventLogs.length > MAX_EVENT_LOGS) {
          eventLogs = eventLogs.slice(0, MAX_EVENT_LOGS);
        }
      }
    }
    // 心跳历史与结果同批落盘：掉线时 1 秒巡检节奏下，若 recordPingHistory 每次
    // 单独 setState，会多出约每秒 1 次写盘；合并后不增加额外 I/O。
    await chrome.storage.local.set({
      lastResult: result,
      eventLogs: eventLogs,
      pingHistory: getPingHistory()
    });
    updateActionBadge(result && result.online);
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
 * reachable=false 门户连不上；unparseable=true 通了但拿不到门户数据
 * ——典型场景是酒店 / 机场的强制门户把任意请求都拦成自家登录页，
 * 这种情况重试再多次也不会成功，必须走退避而非 1 秒高频重试。
 */
const MAX_PING_HISTORY = 12;
const pingHistory = [];

function recordPingHistory(ms) {
  if (typeof ms === 'number') {
    pingHistory.push(ms);
    if (pingHistory.length > MAX_PING_HISTORY) {
      pingHistory.shift();
    }
    // 只更新内存。落盘由 saveResult() 随巡检结果同批完成（见其 set 调用），
    // status 消息则通过 checkStatus() 的返回值直接把历史带给 popup / options。
    // 这样避免了每次探测单独写一次 storage。
  }
}

function getPingHistory() {
  return pingHistory.slice();
}

async function checkStatus() {
  // 探测会写入心跳历史，必须先恢复运行态，否则冷启动首条消息（如 logout）会让
  // pingHistory 先被塞进一条新值，hydrateState 的 !pingHistory.length 判断失效，
  // 磁盘上的历史心跳就被跳过恢复、随后又被写回覆盖。
  await hydrateState();
  const url = URL_CHKSTATUS + '?callback=dr1001&v=' + rand() + '&lang=zh&jsVersion=' + JS_VERSION;
  const t0 = Date.now();
  let text;
  try {
    text = await fetchText(url);
  } catch (e) {
    recordPingHistory(-1);
    return { reachable: false, online: false, raw: null, pingMs: -1, pingHistory: getPingHistory(), message: '网络连接失败，请检查 Wi-Fi 或网线' };
  }
  const pingMs = Date.now() - t0;
  recordPingHistory(pingMs);

  let bad = null;
  try {
    validateContentType(text);   // HTML 响应说明这压根不是门户接口
  } catch (e) {
    bad = '门户返回的是网页而非认证数据（可能处于酒店/机场等强制登录网络）';
  }
  const data = bad ? null : parseJsonp(text);
  if (!data) {
    return {
      reachable: true, online: false, unparseable: true, raw: null, pingMs, pingHistory: getPingHistory(),
      message: bad || '门户返回数据无法解析（可能认证页已变更）'
    };
  }
  const online = Number(data.result) === 1;
  return { reachable: true, online: online, raw: data, pingMs: pingMs, pingHistory: getPingHistory(),
           message: online ? '当前已在线' : '当前未登录' };
}

/** 把门户返回的失败原因翻译成中文 */
function friendlyError(data) {
  const raw = [];
  if (data && data.msga) raw.push(String(data.msga));
  if (data && data.msg) raw.push(String(data.msg));
  const joined = raw.join(' ').trim();
  const key = joined.toLowerCase();
  if (key) {
    // 宵禁 / 夜间断网判断（含误按 UTF-8 解码形成的乱码签名，如 \u02b1(ʱ) 与 \u03bd(ν)）
    if (
      key.indexOf('本时段禁止使用') !== -1 ||
      key.indexOf('禁止使用') !== -1 ||
      key.indexOf('时段') !== -1 ||
      key.indexOf('禁止上网') !== -1 ||
      /[\u02b1][\s\S]{0,3}[\u03bd]/.test(joined) ||
      /ʱ[\s\S]{0,3}ν/.test(joined) ||
      /[\ufffd].*ʱ/.test(joined)
    ) {
      return '当前时段禁止使用校园网（夜间断网/宵禁时段）';
    }
    for (const k of Object.keys(ERROR_MAP)) {
      if (key.indexOf(k) !== -1) return ERROR_MAP[k];
    }
    if (/[\ufffd]/.test(joined)) {
      return '登录失败：当前时段受限或账号密码错误';
    }
  }
  return joined ? '登录失败：' + joined : '登录失败：账号或密码错误';
}

/**
 * 判断登录失败是否属于「重试也没用」的凭据类错误（密码错、账号不存在、被锁、欠费等）。
 * 这类错误按 1 秒间隔无限重试毫无意义 —— 每天会产生上万次注定失败的认证请求，
 * 门户侧还可能触发「该账号已在别处登录」等副作用。
 * 命中即停止重试，改由常规间隔等待用户改好凭据。
 */
function isPermanentAuthError(msg) {
  const m = String(msg || '');
  // 'password error' / 'out of service' / 'supplicant version too low' 都是门户的原始
  // ascii 原因（见 ERROR_MAP），不含中文关键词也不含 errorN 形式，必须显式列出 ——
  // 漏掉会让这些「重试无用」的错误退化成每秒重试（停机状态下每天上万次无效认证）。
  // 「禁止使用」/「时段」代表校园网夜间断网/宵禁策略，重试无用，必须降频。
  return /密码|账号不存在|账号格式|被锁定|锁定|欠费|停机|已在别处|禁止使用|禁止上网|时段|[\u02b1].*[\u03bd]|password error|userid error|out of service|supplicant version too low/i.test(m) ||
    /error[1-6]/i.test(m);
}

/** 执行登录，返回统一结果对象。返回值的 permanent=true 表示凭据类错误、不应再高频重试。 */
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
    return fail('网络连接失败，请检查 Wi-Fi 或网线', false);
  }

  const data = parseJsonp(text);
  if (!data) {
    // 非结构化响应：只认明确的成功标记（纯文本 "ok"、Dr.COMWebLoginID_3 成功结果页、
    // "认证成功" 字样）。
    // 绝不能退回宽松的 /ok/ 子串匹配 —— 错误页里的 "network"/"token" 都含 "ok"，
    // 宽松匹配会把任意失败页误判成登录成功，且这一假成功还可能被二次验证坐实。
    // 成功标记必须先于 validateContentType 检查：成功结果页本身就是 HTML。
    const t = String(text || '');
    if (/^\s*ok[\s;]*$/i.test(t) || t.indexOf('Dr.COMWebLoginID_3') !== -1 || t.indexOf('认证成功') !== -1) {
      return ok('登录成功', true);
    }
    // 剩余内容若形似 HTML，多为强制门户 / 运营商错误页，明确按失败处理
    try {
      validateContentType(text);
    } catch (e) {
      return fail('门户返回的是网页而非认证数据（可能处于强制登录网络）', false);
    }
    return fail('门户返回数据无法解析（可能认证页已变更）', false);
  }

  const code = String(data.result);
  if (code === '1' || code.toLowerCase() === 'ok') {
    return ok('登录成功', true);
  }
  const portalReason = [data.msga, data.msg]
    .filter((v) => v != null && String(v).trim() !== '')
    .join(' ')
    .trim();
  // 「该 IP 已经在线」不是错误：门户在说这个 IP 的会话是好的（常见于多设备/重复提交）。
  // 若当成失败，就会每秒重试一个「本来就成功」的请求。
  // 更不能计入 authError 降频 —— 用户凭据没问题。
  if (/ip has been online/i.test(portalReason)) {
    return ok('该 IP 已经在线，无需重复登录', true);
  }
  // 判定「凭据类错误」必须只看**门户自己给出的原因**，不能看我们拼出来的提示文案。
  // 原因：friendlyError 在门户没给 msga/msg 时会兜底成「登录失败：账号或密码错误」，
  // 其中的「密码」二字会命中 isPermanentAuthError —— 于是把「门户没说明原因」
  // 误判为「密码错误」，抢修间隔被从 1 秒降到 10 秒，核心的秒级重连承诺失效。
  // 门户沉默时原因未知（可能是 AC 过载等瞬时故障），此时必须保持 1 秒快速重试。
  const msg = friendlyError(data);
  const r = fail(msg, false);
  r.permanent = !!portalReason && isPermanentAuthError(portalReason);   // 仅门户明说才算凭据类错误
  return r;
}

/**
 * 注销下线。
 * 先从 chkstatus 取出 wlan_user_ip / mac / ac_ip，再请求注销接口。
 *
 * 重要：注销成功后必须置上 manualLogout 抑制标志。否则下一次后台巡检
 * （掉线间隔默认 1 秒）会立刻把用户重新认证上网，「注销」形同虚设。
 */
// 注销去重：doLogout() 与 autoLogin 里「登录在途时用户点了注销」的补发路径
// 可能同时触发注销。若各发一条完整序列，会重复请求门户。
// 统一由此执行器去重：在途复用同一 Promise；刚完成的结果在 3 秒窗口内复用。
let logoutInFlight = null;
let lastLogoutResult = null;
let lastLogoutAt = 0;
const LOGOUT_DEDUP_MS = 3000;

function runLogoutOnce() {
  if (logoutInFlight) return logoutInFlight;
  if (lastLogoutResult && Date.now() - lastLogoutAt < LOGOUT_DEDUP_MS) {
    return Promise.resolve(lastLogoutResult);
  }
  logoutInFlight = _doLogoutInternal().then((res) => {
    lastLogoutResult = res;
    lastLogoutAt = Date.now();
    return res;
  }).finally(() => {
    logoutInFlight = null;
  });
  return logoutInFlight;
}

async function doLogout() {
  // 已有注销在途（多为 autoLogin 因 manualLogout 补发的那一次）：直接复用结果，
  // 不再发第二条序列，也不回滚 manualLogout。
  if (logoutInFlight) {
    return logoutInFlight;
  }

  // 用户明确注销：第一时间落盘 manualLogout=true，令在途的 autoLogin 主动让出
  await setState({ manualLogout: true, unreachableStreak: 0 });
  unreachableStreak = 0;

  // 若当前有登录认证在进行中，等待登录检测到 manualLogout 后主动让出退出（最多等待 3 秒）
  if (activeAuthOp) {
    const t0 = Date.now();
    while (activeAuthOp && activeAuthOp !== 'logout' && Date.now() - t0 < 3000) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  if (activeAuthOp && activeAuthOp !== 'logout') {
    // 竞态下 autoLogin 可能已补发注销（还没等到锁释放）：此时绝不能回滚暂停标志，
    // 否则 UI 说「注销已跳过」、门户实际已注销，下一轮巡检又会把人静默登回。
    if (logoutInFlight) return logoutInFlight;
    if (lastLogoutResult && Date.now() - lastLogoutAt < LOGOUT_DEDUP_MS) {
      return lastLogoutResult;
    }
    // 抢锁超时（例如内容脚本仍在认证）：必须保留 manualLogout=true。
    // 在途操作会读取该标志并主动让出（autoLogin 的补发注销、content.js 的 5 秒复查），
    // 一旦回滚，反而会让它们继续把用户登回去 —— 注销被静默撤销。
    // 代价只是守护进入暂停态，用户可随时点「立即登录」恢复，远优于注销失效。
    return fail(`当前正在进行${activeAuthOp === 'content' ? '页面认证' : '网络操作'}，已暂停自动登录；该操作结束后不会自动重连`, false);
  }

  activeAuthOp = 'logout';
  running = true;
  try {
    return await runLogoutOnce();
  } finally {
    activeAuthOp = null;
    running = false;
  }
}

async function _doLogoutInternal() {
  const st = await checkStatus();
  if (!st.reachable) {
    return fail('网络连接失败，请检查 Wi-Fi 或网线', false);
  }
  if (st.unparseable) {
    // 门户返回的是 HTML 而非认证数据（如酒店/机场强制门户）：既拿不到会话参数，
    // 也得不到真实在线状态，不能把它当成「已下线」。
    const res = fail('门户返回的不是认证数据，无法执行注销（可能处于强制登录网络）', false);
    res.state = 'unknown';
    await saveResult(res, '手动注销');
    return res;
  }
  const raw = st.raw || {};
  const ip = String([raw.v4ip, raw.ss5].find((v) => v && v !== '0.0.0.0') || '');
  const mac = String(raw.ss1 || '000000000000');
  const ac_ip = String(raw.ss6 || '');

  const p1 = new URLSearchParams({
    callback: 'dr' + (Math.floor(Math.random() * 9000) + 1000),
    v: rand(),
    lang: 'zh',
    login_method: '0',
    user_account: 'drcom',
    user_password: '123',
    ac_logout: '0',
    register_mode: '1',
    wlan_user_ip: ip,
    wlan_user_ipv6: '',
    wlan_vlan_id: '1',
    wlan_user_mac: mac,
    wlan_ac_ip: ac_ip,
    wlan_ac_name: '',
    jsVersion: JS_VERSION
  });

  // 用户明确发起注销：必须在向网关发请求前立即落盘 manualLogout=true，
  // 避免注销过程中（网络请求 + 600ms 延迟）后台定时器触发 autoLogin 看到掉线后把人静默登回。
  await setState({ manualLogout: true, unreachableStreak: 0 });
  unreachableStreak = 0;

  try {
    await fetchText(PORTAL_ORIGIN + '/drcom/logout?' + p1.toString());
  } catch (e) {}

  try {
    await fetchText(PORTAL_ORIGIN + ':801/eportal/?c=ACSetting&a=Logout&ver=1.0&url=drappal&' + p1.toString());
  } catch (e) {}

  await new Promise((r) => setTimeout(r, 600));
  const stAfter = await checkStatus();

  if (!stAfter.reachable) {
    // 网关不可达，无法确认是否下线（C11：区分确认离线与无法确认）
    onlineSince = null;
    await setState({ manualLogout: true, unreachableStreak: 0, onlineSince: null });
    connState = 'unreachable';
    const res = fail('注销请求已提交，但当前网关不可达，无法确认是否成功下线', false);
    res.state = 'unknown';
    await saveResult(res, '手动注销');
    await ensureAlarm();
    console.log('[logout] 网关不可达，无法确认注销结果');
    return res;
  }

  if (stAfter.unparseable) {
    // 门户返回非认证数据：online 恒为 false，但这不是「已下线」，不能据此报成功。
    onlineSince = null;
    await setState({ manualLogout: true, unreachableStreak: 0, onlineSince: null });
    connState = 'unparseable';
    const res = fail('注销请求已提交，但无法确认是否成功下线（门户返回非认证数据）', false);
    res.state = 'unknown';
    await saveResult(res, '手动注销');
    await ensureAlarm();
    console.log('[logout] 门户返回非认证数据，无法确认注销结果');
    return res;
  }

  if (!stAfter.online) {
    // 注销成功 -> 置上抑制标志，暂停自动登录，并清空本地在线会话计时
    onlineSince = null;
    await setState({ manualLogout: true, unreachableStreak: 0, onlineSince: null });
    unreachableStreak = 0;
    connState = 'offline';
    const res = ok('已注销下线（自动登录已暂停，点「立即登录」可恢复）', false);
    await saveResult(res, '手动注销');
    // 需先落盘 manualLogout=true，ensureAlarm 才会按暂停态选空闲间隔
    await ensureAlarm();
    console.log('[logout] 已注销，自动登录暂停中');
    return res;
  }

  const res = fail('注销请求已提交，但会话仍在（可能需到门户页面手动注销）', true);
  // 会话仍在有两种可能：(a) 门户不支持自助注销；(b) 并发登录正在途中，稍后会完成。
  // 无论哪种，用户点过注销就该保持暂停，否则下一轮巡检会立刻把人登回去，
  // 「注销」形同虚设。登录完成时若发现该标志，会补发一次注销（见 autoLogin 第 4.5 步）。
  if (!(await getSettings()).manualLogout) {
    await setState({ manualLogout: true, unreachableStreak: 0 });
    console.log('[logout] 会话未清除，但仍保持注销暂停以避免被立刻登回');
  }
  await updateConnState(stAfter);
  await saveResult(res, '手动注销');
  await applyCadence();
  return res;
}


/**
 * 连接状态机。区分多种「不通」的原因是避免无意义高频重试的关键：
 *   unknown     尚未检测过
 *   online      门户可达且已认证
 *   offline     门户可达但未认证      -> 真·掉线，按 offlineIntervalMin 快速重连
 *   unreachable 门户根本连不上        -> 多半不在校园网内，指数退避
 *   unparseable 通但返回的不是门户数据 -> 强制门户 / 认证页变更，重试无意义，退避
 */
function backoffPeriod(settings) {
  // 宽限期内保持快速重连；超出后才指数退避（2x、4x…），封顶 BACKOFF_MAX_MIN
  const base = clampInterval(settings.offlineIntervalMin);
  const over = unreachableStreak - BACKOFF_GRACE_ATTEMPTS;
  if (over <= 0) return base;
  return clampInterval(Math.min(base * Math.pow(2, Math.min(over, 10)), BACKOFF_MAX_MIN));
}

/**
 * 按当前连接状态调整轮询节奏，并在节奏变化时打一条日志。
 * （ensureAlarm 内部已做「周期没变就不重建」，这里只负责记录变化。）
 */
async function applyCadence() {
  const prev = lastAlarmPeriod;
  await ensureAlarm();
  if (prev !== lastAlarmPeriod) {
    console.log('[cadence] 状态=' + connState +
      (unreachableStreak ? '（连续探测失败 ' + unreachableStreak + ' 次）' : '') +
      '，检查间隔切到 ' + formatInterval(lastAlarmPeriod));
  }
}

/** 根据一次状态检查结果更新连接状态机与退避计数，并持久化。 */
async function updateConnState(st) {
  const before = connState;
  if (!st.reachable) {
    unreachableStreak += 1;
    connState = 'unreachable';
  } else if (st.unparseable) {
    // HTTP 通了但拿不到门户数据（强制门户拦截 / 认证页改版）：不是「掉线」，重试也不会成功
    unreachableStreak += 1;
    connState = 'unparseable';
  } else {
    unreachableStreak = 0;   // 能正常拿到门户数据 -> 确认在校园网内
    connState = st.online ? 'online' : 'offline';
  }

  // 会话在线时间管理：掉线/不可达时清零，连通在线时初始化
  let patchOnlineSince = false;
  if (!st.reachable || st.unparseable || !st.online) {
    if (onlineSince !== null) {
      onlineSince = null;
      patchOnlineSince = true;
    }
  } else if (st.online) {
    if (!onlineSince) {
      const gwSec = parseGatewayDurationSec(st.raw);
      if (gwSec > 0) {
        onlineSince = Date.now() - gwSec * 1000;
      } else if (st.raw && st.raw.stime) {
        const d = new Date(String(st.raw.stime).replace(/-/g, '/'));
        const ms = d.getTime();
        if (Number.isFinite(ms) && !isNaN(ms) && d.toDateString() === new Date().toDateString() && ms <= Date.now()) {
          onlineSince = ms;
        } else {
          onlineSince = Date.now();
        }
      } else {
        onlineSince = Date.now();
      }
      patchOnlineSince = true;
    }
  }

  // 只要计数变了就要落盘（含 unparseable）。此处若只判断状态是否翻转，
  // 那么一旦进入 unparseable，后续每次 +1 都只留在内存里；
  // SW 被回收后 streak 回退到旧值，退避会重新从低档开始 —— 强制门户下又变回每秒空转。
  if (before !== connState || unreachableStreak !== lastPersistedStreak || patchOnlineSince) {
    lastPersistedStreak = unreachableStreak;
    const patch = { connState: connState, unreachableStreak: unreachableStreak };
    if (patchOnlineSince) patch.onlineSince = onlineSince;
    await setState(patch);
  }
  return connState;
}

/**
 * 主流程：先查状态，未在线则登录，登录后再验证。
 * 永远不抛异常。
 *
 * @param {string} trigger 触发来源（仅用于日志/展示）
 * @param {boolean} [manual] 是否为用户主动点击「立即登录」。手动登录会解除注销抑制。
 */
async function autoLogin(trigger, manual) {
  const tag = trigger ? '[' + trigger + '] ' : '';
  if (running || activeAuthOp) {
    return { ok: false, online: false, skipped: true, message: '正在处理认证中，已跳过本次请求', time: nowText() };
  }
  activeAuthOp = 'login';
  running = true;
  try {
    await hydrateState();
    const settings = await getSettings();

    // 0) 用户主动点「立即登录」/ 按快捷键 -> 解除注销暂停
    let paused = settings.manualLogout;
    if (manual && paused) {
      await setState({ manualLogout: false, unreachableStreak: 0 });
      unreachableStreak = 0;
      paused = false;
      console.log(tag + '用户手动登录，已解除注销暂停');
    }
    // 手动登录时（无论是否暂停）：重置退避计数，让本次从 0 开始获得完整的宽限期。
    // 否则用户从长时间不可达状态手动点登录，仍会卡在 60 秒退避，体验极差。
    if (manual && !paused && unreachableStreak > 0) {
      unreachableStreak = 0;
      await setState({ unreachableStreak: 0 });
      console.log(tag + '用户手动登录，已重置退避计数');
    }
    // 用户手动点了登录，说明可能刚改过账号密码 —— 清掉凭据类错误标记，
    // 让这一次重新按正常节奏去试（否则会被 authError 降频挡住，白点一下）。
    if (manual && settings.authError) {
      await setState({ authError: false });
      settings.authError = false;
      console.log(tag + '用户手动登录，已清除凭据错误标记');
    }

    // 1) 未配置账号密码时不空转：否则新装插件（凭据默认为空）会每秒请求门户
    if (!String(settings.account || '').trim() || !String(settings.password || '')) {
      const r = fail('尚未配置账号密码，请点击插件图标 → 设置', false);
      await saveResult(r, trigger);
      console.log(tag + '未配置账号密码，跳过（等待用户在设置页填写）');
      await ensureAlarm();
      return r;
    }

    // 2) 状态检查（每次巡检只查一次，暂停态的判定也复用这次结果）
    const st = await checkStatus();

    // 3) 注销暂停判定。若暂停中却探测到「已在线」，说明用户自己打开门户网页登了回来，
    //    此时应自动恢复守护 —— 否则暂停态一直留着，界面显示「已在线」让用户看不出
    //    异常，等之后真掉线了插件却不重连，表现为「时好时坏」。
    if (paused && !(st.reachable && st.online)) {
      await updateConnState(st);
      console.log(tag + '处于手动注销暂停中，跳过');
      await ensureAlarm();   // 暂停态由 ensureAlarm 内部识别，会降为常规间隔
      return { ok: true, online: false, skipped: true, paused: true,
               message: '已手动注销，自动登录已暂停', time: nowText() };
    }
    if (paused) {
      await setState({ manualLogout: false, unreachableStreak: 0 });
      console.log(tag + '检测到已在线（用户可能自行登录），自动恢复守护');
    }

    await updateConnState(st);

    // 3.5) 已在线说明凭据是可用的（或用户自行登录了）-> 清掉陈旧的「凭据类错误」标记。
    //   不清的后果：标记会一直留到下一次真掉线，把那次抢修从 1 秒拖到 10 秒
    //   （之后由 doLogin 结果自愈，所以只是**一次性**延迟，但白等 10 秒没必要）。
    //   与上面第 3 步「陈旧 manualLogout 自愈」是同一思路。
    if (st.reachable && st.online && settings.authError) {
      await setState({ authError: false });
      settings.authError = false;
      console.log(tag + '已在线，清除陈旧的凭据错误标记');
    }

    // 不可登录的三种情况（互斥）：已在线 / 拿不到门户数据 / 门户连不上
    if (st.online || st.unparseable || !st.reachable) {
      const r = st.online ? ok('已在线，无需登录', true) : fail(st.message, false);
      await saveResult(r, trigger);
      console.log(tag + (st.online ? '已在线，跳过登录'
        : (st.unparseable ? '门户返回非认证数据' : '网络连接失败') + '（连续第 ' + unreachableStreak + ' 次）'));
      await applyCadence();
      return r;
    }

    // 4) 登录（门户可达但未认证 -> 真·掉线，保持快速重连）
    // 在发起登录前，检查检测期间用户是否发起注销：用户意图优先，主动中止让出
    if ((await getSettings()).manualLogout) {
      console.log(tag + '检测到用户已请求注销，主动中止本次自动登录');
      return { ok: true, online: false, skipped: true, paused: true,
               message: '已手动注销，自动登录已取消', time: nowText() };
    }

    console.log(tag + '未在线，开始登录：' + maskAccount(settings.account));
    updateActionBadge(false, '...');
    await applyCadence();
    let r = await doLogin(settings);

    // 4.5) 登录在途期间用户点了「注销」-> 用户意图优先，补发一次注销。
    //   能走到这里说明本次进入时并未处于暂停态（否则第 3 步已早退），
    //   所以此刻 manualLogout 为真，必然是这段时间里用户按了注销。
    //   若不处理：本次登录会把用户刚注销掉的会话重新认证回来，
    //   界面显示「已手动注销·已暂停」，而门户实际 online=true —— 用户以为断网了，
    //   其实还在计费上网，且插件自认为暂停、不会再纠正。
    if ((await getSettings()).manualLogout) {
      console.log(tag + '登录期间用户已注销，补发注销以尊重用户意图');
      const lr = await runLogoutOnce();
      await saveResult(lr, '手动注销');
      return lr;
    }

    // 5) 登录后二次验证（三态：确认在线 / 确认未在线 / 什么都没确认到）
    if (r.ok) {
      const st2 = await checkStatus();
      await updateConnState(st2);
      if (st2.reachable && st2.online) {
        r = ok('登录成功，已确认在线', true);
      } else if (st2.reachable) {
        // 注意：这里**不能**判为凭据类错误。门户已接受认证（result:1），
        // 只是内核生效有延迟 —— 这属于「真掉线」场景，必须保持 1 秒快速重试。
        // 若在此置 permanent，会把正常的秒级抢修降成 10 秒，破坏核心能力。
        r = fail('登录请求已提交，但状态仍未在线（可能密码错误或账号被占用）', false);
      } else {
        // 门户已接受认证，但复查时突然不可达（网络抖动 / 网关重启）：
        // 此刻什么都没确认到 —— 不能报「已确认在线」，也不能改判失败。
        // 按已提交处理，online 置 false（不隐藏离线角标），交给下一轮巡检裁决。
        // 标 pending：这是「待确认」而非成功，避免面板渲染成绿色成功提示。
        r = ok('登录请求已提交，网络波动，待下一轮巡检确认', false);
        r.pending = true;
      }
    }

    // 6) 记录/清除「凭据类错误」标记，决定后续是按秒重试还是降频等待。
    //    成功或非凭据类失败（如网络抖动）都要清掉，避免一直卡在低频。
    const nextAuthError = !r.ok && !!r.permanent;
    if (nextAuthError !== settings.authError) {
      await setState({ authError: nextAuthError });
      console.log(tag + (nextAuthError
        ? '凭据类错误，已降为常规间隔重试（请检查账号密码与运营商）'
        : '已恢复正常重试节奏'));
    }

    await saveResult(r, trigger);
    console.log(tag + r.message);
    await applyCadence();
    return r;
  } catch (e) {
    // 兜底：任何未预期错误都不能让 Service Worker 挂掉
    const r = fail('发生未知错误：' + (e && e.message ? e.message : String(e)), false);
    try {
      await saveResult(r, trigger);
    } catch (e2) {
      // 忽略
    }
    return r;
  } finally {
    activeAuthOp = null;
    running = false;
  }
}

// ---------------------------------------------------------------------------
// 闹钟与生命周期
// ---------------------------------------------------------------------------

/**
 * 按当前状态创建/更新定时闹钟。
 *
 * 间隔选择：
 *   用户已手动注销          -> intervalMin        空闲巡检（不做登录尝试）
 *   凭据类错误（密码错等）  -> 常规间隔            重试无意义，降频等待用户改配置
 *   在线 / 未知            -> intervalMin        常规巡检
 *   门户可达但未认证        -> offlineIntervalMin 真·掉线，快速抢修
 *   连不上 / 拿不到门户数据 -> 指数退避            不在校园网内，避免每秒空转
 */
async function ensureAlarm() {
  try {
    await hydrateState();
    const settings = await getSettings();
    // 未填写账号密码时，即便状态是 offline 也不该按 1 秒空转 ——
    // autoLogin 第一步就会因缺凭据早退，此时应退回常规间隔，避免每秒空唤醒。
    const hasCredentials = !!(String(settings.account || '').trim() && String(settings.password || ''));
    let period;
    // 暂停态从设置里读，而不是靠调用方传参。
    // 否则任何一个调用方（如 settingsChanged 处理器）忘了传，暂停期间就会被
    // 按 connState==='offline' 设成「掉线间隔 1 秒」，浏览器又回到每秒空唤醒。
    if (settings.manualLogout) {
      period = clampInterval(settings.intervalMin);   // 空闲巡检
    } else if (settings.authError) {
      // 密码错 / 账号不存在等：按 1 秒重试一万次也不会成功，
      // 反而每天打出上万次无效认证。降到常规间隔，等用户改好凭据再说。
      period = clampInterval(settings.intervalMin);
    } else if (!settings.adaptive) {
      period = clampInterval(settings.intervalMin);   // 关闭自适应：统一常规间隔
    } else if (connState === 'offline') {
      period = clampInterval(hasCredentials ? settings.offlineIntervalMin : settings.intervalMin);
    } else if (connState === 'unreachable' || connState === 'unparseable') {
      period = backoffPeriod(settings);
    } else {
      period = clampInterval(settings.intervalMin);
    }

    const existing = await chrome.alarms.get(ALARM_NAME);
    // 周期没变就不重建，避免每次唤醒都重置计时器
    if (existing && Math.abs((existing.periodInMinutes || 0) - period) < 1e-9) {
      lastAlarmPeriod = period;
      return;
    }
    // create 对同名闹钟本身就是原子替换语义（官方文档明确），无需先 clear
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: period, periodInMinutes: period });
    lastAlarmPeriod = period;
    console.log('[alarm] 已设置每 ' + formatInterval(period) + ' 检查一次');
  } catch (e) {
    console.log('[alarm] 创建失败：' + (e && e.message ? e.message : String(e)));
  }
}

/** 首次安装：写入默认设置（仅此一次）。账号密码留空，绝不写入任何真实凭据。 */
async function initDefaults() {
  try {
    const stored = await chrome.storage.local.get(null);
    if (!stored || !stored.initialized) {
      await chrome.storage.local.set(DEFAULT_SETTINGS);
      console.log('[init] 已写入首次运行默认设置（账号密码为空，请在设置页填写）');
    }
  } catch (e) {
    // 忽略
  }
}

/**
 * 网页加载失败时立刻登录（最快的触发方式）：断线时浏览器会把任意 http 请求
 * 重定向到门户或直接报错，监听这两种情况即可无需等定时器。
 *
 * onErrorOccurred 是全局事件，任何页面的任何导航失败都会触发它，包括用户按 ESC
 * 中断加载（net::ERR_ABORTED）。故须用错误白名单 + 节流过滤，否则随便一个打不开
 * 的页面都会白唤醒一次门户请求。
 */
function setupInstantTriggers() {
  if (!chrome.webNavigation) return;

  let lastInstantAt = 0;   // 上次触发时间戳，用于节流

  /** 节流通过返回 false；距上次触发不足 INSTANT_THROTTLE_MS 则返回 true */
  function throttled() {
    const now = Date.now();
    if (now - lastInstantAt < INSTANT_THROTTLE_MS) return true;
    lastInstantAt = now;
    return false;
  }

  /**
   * 统一入口：检查开关 -> 节流 -> 发起登录。
   * @param {string} label 日志用的触发来源
   * @param {function(): Promise<*>} [pre] 额外前置条件，返回 false 则放弃
   */
  function trigger(label, pre) {
    try {
      chrome.storage.local.get({ instantTrigger: true }, (s) => {
        if (!s || s.instantTrigger === false) return;
        if (pre && !pre()) return;
        if (throttled()) return;
        console.log('[instant] ' + label);
        autoLogin(label);
      });
    } catch (e) {
      // 忽略
    }
  }

  // 1) 主框架导航被重定向到门户 -> 说明掉线了
  chrome.webNavigation.onCommitted.addListener((d) => {
    if (d.frameId !== 0) return;
    trigger('掉线跳转');
  }, { url: [{ hostEquals: PORTAL_HOST }] });

  // 2) 导航失败 -> 也可能是掉线。只认网络层错误，用户主动中断等一律忽略。
  chrome.webNavigation.onErrorOccurred.addListener((d) => {
    if (d.frameId !== 0) return;
    trigger('导航失败(' + d.error + ')', () => {
      const e = String(d.error || '');
      return !!e && INSTANT_ERROR_WHITELIST.some((code) => e.indexOf(code) !== -1);
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  // 异步流程统一 catch，避免未处理的 Promise 拒绝
  initDefaults()
    .then(hydrateState)
    .then(() => ensureAlarm())
    .then(() => autoLogin('安装'))
    .catch((e) => console.log('[onInstalled] ' + (e && e.message ? e.message : String(e))));
});

// 瞬时触发器必须在顶层注册：MV3 的 service worker 会休眠，
// 每次唤醒都会重新执行本文件，依赖事件驱动才能被唤醒。
setupInstantTriggers();

chrome.runtime.onStartup.addListener(() => {
  hydrateState()
    .then(getSettings)
    .then((s) => {
      if (!s.autoOnStartup) {
        console.log('[startup] 未开启开机自动登录');
        return null;
      }
      // 用户上次是手动注销状态 -> 开机不要擅自把人登回去
      if (s.manualLogout) {
        console.log('[startup] 处于手动注销状态，跳过自动登录');
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
    // manual=true：用户主动点「立即登录」，解除注销暂停
    autoLogin('手动', true)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse(fail('发生未知错误：' + (e && e.message ? e.message : String(e)), false)));
    return true; // 异步响应
  }

  if (msg.type === 'logout') {
    doLogout()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse(fail('注销异常：' + (e && e.message ? e.message : String(e)), false)));
    return true;
  }


  if (msg.type === 'status') {
    // 附带 manualLogout, running 与 onlineSince 状态，让 popup 与内容脚本一次拿全，避免并发竞态
    hydrateState()
      .then(() => Promise.all([checkStatus(), getSettings()]))
      .then(async ([st, s]) => {
        let curOnlineSince = onlineSince || s.onlineSince || null;
        if (st.online && !curOnlineSince) {
          const gwSec = parseGatewayDurationSec(st.raw);
          if (gwSec > 0) {
            curOnlineSince = Date.now() - gwSec * 1000;
          } else if (st.raw && st.raw.stime) {
            const d = new Date(String(st.raw.stime).replace(/-/g, '/'));
            const ms = d.getTime();
            if (Number.isFinite(ms) && !isNaN(ms) && d.toDateString() === new Date().toDateString() && ms <= Date.now()) {
              curOnlineSince = ms;
            } else {
              curOnlineSince = Date.now();
            }
          } else {
            curOnlineSince = Date.now();
          }
          onlineSince = curOnlineSince;
          await setState({ onlineSince: curOnlineSince });
        }
        sendResponse(Object.assign({}, st, {
          manualLogout: !!s.manualLogout,
          running: !!running,
          onlineSince: curOnlineSince
        }));
      })
      .catch(() => sendResponse({
        reachable: false,
        online: false,
        manualLogout: false,
        running: false,
        onlineSince: null,
        message: '网络连接失败，请检查 Wi-Fi 或网线'
      }));
    return true;
  }

  if (msg.type === 'settingsChanged') {
    // 重新从 storage 同步运行态（connState / unreachableStreak / onlineSince）。
    // 「恢复默认设置」会把 connState/unreachableStreak 清回 unknown/0，但后台 SW 的
    // 内存副本仍是旧值；只重建闹钟不会让退避计数归零，导致恢复默认后仍在退避。
    hydrateState()
      .then(getSettings)
      .then((s) => {
        connState = s.connState;
        unreachableStreak = s.unreachableStreak;
        lastPersistedStreak = s.unreachableStreak;
        onlineSince = s.onlineSince || null;
        if (Array.isArray(s.eventLogs)) {
          eventLogs = s.eventLogs.slice(0, MAX_EVENT_LOGS);
        }
        return ensureAlarm();
      })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'clearLogs') {
    eventLogs = [];
    setState({ eventLogs: [] })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'acquireAuthLock') {
    if (activeAuthOp || running) {
      sendResponse({ ok: false, busy: true, reason: activeAuthOp || 'running' });
    } else {
      activeAuthOp = 'content';
      running = true;
      // 为每次获取颁发唯一令牌，释放时必须携带，防止第一个标签结束后误释放第二个标签的锁。
      const token = 'lock-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      contentLockToken = token;
      if (contentLockTimer) clearTimeout(contentLockTimer);
      // 租期需覆盖完整内容脚本流程：拿到锁后的最坏链路是
      // 复查 chkstatus 8s + 5s 表单兜底等待 + 复查 chkstatus 8s + directLogin 8s ≈ 29s，
      // 此前租期 30s 只剩 1 秒余量，门户响应偏慢时租约会中途到期、锁被清掉，
      // 另一个门户标签就能抢锁并发认证（正是本锁要防的事）。放宽到 40s 留足余量，
      // 又不至于在孤儿标签（中途被关闭）时过久阻塞后台自动重连。
      contentLockTimer = setTimeout(() => {
        if (activeAuthOp === 'content' && contentLockToken === token) {
          activeAuthOp = null;
          running = false;
          contentLockToken = null;
        }
      }, 40000);
      sendResponse({ ok: true, token: token });
    }
    return true;
  }

  if (msg.type === 'releaseAuthLock') {
    // 只有持有当前令牌的一方才能释放；无令牌的旧版消息一律忽略，
    // 避免扩展 reload 后残留的旧标签页误清新实例的锁。
    if (activeAuthOp === 'content' && msg.token && msg.token === contentLockToken) {
      activeAuthOp = null;
      running = false;
      contentLockToken = null;
      if (contentLockTimer) clearTimeout(contentLockTimer);
    }
    sendResponse({ ok: true });
    return true;
  }

  // 内容脚本上报的填写/登录结果，仅记录，不重复登录
  if (msg.type === 'contentResult') {
    const r = msg.result || {};
    saveResult({
      ok: !!r.ok,
      state: r.state || (r.ok ? 'success' : (r.online ? 'success' : 'fail')),
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

// ---------------------------------------------------------------------------
// 快捷键快速登录监听 (Alt+Shift+L)
// ---------------------------------------------------------------------------
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'quick-login') {
      console.log('[command] 快捷键触发登录');
      // manual=true：这是用户主动按键，与点「立即登录」等价，应解除注销暂停。
      // 否则用户注销后按快捷键毫无反应，会以为快捷键坏了。
      autoLogin('快捷键', true);
    }
  });
}

