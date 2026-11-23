/**
 * 校园网自动登录 — 通用工具与可复用 UI 组件库 (common.js)
 * 供 popup.js 与 options.js 共享，采用高内聚组件化设计消除重复逻辑。
 */
'use strict';

/** 简化 DOM ID 查询（亦支持直接传入 DOM 元素） */
const $ = (idOrEl) => (typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl);

/**
 * 统一更新元素悬浮提示文案：写入 data-tip 并清理原生 title，
 * 由全局 initHoverTooltips() 使用一致的深色圆角浮层渲染，避免浏览器弹出异构白底系统框。
 */
function setTooltip(el, text) {
  if (!el) return;
  const clean = text === null || text === undefined ? '' : String(text).trim();
  if (typeof el.setAttribute === 'function' && typeof el.removeAttribute === 'function') {
    const hasGet = typeof el.getAttribute === 'function';
    if (clean) {
      if (!hasGet || el.getAttribute('data-tip') !== clean) {
        el.setAttribute('data-tip', clean);
      }
    } else if (!hasGet || el.getAttribute('data-tip') !== null) {
      el.removeAttribute('data-tip');
    }
    if (typeof el.hasAttribute !== 'function' || el.hasAttribute('title')) {
      el.removeAttribute('title');
    }
  }
  if ('title' in el && !clean && el.title) {
    el.title = '';
  }
}

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};
const HTML_ESCAPE_RE = /[&<>"']/g;

/** HTML 特殊字符安全转义 */
function escapeHtml(str) {
  return (str === null || str === undefined ? '' : String(str)).replace(HTML_ESCAPE_RE, (m) => HTML_ESCAPE_MAP[m]);
}

/**
 * 运营商元数据配置字典 (R3 认证参数)
 */
const ISP_ORDER = ['1', '2', '3', '4'];
const ISP_CONFIG = {
  '1': { code: '1', short: '校园', full: '校园用户 (默认)', tag: '默认', isMono: false },
  '2': { code: '2', short: '电信', full: '校园电信 (@dx)', tag: '@dx', isMono: true },
  '3': { code: '3', short: '联通', full: '校园联通 (@lt)', tag: '@lt', isMono: true },
  '4': { code: '4', short: '其他', full: '校园其他', tag: '无后缀', isMono: false }
};

function getIspMeta(isp) {
  const key = String(isp || '1');
  return ISP_CONFIG[key] || ISP_CONFIG['1'];
}

/**
 * 共享矢量图标片段注册表
 */
const ICONS = {
  clipboard: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
  checkSuccess: '<polyline points="20 6 9 17 4 12" stroke="#10b981" stroke-width="2.5" fill="none"/>',
  eyeOpen: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
};

function getStatusIconSvg(kind, size = 14) {
  if (kind === 'ok') {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
  }
  if (kind === 'err') {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  }
  if (kind === 'warn') {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
}

/**
 * Toast 图标种类归一化：ok / err / warn 直通，其余（含未知 kind）一律 info。
 * 此前 createToastManager.show() 用「ok/err 二选一、剩余全 info」的三元映射，
 * warn 命中的是 getStatusIconSvg 的 info 分支（ⓘ），警告三角分支形同虚设——
 * 空凭据保存提示等 warn 场景只有琥珀色样式、没有警示图标。
 */
function toastIconKind(kind) {
  return (kind === 'ok' || kind === 'err' || kind === 'warn') ? kind : 'info';
}

/**
 * 把分钟数格式化为人类可读的字符串
 * 示例: 1/60 -> "1 秒", 0.5 -> "30 秒", 5 -> "5 分钟"
 */
function fmt(min) {
  const n = parseFloat(min);
  if (!Number.isFinite(n)) return '—';
  if (n < 1) return Math.round(n * 60) + ' 秒';
  const cleanMin = Number.isInteger(n) ? n : Number(n.toFixed(2));
  return cleanMin + ' 分钟';
}

/**
 * 格式化流量 (输入单位: KB) 为清晰的 KB / MB / GB 字符串
 */
function fmtFlow(kb) {
  const n = parseFloat(kb);
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  if (n < 1024) return n + ' KB';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' MB';
  return (n / (1024 * 1024)).toFixed(2) + ' GB';
}

const MAC_CLEAN_RE = /[^0-9a-fA-F]/g;
const MAC_PAIR_RE = /.{1,2}/g;

/**
 * 格式化物理 MAC 地址为标准冒号分隔形式 XX:XX:XX:XX:XX:XX
 */
function fmtMac(hex) {
  if (!hex || typeof hex !== 'string') return '';
  const clean = hex.replace(MAC_CLEAN_RE, '');
  if (clean.length !== 12) return hex;
  return clean.match(MAC_PAIR_RE).join(':').toUpperCase();
}

/**
 * 把秒数格式化为 "X小时 Y分 Z秒" 或 "Y分 Z秒"
 */
function fmtDuration(totalSec) {
  if (!Number.isFinite(totalSec) || totalSec < 0) return '00分 00秒';
  const sec = Math.floor(totalSec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  if (h > 0) {
    return `${h}小时 ${p(m)}分 ${p(s)}秒`;
  }
  return `${p(m)}分 ${p(s)}秒`;
}

/**
 * 账号脱敏处理（自习室防窥模式）
 */
function maskAccount(acc) {
  if (!acc || typeof acc !== 'string') return '';
  const trimmed = acc.trim();
  if (trimmed.length <= 4) return '****';
  if (trimmed.length <= 7) return trimmed.slice(0, 2) + '****' + trimmed.slice(-2);
  return trimmed.slice(0, 3) + '****' + trimmed.slice(-4);
}

/**
 * 统一规范化状态提示文案
 */
function normalizeStatusMessage(text) {
  if (typeof text === 'string' && /门户不可达|不在校园网/.test(text)) {
    return '网络连接失败，请检查 Wi-Fi 或插好网线';
  }
  return text || '';
}

/**
 * 统一网关延迟分级评估器
 * @param {number} pingMs 延迟毫秒数
 * @param {boolean} [reachable] 网关是否可达
 */
function classifyPing(pingMs, reachable = false) {
  if (typeof pingMs === 'number' && Number.isFinite(pingMs) && pingMs >= 0) {
    if (pingMs <= 35) {
      return { grade: 'fast', label: '极佳', badgeText: '极佳', text: `${pingMs} ms`, tooltip: `极佳延迟 (${pingMs} ms)`, fallbackMs: pingMs };
    }
    if (pingMs <= 75) {
      return { grade: 'good', label: '畅通', badgeText: '畅通', text: `${pingMs} ms`, tooltip: `网络畅通 (${pingMs} ms)`, fallbackMs: pingMs };
    }
    if (pingMs <= 150) {
      return { grade: 'normal', label: '适中', badgeText: '适中', text: `${pingMs} ms`, tooltip: `正常延迟 (${pingMs} ms)`, fallbackMs: pingMs };
    }
    return { grade: 'slow', label: '迟滞', badgeText: '高延迟', text: `${pingMs} ms`, tooltip: `较高延迟 (${pingMs} ms)`, fallbackMs: pingMs };
  }
  if (reachable) {
    return { grade: 'fast', label: '连通', badgeText: '连通', text: '< 10 ms', tooltip: '网关连通正常', fallbackMs: 8 };
  }
  return { grade: 'slow', label: '超时', badgeText: '超时', text: '超时', tooltip: '网关不可达', fallbackMs: -1 };
}

/**
 * 统一智能会话在线时长解析器（供 popup 与 options 共享）
 * 过滤 4294967295 (0xFFFFFFFF) 网关未设置哨兵值，并识别 Dr.COM 跨夜残留长会话。
 */
function resolveSessionDuration(res, rawData) {
  const raw = rawData || (res && res.raw) || {};
  let durationInput = null;
  let popupTitle = '已在线';
  let optionsSubtitle = '上线时间: —';

  const now = Date.now();
  const localSince = res && res.onlineSince ? Number(res.onlineSince) : null;
  const MAX_SESSION_SEC = 90 * 86400; // 90 天合理上限
  const parseSec = (v) => {
    const n = parseInt(v, 10);
    return (Number.isFinite(n) && n > 0 && n < MAX_SESSION_SEC) ? n : 0;
  };

  if (localSince && Number.isFinite(localSince) && localSince <= now) {
    durationInput = localSince;
    const timeStr = new Date(localSince).toLocaleTimeString();
    popupTitle = '本次在线始于: ' + timeStr;
    optionsSubtitle = '本次连通: ' + timeStr;
  } else if (raw.stime) {
    const stimeDate = new Date(String(raw.stime).replace(/-/g, '/'));
    const stimeMs = stimeDate.getTime();
    const isStimeValid = Number.isFinite(stimeMs) && !isNaN(stimeMs);
    const isSameDay = isStimeValid && new Date().toDateString() === stimeDate.toDateString();
    const validSec = parseSec(raw.actt) || parseSec(raw.oltime);

    if (validSec) {
      durationInput = validSec;
      const fmtStr = `活跃在线: ${fmtDuration(validSec)}`;
      popupTitle = fmtStr;
      optionsSubtitle = fmtStr;
    } else if (isSameDay) {
      durationInput = raw.stime;
      popupTitle = '上线时间: ' + raw.stime;
      optionsSubtitle = '上线时间: ' + raw.stime;
    } else if (isStimeValid && (now - stimeMs) > 16 * 3600 * 1000) {
      durationInput = Date.now();
      popupTitle = '本次在线中';
      optionsSubtitle = '本次在线中';
    } else if (isStimeValid) {
      durationInput = raw.stime;
      popupTitle = '上线时间: ' + raw.stime;
      optionsSubtitle = '上线时间: ' + raw.stime;
    }
  } else {
    const acttSec = parseSec(raw.actt);
    const olSec = parseSec(raw.oltime);
    if (acttSec) {
      durationInput = acttSec;
      popupTitle = '网关活跃在线计时';
      optionsSubtitle = '网关活跃在线计时';
    } else if (olSec) {
      durationInput = olSec;
      popupTitle = '网关在线计时';
      optionsSubtitle = '网关在线计时';
    }
  }

  return { durationInput, popupTitle, optionsSubtitle };
}

/**
 * 组件 1：自校准秒表计时器 (Ticker Component)
 * @param {function(string, number): void} onTick 回调函数 (formattedText, elapsedSeconds)
 */
function createTicker(onTick) {
  let timer = null;
  let startMs = null;

  return {
    start(timeInput) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (!timeInput) {
        startMs = null;
        return;
      }

      if (typeof timeInput === 'number') {
        if (timeInput > 1e11) {
          startMs = timeInput;
        } else {
          startMs = Date.now() - timeInput * 1000;
        }
      } else {
        const d = new Date(String(timeInput).replace(/-/g, '/'));
        startMs = d.getTime();
      }

      if (!Number.isFinite(startMs) || isNaN(startMs)) {
        startMs = null;
        return;
      }

      const tick = () => {
        if (!startMs) return;
        const elapsedSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
        onTick(fmtDuration(elapsedSec), elapsedSec);
      };

      tick();
      timer = setInterval(tick, 1000);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      startMs = null;
    }
  };
}

/**
 * 组件 2：心跳延迟波动实时波形图渲染组件 (Sparkline Component)
 * @param {string|HTMLElement} containerId 容器元素或ID
 * @param {number} maxBars 最多保留的历史条数
 */
function createSparkline(containerId, maxBars = 8) {
  let history = [];
  return function render(pingInput) {
    const container = $(containerId);
    if (!container) return;

    if (Array.isArray(pingInput)) {
      history = pingInput.slice(-maxBars);
    } else if (typeof pingInput === 'number' && Number.isFinite(pingInput)) {
      if (pingInput >= 0 || pingInput === -1) {
        history.push(pingInput);
      }
      if (history.length > maxBars) history.shift();
    }

    const bars = container.querySelectorAll('.spark-bar');
    if (!bars.length) return;

    const validPings = history.filter((p) => typeof p === 'number' && p >= 0);
    const maxPing = Math.max(50, ...validPings, 1);
    const minPing = validPings.length ? Math.min(...validPings) : 0;
    const avgPing = validPings.length ? Math.round(validPings.reduce((a, b) => a + b, 0) / validPings.length) : 0;

    // 右对齐填充：最新的心跳始终在最右侧显示
    const offset = bars.length - history.length;

    bars.forEach((bar, idx) => {
      const historyIdx = idx - offset;
      if (historyIdx >= 0 && historyIdx < history.length) {
        const val = history[historyIdx];
        const isLatest = historyIdx === history.length - 1;

        if (val === -1) {
          const nextCls = 'spark-bar timeout' + (isLatest ? ' latest' : '');
          if (bar.style.height !== '42%') bar.style.height = '42%';
          if (bar.className !== nextCls) bar.className = nextCls;
          setTooltip(bar, `心跳 #${historyIdx + 1}: 超时 / 丢包`);
        } else {
          const pct = Math.max(22, Math.min(100, Math.round((val / maxPing) * 100)));
          const nextHeight = `${pct}%`;
          const info = classifyPing(val, true);
          const nextCls = `spark-bar ${info.grade}` + (isLatest ? ' latest' : '');
          if (bar.style.height !== nextHeight) bar.style.height = nextHeight;
          if (bar.className !== nextCls) bar.className = nextCls;
          setTooltip(bar, `心跳 #${historyIdx + 1}: ${val} ms (${info.label})`);
        }
      } else {
        if (bar.style.height !== '18%') bar.style.height = '18%';
        if (bar.className !== 'spark-bar empty') bar.className = 'spark-bar empty';
        setTooltip(bar, '等待心跳…');
      }
    });

    if (validPings.length) {
      setTooltip(container, `心跳延迟走势 (均值: ${avgPing}ms · 最低: ${minPing}ms · 最高: ${Math.max(...validPings)}ms)`);
    } else if (history.length) {
      setTooltip(container, '最近心跳: 网络连接超时或不可达');
    } else {
      setTooltip(container, '心跳延迟波动走势');
    }
  };
}

/**
 * 组件 3：双向流量计量与上下行比例进度条组件 (FlowMeter Component)
 * @param {Object} cfg 元素配置，支持 ID 字符串或 DOM 元素引用
 */
function createFlowMeter(cfg = {}) {
  const getEl = (k1, k2) => $(cfg[k1] || cfg[k2]);
  const card = () => getEl('cardEl', 'cardId');
  const total = () => getEl('totalEl', 'totalId');
  const detail = () => getEl('detailEl', 'detailId');
  const subTag = () => getEl('subTagEl', 'subTagId');
  const wrap = () => getEl('wrapEl', 'wrapId');
  const dlBar = () => $(cfg.dlBarEl || cfg.dlBarId || cfg.dlId);
  const ulBar = () => $(cfg.ulBarEl || cfg.ulBarId || cfg.ulId);

  function clearFlowTips(cardEl, totalEl, wrapEl) {
    setTooltip(cardEl, '');
    setTooltip(totalEl, '');
    setTooltip(wrapEl, '');
    if (totalEl && typeof totalEl.removeAttribute === 'function') totalEl.removeAttribute('aria-label');
    if (wrapEl && typeof wrapEl.removeAttribute === 'function') wrapEl.removeAttribute('aria-label');
    if (cardEl) cardEl.classList.remove('has-flow-tip');
  }

  function render(rawData, online) {
    const raw = rawData || {};
    const cardEl = card();
    const totalEl = total();
    const detailEl = detail();
    const subTagEl = subTag();
    const wrapEl = wrap();
    const dlBarEl = dlBar();
    const ulBarEl = ulBar();

    if (raw.flow !== undefined) {
      const totalFormatted = fmtFlow(raw.flow);
      if (totalEl) totalEl.textContent = totalFormatted;

      const dl = parseFloat(raw.actdf) || 0;
      const ul = parseFloat(raw.actuf) || 0;
      const sum = dl + ul;

      if (sum > 0) {
        const exactDlPct = Math.round((dl / sum) * 100);
        const exactUlPct = 100 - exactDlPct;
        const breakdown = `↓ 下载 ${exactDlPct}% (${fmtFlow(dl)}) · ↑ 上传 ${exactUlPct}% (${fmtFlow(ul)})`;

        if (subTagEl) {
          subTagEl.textContent = `下载 ${exactDlPct}%`;
          subTagEl.classList.add('visible');
        }

        if (cardEl) {
          setTooltip(cardEl, breakdown);
          cardEl.classList.add('has-flow-tip');
          setTooltip(totalEl, '');
          setTooltip(wrapEl, '');
        } else {
          setTooltip(wrapEl, breakdown);
          setTooltip(totalEl, `已用: ${totalFormatted} (下载: ${fmtFlow(dl)} / 上传: ${fmtFlow(ul)})`);
        }

        if (totalEl) totalEl.setAttribute('aria-label', `已用 ${totalFormatted}，${breakdown}`);
        if (wrapEl) wrapEl.setAttribute('aria-label', breakdown);

        if (dlBarEl && ulBarEl && wrapEl) {
          const barDlPct = Math.max(6, Math.min(94, exactDlPct));
          const barUlPct = 100 - barDlPct;
          dlBarEl.style.width = barDlPct + '%';
          ulBarEl.style.width = barUlPct + '%';
          wrapEl.style.display = 'flex';
        }
      } else {
        if (subTagEl) subTagEl.classList.remove('visible');
        clearFlowTips(cardEl, totalEl, wrapEl);
        if (wrapEl) wrapEl.style.display = 'none';
      }

      if (detailEl) {
        if (raw.actdf !== undefined && raw.actuf !== undefined) {
          detailEl.textContent = `↓ ${fmtFlow(raw.actdf)} · ↑ ${fmtFlow(raw.actuf)}`;
        } else {
          detailEl.textContent = '校园网流量统计';
        }
      }
    } else {
      if (totalEl) totalEl.textContent = online ? '计量中' : '—';
      if (detailEl) detailEl.textContent = '流量明细: —';
      if (wrapEl) wrapEl.style.display = 'none';
      if (subTagEl) subTagEl.classList.remove('visible');
      clearFlowTips(cardEl, totalEl, wrapEl);
    }
  }

  function reset() {
    const cardEl = card();
    const totalEl = total();
    const detailEl = detail();
    const subTagEl = subTag();
    const wrapEl = wrap();
    if (totalEl) totalEl.textContent = '—';
    if (detailEl) detailEl.textContent = '流量明细: —';
    if (wrapEl) wrapEl.style.display = 'none';
    if (subTagEl) subTagEl.classList.remove('visible');
    clearFlowTips(cardEl, totalEl, wrapEl);
  }

  return {
    render,
    update: render,
    reset
  };
}

/**
 * 组件 4：防误触二段式内联确认按钮组件 (ConfirmButton Component)
 * 避免使用原生 window.confirm 导致扩展 Popup 失焦关闭或阻塞线程。
 * 支持 createConfirmButton('id', { ... }) 与 createConfirmButton({ btnEl: ..., ... }) 多态调用。
 */
function createConfirmButton(btnOrId, options = {}) {
  if (btnOrId && typeof btnOrId === 'object' && (typeof Element === 'undefined' || !(btnOrId instanceof Element)) && typeof btnOrId.addEventListener !== 'function') {
    options = btnOrId;
    btnOrId = options.btnEl || options.btn || options.target || options.id;
  }
  const defaultLabel = options.defaultText || options.idleText || '注销';
  const confirmLabel = options.confirmText || '确认注销？';
  const timeoutMs = options.timeoutMs || 3200;
  const labelSelector = options.labelSelector || 'span';
  let timer = null;

  const getBtn = () => $(btnOrId);
  const getSpan = () => {
    const b = getBtn();
    return b ? (labelSelector ? b.querySelector(labelSelector) : b.querySelector('span')) : null;
  };

  function reset() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const btn = getBtn();
    if (!btn) return;
    btn.classList.remove('confirming');
    const span = getSpan();
    if (span) span.textContent = defaultLabel;
  }

  const btn = getBtn();
  if (btn && typeof btn.addEventListener === 'function') {
    btn.addEventListener('click', (e) => {
      if (btn.disabled) return;
      const span = getSpan();

      if (!btn.classList.contains('confirming')) {
        btn.classList.add('confirming');
        if (span) span.textContent = confirmLabel;
        const promptFn = options.onPrompt || options.onArmed;
        if (typeof promptFn === 'function') {
          promptFn(btn);
        }
        timer = setTimeout(reset, timeoutMs);
        return;
      }

      reset();
      if (typeof options.onConfirm === 'function') {
        options.onConfirm(btn, e);
      }
    });
  }

  return { reset };
}

/**
 * 组件 5：一键复制微交互组件 (CopyTrigger Component)
 * 统一管理剪贴板写入、防抖锁、图标/胶囊状态翻转与键盘无障碍触发。
 */
function createCopyTrigger(options = {}) {
  let timer = null;
  const duration = options.duration || 1500;
  const target = options.triggerEl || options.target || options.targetEl || options.el;
  const feedback = options.badgeEl || options.feedbackEl || options.pillEl;
  const getText = options.getText || options.getValue;
  const onCopied = options.onCopied || options.onSuccess;
  const onError = options.onError || options.onFail;

  function trigger(e) {
    if (e && options.stopPropagation) e.stopPropagation();
    const el = $(target);
    const feedbackEl = feedback ? $(feedback) : el;
    if (feedbackEl && feedbackEl.classList.contains('copied')) return;

    const text = typeof getText === 'function' ? getText() : '';
    if (!text) {
      if (typeof options.onEmpty === 'function') options.onEmpty();
      return;
    }

    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      if (typeof onError === 'function') onError(text);
      return;
    }

    // 两参数形式：onRejected 只处理 writeText 本身的失败。若用链式 .catch，
    // 成功回调里任何 DOM/回调异常也会被误当成「复制失败」。
    navigator.clipboard.writeText(text).then(() => {
      if (timer) clearTimeout(timer);
      if (feedbackEl) feedbackEl.classList.add('copied');

      const flashEl = options.flashEl ? $(options.flashEl) : null;
      if (flashEl) {
        flashEl.classList.add('copied-flash');
        setTimeout(() => flashEl.classList.remove('copied-flash'), 450);
      }

      const iconEl = options.iconEl ? $(options.iconEl) : null;
      if (iconEl && ICONS && ICONS.checkSuccess) {
        iconEl.innerHTML = ICONS.checkSuccess;
      }

      const pillEl = options.pillEl ? $(options.pillEl) : (feedback ? $(feedback) : null);
      const prevPillText = pillEl ? pillEl.textContent : '';
      if (pillEl && (options.copiedPillText || options.copiedText)) {
        pillEl.textContent = options.copiedPillText || options.copiedText || '已复制 ✓';
        pillEl.classList.add('copied');
      }

      if (typeof onCopied === 'function') {
        onCopied(text);
      }

      timer = setTimeout(() => {
        if (feedbackEl) feedbackEl.classList.remove('copied');
        if (iconEl && ICONS && ICONS.clipboard) iconEl.innerHTML = ICONS.clipboard;
        if (pillEl && (options.copiedPillText || options.copiedText)) {
          pillEl.textContent = options.defaultPillText || prevPillText || '点击复制';
          pillEl.classList.remove('copied');
        }
        timer = null;
      }, duration);
    }, (err) => {
      // 降级契约：无论「API 不可用」还是「写入被拒」，onError 的第一个参数
      // 都必须是**原始文本**。消费端（popup）靠它把值显示出来供手动复制；
      // 若这里把 Error 对象传过去，用户看到的会是 "Error: NotAllowedError..."。
      // 原始错误作为第二个参数保留，供需要的调用方诊断。
      if (typeof onError === 'function') onError(text, err);
    });
  }

  const el = $(target);
  if (el && typeof el.addEventListener === 'function') {
    el.addEventListener('click', trigger);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        trigger(e);
      }
    });
  }

  return { trigger };
}

