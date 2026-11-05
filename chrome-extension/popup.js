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

  // 规范化旧版本缓存或离线提示文案，统一口径
  if (typeof text === 'string' && /门户不可达|不在校园网/.test(text)) {
    text = '网络连接失败，请检查 Wi-Fi 或插好网线';
  }

  box.className = 'msg-box show ' + (kind || 'info');
  msgEl.textContent = text;
  iconEl.innerHTML = kind === 'ok'
    ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

  if (autoDismissMs && kind !== 'err') {
    msgTimer = setTimeout(() => {
      box.className = 'msg-box';
    }, autoDismissMs);
  }
}

let currentIp = '';
let currentAccount = '';
let isMasked = false;

function maskAccount(acc) {
  if (!acc || typeof acc !== 'string') return '';
  const trimmed = acc.trim();
  if (trimmed.length <= 4) return '****';
  if (trimmed.length <= 7) return trimmed.slice(0, 2) + '****' + trimmed.slice(-2);
  return trimmed.slice(0, 3) + '****' + trimmed.slice(-4);
}

function updateAccountDisplay() {
  const accEl = $('account');
  const maskBtn = $('btnToggleMask');
  const maskIcon = $('maskIcon');
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

  // 恢复按钮正常可交互状态
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

  if (isMasked) {
    accEl.textContent = maskAccount(currentAccount);
    accEl.classList.add('masked');
    accEl.title = '自习室防窥模式（点击切换明文显示）';
    if (maskBtn) {
      maskBtn.classList.add('active');
      maskBtn.title = '当前：自习室防窥（点击显示明文）';
    }
    if (maskIcon) {
      maskIcon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
    }
  } else {
    accEl.textContent = currentAccount;
    accEl.classList.remove('masked');
    accEl.title = `点击开启自习室防窥: ${currentAccount}`;
    if (maskBtn) {
      maskBtn.classList.remove('active');
      maskBtn.title = '当前：明文显示（点击开启自习室防窥）';
    }
    if (maskIcon) {
      maskIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
  }
}

function setLocalIp(ip) {
  currentIp = ip || '';
  $('localIp').textContent = currentIp || '未连接';
}

const renderPingSparkline = createSparkline('popPingSparkline', 4);


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

  const verEl = $('ver');
  if (verEl) {
    try {
      const ver = chrome.runtime?.getManifest?.()?.version;
      verEl.textContent = 'v' + (ver || '1.0.0');
    } catch (e) {
      if (!verEl.textContent) verEl.textContent = 'v1.0.0';
    }
  }

  // 是否处于「手动注销暂停」状态（由后台在 status 响应里一并返回）
  let paused = false;

  chrome.storage.local.get(
    ['account', 'isp', 'intervalMin', 'offlineIntervalMin', 'adaptive', 'lastResult', 'privacyMask'],
    (s) => {
      // 只接受字符串：account 被手改/来自旧版本时可能不是字符串，
      // 直接放进 textContent 会显示成 "[object Object]"。
      currentAccount = (s && typeof s.account === 'string') ? s.account : '';
      isMasked = !!(s && s.privacyMask);
      updateAccountDisplay();

      const ispNames = { '1': '校园', '2': '电信', '3': '联通', '4': '其他' };
      const ispFullNames = { '1': '校园用户 (默认)', '2': '校园电信 (@dx)', '3': '校园联通 (@lt)', '4': '校园其他' };
      const currentIsp = (s && s.isp) || '1';
      const ispEl = $('accountIsp');
      if (ispEl) {
        ispEl.textContent = ispNames[currentIsp] || '校园';
        ispEl.title = '认证运营商: ' + (ispFullNames[currentIsp] || currentIsp);
      }

      const r = s && s.lastResult;
      const rMsg = r && typeof r.message === 'string' ? r.message : '';
      if (rMsg && (!r.ok || rMsg.indexOf('无需登录') === -1)) {
        // pending（登录已提交但复查时网络抖动）是「待确认」，按 info 显示，
        // 不能因为 ok:true 就渲染成绿色成功。
        const msgType = (r.state === 'submitted' || r.pending) ? 'info' : (r.ok === false ? 'err' : 'ok');
        setMsg(rMsg, msgType);
      }
    }
  );

  chrome.runtime.sendMessage({ type: 'status' }, (res) => {
    stopSpin();

    if (chrome.runtime.lastError || !res) {
      // 与 !reachable 分支保持一致：停掉计时器，否则上一轮在线状态启动的
      // 秒表会继续跳动，把占位符覆盖成不断增长的时长
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
      const popFlow = $('popFlow');
      if (popFlow) popFlow.textContent = '—';
      const flowWrap = $('flowBarWrap');
      if (flowWrap) flowWrap.style.display = 'none';
      const btnLogin = $('btnLogin');
      if (btnLogin) {
        btnLogin.classList.remove('online-mode');
        $('btnLoginText').textContent = '立即登录';
      }
      $('btnLogout').disabled = true;
      return;
    }

    // 网关延迟与已用流量
    paused = !!res.manualLogout;

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
      renderPingSparkline(res.pingMs);
    } else {
      pingEl.textContent = res.reachable ? '< 10 ms' : '超时';
      pingEl.className = res.reachable ? 'dock-value mono ping-fast' : 'dock-value mono ping-slow';
      pingEl.title = res.reachable ? '网关连通正常' : '网关不可达';
      renderPingSparkline(res.reachable ? 8 : -1);
    }

    const rawData = res.raw || {};
    const flowWrap = $('flowBarWrap');
    const flowDl = $('flowBarDl');
    const flowUl = $('flowBarUl');
    const flowSub = $('popFlowSub');

    if (rawData.flow !== undefined) {
      $('popFlow').textContent = fmtFlow(rawData.flow);
      const dl = parseFloat(rawData.actdf) || 0;
      const ul = parseFloat(rawData.actuf) || 0;
      const total = dl + ul;

      if (flowSub) {
        if (total > 0) {
          const dlPct = Math.round((dl / total) * 100);
          flowSub.textContent = `↓${dlPct}%`;
          flowSub.classList.add('visible');
        } else {
          flowSub.classList.remove('visible');
        }
      }

      if (total > 0 && flowDl && flowUl && flowWrap) {
        const dlPct = Math.max(6, Math.min(94, Math.round((dl / total) * 100)));
        const ulPct = 100 - dlPct;
        flowDl.style.width = dlPct + '%';
        flowUl.style.width = ulPct + '%';
        flowWrap.style.display = 'flex';
        flowWrap.title = `下载 ${dlPct}% (${fmtFlow(dl)}) · 上传 ${ulPct}% (${fmtFlow(ul)})`;
        $('popFlow').title = `已用: ${fmtFlow(rawData.flow)} (下载: ${fmtFlow(dl)} / 上传: ${fmtFlow(ul)})`;
      } else if (flowWrap) {
        flowWrap.style.display = 'none';
      }
    } else {
      $('popFlow').textContent = res.online ? '计量中' : '—';
      if (flowWrap) flowWrap.style.display = 'none';
      if (flowSub) flowSub.classList.remove('visible');
    }

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
    } else if (res.online) {
      setStatus('已在线 · 认证通过', '', 'on');
      $('btnLogin').classList.add('online-mode');
      $('btnLoginText').textContent = '刷新状态';
      $('btnLogout').disabled = false;

      const ip = [rawData.v4ip, rawData.ss5].find((v) => v && v !== '0.0.0.0') || '';
      setLocalIp(ip);

      // 智能计算在线时长：
      // 1. 若后台记录了本次实际连通/登录时间 (res.onlineSince)，以本地连通时间为准，
      //    避免校园网网关跨夜未释放 RADIUS 会话导致显示荒谬的「23小时+」。
      // 2. 若无本地记录，但网关返回了 stime：
      //    - 若 stime 为今天的时间，正常计时；
      //    - 若 stime 跨天 (昨天或更早)，注明「网关长会话（跨夜保留）」，
      //      并优先使用网关 oltime/time（若有较小值）。
      let durationInput = null;
      let titleText = '';

      const now = Date.now();
      const localSince = res.onlineSince ? Number(res.onlineSince) : null;

      if (localSince && Number.isFinite(localSince) && localSince <= now) {
        durationInput = localSince;
        titleText = '本次在线始于: ' + new Date(localSince).toLocaleTimeString();
      } else if (rawData.stime) {
        const stimeDate = new Date(String(rawData.stime).replace(/-/g, '/'));
        const stimeMs = stimeDate.getTime();
        const isStimeValid = Number.isFinite(stimeMs) && !isNaN(stimeMs);

        // 检查 stime 是否为跨天旧会话（如昨天的会话）
        const isSameDay = isStimeValid &&
          new Date().toDateString() === stimeDate.toDateString();

        const MAX_SESSION_SEC = 90 * 86400; // 90 天合理上限（过滤 4294967295 / 0xFFFFFFFF 网关未设置哨兵值）
        const parseSec = (v) => {
          const n = parseInt(v, 10);
          return (Number.isFinite(n) && n > 0 && n < MAX_SESSION_SEC) ? n : 0;
        };
        const validSec = parseSec(rawData.actt) || parseSec(rawData.oltime);

        if (validSec) {
          durationInput = validSec;
          titleText = `活跃在线: ${fmtDuration(validSec)}`;
        } else if (isSameDay) {
          durationInput = rawData.stime;
          titleText = '上线时间: ' + rawData.stime;
        } else if (isStimeValid && (now - stimeMs) > 16 * 3600 * 1000) {
          // 典型的 Dr.COM 跨夜未注销会话（如昨晨建立、夜间断网、今晨复活）
          durationInput = Date.now();
          titleText = '本次在线中';
        } else if (isStimeValid) {
          durationInput = rawData.stime;
          titleText = '上线时间: ' + rawData.stime;
        }
      } else if (rawData.actt && parseInt(rawData.actt, 10) > 0 && parseInt(rawData.actt, 10) < 90 * 86400) {
        durationInput = parseInt(rawData.actt, 10);
        titleText = '网关活跃在线计时';
      } else if (rawData.oltime && parseInt(rawData.oltime, 10) > 0 && parseInt(rawData.oltime, 10) < 90 * 86400) {
        durationInput = parseInt(rawData.oltime, 10);
        titleText = '网关在线计时';
      }

      if (durationInput != null) {
        durationTicker.start(durationInput);
        $('onlineDuration').title = titleText;
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

      const ip = [rawData.v4ip, rawData.ss5].find((v) => v && v !== '0.0.0.0') || '';
      setLocalIp(ip);
      $('onlineDuration').textContent = '未在线';
    }

    triggerTelemetryFade();
  });
}

