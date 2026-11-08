/**
 * 校园网自动登录 — 弹出面板脚本 (组件化重构版)
 */
'use strict';

/** 组件实例：动态在线计时器 */
const durationTicker = createTicker((text) => {
  $('onlineDuration').textContent = text;
});

/** 组件实例：实时心跳延迟波形图 */
const renderPingSparkline = createSparkline('popPingSparkline', 7);

/** 组件实例：上下行双向流量计量条 */
const popupFlowMeter = createFlowMeter({
  totalEl: 'popFlow',
  subTagEl: 'popFlowSub',
  wrapEl: 'flowBarWrap',
  dlBarEl: 'flowBarDl',
  ulBarEl: 'flowBarUl'
});

/** 设置状态卡片 UI */
function setStatus(title, desc, cls) {
  const card = $('statusCard');
  card.className = 'card status-card ' + (cls ? cls : '');

  const av = $('avatarBeacon');
  if (av) {
    av.className = 'avatar-beacon ' + (cls === 'on' ? 'on' : (cls === 'wait' ? 'wait' : 'off'));
  }

  const statePill = $('statusStatePill');
  if (statePill) {
    statePill.textContent = cls === 'on' ? '已认证 ✓' : (cls === 'wait' ? '待认证' : '离线');
  }

  const titleEl = $('statusTitle');
  const descEl = $('statusDesc');

  if (titleEl) titleEl.textContent = title;
  if (descEl) {
    descEl.textContent = desc || '';
    descEl.style.display = desc ? 'block' : 'none';
  }
}

/** 组件实例：悬浮毛玻璃胶囊通知 (Component: createToastManager) */
const popupToast = createToastManager({
  boxId: 'msgBox',
  textId: 'msg',
  iconId: 'msgIcon'
});
const setMsg = (text, kind, autoDismissMs = 3200) => popupToast.show(text, kind, autoDismissMs);

let currentIp = '';
let currentAccount = '';

/** 自习室防窥遮罩管理组件 (Component: createPrivacyMaskManager) */
const privacyMask = createPrivacyMaskManager({
  toggleBtnId: 'btnToggleMask',
  iconId: 'maskIcon',
  onUpdate: () => updateAccountDisplay(),
  onNotify: (msg) => setMsg(msg, 'info', 1600)
});

function updateAccountDisplay() {
  const accEl = $('account');
  const maskBtn = $('btnToggleMask');
  const copyBtn = $('btnCopyAccount');
  if (!accEl) return;

  if (!currentAccount) {
    accEl.textContent = '未设置账号';
    accEl.classList.remove('masked');
    accEl.classList.add('unset');
    accEl.title = '尚未设置认证账号，点击前往「偏好设置」填写';
    if (maskBtn) {
      maskBtn.classList.remove('active');
      maskBtn.disabled = true;
      maskBtn.title = '未设置账号，无需防窥';
      maskBtn.style.opacity = '0.35';
      maskBtn.style.pointerEvents = 'none';
    }
    if (copyBtn) {
      copyBtn.disabled = true;
      copyBtn.title = '未设置账号，无法复制';
      copyBtn.style.opacity = '0.35';
      copyBtn.style.pointerEvents = 'none';
    }
    return;
  }

  if (maskBtn) {
    maskBtn.disabled = false;
    maskBtn.style.opacity = '';
    maskBtn.style.pointerEvents = '';
  }
  if (copyBtn) {
    copyBtn.disabled = false;
    copyBtn.style.opacity = '';
    copyBtn.style.pointerEvents = '';
  }
  accEl.classList.remove('unset');

  const masked = privacyMask.isMasked();
  if (masked) {
    accEl.textContent = maskAccount(currentAccount);
    accEl.classList.add('masked');
    accEl.title = '自习室防窥模式（点击切换明文显示）';
  } else {
    accEl.textContent = currentAccount;
    accEl.classList.remove('masked');
    accEl.title = `点击开启自习室防窥: ${currentAccount}`;
  }
}

function setLocalIp(ip) {
  currentIp = ip || '';
  $('localIp').textContent = currentIp || '未连接';
}

