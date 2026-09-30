/**
 * 校园网自动登录 — 弹出面板脚本
 */
'use strict';

const $ = (id) => document.getElementById(id);

/** 把分钟数显示成人话 */
function fmt(min) {
  const n = parseFloat(min);
  if (!Number.isFinite(n)) return '—';
  return n < 1 ? Math.round(n * 60) + ' 秒' : n + ' 分钟';
}

/** 格式化流量为 MB / GB */
function fmtFlow(kb) {
  const n = parseFloat(kb);
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  if (n < 1024) return n + ' KB';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' MB';
  return (n / (1024 * 1024)).toFixed(2) + ' GB';
}

/** 动态在线计时器 (秒表实时跳动) */
let durationTimer = null;
let loginStartTimeMs = null;

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

function startDurationTicker(startTimeStr) {
  if (durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }
  if (!startTimeStr) {
    loginStartTimeMs = null;
    return;
  }
  const d = new Date(startTimeStr.replace(/-/g, '/'));
  loginStartTimeMs = d.getTime();
  if (isNaN(loginStartTimeMs)) {
    loginStartTimeMs = null;
    return;
  }

  function tick() {
    if (!loginStartTimeMs) return;
    const elapsedSec = Math.max(0, Math.floor((Date.now() - loginStartTimeMs) / 1000));
    $('onlineDuration').textContent = fmtDuration(elapsedSec);
  }

  tick();
  durationTimer = setInterval(tick, 1000);
}

function stopDurationTicker() {
  if (durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }
  loginStartTimeMs = null;
}


/** 设置状态卡片UI */
function setStatus(title, desc, cls) {
  const card = $('statusCard');
  card.className = 'card status-card' + (cls ? ' ' + cls : '');

  const titleEl = $('statusTitle');
  const descEl = $('statusDesc');

  titleEl.textContent = title;
  descEl.textContent = desc;
}

/** 显示提示信息条 */
function setMsg(text, kind) {
  const box = $('msgBox');
  const msgEl = $('msg');
  const iconEl = $('msgIcon');

  if (!text) {
    box.className = 'msg-box';
    msgEl.textContent = '';
    return;
  }

  box.className = 'msg-box show ' + (kind || 'info');
  msgEl.textContent = text;
  iconEl.innerHTML = kind === 'ok'
    ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
}

let currentIp = '';
function setLocalIp(ip) {
  currentIp = ip || '';
  $('localIp').textContent = currentIp || '未检测到';
}

/** 刷新面板状态 */
function refresh() {
  const refreshBtn = $('btnRefresh');
  if (refreshBtn) refreshBtn.classList.add('spinning');

  try {
    const ver = chrome.runtime.getManifest().version;
    $('ver').textContent = 'v' + (ver || '1.3.0');
  } catch (e) {
    $('ver').textContent = '';
  }

  chrome.storage.local.get(
    ['account', 'intervalMin', 'offlineIntervalMin', 'adaptive', 'lastResult'],
    (s) => {
      $('account').textContent = (s && s.account) || '未设置';

      const iv = s && s.intervalMin !== undefined ? parseFloat(s.intervalMin) : 1 / 60;
      const off = s && s.offlineIntervalMin !== undefined ? parseFloat(s.offlineIntervalMin) : 1 / 60;
      const adaptive = !s || s.adaptive !== false;

      $('interval').textContent = adaptive
        ? `${fmt(iv)} (掉线${fmt(off)})`
        : fmt(iv);

      const r = s && s.lastResult;
      if (r && r.time) {
        // 只保留时分秒以节省空间
        const t = r.time.indexOf(' ') !== -1 ? r.time.split(' ')[1] : r.time;
        $('lastTime').textContent = t;
      }
      if (r && r.message) {
        setMsg(r.message, r.ok ? 'ok' : 'err');
      }
    }
  );

  chrome.runtime.sendMessage({ type: 'status' }, (res) => {
    if (refreshBtn) refreshBtn.classList.remove('spinning');

    if (chrome.runtime.lastError || !res) {
      setStatus('后台无响应', '扩展 Service Worker 可能休眠，请重试', 'off');
      setLocalIp('');
      $('onlineDuration').textContent = '—';
      $('btnLogout').disabled = true;
      return;
    }

    // 网关延迟与已用流量
    if (res.pingMs !== undefined && res.pingMs >= 0) {
      $('popPing').textContent = res.pingMs + ' ms';
    } else {
      $('popPing').textContent = res.reachable ? '< 10 ms' : '超时';
    }

    const rawData = res.raw || {};
    if (rawData.flow !== undefined) {
      $('popFlow').textContent = fmtFlow(rawData.flow);
      if (rawData.actdf !== undefined && rawData.actuf !== undefined) {
        $('popFlow').title = `下载: ${fmtFlow(rawData.actdf)} / 上传: ${fmtFlow(rawData.actuf)}`;
      }
    } else {
      $('popFlow').textContent = res.online ? '计量中' : '—';
    }

    if (!res.reachable) {
      stopDurationTicker();
      setStatus('未连接校园网', '门户不可达，请连接校园 Wi-Fi 或插网线', 'off');
      setLocalIp('');
      $('onlineDuration').textContent = '网络断开';
      $('btnLoginText').textContent = '立即登录';
      $('btnLogout').disabled = true;
    } else if (res.online) {
      setStatus('已在线 · 认证通过', '校园网互联网访问已畅通', 'on');
      $('btnLoginText').textContent = '重新验证';
      $('btnLogout').disabled = false;

      const ip = rawData.v4ip || rawData.ss5 || '';
      setLocalIp(ip);

      if (rawData.stime) {
        startDurationTicker(rawData.stime);
        $('onlineDuration').title = '上线时间: ' + rawData.stime;
      } else if (rawData.actt) {
        const startMs = Date.now() - parseInt(rawData.actt, 10) * 1000;
        loginStartTimeMs = startMs;
        if (!durationTimer) {
          durationTimer = setInterval(() => {
            const elapsed = Math.max(0, Math.floor((Date.now() - loginStartTimeMs) / 1000));
            $('onlineDuration').textContent = fmtDuration(elapsed);
          }, 1000);
        }
        $('onlineDuration').textContent = fmtDuration(parseInt(rawData.actt, 10));
      } else {
        stopDurationTicker();
        $('onlineDuration').textContent = '在线中';
      }
    } else {
      stopDurationTicker();
      setStatus('未登录 · 需要认证', '已连上校园局域网，请点击登录', 'wait');
      $('btnLoginText').textContent = '立即登录';
      $('btnLogout').disabled = true;

      const ip = rawData.v4ip || rawData.ss5 || '';
      setLocalIp(ip);
      $('onlineDuration').textContent = '未在线';
    }
  });
}