/** 遥测数据刷新时的平滑微动效 */
function triggerTelemetryFade() {
  const vals = document.querySelectorAll('.dock-value');
  vals.forEach((el) => {
    el.classList.remove('val-pulse');
    void el.offsetWidth;
    el.classList.add('val-pulse');
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
    $('btnLoginText').textContent = (res && res.online) ? '刷新状态' : '立即登录';

    if (chrome.runtime.lastError || !res) {
      setMsg('后台未响应，请刷新插件', 'err');
      return;
    }
    setMsg(res.message || '完成', res.skipped ? 'info' : (res.ok ? 'ok' : 'err'));
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
    setMsg(res.message || '注销完成', res.skipped ? 'info' : (res.ok ? 'ok' : 'err'));
    setTimeout(refresh, 600);
  });
});

const CLIPBOARD_ICON_HTML = '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>';

// --- 一键复制 IP ---
$('ipChip').addEventListener('click', (e) => {
  const chip = $('ipChip');
  if (chip && chip.classList.contains('copied')) return;
  if (!currentIp || currentIp === '未检测到' || currentIp === '未连接') return;

  navigator.clipboard.writeText(currentIp).then(() => {
    const copyIcon = $('copyIcon');
    chip.classList.add('copied');
    copyIcon.innerHTML = '<polyline points="20 6 9 17 4 12" stroke="#10b981" stroke-width="2.5" fill="none"/>';
    setMsg('已复制 IP 到剪贴板', 'ok', 1600);

    setTimeout(() => {
      copyIcon.innerHTML = CLIPBOARD_ICON_HTML;
      chip.classList.remove('copied');
    }, 1500);
  }).catch(() => {
    setMsg(`IP 地址: ${currentIp}`, 'info', 2500);
  });
});