/** 同步运营商徽章与内嵌直选面板高亮状态 */
function syncIspDisplay(ispCode) {
  const meta = getIspMeta(ispCode);
  const ispEl = $('accountIsp');
  if (ispEl) {
    ispEl.textContent = meta.short;
    ispEl.title = `认证运营商: ${meta.full} (点击直选切换)`;
  }
  const sheet = $('ispQuickSheet');
  if (sheet) {
    sheet.querySelectorAll('.isp-sheet-btn').forEach((btn) => {
      const active = btn.getAttribute('data-isp') === meta.code;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }
}

/** 刷新面板状态 */
function refresh(onComplete) {
  const refreshBtn = $('btnRefresh');
  const spinStart = Date.now();
  if (refreshBtn) refreshBtn.classList.add('spinning');

  const stopSpin = () => {
    if (!refreshBtn) return;
    const elapsed = Date.now() - spinStart;
    const remaining = Math.max(0, 600 - elapsed);
    setTimeout(() => {
      refreshBtn.classList.remove('spinning');
    }, remaining);
  };

  const verEl = $('ver');
  if (verEl) {
    try {
      const ver = chrome.runtime?.getManifest?.()?.version;
      verEl.textContent = 'v' + (ver || '1.0.0');
    } catch (e) {
      if (!verEl.textContent) verEl.textContent = 'v1.0.0';
    }
  }

  let paused = false;

  chrome.storage.local.get(
    ['account', 'isp', 'intervalMin', 'offlineIntervalMin', 'adaptive', 'lastResult', 'privacyMask'],
    (s) => {
      currentAccount = (s && typeof s.account === 'string') ? s.account : '';
      if (s && s.privacyMask !== undefined) {
        privacyMask.setMasked(s.privacyMask);
      }
      updateAccountDisplay();
      syncIspDisplay((s && s.isp) || '1');

      const r = s && s.lastResult;
      const rMsg = r && typeof r.message === 'string' ? r.message : '';
      if (rMsg && (!r.ok || rMsg.indexOf('无需登录') === -1)) {
        const msgType = (r.state === 'submitted' || r.pending) ? 'info' : (r.ok === false ? 'err' : 'ok');
        setMsg(rMsg, msgType);
      }
    }
  );

  chrome.runtime.sendMessage({ type: 'status' }, (res) => {
    stopSpin();

    if (chrome.runtime.lastError || !res) {
      durationTicker.stop();
      setStatus('后台无响应', '扩展 Service Worker 可能休眠，请重试', 'off');
      setLocalIp('');
      $('onlineDuration').textContent = '—';
      const popPing = $('popPing');
      if (popPing) {
        popPing.textContent = '—';
        popPing.className = 'dock-value mono';
      }
      renderPingSparkline(-1);
      popupFlowMeter.reset();
      const btnLogin = $('btnLogin');
      if (btnLogin) {
        btnLogin.classList.remove('online-mode');
        $('btnLoginText').textContent = '立即登录';
      }
      $('btnLogout').disabled = true;
      logoutConfirmCtrl.reset();
      if (typeof onComplete === 'function') onComplete(null);
      return;
    }

    paused = !!res.manualLogout;

    // 网关延迟分级与心跳波形图
    const pingEl = $('popPing');
    const hist = Array.isArray(res.pingHistory) && res.pingHistory.length ? res.pingHistory : null;
    const pingInfo = classifyPing(res.pingMs, res.reachable);
    if (pingEl) {
      pingEl.textContent = pingInfo.text;
      pingEl.className = `dock-value mono ping-${pingInfo.grade}`;
      pingEl.title = pingInfo.tooltip;
    }
    renderPingSparkline(hist || pingInfo.fallbackMs);

    // 流量进度组件渲染
    const rawData = res.raw || {};
    popupFlowMeter.render(rawData, res.online);

    if (!res.reachable) {
      durationTicker.stop();
      setStatus('网络连接失败', paused
        ? '未连上校园网；自动登录当前处于暂停状态'
        : '未能连接到校园网，请检查 Wi-Fi 或插好网线', 'off');
      setLocalIp('');
      $('onlineDuration').textContent = '网络断开';
      $('btnLogin').classList.remove('online-mode');
      $('btnLoginText').textContent = paused ? '恢复登录' : '立即登录';
      $('btnLogout').disabled = true;
      logoutConfirmCtrl.reset();
    } else if (res.online) {
      setStatus('已在线 · 认证通过', '', 'on');
      $('btnLogin').classList.add('online-mode');
      $('btnLoginText').textContent = '刷新状态';
      $('btnLogout').disabled = false;

      const ip = [rawData.v4ip, rawData.ss5].find((v) => v && v !== '0.0.0.0') || '';
      setLocalIp(ip);

      const dur = resolveSessionDuration(res, rawData);
      if (dur.durationInput != null) {
        durationTicker.start(dur.durationInput);
        $('onlineDuration').title = dur.popupTitle;
      } else {
        durationTicker.stop();
        $('onlineDuration').textContent = '在线中';
        $('onlineDuration').title = '已在线';
      }
    } else {
      durationTicker.stop();
      if (paused) {
        setStatus('已手动注销 · 自动登录暂停', '点「立即登录」可恢复自动重连', 'wait');
      } else if (res.unparseable) {
        setStatus('未识别的网络', '当前网络需要网页登录（非校园网认证页）', 'wait');
      } else {
        setStatus('未登录 · 需要认证', '已连上校园局域网，请点击登录', 'wait');
      }
      $('btnLogin').classList.remove('online-mode');
      $('btnLoginText').textContent = paused ? '恢复登录' : '立即登录';
      $('btnLogout').disabled = true;
      logoutConfirmCtrl.reset();

      const ip = [rawData.v4ip, rawData.ss5].find((v) => v && v !== '0.0.0.0') || '';
      setLocalIp(ip);
      $('onlineDuration').textContent = '未在线';
    }

    triggerTelemetryFade();
    if (typeof onComplete === 'function') onComplete(res);
  });
}

/** 遥测数据刷新时的平滑微动效 (Component: triggerPulseAnimation, 60fps 无 Layout Thrashing) */
const triggerTelemetryFade = () => triggerPulseAnimation('.dock-value');

// --- 登录 / 重新验证 ---
$('btnLogin')?.addEventListener('click', () => {
  const btn = $('btnLogin');
  btn.disabled = true;
  btn.classList.add('loading');
  $('btnLoginText').textContent = '通信中…';
  setMsg('正在连接校园网门户验证…', 'info');

  chrome.runtime.sendMessage({ type: 'login' }, (res) => {
    btn.disabled = false;
    btn.classList.remove('loading');
    $('btnLoginText').textContent = (res && res.online) ? '刷新状态' : '立即登录';

    if (chrome.runtime.lastError || !res) {
      setMsg('后台未响应，请刷新插件', 'err');
      return;
    }
    setMsg(res.message || '完成', res.skipped ? 'info' : (res.ok ? 'ok' : 'err'));
    setTimeout(refresh, 500);
  });
});

// --- 组件实例：注销下线二段式确认按钮 ---
const logoutConfirmCtrl = createConfirmButton('btnLogout', {
  defaultText: '注销',
  confirmText: '确认注销？',
  timeoutMs: 3000,
  onPrompt() {
    setMsg('再次点击「确认注销」即可下线断网', 'info', 3000);
  },
  onConfirm() {
    const btn = $('btnLogout');
    btn.disabled = true;
    setMsg('正在向门户请求注销下线…', 'info');

    chrome.runtime.sendMessage({ type: 'logout' }, (res) => {
      btn.disabled = false;
      if (chrome.runtime.lastError || !res) {
        setMsg('注销请求超时，请到门户手动操作', 'err');
        return;
      }
      setMsg(res.message || '注销完成', res.skipped ? 'info' : (res.ok ? 'ok' : 'err'));
      setTimeout(refresh, 600);
    });
  }
});

// --- 组件实例：一键复制本机 IP ---
createCopyTrigger({
  target: 'ipChip',
  iconEl: 'copyIcon',
  getValue: () => (currentIp && currentIp !== '未检测到' && currentIp !== '未连接' ? currentIp : ''),
  onSuccess: () => setMsg('已复制 IP 到剪贴板', 'ok', 1600),
  onError: (ip) => setMsg(`IP 地址: ${ip}`, 'info', 2500)
});

// --- 组件实例：一键复制认证账号 ---
createCopyTrigger({
  target: 'btnCopyAccount',
  iconEl: 'copyAccountIcon',
  flashEl: 'accountDockItem',
  stopPropagation: true,
  getValue: () => (currentAccount && currentAccount !== '未设置' ? currentAccount : ''),
  onEmpty: () => setMsg('当前未设置认证账号', 'info', 2000),
  onSuccess: () => setMsg('已复制账号到剪贴板', 'ok', 1600),
  onError: (acc) => setMsg(`账号: ${acc}`, 'info', 2500)
});

// --- 点击网关地址胶囊：即时探测网关连通性与延迟 ---
const popGwTag = $('popGwTag');
if (popGwTag) {
  const probeGateway = () => {
    setMsg('正在探测网关 172.30.100.2 响应…', 'info', 1800);
    refresh((res) => {
      if (!res || !res.reachable) {
        setMsg('网关 172.30.100.2 当前不可达', 'err', 2400);
      } else {
        const p = classifyPing(res.pingMs, true);
        setMsg(`网关连通正常 · 响应延迟 ${p.text} (${p.label})`, 'ok', 2200);
      }
    });
  };
  popGwTag.addEventListener('click', probeGateway);
  popGwTag.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      probeGateway();
    }
  });
}

