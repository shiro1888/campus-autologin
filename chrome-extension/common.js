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
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
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
        // 如果传入的是已过去的秒数，倒推起始毫秒
        startMs = Date.now() - timeInput * 1000;
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