/**
 * 组件 6：毛玻璃模态确认对话框组件 (ConfirmModal Component)
 * 用于替代阻塞式原生 confirm()，支持键盘 Escape / Enter 与焦点无障碍管理。
 */
function createConfirmModal(cfg = {}) {
  let activeResolve = null;
  let lastFocused = null;
  let focusTimer = null;

  const getOverlay = () => $(cfg.overlayId || 'confirmModalOverlay');
  const getTitle = () => $(cfg.titleId || 'confirmModalTitle');
  const getDesc = () => $(cfg.descId || 'confirmModalDesc');
  const getConfirmBtn = () => $(cfg.confirmBtnId || 'btnModalConfirm');
  const getCancelBtn = () => $(cfg.cancelBtnId || 'btnModalCancel');

  /**
   * 同一 overlay 上的所有实例登记表。
   *
   * DOM 事件只能绑定一次（overlay.dataset.bound 去重），否则会出现重复绑定、
   * 一次点击触发多次结算。但去重后若只让「第一个实例」持有按钮监听，第二个
   * 实例的 activeResolve 就永远不会被调用 —— 它的 Promise 永久悬挂（实测确认）。
   * 工厂函数在语义上允许同一 DOM 创建多个实例，因此这里用一个登记表把
   * 「结算」广播给该 overlay 上的全部实例：每个实例只结算自己 pending 的那次。
   */
  const instancesKey = '__confirmModalInstances';
  function registryOf(overlay) {
    if (!overlay[instancesKey]) overlay[instancesKey] = [];
    return overlay[instancesKey];
  }
  /** 结算本 overlay 上所有实例中处于 pending 的那一个（含自身） */
  function settleAll(overlay, result) {
    registryOf(overlay).forEach((inst) => inst.settle(result));
  }

  /** 结算单个实例（幂等：无 pending 时为空操作） */
  function settle(result) {
    if (!activeResolve) return;
    const r = activeResolve;
    activeResolve = null;
    r(!!result);
  }

  /** 本实例句柄，供 registry 回调（需在 init 之前定义） */
  const self = { settle };

  function close(result) {
    if (focusTimer) {
      clearTimeout(focusTimer);
      focusTimer = null;
    }
    const overlay = getOverlay();
    if (!overlay || !overlay.classList.contains('open')) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    const prevFocus = lastFocused;
    lastFocused = null;
    if (prevFocus && typeof prevFocus.focus === 'function') {
      prevFocus.focus();
    }
    settleAll(overlay, !!result);
  }

  function init() {
    const overlay = getOverlay();
    if (!overlay) return;
    if (registryOf(overlay).indexOf(self) === -1) registryOf(overlay).push(self);
    if (overlay.dataset.bound === 'true') return;
    overlay.dataset.bound = 'true';

    getCancelBtn()?.addEventListener('click', () => close(false));
    getConfirmBtn()?.addEventListener('click', () => close(true));

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });

    document.addEventListener('keydown', (e) => {
      if (!overlay.classList.contains('open')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
        return;
      }
      // 焦点陷阱：overlay 标了 aria-modal="true"，就必须把键盘焦点限制在框内，
      // 否则 Tab 会跑到背后的设置项上 —— 用户看不见焦点、却可能误改配置，
      // 而且「模态」的语义与实际行为不一致。这里只处理 Tab，其余按键不拦截。
      if (e.key === 'Tab') {
        const focusables = overlay.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
          'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables || !focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        // 焦点不在框内（或落在容器本身）时，Tab 一律拉回第一个元素
        if (!overlay.contains(active)) {
          e.preventDefault();
          first.focus();
          return;
        }
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  function confirm(opts = {}) {
    init();
    const overlay = getOverlay();
    if (!overlay) {
      return Promise.resolve(window.confirm(opts.desc || opts.title || '确定执行此操作吗？'));
    }

    // 已有模态框在等待时（快速双击触发第二次 open），先以「取消」结算上一次并保留原始触发焦点，
    // 避免把当前框内的确认/取消按钮误记为关闭后应恢复的目标元素。
    const wasOpen = overlay.classList.contains('open');
    settleAll(overlay, false);

    if (!wasOpen) {
      lastFocused = typeof document !== 'undefined' ? document.activeElement : null;
    }
    const titleEl = getTitle();
    const descEl = getDesc();
    const confirmBtn = getConfirmBtn();
    const cancelBtn = getCancelBtn();

    if (titleEl && opts.title) titleEl.textContent = opts.title;
    if (descEl && opts.desc) descEl.textContent = opts.desc;
    if (confirmBtn && opts.confirmText) confirmBtn.textContent = opts.confirmText;
    if (cancelBtn && opts.cancelText) cancelBtn.textContent = opts.cancelText;

    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      focusTimer = null;
      if (overlay.classList.contains('open') && confirmBtn) confirmBtn.focus();
    }, 40);

    return new Promise((resolve) => {
      activeResolve = resolve;
    });
  }

  function open(opts = {}) {
    return confirm(opts).then((isConfirmed) => {
      if (isConfirmed && typeof opts.onConfirm === 'function') {
        opts.onConfirm();
      }
      return isConfirmed;
    });
  }

  return {
    confirm,
    open,
    close,
    isOpen: () => !!(getOverlay() && getOverlay().classList.contains('open'))
  };
}

