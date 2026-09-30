/**
 * 校园网自动登录 — 弹出面板
 */
'use strict';

const $ = (id) => document.getElementById(id);

/** 把分钟数显示成人话 */
function fmt(min) {
  const n = parseFloat(min);
  if (!Number.isFinite(n)) return '—';
  return n < 1 ? Math.round(n * 60) + ' 秒' : n + ' 分钟';
}

function setStatus(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (cls ? ' ' + cls : '');
  const dot = $('dot');
  dot.className = 'dot ' + (cls === 'on' ? 'on' : cls === 'off' ? 'off' : 'wait');
}

function setMsg(text, cls) {
  const el = $('msg');
  el.textContent = text || '';
  el.className = 'msg' + (cls ? ' ' + cls : '');
}

/** 询问后台当前状态 */
function refresh() {
  // 显示版本号，用来确认 Chrome 是否已加载最新代码
  try {
    $('ver').textContent = 'v' + (chrome.runtime.getManifest().version || '?');
  } catch (e) {
    $('ver').textContent = '';
  }

  chrome.storage.local.get(['account', 'intervalMin', 'offlineIntervalMin', 'adaptive', 'lastResult'], (s) => {
    $('account').textContent = (s && s.account) || '未设置';

    const iv = s && s.intervalMin !== undefined ? parseFloat(s.intervalMin) : 1 / 60;
    const off = s && s.offlineIntervalMin !== undefined ? parseFloat(s.offlineIntervalMin) : 1 / 60;
    const adaptive = !s || s.adaptive !== false;
    $('interval').textContent = adaptive
      ? fmt(iv) + ' / 掉线 ' + fmt(off)
      : fmt(iv);

    const r = s && s.lastResult;
    if (r && r.time) $('lastTime').textContent = r.time;
    if (r && r.message) setMsg(r.message, r.ok ? 'ok' : 'err');
  });

  chrome.runtime.sendMessage({ type: 'status' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      setStatus('无法连接后台，请重新加载插件', 'off');
      return;
    }
    if (!res.reachable) {
      setStatus('不在校园网内 / 门户不可达', 'off');
    } else if (res.online) {
      setStatus('已在线', 'on');
    } else {
      setStatus('未登录，需要认证', 'off');
    }
  });
}

$('btnLogin').addEventListener('click', () => {
  const btn = $('btnLogin');
  btn.disabled = true;
  btn.textContent = '登录中…';
  setStatus('正在登录…', '');
  setMsg('');

  chrome.runtime.sendMessage({ type: 'login' }, (res) => {
    btn.disabled = false;
    btn.textContent = '立即登录';
    if (chrome.runtime.lastError || !res) {
      setStatus('登录请求失败', 'off');
      setMsg('后台无响应，请重新加载插件', 'err');
      return;
    }
    setMsg(res.message || '', res.ok ? 'ok' : 'err');
    setTimeout(refresh, 600);
  });
});

$('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

refresh();
