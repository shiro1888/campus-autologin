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

      const iv = s && s.intervalMin !== undefined ? parseFloat(s.intervalMin) : 10 / 60;
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
      if (r && r.message && (!r.ok || r.message.indexOf('无需登录') === -1)) {
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
      const isFast = res.pingMs < 60;
      $('popPing').innerHTML = `<span class="ping-badge ${isFast ? 'speed-fast' : 'speed-normal'}">${res.pingMs} ms</span>`;
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