/**
 * 归一化事件日志数组。
 *
 * eventLogs 来自 chrome.storage.local，可能混入 null / 字符串 / 数字等非对象元素
 * （用户手改、旧版本残留、其他扩展写入）。而所有消费端都是直接读取条目字段：
 *   - 时间线抽屉 render 读 item.pending
 *   - 诊断报告读 item.time / item.from / item.message
 * 只要混入一个 null，两处就会抛 TypeError —— 抽屉整块空白、「复制诊断报告」
 * 按钮点了没反应，且控制台之外没有任何提示。
 *
 * 本函数是这两处的唯一入口守卫：只保留真正可渲染的对象条目。
 */
function sanitizeEventLogs(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
}

/**
 * 组件 7：实时诊断事件时间轴组件 (ActivityTimeline Component)
 * 渲染近期巡检、认证、网络波动与重连记录，支持折叠抽屉与一键复制脱敏诊断摘要。
 */
function createActivityTimeline(cfg = {}) {
  let isOpen = false;
  let cachedLogs = [];
  let lastBadgeText = null;
  let lastRenderedHtml = null;

  const getDrawer = () => $(cfg.drawerId);
  const getList = () => $(cfg.listId);
  const getToggleBtn = () => $(cfg.toggleBtnId);
  const getCountBadge = () => $(cfg.countBadgeId);

  function render(logs) {
    if (Array.isArray(logs)) {
      cachedLogs = sanitizeEventLogs(logs);
    }
    const listEl = getList();
    const badgeEl = getCountBadge();
    if (badgeEl) {
      const nextBadge = cachedLogs.length ? `日志 (${cachedLogs.length})` : '日志';
      if (lastBadgeText !== nextBadge) {
        lastBadgeText = nextBadge;
        badgeEl.textContent = nextBadge;
      }
    }
    if (!listEl) return;

    const nextHtml = !cachedLogs.length
      ? '<div class="timeline-empty">暂无事件记录，后台巡检与认证操作将实时记录于此</div>'
      : cachedLogs.map((item) => {
          const isPending = !!item.pending;
          const isOk = !isPending && !!item.ok;
          const stateCls = isPending ? 'wait' : (isOk ? 'ok' : 'err');
          const timeShort = String(item.time || '').split(' ').pop() || '—';
          const fromText = escapeHtml(item.from || '巡检');
          const msgText = escapeHtml(normalizeStatusMessage(item.message || ''));
          const rawCount = Number(item.count);
          const countNum = Number.isFinite(rawCount) && rawCount > 1 ? Math.floor(rawCount) : 1;
          const countHtml = countNum > 1 ? `<span class="timeline-repeat-badge" data-tip="连续相同状态合并计数">×${countNum}</span>` : '';

          return (
            `<div class="timeline-item ${stateCls}">` +
              `<span class="timeline-dot"></span>` +
              `<span class="timeline-time mono">${escapeHtml(timeShort)}</span>` +
              `<span class="timeline-from">${fromText}</span>` +
              `<span class="timeline-msg">${msgText}</span>` +
              countHtml +
            `</div>`
          );
        }).join('');
    if (lastRenderedHtml !== nextHtml) {
      lastRenderedHtml = nextHtml;
      listEl.innerHTML = nextHtml;
    }
  }

  function toggle(forceState) {
    const drawer = getDrawer();
    const btn = getToggleBtn();
    if (!drawer) return;
    isOpen = typeof forceState === 'boolean' ? forceState : !isOpen;
    drawer.classList.toggle('open', isOpen);
    drawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    if (btn) {
      btn.classList.toggle('active', isOpen);
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
  }

  const toggleBtn = getToggleBtn();
  const onToggleClick = () => toggle();
  if (toggleBtn) {
    toggleBtn.addEventListener('click', onToggleClick);
  }

  const onDocMouseDown = (e) => {
    if (!isOpen || !e || !e.target) return;
    const drawer = getDrawer();
    const btn = getToggleBtn();
    if (drawer && typeof drawer.contains === 'function' && drawer.contains(e.target)) return;
    if (btn && typeof btn.contains === 'function' && btn.contains(e.target)) return;
    toggle(false);
  };
  const onDocKeyDown = (e) => {
    if (isOpen && e && e.key === 'Escape') {
      const drawer = getDrawer();
      const btn = getToggleBtn();
      const wasFocusedInside = !!(drawer && typeof drawer.contains === 'function' &&
        typeof document !== 'undefined' && document.activeElement &&
        drawer.contains(document.activeElement));
      toggle(false);
      if (wasFocusedInside && btn && typeof btn.focus === 'function') {
        btn.focus();
      }
    }
  };

  const onDrawerFocusOut = () => {
    if (!isOpen) return;
    const isMobile = typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 900px)').matches;
    if (isMobile) return;
    setTimeout(() => {
      if (!isOpen) return;
      const drawer = getDrawer();
      const btn = getToggleBtn();
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      if (drawer && typeof drawer.contains === 'function' && drawer.contains(active)) return;
      if (btn && typeof btn.contains === 'function' && btn.contains(active)) return;
      toggle(false);
    }, 0);
  };

  const drawerOnInit = getDrawer();
  if (drawerOnInit && typeof drawerOnInit.addEventListener === 'function') {
    drawerOnInit.addEventListener('focusout', onDrawerFocusOut);
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);
  }

  return {
    render,
    toggle,
    getLogs: () => cachedLogs.slice(),
    destroy() {
      if (toggleBtn) toggleBtn.removeEventListener('click', onToggleClick);
      const d = getDrawer();
      if (d && typeof d.removeEventListener === 'function') {
        d.removeEventListener('focusout', onDrawerFocusOut);
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('mousedown', onDocMouseDown);
        document.removeEventListener('keydown', onDocKeyDown);
      }
    }
  };
}

