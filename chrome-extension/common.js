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
 * 弹出触感复制反馈微气泡
 * @param {MouseEvent} e 点击事件对象
 * @param {string} text 气泡文案
 */
function showFloatingBubble(e, text = '已复制 ✓') {
  try {
    const bubble = document.createElement('div');
    bubble.className = 'floating-copy-bubble';
    bubble.textContent = text;
    const x = e && e.clientX ? e.clientX : (window.innerWidth / 2);
    const y = e && e.clientY ? e.clientY : (window.innerHeight / 2);
    bubble.style.left = `${x}px`;
    bubble.style.top = `${y}px`;
    document.body.appendChild(bubble);
    setTimeout(() => bubble.remove(), 900);
  } catch (err) {}
}

/**
 * 创建心跳延迟波动小柱图渲染器
 * @param {string} containerId 容器元素ID
 * @param {number} maxBars 最多保留的历史条数
 */
function createSparkline(containerId, maxBars = 5) {
  const history = [];
  return function render(pingMs) {
    const container = $(containerId);
    if (!container) return;
    if (pingMs !== undefined && pingMs >= 0) {
      history.push(pingMs);
      if (history.length > maxBars) history.shift();
    }
    const bars = container.querySelectorAll('.spark-bar');
    if (!bars.length) return;
    const maxPing = Math.max(60, ...history, 1);
    bars.forEach((bar, idx) => {
      const val = history[idx];
      if (val !== undefined) {
        const pct = Math.max(25, Math.min(100, Math.round((val / maxPing) * 100)));
        bar.style.height = `${pct}%`;
        bar.className = 'spark-bar ' + (val <= 50 ? 'fast' : (val <= 150 ? 'normal' : 'slow'));
        bar.title = `${val} ms`;
      } else {
        bar.style.height = '25%';
        bar.className = 'spark-bar';
        bar.title = '';
      }
    });
  };
}

/**
 * 启用卡片鼠标微光跟随效果（已精简：保持卡片克制高级无闪烁）
 */
function initMouseGlow() {
  // 卡片保持纯净沉静边框，不注入额外 mousemove 监听与 rAF 循环
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

