/**
 * 校园网自动登录 — 控制中心设置脚本
 */
'use strict';

const DEFAULTS = {
  account: 'REDACTED_CAMPUS_ACCOUNT',
  password: 'REDACTED_CAMPUS_PASSWORD',
  isp: '1',
  intervalMin: 1 / 60,
  offlineIntervalMin: 1 / 60,
  adaptive: true,
  autoOnStartup: true,
  contentAutoFill: true,
  instantTrigger: true
};

let toastTimer = null;

/** 顶部浮动消息通知 */
function showToast(text, kind) {
  const bar = $('toastBar');
  const msgEl = $('toastMsg');
  const iconEl = $('toastIcon');

  if (toastTimer) clearTimeout(toastTimer);

  bar.className = 'toast-bar show ' + (kind || 'info');
  msgEl.textContent = text;

  if (kind === 'ok') {
    iconEl.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  } else if (kind === 'err') {
    iconEl.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  } else {
    iconEl.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  }

  toastTimer = setTimeout(() => {
    bar.className = 'toast-bar';
  }, 4500);
}

/** 动态在线计时器 (秒表实时跳动) */
const durationTicker = createTicker((text) => {
  $('stTime').textContent = text;
});

/** 主题切换管理 */
function initTheme() {
  chrome.storage.local.get({ theme: 'auto' }, (s) => {
    applyTheme(s.theme || 'auto');
  });

  const btn = $('btnThemeToggle');
  if (btn) {
    btn.addEventListener('click', () => {
      chrome.storage.local.get({ theme: 'auto' }, (s) => {
        const cur = s.theme || 'auto';
        const next = cur === 'auto' ? 'dark' : (cur === 'dark' ? 'light' : 'auto');
        chrome.storage.local.set({ theme: next }, () => {
          applyTheme(next);
          const nameMap = { auto: '跟随系统', dark: '深色模式', light: '浅色模式' };
          showToast('已切换至 ' + nameMap[next], 'info');
        });
      });
    });
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const label = $('themeLabel');
  if (label) {
    label.textContent = theme === 'dark' ? '深色' : (theme === 'light' ? '浅色' : '自动');
  }
}

/** 从本地存储加载配置到表单 */
function load() {
  initTheme();

  try {
    const ver = chrome.runtime.getManifest().version;
    $('ver').textContent = 'v' + (ver || '1.3.0');
  } catch (e) {
    $('ver').textContent = '';
  }

  chrome.storage.local.get(DEFAULTS, (s) => {
    $('account').value = s.account || '';
    $('password').value = s.password || '';
    $('isp').value = String(s.isp || '1');

    pickClosest('intervalMin', s.intervalMin === undefined ? 1 / 60 : s.intervalMin);
    pickClosest('offlineIntervalMin', s.offlineIntervalMin === undefined ? 1 / 60 : s.offlineIntervalMin);

    $('adaptive').checked = s.adaptive !== false;
    $('autoOnStartup').checked = s.autoOnStartup !== false;
    $('contentAutoFill').checked = s.contentAutoFill !== false;
    $('instantTrigger').checked = s.instantTrigger !== false;
    syncOfflineRow();
  });

  refreshStatus();
}

/** 在 select 里选中最接近给定值的项 */
function pickClosest(id, value) {
  const sel = $(id);
  const v = parseFloat(value);
  if (!Number.isFinite(v)) { sel.selectedIndex = 0; return; }
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < sel.options.length; i++) {
    const diff = Math.abs(parseFloat(sel.options[i].value) - v);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  sel.selectedIndex = best;
}

/** 自适应关闭时，隐藏「掉线重连间隔」 */
function syncOfflineRow() {
  const row = $('offlineRow');
  if ($('adaptive').checked) {
    row.style.display = '';
  } else {
    row.style.display = 'none';
  }
}

/** 刷新顶部诊断卡片状态 */
function refreshStatus(cb) {
  const checkBtn = $('btnCheckStatus');
  if (checkBtn) checkBtn.classList.add('spinning');

  chrome.storage.local.get(['lastResult'], (s) => {
    const r = s && s.lastResult;
    $('stLast').textContent = r ? (r.time + ' · ' + r.message) : '暂无记录';
  });

  chrome.runtime.sendMessage({ type: 'status' }, (res) => {
    if (checkBtn) checkBtn.classList.remove('spinning');

    const pill = $('stPill');
    const textEl = $('stOnline');

    if (chrome.runtime.lastError || !res) {
      pill.className = 'status-pill off';
      textEl.textContent = '后台未响应';
      $('stIp').textContent = '—';
      $('stTime').textContent = '—';
      $('stMac').textContent = '物理 MAC: —';
      $('stPing').textContent = '—';
      $('stFlow').textContent = '—';
      $('stFee').textContent = '账户计费: —';
      $('stStime').textContent = '上线时间: —';
      if (cb) cb();
      return;
    }

    const raw = res.raw || {};
    const ip = raw.v4ip || raw.ss5 || '';
    $('stIp').textContent = ip || '未获取到';
    $('stMac').textContent = raw.ss1 ? ('物理 MAC: ' + fmtMac(raw.ss1)) : '物理 MAC: —';

    if (res.online && raw.stime) {
      durationTicker.start(raw.stime);
      $('stStime').textContent = '上线时间: ' + raw.stime;
    } else if (res.online && raw.actt) {
      durationTicker.start(parseInt(raw.actt, 10));
      $('stStime').textContent = '在线中 (网关计时)';
    } else if (res.online) {
      durationTicker.stop();
      $('stTime').textContent = '在线中';
      $('stStime').textContent = '上线时间: —';
    } else {
      durationTicker.stop();
      $('stTime').textContent = '未在线';
      $('stStime').textContent = '上线时间: —';
    }

    // Ping
    if (res.pingMs !== undefined && res.pingMs >= 0) {
      $('stPing').textContent = res.pingMs + ' ms';
    } else {
      $('stPing').textContent = res.reachable ? '< 10 ms' : '超时';
    }

    // Flow & Fee (下行 / 上行 / 总计 / 余额)
    if (raw.flow !== undefined) {
      $('stFlow').textContent = fmtFlow(raw.flow);
      const sub = [];
      if (raw.actdf !== undefined && raw.actuf !== undefined) {
        sub.push(`↓ ${fmtFlow(raw.actdf)} · ↑ ${fmtFlow(raw.actuf)}`);
      }
      if (raw.fee !== undefined) {
        const yuan = (parseFloat(raw.fee) / 10000).toFixed(2);
        sub.push(`余额 ¥${yuan}`);
      }
      $('stFee').textContent = sub.length ? sub.join(' | ') : '校园网计费统计';
    } else {
      $('stFlow').textContent = res.online ? '计量中' : '—';
      $('stFee').textContent = '账户余额: —';
    }

    if (!res.reachable) {
      durationTicker.stop();
      pill.className = 'status-pill off';
      textEl.textContent = '不在校园网内';
    } else if (res.online) {
      pill.className = 'status-pill on';
      textEl.textContent = '已在线 ✓';
    } else {
      durationTicker.stop();
      pill.className = 'status-pill wait';
      textEl.textContent = '未登录';
    }

    if (cb) cb();
  });
}


/** 读取表单当前值 */
function readForm() {
  const interval = parseFloat($('intervalMin').value);
  const offline = parseFloat($('offlineIntervalMin').value);

  return {
    account: $('account').value.trim(),
    password: $('password').value,
    isp: $('isp').value,
    intervalMin: Number.isFinite(interval) ? interval : 1 / 60,
    offlineIntervalMin: Number.isFinite(offline) ? offline : 1 / 60,
    adaptive: $('adaptive').checked,
    autoOnStartup: $('autoOnStartup').checked,
    contentAutoFill: $('contentAutoFill').checked,
    instantTrigger: $('instantTrigger').checked,
    initialized: true
  };
}

/** 保存到 chrome.storage 并通知后台刷新定时器 */
function save(cb) {
  const s = readForm();
  if (!s.account || !s.password) {
    showToast('请先填写上网账号和密码。', 'err');
    if (cb) cb(false);
    return;
  }
  chrome.storage.local.set(s, () => {
    chrome.runtime.sendMessage({ type: 'settingsChanged' }, () => {
      void chrome.runtime.lastError;
      if (cb) cb(true);
    });
  });
}

// --- 保存并立即测试 ---
$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const btn = $('btnSave');
  btn.disabled = true;
  btn.classList.add('loading');
  $('btnSaveText').textContent = '正在保存并测试…';
  showToast('正在向校园网门户发起验证…', 'info');

  save((okSaved) => {
    if (!okSaved) {
      btn.disabled = false;
      btn.classList.remove('loading');
      $('btnSaveText').textContent = '保存配置并立即测试';
      return;
    }

    chrome.runtime.sendMessage({ type: 'login' }, (res) => {
      btn.disabled = false;
      btn.classList.remove('loading');
      $('btnSaveText').textContent = '保存配置并立即测试';

      if (chrome.runtime.lastError || !res) {
        showToast('保存成功，但后台未响应测试请求', 'err');
        return;
      }

      showToast(res.message || '配置已生效', res.ok ? 'ok' : 'err');
      refreshStatus();
    });
  });
});