/**
 * 组件 8：主题强调色管理 (科技蓝、极光紫、翡翠绿、落日橙、玫瑰粉)
 */
function normalizeAccent(accent) {
  const valid = ['blue', 'purple', 'emerald', 'amber', 'rose'];
  return valid.includes(accent) ? accent : 'blue';
}

function applyAccent(accent) {
  const target = normalizeAccent(accent);
  document.documentElement.setAttribute('data-accent', target);
  return target;
}

/**
 * 强调色初始化：读取当前值并注册变更监听。
 *
 * 幂等：重复调用不会重复注册 onChanged 监听器。此前每次调用都会 addListener，
 * 而 addListener 无法去重 —— 一旦某个页面（或将来新增的组件）多次调用本函数，
 * 监听器就会累积，同一变更被处理 N 次。当前调用点各只调一次，但这类"调用次数
 * 决定副作用"的隐含契约很脆弱，故在此显式收敛。
 *
 * @param {function(string): void} [callback] 每次强调色确定/变更时回调（仅首次注册时绑定）
 */
let accentListenerBound = false;
let accentOnChange = null;
let _accentSelfWriteValue = null;
let _accentSelfWriteTimer = null;
function initAccent(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  // 记录最新回调：监听器只注册一次，但每次调用都应让新回调接管后续变更
  if (typeof callback === 'function') accentOnChange = callback;
  chrome.storage.local.get({ accentColor: 'blue' }, (res) => {
    if (chrome.runtime && chrome.runtime.lastError) return;
    const acc = applyAccent(res && res.accentColor);
    if (typeof callback === 'function') callback(acc);
  });
  if (chrome.storage.onChanged && !accentListenerBound) {
    accentListenerBound = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.accentColor) {
        const nextAcc = normalizeAccent(changes.accentColor.newValue);
        if (_accentSelfWriteValue !== null && nextAcc === _accentSelfWriteValue) {
          _accentSelfWriteValue = null;
          return;
        }
        applyAccent(nextAcc);
        if (typeof accentOnChange === 'function') accentOnChange(nextAcc);
      }
    });
  }
}

/**
 * 组件 9：深浅色主题模式管理组件 (ThemeManager Component)
 * 统一管理 auto/dark/light 状态轮转、系统偏好跟随、存储持久化与多端无缝响应。
 */
