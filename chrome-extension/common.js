/**
 * 校园网自动登录 — 通用工具与可复用 UI 组件库 (common.js)
 * 供 popup.js 与 options.js 共享，采用高内聚组件化设计消除重复逻辑。
 */
'use strict';

/** 简化 DOM ID 查询（亦支持直接传入 DOM 元素） */
const $ = (idOrEl) => (typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl);

/** HTML 特殊字符安全转义 */
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
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
 * 把分钟数格式化为人类可读的字符串
 * 示例: 1/60 -> "1 秒", 0.5 -> "30 秒", 5 -> "5 分钟"
 */
function fmt(min) {
  const n = parseFloat(min);
  if (!Number.isFinite(n)) return '—';
  return n < 1 ? Math.round(n * 60) + ' 秒' : n + ' 分钟';
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

/**
 * 格式化物理 MAC 地址为标准冒号分隔形式 XX:XX:XX:XX:XX:XX
 */
function fmtMac(hex) {
  if (!hex || typeof hex !== 'string') return '';
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length !== 12) return hex;
  return clean.match(/.{1,2}/g).join(':').toUpperCase();
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
          bar.style.height = '42%';
          bar.className = 'spark-bar timeout' + (isLatest ? ' latest' : '');
          bar.title = `心跳 #${historyIdx + 1}: 超时 / 丢包`;
        } else {
          const pct = Math.max(22, Math.min(100, Math.round((val / maxPing) * 100)));
          bar.style.height = `${pct}%`;
          const info = classifyPing(val, true);
          bar.className = `spark-bar ${info.grade}` + (isLatest ? ' latest' : '');
          bar.title = `心跳 #${historyIdx + 1}: ${val} ms (${info.label})`;
        }
      } else {
        bar.style.height = '18%';
        bar.className = 'spark-bar empty';
        bar.title = '等待心跳…';
      }
    });

    if (validPings.length) {
      container.title = `心跳延迟走势 (均值: ${avgPing}ms · 最低: ${minPing}ms · 最高: ${Math.max(...validPings)}ms)`;
    } else if (history.length) {
      container.title = '最近心跳: 网络连接超时或不可达';
    }
  };
}

/**
 * 组件 3：双向流量计量与上下行比例进度条组件 (FlowMeter Component)
 * @param {Object} cfg 元素配置，支持 ID 字符串或 DOM 元素引用
 */