// --- 一键复制账号 ---
function copyAccount(e) {
  const btn = $('btnCopyAccount');
  if (btn && btn.classList.contains('copied')) return;
  if (!currentAccount || currentAccount === '未设置') {
    setMsg('当前未设置认证账号', 'info', 2000);
    return;
  }

  navigator.clipboard.writeText(currentAccount).then(() => {
    const icon = $('copyAccountIcon');
    const card = $('accountDockItem');
    if (card) {
      card.classList.add('copied-flash');
      setTimeout(() => card.classList.remove('copied-flash'), 450);
    }
    if (btn) btn.classList.add('copied');
    if (icon) {
      icon.innerHTML = '<polyline points="20 6 9 17 4 12" stroke="#10b981" stroke-width="2.5" fill="none"/>';
      setTimeout(() => {
        icon.innerHTML = CLIPBOARD_ICON_HTML;
        if (btn) btn.classList.remove('copied');
      }, 1500);
    }
    setMsg('已复制账号到剪贴板', 'ok', 1600);
  }).catch(() => {
    setMsg(`账号: ${currentAccount}`, 'info', 2500);
  });
}

const btnMask = $('btnToggleMask');
if (btnMask) {
  btnMask.addEventListener('click', (e) => {
    e.stopPropagation();
    isMasked = !isMasked;
    chrome.storage.local.set({ privacyMask: isMasked });
    updateAccountDisplay();
    setMsg(isMasked ? '已开启自习室防窥模式' : '已恢复明文显示', 'info', 1600);
  });
}