// --- 顶部快捷：测试连接/检测状态 ---
$('btnCheckStatus').addEventListener('click', () => {
  refreshStatus(() => {
    showToast('网络与认证状态已更新', 'info');
  });
});

// --- 顶部快捷：立即登录 ---
$('btnLoginNow').addEventListener('click', () => {
  const btn = $('btnLoginNow');
  btn.disabled = true;
  showToast('正在请求登录…', 'info');

  chrome.runtime.sendMessage({ type: 'login' }, (res) => {
    btn.disabled = false;
    if (chrome.runtime.lastError || !res) {
      showToast('后台未响应', 'err');
      return;
    }
    showToast(res.message || '登录请求完成', res.ok ? 'ok' : 'err');
    refreshStatus();
  });
});

// --- 顶部快捷：注销下线 ---
$('btnLogoutNow').addEventListener('click', () => {
  if (!confirm('确定要注销下线当前校园网会话吗？\n注销后电脑将断开互联网连接。')) {
    return;
  }
  const btn = $('btnLogoutNow');
  btn.disabled = true;
  showToast('正在请求注销下线…', 'info');

  chrome.runtime.sendMessage({ type: 'logout' }, (res) => {
    btn.disabled = false;
    if (chrome.runtime.lastError || !res) {
      showToast('注销超时，请到门户手动注销', 'err');
      return;
    }
    showToast(res.message || '注销完成', res.ok ? 'ok' : 'err');
    refreshStatus();
  });
});