// --- 登录 / 重新验证 ---
$('btnLogin').addEventListener('click', () => {
  const btn = $('btnLogin');
  btn.disabled = true;
  btn.classList.add('loading');
  $('btnLoginText').textContent = '通信中…';
  setMsg('正在连接校园网门户验证…', 'info');

  chrome.runtime.sendMessage({ type: 'login' }, (res) => {
    btn.disabled = false;
    btn.classList.remove('loading');
    $('btnLoginText').textContent = '立即登录';

    if (chrome.runtime.lastError || !res) {
      setMsg('后台未响应，请刷新插件', 'err');
      return;
    }
    setMsg(res.message || '完成', res.ok ? 'ok' : 'err');
    setTimeout(refresh, 500);
  });
});

// --- 注销下线 ---
$('btnLogout').addEventListener('click', () => {
  if (!confirm('确定要注销下线当前校园网吗？\n注销后电脑将断开互联网连接。')) {
    return;
  }
  const btn = $('btnLogout');
  btn.disabled = true;
  setMsg('正在向门户请求注销下线…', 'info');

  chrome.runtime.sendMessage({ type: 'logout' }, (res) => {
    btn.disabled = false;
    if (chrome.runtime.lastError || !res) {
      setMsg('注销请求超时，请到门户手动操作', 'err');
      return;
    }
    setMsg(res.message || '注销完成', res.ok ? 'ok' : 'err');
    setTimeout(refresh, 600);
  });
});

// --- 一键复制 IP ---
$('ipChip').addEventListener('click', () => {
  if (!currentIp || currentIp === '未检测到') return;

  navigator.clipboard.writeText(currentIp).then(() => {
    const copyIcon = $('copyIcon');
    const oldHtml = copyIcon.innerHTML;
    copyIcon.innerHTML = '<polyline points="20 6 9 17 4 12" stroke="#10b981" stroke-width="2.5" fill="none"/>';
    setMsg(`已复制 IP: ${currentIp}`, 'ok');

    setTimeout(() => {
      copyIcon.innerHTML = oldHtml;
    }, 1500);
  }).catch(() => {
    setMsg(`IP 地址: ${currentIp}`, 'info');
  });
});

// --- 刷新按钮 ---
$('btnRefresh').addEventListener('click', refresh);

// --- 打开设置页 ---
$('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  const optionsUrl = chrome.runtime.getURL('options.html');
  chrome.tabs.query({ url: optionsUrl + '*' }, (tabs) => {
    if (tabs && tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true }, () => {
        chrome.tabs.reload(tabs[0].id);
      });
    } else {
      chrome.runtime.openOptionsPage();
    }
    window.close();
  });
});


refresh();