const btnCopyAcc = $('btnCopyAccount');
if (btnCopyAcc) {
  btnCopyAcc.addEventListener('click', (e) => {
    e.stopPropagation();
    copyAccount(e);
  });
}

const accEl = $('account');
if (accEl) {
  accEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentAccount) {
      if (chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('options.html'));
      }
      return;
    }
    isMasked = !isMasked;
    chrome.storage.local.set({ privacyMask: isMasked });
    updateAccountDisplay();
    setMsg(isMasked ? '已开启自习室防窥模式' : '已恢复明文显示', 'info', 1600);
  });
}

const msgBoxEl = $('msgBox');
if (msgBoxEl) {
  msgBoxEl.addEventListener('click', () => {
    msgBoxEl.className = 'msg-box';
    if (msgTimer) {
      clearTimeout(msgTimer);
      msgTimer = null;
    }
  });
}

// --- 点击版本号胶囊或应用头像快速打开设置页 ---
const verEl = $('ver');
if (verEl) {
  verEl.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });
}
const brandAvatarEl = $('brandAvatar');
if (brandAvatarEl) {
  brandAvatarEl.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });
  brandAvatarEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
      window.close();
    }
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

// --- 点击运营商徽章快捷轮换 ISP (校园 -> 电信 -> 联通 -> 其他) ---
const accountIspEl = $('accountIsp');
if (accountIspEl) {
  const cycleIsp = (e) => {
    e.stopPropagation();
    const order = ['1', '2', '3', '4'];
    const shortMap = { '1': '校园', '2': '电信', '3': '联通', '4': '其他' };
    const fullMap = { '1': '校园用户 (默认)', '2': '校园电信 (@dx)', '3': '校园联通 (@lt)', '4': '校园其他' };
    chrome.storage.local.get({ isp: '1' }, (s) => {
      const cur = (s && order.includes(String(s.isp))) ? String(s.isp) : '1';
      const next = order[(order.indexOf(cur) + 1) % order.length];
      chrome.storage.local.set({ isp: next, authError: false }, () => {
        accountIspEl.textContent = shortMap[next];
        accountIspEl.title = '认证运营商: ' + fullMap[next] + ' (点击可快捷切换)';
        chrome.runtime.sendMessage({ type: 'settingsChanged' }, () => {
          void chrome.runtime.lastError;
        });
        setMsg('已切换运营商: ' + fullMap[next], 'ok', 2000);
      });
    });
  };
  accountIspEl.addEventListener('click', cycleIsp);
  accountIspEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      cycleIsp(e);
    }
  });
}

// --- 同步设置页选择的主题 ---
function applyPopupTheme(theme) {
  if (theme && theme !== 'auto') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

// --- 一键切换深色/浅色主题 (太阳/月亮) ---
const btnTheme = $('btnThemeToggle');
if (btnTheme) {
  btnTheme.addEventListener('click', () => {
    chrome.storage.local.get({ theme: 'auto' }, (s) => {
      const cur = s && s.theme ? s.theme : 'auto';
      let next = 'dark';
      if (cur === 'dark') {
        next = 'light';
      } else if (cur === 'light') {
        next = 'dark';
      } else {
        const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        next = sysDark ? 'light' : 'dark';
      }
      chrome.storage.local.set({ theme: next }, () => {
        applyPopupTheme(next);
        setMsg(`已切换为${next === 'dark' ? '深色' : '浅色'}模式`, 'info', 1800);
      });
    });
  });
}


chrome.storage.local.get({ theme: 'auto' }, (s) => {
  applyPopupTheme(s && s.theme);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.theme) {
    applyPopupTheme(changes.theme.newValue);
  }
});

initAccent();
refresh();

// 页面隐藏/关闭时清理计时器
window.addEventListener('pagehide', () => {
  durationTicker.stop();
});
