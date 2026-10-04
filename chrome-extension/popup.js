/**
 * 校园网自动登录 — 弹出面板脚本
 */
'use strict';

/** 动态在线计时器 (秒表实时跳动) */
const durationTicker = createTicker((text) => {
  $('onlineDuration').textContent = text;
});


/** 设置状态卡片UI */
function setStatus(title, desc, cls) {
  const card = $('statusCard');
  card.className = 'card status-card ' + (cls ? cls : '');

  const av = $('avatarBeacon');
  if (av) {
    av.className = 'avatar-beacon ' + (cls === 'on' ? 'on' : 'off');
  }

  const titleEl = $('statusTitle');
  const descEl = $('statusDesc');

  titleEl.textContent = title;
  descEl.textContent = desc;
}

let msgTimer = null;
/** 显示提示信息条 (支持自动淡出) */
function setMsg(text, kind, autoDismissMs = 3200) {
  const box = $('msgBox');
  const msgEl = $('msg');
  const iconEl = $('msgIcon');

  if (msgTimer) {
    clearTimeout(msgTimer);
    msgTimer = null;
  }

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

  if (autoDismissMs && kind === 'ok') {
    msgTimer = setTimeout(() => {
      box.className = 'msg-box';
    }, autoDismissMs);
  }
}

let currentIp = '';
let currentAccount = '';
function setLocalIp(ip) {
  currentIp = ip || '';
  $('localIp').textContent = currentIp || '未检测到';
}

/** 刷新面板状态 */
function refresh() {
  const refreshBtn = $('btnRefresh');
  const spinStart = Date.now();
  if (refreshBtn) refreshBtn.classList.add('spinning');

  const stopSpin = () => {
    if (!refreshBtn) return;
    const elapsed = Date.now() - spinStart;
    const minSpinMs = 600;
    const remaining = Math.max(0, minSpinMs - elapsed);
    setTimeout(() => {
      refreshBtn.classList.remove('spinning');
    }, remaining);
  };

  try {
    const ver = chrome.runtime.getManifest().version;
    $('ver').textContent = 'v' + (ver || '1.3.0');
  } catch (e) {
    $('ver').textContent = '';
  }

  chrome.storage.local.get(
    ['account', 'isp', 'intervalMin', 'offlineIntervalMin', 'adaptive', 'lastResult'],
    (s) => {
      currentAccount = (s && s.account) || '';
      $('account').textContent = currentAccount || '未设置';
      $('account').title = currentAccount ? `点击复制账号: ${currentAccount}` : '尚未设置认证账号';

      const ispNames = { '1': '校园', '2': '电信', '3': '联通', '4': '其他' };
      const ispFullNames = { '1': '校园用户 (默认)', '2': '校园电信 (@dx)', '3': '校园联通 (@lt)', '4': '校园其他' };
      const currentIsp = (s && s.isp) || '1';
      const ispEl = $('accountIsp');
      if (ispEl) {
        ispEl.textContent = ispNames[currentIsp] || '校园';
        ispEl.title = '认证运营商: ' + (ispFullNames[currentIsp] || currentIsp);
      }

      const iv = s && s.intervalMin !== undefined ? parseFloat(s.intervalMin) : 10 / 60;
      const off = s && s.offlineIntervalMin !== undefined ? parseFloat(s.offlineIntervalMin) : 1 / 60;
      const adaptive = !s || s.adaptive !== false;

      $('interval').textContent = adaptive
        ? `${fmt(iv)} (掉线${fmt(off)})`
        : fmt(iv);
      $('interval').title = adaptive ? `正常在线: ${fmt(iv)} / 掉线急救: ${fmt(off)}` : `巡检频率: ${fmt(iv)}`;

      const r = s && s.lastResult;
      if (r && r.time) {
        // 只保留时分秒以节省空间
        const t = r.time.indexOf(' ') !== -1 ? r.time.split(' ')[1] : r.time;
        $('lastTime').textContent = t;
        $('lastTime').title = '上次检查记录: ' + r.time;
      }
      if (r && r.message && (!r.ok || r.message.indexOf('无需登录') === -1)) {
        setMsg(r.message, r.ok ? 'ok' : 'err');
      }
    }
  );

  chrome.runtime.sendMessage({ type: 'status' }, (res) => {
    stopSpin();

    if (chrome.runtime.lastError || !res) {
      setStatus('后台无响应', '扩展 Service Worker 可能休眠，请重试', 'off');
      setLocalIp('');
      $('onlineDuration').textContent = '—';
      $('btnLogout').disabled = true;
      return;
    }

    // 网关延迟与已用流量
    const pingEl = $('popPing');
    if (res.pingMs !== undefined && res.pingMs >= 0) {
      pingEl.textContent = `${res.pingMs} ms`;
      if (res.pingMs <= 50) {
        pingEl.className = 'dock-value mono ping-fast';
        pingEl.title = `极佳延迟 (${res.pingMs} ms)`;
      } else if (res.pingMs <= 150) {
        pingEl.className = 'dock-value mono ping-normal';
        pingEl.title = `正常延迟 (${res.pingMs} ms)`;
      } else {
        pingEl.className = 'dock-value mono ping-slow';
        pingEl.title = `较高延迟 (${res.pingMs} ms)`;
      }
    } else {
      pingEl.textContent = res.reachable ? '< 10 ms' : '超时';
      pingEl.className = 'dock-value mono';
      pingEl.title = res.reachable ? '网关连通正常' : '网关不可达';
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
      durationTicker.stop();
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
        durationTicker.start(rawData.stime);
        $('onlineDuration').title = '上线时间: ' + rawData.stime;
      } else if (rawData.actt) {
        durationTicker.start(parseInt(rawData.actt, 10));
      } else {
        durationTicker.stop();
        $('onlineDuration').textContent = '在线中';
      }
    } else {
      durationTicker.stop();
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

// --- 注销下线 (防误触二次确认，避免浏览器原生 confirm 导致扩展弹窗失焦关闭) ---
let logoutConfirmTimer = null;
$('btnLogout').addEventListener('click', () => {
  const btn = $('btnLogout');
  const span = btn.querySelector('span');

  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    if (span) span.textContent = '确认注销？';
    setMsg('再次点击「确认注销」即可下线断网', 'info', 3000);
    logoutConfirmTimer = setTimeout(() => {
      btn.classList.remove('confirming');
      if (span) span.textContent = '注销';
    }, 3000);
    return;
  }

  // 确认注销
  clearTimeout(logoutConfirmTimer);
  btn.classList.remove('confirming');
  if (span) span.textContent = '注销';
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
    const chip = $('ipChip');
    const copyIcon = $('copyIcon');
    const oldHtml = copyIcon.innerHTML;
    chip.classList.add('copied');
    copyIcon.innerHTML = '<polyline points="20 6 9 17 4 12" stroke="#10b981" stroke-width="2.5" fill="none"/>';
    setMsg(`已复制 IP: ${currentIp}`, 'ok', 1800);

    setTimeout(() => {
      copyIcon.innerHTML = oldHtml;
      chip.classList.remove('copied');
    }, 1500);
  }).catch(() => {
    setMsg(`IP 地址: ${currentIp}`, 'info', 2500);
  });
});