$('account')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentAccount) {
    if (chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
    return;
  }
  privacyMask.toggle();
});

$('msgBox')?.addEventListener('click', () => {
  popupToast.dismiss($('msgBox'));
});

// --- 点击版本号胶囊或应用头像快速打开设置页 ---
function openSettingsAndClose(e) {
  if (e) e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
}

$('ver')?.addEventListener('click', openSettingsAndClose);
$('openOptions')?.addEventListener('click', openSettingsAndClose);

const brandAvatarEl = $('brandAvatar');
if (brandAvatarEl) {
  brandAvatarEl.addEventListener('click', openSettingsAndClose);
  brandAvatarEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      openSettingsAndClose(e);
    }
  });
}

// --- 刷新按钮 ---
$('btnRefresh')?.addEventListener('click', () => refresh());

// --- 内嵌式运营商直选抽屉面板组件 (In-Card ISP Quick Sheet) ---
const accountIspEl = $('accountIsp');
const ispQuickSheet = $('ispQuickSheet');

function toggleIspSheet(forceOpen) {
  if (!ispQuickSheet) return;
  const open = typeof forceOpen === 'boolean' ? forceOpen : !ispQuickSheet.classList.contains('open');
  ispQuickSheet.classList.toggle('open', open);
  ispQuickSheet.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (accountIspEl) {
    accountIspEl.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

if (accountIspEl && ispQuickSheet) {
  accountIspEl.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleIspSheet();
  });

  accountIspEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      toggleIspSheet();
    }
  });

  ispQuickSheet.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = e.target.closest('.isp-sheet-btn');
    if (!btn) return;
    const next = btn.getAttribute('data-isp');
    if (!next || !ISP_ORDER.includes(next)) return;

    const meta = getIspMeta(next);
    chrome.storage.local.set({ isp: next, authError: false }, () => {
      syncIspDisplay(next);
      toggleIspSheet(false);
      chrome.runtime.sendMessage({ type: 'settingsChanged' }, () => {
        void chrome.runtime.lastError;
      });
      setMsg('已切换运营商: ' + meta.full, 'ok', 2000);
    });
  });

  document.addEventListener('click', (e) => {
    if (ispQuickSheet.classList.contains('open') && !e.target.closest('#ispQuickSheet')) {
      toggleIspSheet(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ispQuickSheet.classList.contains('open')) {
      toggleIspSheet(false);
    }
  });
}

// --- 同步与切换深色/浅色主题 (Component: createThemeManager) ---
const popupThemeManager = createThemeManager({
  toggleBtnId: 'btnThemeToggle',
  supportAuto: false,
  onNotify: (msg) => setMsg(msg, 'info', 1800)
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.isp) {
    syncIspDisplay(changes.isp.newValue);
  }
  if (changes.account) {
    currentAccount = typeof changes.account.newValue === 'string' ? changes.account.newValue : '';
    updateAccountDisplay();
  }
});

initAccent();
refresh();

// 页面隐藏/关闭时清理计时器
window.addEventListener('pagehide', () => {
  durationTicker.stop();
});