// 与 initAccent 保持相同的幂等保护：单一页面内若多次实例化 ThemeManager，
// onChanged 监听器只注册一次，通过 _themeApplyFn 指针把事件路由给最新实例的 apply。
let _themeListenerBound = false;
let _themeApplyFn = null;
let _themeSelfWriteValue = null;
let _themeSelfWriteTimer = null;
function createThemeManager(options = {}) {
  const toggleBtn = $(options.toggleBtnId || options.btnId);
  const labelEl = $(options.labelId);
  const VALID_THEMES = ['auto', 'dark', 'light'];
  const normalizeTheme = (t) => VALID_THEMES.includes(t) ? t : 'auto';
  let currentPref = 'auto';
  let cycling = false;

  function apply(theme) {
    currentPref = normalizeTheme(theme);
    const sysDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effective = currentPref === 'auto' ? (sysDark ? 'dark' : 'light') : currentPref;
    document.documentElement.setAttribute('data-theme', effective);

    if (labelEl) {
      labelEl.textContent = currentPref === 'dark' ? '深色' : (currentPref === 'light' ? '浅色' : '自动');
    }

    if (typeof options.onChange === 'function') {
      options.onChange(currentPref, effective);
    }
  }

  function cycle() {
    if (cycling) return;
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    cycling = true;
    try {
      chrome.storage.local.get({ theme: 'auto' }, (s) => {
        const finishCycle = () => { cycling = false; };
        if (chrome.runtime && chrome.runtime.lastError) {
          finishCycle();
          return;
        }
        const cur = normalizeTheme(s && s.theme);
        let next = 'dark';
        if (options.supportAuto !== false) {
          next = cur === 'auto' ? 'dark' : (cur === 'dark' ? 'light' : 'auto');
        } else {
          if (cur === 'dark') next = 'light';
          else if (cur === 'light') next = 'dark';
          else {
            const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            next = sysDark ? 'light' : 'dark';
          }
        }
        _themeSelfWriteValue = next;
        if (_themeSelfWriteTimer) clearTimeout(_themeSelfWriteTimer);
        _themeSelfWriteTimer = setTimeout(() => { _themeSelfWriteValue = null; }, 300);

        chrome.storage.local.set({ theme: next }, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            _themeSelfWriteValue = null;
            finishCycle();
            return;
          }
          const reducedMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (!reducedMotion && typeof document !== 'undefined' && typeof document.startViewTransition === 'function') {
            try {
              const vt = document.startViewTransition(() => apply(next));
              if (vt && vt.finished && typeof vt.finished.then === 'function') {
                vt.finished.then(finishCycle, finishCycle);
              } else {
                finishCycle();
              }
            } catch (e) {
              apply(next);
              finishCycle();
            }
          } else {
            apply(next);
            finishCycle();
          }
          if (typeof options.onNotify === 'function') {
            const map = { auto: '跟随系统', dark: '深色模式', light: '浅色模式' };
            options.onNotify(`已切换至 ${map[next] || next}`);
          }
        });
      });
    } catch (e) {
      cycling = false;
    }
  }

  function init() {
    // 更新 apply 指针，使全局唯一的 onChanged 监听器始终路由给本实例
    _themeApplyFn = apply;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ theme: 'auto' }, (s) => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        apply(s && s.theme);
      });

      if (chrome.storage.onChanged && !_themeListenerBound) {
        _themeListenerBound = true;
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes.theme) {
            const nextTheme = changes.theme.newValue;
            if (_themeSelfWriteValue !== null && nextTheme === _themeSelfWriteValue) {
              _themeSelfWriteValue = null;
              return;
            }
            if (typeof _themeApplyFn === 'function') _themeApplyFn(nextTheme);
          }
        });
      }
    }

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      if (mql && typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', () => {
          if (currentPref === 'auto') {
            apply('auto');
          }
        });
      }
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', cycle);
    }
  }

  init();

  return {
    apply,
    cycle,
    getCurrent: () => currentPref
  };
}

/**
 * 组件 10：统一通知气泡与轻量 Toast 胶囊组件 (ToastManager Component)
 * 适配 options 控制中心（多条垂直堆叠）与 popup 弹窗（内嵌微胶囊）。
 */