// --- 一键复制账号 ---
function copyAccount() {
  if (!currentAccount || currentAccount === '未设置') {
    setMsg('当前未设置认证账号', 'info', 2000);
    return;
  }

  navigator.clipboard.writeText(currentAccount).then(() => {
    const btn = $('btnCopyAccount');
    const icon = $('copyAccountIcon');
    if (btn) btn.classList.add('copied');
    if (icon) {
      const oldHtml = icon.innerHTML;
      icon.innerHTML = '<polyline points="20 6 9 17 4 12" stroke="#10b981" stroke-width="2.5" fill="none"/>';
      setTimeout(() => {
        icon.innerHTML = oldHtml;
        if (btn) btn.classList.remove('copied');
      }, 1500);
    }
    setMsg(`已复制账号: ${currentAccount}`, 'ok', 1800);
  }).catch(() => {
    setMsg(`账号: ${currentAccount}`, 'info', 2500);
  });
}

const btnCopyAcc = $('btnCopyAccount');
if (btnCopyAcc) {
  btnCopyAcc.addEventListener('click', (e) => {
    e.stopPropagation();
    copyAccount();
  });
}

const accEl = $('account');
if (accEl) {
  accEl.addEventListener('click', (e) => {
    e.stopPropagation();
    copyAccount();
  });
}

// --- 刷新按钮 ---
$('btnRefresh').addEventListener('click', refresh);

// --- 打开设置页 ---
$('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

// --- 同步设置页选择的主题 ---
function applyPopupTheme(theme) {
  if (theme && theme !== 'auto') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

chrome.storage.local.get({ theme: 'auto' }, (s) => {
  applyPopupTheme(s && s.theme);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.theme) {
    applyPopupTheme(changes.theme.newValue);
  }
});

refresh();
