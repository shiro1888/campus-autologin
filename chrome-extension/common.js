/**
 * 校园网自动登录 — 通用工具函数模块 (common.js)
 * 供 popup.js 与 options.js 共享，避免代码重复。
 */
'use strict';

/** 简化 DOM ID 查询 */
const $ = (id) => document.getElementById(id);

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
 * 创建一个自校准的秒表计时器 (Ticker)
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
        // 若传入的是时间戳毫秒 (>= 1e11，如 Date.now() / 1791504448000)，直接作为 startMs；
        // 若是已过去的秒数 (如 120 或 3600)，倒推起始毫秒
        if (timeInput > 1e11) {
          startMs = timeInput;
        } else {
          startMs = Date.now() - timeInput * 1000;
        }
      } else {
        // 传入的是时间戳字符串，形如 "2026-09-30 10:08:56"
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
 * 创建心跳延迟波动实时柱状/波形图渲染器
 * @param {string} containerId 容器元素ID
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
          let grade = 'fast';
          let gradeLabel = '极佳';
          if (val <= 35) {
            grade = 'fast';
            gradeLabel = '极佳';
          } else if (val <= 75) {
            grade = 'good';
            gradeLabel = '畅通';
          } else if (val <= 150) {
            grade = 'normal';
            gradeLabel = '适中';
          } else {
            grade = 'slow';
            gradeLabel = '迟滞';
          }
          bar.className = `spark-bar ${grade}` + (isLatest ? ' latest' : '');
          bar.title = `心跳 #${historyIdx + 1}: ${val} ms (${gradeLabel})`;
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
 * 设置或切换主题强调色 (科技蓝、极光紫、翡翠绿、落日橙、玫瑰粉)
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