function createFlowMeter(cfg = {}) {
  const getEl = (k1, k2) => $(cfg[k1] || cfg[k2]);
  const total = () => getEl('totalEl', 'totalId');
  const detail = () => getEl('detailEl', 'detailId');
  const subTag = () => getEl('subTagEl', 'subTagId');
  const wrap = () => getEl('wrapEl', 'wrapId');
  const dlBar = () => getEl('dlBarEl', 'dlId') || getEl('dlBarEl', 'dlBarId');
  const ulBar = () => getEl('ulBarEl', 'ulId') || getEl('ulBarEl', 'ulBarId');

  function render(rawData, online) {
    const raw = rawData || {};
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

      if (subTagEl) {
        if (sum > 0) {
          const dlPct = Math.round((dl / sum) * 100);
          subTagEl.textContent = `↓${dlPct}%`;
          subTagEl.classList.add('visible');
        } else {
          subTagEl.classList.remove('visible');
        }
      }

      if (sum > 0 && dlBarEl && ulBarEl && wrapEl) {
        const dlPct = Math.max(6, Math.min(94, Math.round((dl / sum) * 100)));
        const ulPct = 100 - dlPct;
        dlBarEl.style.width = dlPct + '%';
        ulBarEl.style.width = ulPct + '%';
        wrapEl.style.display = 'flex';
        wrapEl.title = `下载 ${dlPct}% (${fmtFlow(dl)}) · 上传 ${ulPct}% (${fmtFlow(ul)})`;
        if (totalEl) {
          totalEl.title = `已用: ${totalFormatted} (下载: ${fmtFlow(dl)} / 上传: ${fmtFlow(ul)})`;
        }
      } else if (wrapEl) {
        wrapEl.style.display = 'none';
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
    }
  }

  function reset() {
    const totalEl = total();
    const detailEl = detail();
    const subTagEl = subTag();
    const wrapEl = wrap();
    if (totalEl) totalEl.textContent = '—';
    if (detailEl) detailEl.textContent = '流量明细: —';
    if (wrapEl) wrapEl.style.display = 'none';
    if (subTagEl) subTagEl.classList.remove('visible');
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

  const getOverlay = () => $(cfg.overlayId || 'confirmModalOverlay');
  const getTitle = () => $(cfg.titleId || 'confirmModalTitle');
  const getDesc = () => $(cfg.descId || 'confirmModalDesc');
  const getConfirmBtn = () => $(cfg.confirmBtnId || 'btnModalConfirm');
  const getCancelBtn = () => $(cfg.cancelBtnId || 'btnModalCancel');

  function close(result) {
    const overlay = getOverlay();
    if (!overlay || !overlay.classList.contains('open')) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
    if (activeResolve) {
      const r = activeResolve;
      activeResolve = null;
      r(!!result);
    }
  }

  function init() {
    const overlay = getOverlay();
    if (!overlay || overlay.dataset.bound === 'true') return;
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
      }
    });
  }

  function confirm(opts = {}) {
    init();
    const overlay = getOverlay();
    if (!overlay) {
      return Promise.resolve(window.confirm(opts.desc || opts.title || '确定执行此操作吗？'));
    }

    // 已有模态框在等待时（快速双击触发第二次 open），先以「取消」结算上一次，
    // 否则 activeResolve 被覆盖，第一个 Promise 会永久悬挂、其 .then 永不执行。
    if (activeResolve) {
      const prev = activeResolve;
      activeResolve = null;
      prev(false);
    }

    lastFocused = document.activeElement;
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
    setTimeout(() => {
      if (confirmBtn) confirmBtn.focus();
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

  return { confirm, open, close };
}

/**
 * 组件 7：实时诊断事件时间轴组件 (ActivityTimeline Component)
 * 渲染近期巡检、认证、网络波动与重连记录，支持折叠抽屉与一键复制脱敏诊断摘要。
 */
function createActivityTimeline(cfg = {}) {
  let isOpen = false;
  let cachedLogs = [];

  const getDrawer = () => $(cfg.drawerId);
  const getList = () => $(cfg.listId);
  const getToggleBtn = () => $(cfg.toggleBtnId);
  const getCountBadge = () => $(cfg.countBadgeId);

  function render(logs) {
    if (Array.isArray(logs)) {
      cachedLogs = logs;
    }
    const listEl = getList();
    const badgeEl = getCountBadge();
    if (badgeEl) {
      badgeEl.textContent = cachedLogs.length ? `日志 (${cachedLogs.length})` : '日志';
    }
    if (!listEl) return;

    if (!cachedLogs.length) {
      listEl.innerHTML = '<div class="timeline-empty">暂无事件记录，后台巡检与认证操作将实时记录于此</div>';
      return;
    }

    listEl.innerHTML = cachedLogs.map((item) => {
      const isPending = !!item.pending;
      const isOk = !isPending && !!item.ok;
      const stateCls = isPending ? 'wait' : (isOk ? 'ok' : 'err');
      const timeShort = String(item.time || '').split(' ').pop() || '—';
      const fromText = escapeHtml(item.from || '巡检');
      const msgText = escapeHtml(normalizeStatusMessage(item.message || ''));
      const countNum = Number(item.count) || 1;
      const countHtml = countNum > 1 ? `<span class="timeline-repeat-badge" title="连续相同状态合并计数">×${countNum}</span>` : '';

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
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => toggle());
  }

  return {
    render,
    toggle,
    getLogs: () => cachedLogs.slice()
  };
}

/**
 * 组件 8：主题强调色管理 (科技蓝、极光紫、翡翠绿、落日橙、玫瑰粉)
 */
function applyAccent(accent) {
  const valid = ['blue', 'purple', 'emerald', 'amber', 'rose'];
  const target = valid.includes(accent) ? accent : 'blue';
  document.documentElement.setAttribute('data-accent', target);
}

function initAccent(callback) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ accentColor: 'blue' }, (res) => {
      const acc = res && res.accentColor ? res.accentColor : 'blue';
      applyAccent(acc);
      if (typeof callback === 'function') callback(acc);
    });
    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.accentColor) {
          applyAccent(changes.accentColor.newValue);
          if (typeof callback === 'function') callback(changes.accentColor.newValue);
        }
      });
    }
  }
}