function createToastManager(options = {}) {
  const container = $(options.containerId) || $(options.container);
  const singleMsgBox = $(options.boxId);
  const singleTextEl = $(options.textId);
  const singleIconEl = $(options.iconId);
  let singleTimer = null;

  function dismiss(toastEl) {
    if (!toastEl || toastEl._dismissing) return;

    // 单体模式（popup 的 #msgBox）是页面里的常驻元素，组件在初始化时就缓存了它的
    // 引用。若这里执行 remove()，元素会脱离文档；之后 show() 仍改的是这个游离节点，
    // 用户再也看不到任何提示（表现为「点一次消息框后所有提示都消失」）。
    // 因此单体框只复位视觉状态，不做移除。
    if (singleMsgBox && toastEl === singleMsgBox) {
      if (singleTimer) {
        clearTimeout(singleTimer);
        singleTimer = null;
      }
      toastEl.className = 'msg-box';
      return;
    }

    toastEl._dismissing = true;
    if (toastEl._timer) clearTimeout(toastEl._timer);
    toastEl.classList.remove('show');
    toastEl.classList.add('hide');

    let finished = false;
    const onEnd = () => {
      if (finished) return;
      finished = true;
      toastEl.removeEventListener('transitionend', onEnd);
      toastEl.remove();
    };
    toastEl.addEventListener('transitionend', onEnd, { once: true });
    setTimeout(onEnd, 300);
  }

  function show(text, kind = 'info', duration = 3500) {
    const norm = normalizeStatusMessage(text);
    if (!norm) {
      if (singleMsgBox) singleMsgBox.className = 'msg-box';
      return;
    }

    // 单体胶囊模式 (如 Popup)
    if (singleMsgBox && singleTextEl) {
      if (singleTimer) {
        clearTimeout(singleTimer);
        singleTimer = null;
      }
      singleMsgBox.className = `msg-box show ${kind}`;
      singleTextEl.textContent = norm;
      if (singleIconEl) {
        singleIconEl.innerHTML = getStatusIconSvg(toastIconKind(kind), 13);
      }
      if (duration && kind !== 'err') {
        singleTimer = setTimeout(() => {
          singleMsgBox.className = 'msg-box';
        }, duration);
      }
      return;
    }

    // 多条堆叠模式 (如 Options 控制中心)
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-bar show ${kind}`;
    toast.setAttribute('role', 'status');

    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.innerHTML = getStatusIconSvg(toastIconKind(kind), 16);

    const msgSpan = document.createElement('span');
    msgSpan.className = 'toast-msg';
    msgSpan.textContent = norm;

    toast.appendChild(iconSpan);
    toast.appendChild(msgSpan);

    toast.addEventListener('click', () => dismiss(toast));

    const activeToasts = container.querySelectorAll('.toast-bar.show');
    if (activeToasts.length >= (options.maxStack || 3)) {
      dismiss(activeToasts[0]);
    }

    container.appendChild(toast);

    if (duration) {
      toast._timer = setTimeout(() => dismiss(toast), duration);
    }
  }

  return {
    show,
    ok: (text, dur) => show(text, 'ok', dur),
    err: (text, dur) => show(text, 'err', dur || 5000),
    warn: (text, dur) => show(text, 'warn', dur),
    info: (text, dur) => show(text, 'info', dur),
    dismiss
  };
}

/**
 * 组件 11：密码显隐与自习室防窥自动回隐组件 (PasswordToggle Component)
 * 点击切换明密文，自带 10 秒无操作自动回隐保护，防止公共场所遗忘暴露。
 */
function createPasswordToggle(options = {}) {
  const inputEl = $(options.inputId);
  const toggleBtn = $(options.toggleBtnId);
  const eyeIcon = $(options.iconId);
  const timeoutMs = options.timeoutMs || 10000;
  let rehideTimer = null;

  function syncBtnState(revealed) {
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-pressed', revealed ? 'true' : 'false');
    }
  }

  function rehide() {
    if (rehideTimer) {
      clearTimeout(rehideTimer);
      rehideTimer = null;
    }
    if (inputEl && inputEl.type === 'text') {
      inputEl.type = 'password';
      if (eyeIcon) eyeIcon.innerHTML = ICONS.eyeOpen;
      syncBtnState(false);
      if (typeof options.onToggle === 'function') options.onToggle(false);
    }
  }

  function toggle() {
    if (!inputEl) return;
    const isCurrentlyPassword = inputEl.type === 'password';
    inputEl.type = isCurrentlyPassword ? 'text' : 'password';
    syncBtnState(isCurrentlyPassword);

    if (rehideTimer) {
      clearTimeout(rehideTimer);
      rehideTimer = null;
    }

    if (isCurrentlyPassword) {
      if (eyeIcon) eyeIcon.innerHTML = ICONS.eyeOff;
      rehideTimer = setTimeout(rehide, timeoutMs);
    } else {
      if (eyeIcon) eyeIcon.innerHTML = ICONS.eyeOpen;
    }

    if (typeof options.onToggle === 'function') {
      options.onToggle(isCurrentlyPassword);
    }
  }

  if (toggleBtn) {
    syncBtnState(inputEl?.type === 'text');
    toggleBtn.addEventListener('click', toggle);
  }

  return {
    toggle,
    rehide,
    isRevealed: () => inputEl?.type === 'text'
  };
}

/**
 * 组件 12：全链路网络健康指数测算与语义徽章组件 (NetworkHealthMeter Component)
 * 根据网关连通度、延迟等级、心跳历史计算 0-100 综合分值并驱动 UI。
 */
function createNetworkHealthMeter(options = {}) {
  const badgeEl = $(options.badgeId);
  const scoreEl = $(options.scoreId);

  function evaluate(res) {
    if (!res || !res.reachable) {
      return {
        score: 0,
        grade: 'offline',
        title: '离线',
        text: '健康度 0% · 离线',
        desc: '未连接到校园网物理链路'
      };
    }

    if (!res.online) {
      // score 与展示文案必须同源：此前 score 返回 45/55、text 却硬编码「50%」，
      // 两个字段自相矛盾 —— 一旦有消费方改用 score 渲染，就会出现「评分 55、文案 50%」的分裂。
      const score = res.manualLogout ? 45 : 55;
      const stateText = res.manualLogout ? '已暂停' : '待认证';
      return {
        score,
        grade: 'wait',
        title: stateText,
        text: `健康度 ${score}% · ${stateText}`,
        desc: '已连接局域网网关，互联网访问受限'
      };
    }

    let score = 100;
    const ping = res.pingMs !== undefined ? Number(res.pingMs) : 10;
    if (ping <= 30) {
      score = 100;
    } else if (ping <= 60) {
      score = 95 - Math.round((ping - 30) * 0.25);
    } else if (ping <= 120) {
      score = 85 - Math.round((ping - 60) * 0.25);
    } else {
      score = Math.max(60, 70 - Math.round((ping - 120) * 0.1));
    }

    const grade = score >= 90 ? 'fast' : (score >= 75 ? 'good' : 'normal');
    const label = score >= 95 ? '极佳' : (score >= 85 ? '畅通' : '良好');

    return {
      score,
      grade,
      title: label,
      text: `健康度 ${score}% · ${label}`,
      desc: `网关响应耗时 ${classifyPing(ping, true).text}，链路畅通`
    };
  }

  function render(resOrData) {
    const data = (resOrData && typeof resOrData.grade === 'string') ? resOrData : evaluate(resOrData);
    if (badgeEl) {
      badgeEl.className = `hero-health-pill ${data.grade}`;
      setTooltip(badgeEl, `${data.text} (${data.desc})`);
    }
    if (scoreEl) {
      scoreEl.textContent = data.text;
    }
    return data;
  }

  return {
    evaluate,
    render
  };
}

/**
 * 诊断报告标准化生成器：一键生成脱敏文本快照，便于校园网报障与排查
 */
function generateDiagnosticSnapshot(data = {}) {
  const version = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '1.0.0';
  const ispMeta = getIspMeta(data.isp || '1');
  const maskedAcc = maskAccount(data.account || '') || '未配置';
  const logs = sanitizeEventLogs(data.eventLogs).slice(0, 6);
  // data.mac 的调用方（设置页）传的是 UI 文案「物理 MAC: AA:BB:...」而不是裸 MAC。
  // 直接交给 fmtMac 会因剥离出的十六进制位多于 12 位而判定失败、原样返回，
  // 最终报告里出现「MAC: 物理 MAC: AA:BB:...」的重复前缀。先剥掉标签再格式化。
  const macText = fmtMac(String(data.mac || '').replace(/^\s*(?:物理\s*)?MAC\s*[:：]\s*/i, '')) || '—';

  const lines = [
    `=== [校园网自动登录 诊断快照 v${version}] ===`,
    `导出时间: ${new Date().toLocaleString()}`,
    `连接状态: ${data.statusText || '—'} (健康度: ${data.healthText || '—'})`,
    `网关延迟: ${data.pingText || '—'} (网关: 172.30.100.2:80)`,
    `认证账号: ${maskedAcc} | 运营商: ${ispMeta.short} (${ispMeta.tag})`,
    `终端地址: ${data.ip || '—'} | MAC: ${macText}`,
    `计费流量: ${data.flowText || '—'}`,
    `保活策略: ${data.policyText || '—'}`,
    `近况事件:`,
    ...(logs.length
      ? logs.map((l) => `  - ${l.time} [${l.from || '巡检'}] ${l.message}${l.count > 1 ? ' ×' + l.count : ''}`)
      : ['  - 暂无事件记录'])
  ];

  return lines.join('\n');
}

/**
 * 组件 13：现代毛玻璃自定义下拉选择组件 (SelectDropdown Component)
 * 将原生 <select> 美化为符合无障碍标准的自定义 Combobox 菜单。
 */
const OPT_LABEL_RE = /^(.*?)[（\(](.*?)[）\)]$/;

function formatOptionContent(text) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(OPT_LABEL_RE);
  if (!match) {
    return `<span class="opt-label">${escapeHtml(trimmed)}</span>`;
  }
  const main = match[1].trim();
  const sub = match[2].trim();
  let badgeClass = 'opt-badge';
  if (sub.includes('推荐') || sub.includes('最快') || sub.includes('最灵敏')) {
    badgeClass += ' primary';
  } else if (sub.startsWith('@')) {
    badgeClass += ' mono';
  }
  return `<div class="opt-body"><span class="opt-label">${escapeHtml(main)}</span><span class="${badgeClass}">${escapeHtml(sub)}</span></div>`;
}

function closeAllCustomSelects() {
  document.querySelectorAll('.select-wrap.open').forEach((w) => {
    w.classList.remove('open');
    const t = w.querySelector('.custom-select-trigger');
    if (t) {
      t.setAttribute('aria-expanded', 'false');
      t.removeAttribute('aria-activedescendant');
    }
    w.querySelectorAll('.custom-select-option.focused').forEach((optEl) => {
      optEl.classList.remove('focused');
    });
    const card = w.closest('.card');
    if (card) card.style.zIndex = '';
    const field = w.closest('.field');
    if (field) field.style.zIndex = '';
  });
}

function syncCustomSelect(target) {
  const el = typeof target === 'string' ? $(target) : target;
  if (el && typeof el._syncCustomSelect === 'function') {
    el._syncCustomSelect();
  }
}

function initCustomSelects(root = document) {
  const wraps = root.querySelectorAll('.select-wrap');
  wraps.forEach((wrap) => {
    const select = wrap.querySelector('select');
    if (!select || wrap.dataset.customized === 'true') return;
    wrap.dataset.customized = 'true';

    select.classList.add('custom-select-hidden');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const oldArrow = wrap.querySelector('.select-arrow');
    if (oldArrow) oldArrow.remove();

    const menuId = 'menu-' + (select.id || 'select-' + Math.floor(Math.random() * 10000));
    const valueId = `${menuId}-value`;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', menuId);
    let selectAriaLabel = '';
    let hasAssocLabel = false;
    if (select.id && typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      const assocLabel = document.querySelector(`label[for="${select.id}"]`);
      if (assocLabel) {
        if (!assocLabel.id) assocLabel.id = `${select.id}-label`;
        trigger.setAttribute('aria-labelledby', `${assocLabel.id} ${valueId}`);
        hasAssocLabel = true;
      }
    }
    if (!hasAssocLabel && typeof select.getAttribute === 'function' && select.getAttribute('aria-label')) {
      selectAriaLabel = select.getAttribute('aria-label');
      trigger.setAttribute('aria-label', selectAriaLabel);
    }

    const labelWrap = document.createElement('div');
    labelWrap.id = valueId;
    labelWrap.className = 'custom-select-label';

    const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrowSvg.setAttribute('class', 'custom-select-arrow');
    arrowSvg.setAttribute('aria-hidden', 'true');
    arrowSvg.setAttribute('viewBox', '0 0 24 24');
    arrowSvg.setAttribute('fill', 'none');
    arrowSvg.setAttribute('stroke', 'currentColor');
    arrowSvg.setAttribute('stroke-width', '2');
    arrowSvg.innerHTML = '<polyline points="6 9 12 15 18 9"/>';

    trigger.appendChild(labelWrap);
    trigger.appendChild(arrowSvg);
    wrap.appendChild(trigger);

    const menu = document.createElement('div');
    menu.id = menuId;
    menu.className = 'custom-select-menu';
    menu.setAttribute('role', 'listbox');
    if (trigger.getAttribute('aria-labelledby')) {
      menu.setAttribute('aria-labelledby', trigger.getAttribute('aria-labelledby').split(' ')[0]);
    } else if (selectAriaLabel) {
      menu.setAttribute('aria-label', selectAriaLabel);
    }

    let focusedIdx = Math.max(0, select.selectedIndex);

    Array.from(select.options).forEach((opt, idx) => {
      const optionEl = document.createElement('div');
      optionEl.id = `${menuId}-opt-${idx}`;
      optionEl.className = 'custom-select-option' + (idx === select.selectedIndex ? ' active' : '');
      optionEl.setAttribute('role', 'option');
      optionEl.setAttribute('data-value', opt.value);
      optionEl.setAttribute('data-index', String(idx));
      optionEl.setAttribute('aria-selected', idx === select.selectedIndex ? 'true' : 'false');

      optionEl.innerHTML = formatOptionContent(opt.textContent) +
        '<svg class="custom-select-check" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

      optionEl.addEventListener('click', (e) => {
        e.stopPropagation();
        selectOption(idx);
        closeMenu();
        trigger.focus();
      });

      menu.appendChild(optionEl);
    });

    wrap.appendChild(menu);

    function setFocusedOption(idx, shouldScroll) {
      const allItems = menu.querySelectorAll('.custom-select-option');
      if (!allItems || !allItems.length) return;
      focusedIdx = Math.max(0, Math.min(allItems.length - 1, idx));
      allItems.forEach((it, i) => {
        it.classList.toggle('focused', i === focusedIdx);
      });
      if (wrap.classList.contains('open')) {
        trigger.setAttribute('aria-activedescendant', `${menuId}-opt-${focusedIdx}`);
        if (shouldScroll && allItems[focusedIdx] && typeof allItems[focusedIdx].scrollIntoView === 'function') {
          allItems[focusedIdx].scrollIntoView({ block: 'nearest' });
        }
      } else {
        trigger.removeAttribute('aria-activedescendant');
      }
    }

    function selectOption(index) {
      if (select.selectedIndex !== index) {
        select.selectedIndex = index;
        syncUI();
        select.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        syncUI();
      }
    }

    function syncUI() {
      const curOpt = select.options[select.selectedIndex];
      if (curOpt) {
        labelWrap.innerHTML = formatOptionContent(curOpt.textContent);
        if (!hasAssocLabel && selectAriaLabel) {
          trigger.setAttribute('aria-label', `${selectAriaLabel}: ${String(curOpt.textContent || '').trim()}`);
        }
      }
      focusedIdx = Math.max(0, select.selectedIndex);
      const allItems = menu.querySelectorAll('.custom-select-option');
      const isOpenMenu = wrap.classList.contains('open');
      allItems.forEach((it, idx) => {
        const isMatch = idx === select.selectedIndex;
        it.classList.toggle('active', isMatch);
        it.classList.toggle('focused', isOpenMenu && idx === focusedIdx);
        it.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });

      if (isOpenMenu) {
        trigger.setAttribute('aria-activedescendant', `${menuId}-opt-${focusedIdx}`);
        const activeItem = menu.querySelector('.custom-select-option.active');
        if (activeItem && typeof activeItem.scrollIntoView === 'function') {
          activeItem.scrollIntoView({ block: 'nearest' });
        }
      } else {
        trigger.removeAttribute('aria-activedescendant');
      }
    }

    select._syncCustomSelect = syncUI;
    select.addEventListener('change', syncUI);
    syncUI();

    function openMenu() {
      closeAllCustomSelects();

      const rect = trigger.getBoundingClientRect();
      const menuHeight = 240;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
        menu.classList.add('placement-top');
      } else {
        menu.classList.remove('placement-top');
      }

      wrap.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');

      const parentCard = wrap.closest('.card');
      if (parentCard) parentCard.style.zIndex = '50';
      const parentField = wrap.closest('.field');
      if (parentField) parentField.style.zIndex = '60';

      focusedIdx = Math.max(0, select.selectedIndex);
      setFocusedOption(focusedIdx, true);
    }

    function closeMenu() {
      wrap.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      menu.querySelectorAll('.custom-select-option.focused').forEach((it) => {
        it.classList.remove('focused');
      });
      const parentCard = wrap.closest('.card');
      if (parentCard) parentCard.style.zIndex = '';
      const parentField = wrap.closest('.field');
      if (parentField) parentField.style.zIndex = '';
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (wrap.classList.contains('open')) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!wrap.classList.contains('open')) {
          if (e.key !== 'Home' && e.key !== 'End') {
            openMenu();
          }
        } else {
          if (e.key === 'ArrowDown') {
            setFocusedOption(focusedIdx + 1, true);
          } else if (e.key === 'ArrowUp') {
            setFocusedOption(focusedIdx - 1, true);
          } else if (e.key === 'Home') {
            setFocusedOption(0, true);
          } else if (e.key === 'End') {
            setFocusedOption(select.options.length - 1, true);
          } else if (e.key === 'Enter' || e.key === ' ') {
            selectOption(focusedIdx);
            closeMenu();
          }
        }
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        if (e.key === 'Escape' && wrap.classList.contains('open')) {
          e.preventDefault();
        }
        closeMenu();
      }
    });

    if (select.id) {
      const label = document.querySelector(`label[for="${select.id}"]`);
      if (label) {
        label.addEventListener('click', (e) => {
          if (wrap.classList.contains('is-hidden')) return;
          if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
              && window.getComputedStyle(wrap).display === 'none') {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          trigger.focus();
          trigger.click();
        });
      }
    }
  });

  if (!root._customSelectGlobalBound && typeof document !== 'undefined') {
    root._customSelectGlobalBound = true;
    document.addEventListener('click', (e) => {
      if (!e || !e.target || typeof e.target.closest !== 'function' || !e.target.closest('.select-wrap')) {
        closeAllCustomSelects();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAllCustomSelects();
      }
    });
  }
}

/**
 * 组件 14：自习室防窥隐私遮罩管理组件 (PrivacyMaskManager Component)
 * 统一管理自习室防窥状态持久化、UI图标显隐与各端文本脱敏同步。
 */
function createPrivacyMaskManager(options = {}) {
  const toggleBtn = $(options.toggleBtnId);
  const iconEl = $(options.iconId);
  let isMasked = false;
  let storageListener = null;
  let clickListener = null;

  function render() {
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', isMasked);
      toggleBtn.setAttribute('aria-pressed', isMasked ? 'true' : 'false');
      const title = isMasked
        ? (options.maskedTitle || '当前：自习室防窥（点击显示明文）')
        : (options.unmaskedTitle || '当前：明文显示（点击开启自习室防窥）');
      setTooltip(toggleBtn, title);
      toggleBtn.setAttribute('aria-label', title);
    }
    if (iconEl && ICONS) {
      iconEl.innerHTML = isMasked ? ICONS.eyeOff : ICONS.eyeOpen;
    }
    if (typeof options.onUpdate === 'function') {
      options.onUpdate(isMasked);
    }
  }

  function setMasked(val) {
    isMasked = !!val;
    render();
  }

  function toggle() {
    const nextMasked = !isMasked;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ privacyMask: nextMasked }, () => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        isMasked = nextMasked;
        render();
        if (typeof options.onNotify === 'function') {
          options.onNotify(isMasked ? '已开启自习室防窥模式' : '已恢复明文显示');
        }
      });
    } else {
      isMasked = nextMasked;
      render();
    }
  }

  function init() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ privacyMask: false }, (s) => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        isMasked = !!(s && s.privacyMask);
        render();
      });
      if (chrome.storage.onChanged) {
        storageListener = (changes, area) => {
          if (area === 'local' && changes.privacyMask) {
            isMasked = !!changes.privacyMask.newValue;
            render();
          }
        };
        chrome.storage.onChanged.addListener(storageListener);
      }
    }
    if (toggleBtn) {
      clickListener = (e) => {
        e.preventDefault();
        toggle();
      };
      toggleBtn.addEventListener('click', clickListener);
    }
  }

  init();

  return {
    isMasked: () => isMasked,
    toggle,
    setMasked,
    render,
    destroy() {
      if (storageListener && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged &&
          typeof chrome.storage.onChanged.removeListener === 'function') {
        chrome.storage.onChanged.removeListener(storageListener);
      }
      if (clickListener && toggleBtn && typeof toggleBtn.removeEventListener === 'function') {
        toggleBtn.removeEventListener('click', clickListener);
      }
    }
  };
}

/**
 * 组件 15：个性化强调色切换选择器组件 (AccentPicker Component)
 * 统一管理强调色色盘交互、DOM属性绑定与持久化通知。
 */
function createAccentPicker(options = {}) {
  const bar = $(options.barId || 'accentPaletteBar');
  const dotSelector = options.dotSelector || '.accent-dot';
  const names = Object.assign({
    blue: '科技蓝（默认）',
    purple: '极光紫',
    emerald: '翡翠绿',
    amber: '落日橙',
    rose: '玫瑰粉'
  }, options.names);

  function sync(current) {
    const dots = document.querySelectorAll(dotSelector);
    dots.forEach((dot) => {
      const active = dot.dataset.accent === current;
      dot.classList.toggle('active', active);
      dot.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function set(accent) {
    if (!accent) return;
    const normalized = normalizeAccent(accent);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      _accentSelfWriteValue = normalized;
      if (_accentSelfWriteTimer) clearTimeout(_accentSelfWriteTimer);
      _accentSelfWriteTimer = setTimeout(() => { _accentSelfWriteValue = null; }, 300);
      chrome.storage.local.set({ accentColor: normalized }, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          _accentSelfWriteValue = null;
          return;
        }
        applyAccent(normalized);
        sync(normalized);
        if (typeof options.onNotify === 'function') {
          options.onNotify(`已应用强调色：${names[normalized] || normalized}`);
        }
      });
    } else {
      applyAccent(normalized);
      sync(normalized);
    }
  }

  function init() {
    initAccent((cur) => sync(cur));
    if (bar) {
      bar.addEventListener('click', (e) => {
        const dot = e && e.target && typeof e.target.closest === 'function' ? e.target.closest(dotSelector) : null;
        if (dot && dot.dataset.accent) {
          set(dot.dataset.accent);
        }
      });
    }
  }

  init();

  return {
    set,
    sync,
    getName: (acc) => names[acc] || acc
  };
}

/**
 * 组件 16：节能前台可见性智能轮询器 (VisibilityPoller Component)
 * 标签页在前台时按指定间隔轮询，后台隐退时自动暂停以省电省CPU，恢复前台立即首刷。
 */
function createVisibilityPoller(callback, intervalMs = 15000) {
  let timer = null;

  function syncHiddenAttr() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const isHidden = document.visibilityState === 'hidden';
    if (isHidden) {
      if (typeof document.documentElement.setAttribute === 'function') {
        document.documentElement.setAttribute('data-page-hidden', 'true');
      }
    } else if (typeof document.documentElement.removeAttribute === 'function') {
      document.documentElement.removeAttribute('data-page-hidden');
    }
  }

  function poll() {
    if (typeof callback === 'function' && typeof document !== 'undefined' && document.visibilityState === 'visible') {
      callback();
    }
  }

  function start() {
    stop();
    timer = setInterval(poll, intervalMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  const onVisChange = () => {
    syncHiddenAttr();
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      poll();
      start();
    } else {
      stop();
    }
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', onVisChange);
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('beforeunload', stop);
    window.addEventListener('pagehide', stop);
  }

  syncHiddenAttr();
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
    start();
  }

  return {
    start,
    stop,
    trigger: poll,
    destroy() {
      stop();
      if (typeof document !== 'undefined' && document.documentElement && typeof document.documentElement.removeAttribute === 'function') {
        document.documentElement.removeAttribute('data-page-hidden');
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', onVisChange);
      }
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('beforeunload', stop);
        window.removeEventListener('pagehide', stop);
      }
    }
  };
}

/**
 * 组件 17：无排版抖动的微动效触发器 (PulseAnimation Component)
 * 利用双 requestAnimationFrame 重新挂载 CSS 动画，杜绝 offsetWidth 导致的强制重排（Layout Thrashing），
 * 同时避免单帧内 remove + add 被浏览器合并导致动画未重播。
 */
let _pulseRafId = 0;
function triggerPulseAnimation(selectorOrElements, className = 'val-pulse') {
  if (typeof document === 'undefined') return;
  const elements = typeof selectorOrElements === 'string'
    ? document.querySelectorAll(selectorOrElements)
    : selectorOrElements;
  if (!elements || !elements.length) return;

  if (_pulseRafId && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(_pulseRafId);
    _pulseRafId = 0;
  }
  elements.forEach((node) => node.classList.remove(className));
  if (typeof requestAnimationFrame !== 'undefined') {
    _pulseRafId = requestAnimationFrame(() => {
      _pulseRafId = requestAnimationFrame(() => {
        _pulseRafId = 0;
        elements.forEach((node) => node.classList.add(className));
      });
    });
  } else {
    elements.forEach((node) => node.classList.add(className));
  }
}

/**
 * 组件 18：全局统一悬浮提示浮层管理器 (Unified Hover Tooltip Portal)
 * 将页面内所有 [title] 与 [data-tip] 统一托管为深色圆角浮层（#uiHoverTip），
 * 自动处理窄视口左右贴边夹逼、上方不足时向下翻转及小三角指针精准对齐。
 */
let _hoverTooltipsBound = false;
function initHoverTooltips() {
  if (_hoverTooltipsBound || typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') {
    return;
  }
  _hoverTooltipsBound = true;

  const existing = $('uiHoverTip');
  const tipEl = existing || document.createElement('div');
  tipEl.id = 'uiHoverTip';
  tipEl.className = 'ui-hover-tip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.setAttribute('aria-hidden', 'true');

  let textEl = tipEl.querySelector ? tipEl.querySelector('.ui-hover-tip-text') : null;
  let arrowEl = tipEl.querySelector ? tipEl.querySelector('.ui-hover-tip-arrow') : null;
  if (!textEl) {
    textEl = document.createElement('span');
    textEl.className = 'ui-hover-tip-text';
    tipEl.appendChild(textEl);
  }
  if (!arrowEl) {
    arrowEl = document.createElement('span');
    arrowEl.className = 'ui-hover-tip-arrow';
    arrowEl.setAttribute('aria-hidden', 'true');
    tipEl.appendChild(arrowEl);
  }
  if (!existing) {
    document.body.appendChild(tipEl);
  }

  let activeTarget = null;
  let suppressedTarget = null;
  let ariaAttached = false;
  let lastFocusWasKeyboard = false;

  function promoteTitle(el) {
    if (!el || typeof el.getAttribute !== 'function') return '';
    const rawTitle = el.getAttribute('title');
    if (rawTitle !== null) {
      const clean = rawTitle.trim();
      if (clean) {
        el.setAttribute('data-tip', clean);
      } else {
        el.removeAttribute('data-tip');
      }
      el.removeAttribute('title');
      return clean;
    }
    return (el.getAttribute('data-tip') || '').trim();
  }

  function sweepTitles(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    if (typeof root.hasAttribute === 'function' && root.hasAttribute('title')) {
      promoteTitle(root);
    }
    root.querySelectorAll('[title]').forEach(promoteTitle);
  }

  sweepTitles(document);

  function hideTip() {
    if (ariaAttached && activeTarget && typeof activeTarget.removeAttribute === 'function') {
      activeTarget.removeAttribute('aria-describedby');
    }
    ariaAttached = false;
    activeTarget = null;
    tipEl.classList.remove('show', 'place-bottom');
    tipEl.setAttribute('aria-hidden', 'true');
  }

  function showTip(target) {
    if (!target || (typeof document.contains === 'function' && !document.contains(target))) {
      hideTip();
      return;
    }
    const text = promoteTitle(target);
    if (!text || typeof target.getBoundingClientRect !== 'function') {
      hideTip();
      return;
    }
    const r = target.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      hideTip();
      return;
    }

    // 性能优化：同元素内子节点移动且文案未变时避免重复触发布局重排与样式更新
    if (activeTarget === target && tipEl.classList.contains('show') && textEl.textContent === text) {
      return;
    }

    if (activeTarget !== target && ariaAttached && activeTarget && typeof activeTarget.removeAttribute === 'function') {
      activeTarget.removeAttribute('aria-describedby');
      ariaAttached = false;
    }

    // 先重置位置到左上角，确保 width: max-content 在真实 max-width 约束下自然排版后再测量
    tipEl.style.left = '0px';
    tipEl.style.top = '0px';
    textEl.textContent = text;

    const tipW = tipEl.offsetWidth || 120;
    const tipH = tipEl.offsetHeight || 28;
    const vw = (document.documentElement && document.documentElement.clientWidth) || (typeof window !== 'undefined' && window.innerWidth) || 356;
    const vh = (document.documentElement && document.documentElement.clientHeight) || (typeof window !== 'undefined' && window.innerHeight) || 600;

    const pad = 8;
    const gap = 8;
    const centerX = r.left + r.width / 2;
    const left = Math.max(pad, Math.min(vw - tipW - pad, centerX - tipW / 2));

    const spaceAbove = r.top;
    const spaceBelow = vh - r.bottom;
    const placeBottom = spaceAbove < tipH + gap + 6 && spaceBelow > spaceAbove;
    const rawTop = placeBottom ? (r.bottom + gap) : (r.top - tipH - gap);
    const top = Math.max(4, Math.min(vh - tipH - 4, rawTop));

    const arrowMin = 12;
    const arrowMax = Math.max(arrowMin, tipW - 12);
    const arrowLeft = Math.max(arrowMin, Math.min(arrowMax, centerX - left));

    tipEl.classList.toggle('place-bottom', placeBottom);
    tipEl.style.left = Math.round(left) + 'px';
    tipEl.style.top = Math.round(top) + 'px';
    arrowEl.style.left = Math.round(arrowLeft) + 'px';

    if (activeTarget !== target && typeof target.hasAttribute === 'function' && !target.hasAttribute('aria-describedby')) {
      target.setAttribute('aria-describedby', 'uiHoverTip');
      ariaAttached = true;
    }
    activeTarget = target;
    tipEl.setAttribute('aria-hidden', 'false');
    tipEl.classList.add('show');
  }

  function findTipTarget(node) {
    if (!node || typeof node.closest !== 'function') return null;
    return node.closest('[data-tip], [title]');
  }

  if (typeof MutationObserver === 'function' && typeof Node === 'function' && document.body instanceof Node) {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes') {
          if (m.attributeName === 'title') {
            promoteTitle(m.target);
          }
          if (m.target === activeTarget) {
            showTip(activeTarget);
          }
        } else if (m.type === 'childList') {
          if (m.addedNodes && m.addedNodes.length) {
            m.addedNodes.forEach((n) => {
              if (n && n.nodeType === 1) sweepTitles(n);
            });
          }
          if (activeTarget && m.removedNodes && m.removedNodes.length &&
              typeof document.contains === 'function' && !document.contains(activeTarget)) {
            hideTip();
          }
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title', 'data-tip']
    });
  }

  document.addEventListener('mouseover', (e) => {
    const next = findTipTarget(e && e.target);
    if (!next) {
      suppressedTarget = null;
      hideTip();
      return;
    }
    if (suppressedTarget && next === suppressedTarget) return;
    suppressedTarget = null;
    showTip(next);
  });

  document.addEventListener('mouseout', (e) => {
    if (suppressedTarget && (!e || !e.relatedTarget || (typeof suppressedTarget.contains === 'function' && !suppressedTarget.contains(e.relatedTarget)))) {
      suppressedTarget = null;
    }
    if (!e || !e.relatedTarget) {
      hideTip();
    }
  });

  document.addEventListener('pointerdown', () => {
    lastFocusWasKeyboard = false;
    suppressedTarget = activeTarget;
    hideTip();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!e) return;
    if (e.key === 'Escape') {
      suppressedTarget = activeTarget;
      hideTip();
      return;
    }
    if (e.key === 'Tab' || (typeof e.key === 'string' && e.key.startsWith('Arrow')) || e.key === 'Home' || e.key === 'End') {
      lastFocusWasKeyboard = true;
    }
  }, true);

  document.addEventListener('focusin', (e) => {
    const t = e && e.target;
    let isFocusVisible = false;
    try {
      isFocusVisible = !!(t && typeof t.matches === 'function' && t.matches(':focus-visible'));
    } catch (_) {
      isFocusVisible = false;
    }
    if (!lastFocusWasKeyboard && !isFocusVisible) return;
    const tipTarget = findTipTarget(t);
    if (tipTarget) showTip(tipTarget);
  });

  document.addEventListener('focusout', () => {
    hideTip();
  });

  document.addEventListener('scroll', hideTip, true);

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('blur', hideTip);
    window.addEventListener('resize', hideTip);
    window.addEventListener('pagehide', hideTip);
  }
}