// --- 恢复默认设置 ---
$('btnResetDefaults').addEventListener('click', () => {
  if (!confirm('确定要将所有设置恢复为默认值吗？\n（你的账号密码将被重置为初始配置）')) {
    return;
  }
  chrome.storage.local.set(DEFAULTS, () => {
    load();
    chrome.runtime.sendMessage({ type: 'settingsChanged' });
    showToast('已恢复为默认配置。', 'ok');
  });
});

// --- 显示/隐藏密码 ---
$('togglePwd').addEventListener('click', () => {
  const el = $('password');
  const isPwd = el.type === 'password';
  el.type = isPwd ? 'text' : 'password';

  const eyeIcon = $('eyeIcon');
  if (isPwd) {
    // 隐藏状态图标 (带有斜线)
    eyeIcon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
  } else {
    // 正常眼睛图标
    eyeIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
});

// --- 即时保存的切换项 ---
['autoOnStartup', 'contentAutoFill', 'instantTrigger'].forEach((id) => {
  $(id).addEventListener('change', () => {
    save(() => showToast('设置已自动保存。', 'ok'));
  });
});

$('adaptive').addEventListener('change', () => {
  syncOfflineRow();
  save(() => {
    showToast($('adaptive').checked
      ? `已启用自适应重连加速（掉线重试：${fmt($('offlineIntervalMin').value)}）`
      : '已关闭自适应加速，统一使用常规间隔。', 'ok');
  });
});

// --- 下拉框改动即时保存 ---
['intervalMin', 'offlineIntervalMin', 'isp'].forEach((id) => {
  $(id).addEventListener('change', () => {
    save(() => showToast('参数已自动保存并生效。', 'ok'));
  });
});

load();

// 当偏好设置页面在前台激活时，每 15 秒自动向后台刷新一次网关状态（流量与Ping）
setInterval(() => {
  if (document.visibilityState === 'visible') {
    refreshStatus();
  }
}, 15000);
