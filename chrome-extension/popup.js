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

const pingHistory = [];
function renderPingSparkline(pingMs) {
  const container = $('popPingSparkline');
  if (!container) return;
  if (pingMs !== undefined && pingMs >= 0) {
    pingHistory.push(pingMs);
    if (pingHistory.length > 4) pingHistory.shift();
  }
  const bars = container.querySelectorAll('.spark-bar');
  if (!bars.length) return;
  const maxPing = Math.max(60, ...pingHistory, 1);
  bars.forEach((bar, idx) => {
    const val = pingHistory[idx];
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
}

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
    $('ver').textContent = 'v' + (ver || '1.0.0');
  } catch (e) {
    $('ver').textContent = '';
  }

  // 是否处于「手动注销暂停」状态（由后台在 status 响应里一并返回）
  let paused = false;

  chrome.storage.local.get(
    ['account', 'isp', 'intervalMin', 'offlineIntervalMin', 'adaptive', 'lastResult'],
    (s) => {
      // 只接受字符串：account 被手改/来自旧版本时可能不是字符串，
      // 直接放进 textContent 会显示成 "[object Object]"。
      currentAccount = (s && typeof s.account === 'string') ? s.account : '';
      const accEl = $('account');
      if (accEl) {
        accEl.textContent = currentAccount || '未设置';
        accEl.title = currentAccount ? `点击复制账号: ${currentAccount}` : '尚未设置认证账号';
      }

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

      const ivText = fmt(iv).replace(/\s+/g, '');
      const offText = fmt(off).replace(/\s+/g, '');

      const ivEl = $('interval');
      if (ivEl) {
        ivEl.textContent = adaptive
          ? `${ivText} (掉线${offText})`
          : ivText;
        ivEl.title = adaptive ? `正常在线: ${fmt(iv)} / 掉线急救: ${fmt(off)}` : `巡检频率: ${fmt(iv)}`;
      }

      const r = s && s.lastResult;
      // lastResult 可能来自旧版本/手改：time 与 message 都要先确认是字符串再调
      // .indexOf / .split，否则会抛 TypeError。而这里处于 storage 回调内，
      // 异常会中断整个 refresh()，让后面的状态卡片、IP、按钮全部不更新
      // （面板卡在半渲染状态，看起来像"插件坏了"）。
      const rTime = r && typeof r.time === 'string' ? r.time : '';
      const rMsg = r && typeof r.message === 'string' ? r.message : '';
      if (rTime) {
        // 只保留时分秒以节省空间
        const t = rTime.indexOf(' ') !== -1 ? rTime.split(' ')[1] : rTime;
        const ltEl = $('lastTime');
        if (ltEl) {
          ltEl.textContent = t;
          ltEl.title = '上次检查记录: ' + rTime;
        }
      }
      if (rMsg && (!r.ok || rMsg.indexOf('无需登录') === -1)) {
        setMsg(rMsg, r.ok === false ? 'err' : 'ok');
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
      pingEl.className = 'dock-value mono';
      pingEl.title = res.reachable ? '网关连通正常' : '网关不可达';
      renderPingSparkline(res.reachable ? 8 : -1);
    }

    const rawData = res.raw || {};
    const flowWrap = $('flowBarWrap');
    const flowDl = $('flowBarDl');
    const flowUl = $('flowBarUl');

    if (rawData.flow !== undefined) {
      $('popFlow').textContent = fmtFlow(rawData.flow);
      const dl = parseFloat(rawData.actdf) || 0;
      const ul = parseFloat(rawData.actuf) || 0;
      const total = dl + ul;

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
    }

    if (!res.reachable) {
      durationTicker.stop();
      setStatus('未连接校园网', paused
        ? '门户不可达；自动登录当前处于暂停状态'
        : '门户不可达，请连接校园 Wi-Fi 或插网线', 'off');
      setLocalIp('');
      $('onlineDuration').textContent = '网络断开';
      $('btnLogin').classList.remove('online-mode');
      $('btnLoginText').textContent = paused ? '恢复登录' : '立即登录';
      $('btnLogout').disabled = true;
    } else if (res.online) {
      setStatus('已在线 · 认证通过', '', 'on');
      $('btnLogin').classList.add('online-mode');
      $('btnLoginText').textContent = '重新验证';
      $('btnLogout').disabled = false;

      const ip = rawData.v4ip || rawData.ss5 || '';
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
        if (rawData.stime) {
          titleText += ` (网关计费起始: ${rawData.stime})`;
        }
      } else if (rawData.stime) {
        const stimeDate = new Date(String(rawData.stime).replace(/-/g, '/'));
        const stimeMs = stimeDate.getTime();
        const isStimeValid = Number.isFinite(stimeMs) && !isNaN(stimeMs);

        // 检查 stime 是否为跨天旧会话（如昨天的会话）
        const isSameDay = isStimeValid &&
          new Date().toDateString() === stimeDate.toDateString();

        if (isSameDay) {
          durationInput = rawData.stime;
          titleText = '上线时间: ' + rawData.stime;
        } else if (rawData.oltime && parseInt(rawData.oltime, 10) > 0) {
          durationInput = parseInt(rawData.oltime, 10);
          titleText = `网关会话计费: ${rawData.stime}`;
        } else if (rawData.time && parseInt(rawData.time, 10) > 0) {
          durationInput = parseInt(rawData.time, 10);
          titleText = `网关会话计费: ${rawData.stime}`;
        } else if (isStimeValid && (now - stimeMs) > 16 * 3600 * 1000) {
          // 典型的 Dr.COM 跨夜未注销会话（如昨晨建立、夜间断网、今晨复活）
          durationInput = rawData.stime;
          titleText = `网关保留长会话 (始于 ${rawData.stime}，跨夜未释放)`;
        } else if (isStimeValid) {
          durationInput = rawData.stime;
          titleText = '上线时间: ' + rawData.stime;
        }
      } else if (rawData.oltime) {
        durationInput = parseInt(rawData.oltime, 10);
        titleText = '网关在线计时';
      } else if (rawData.actt) {
        durationInput = parseInt(rawData.actt, 10);
        titleText = '网关计费计时';
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
      } else {
        setStatus('未登录 · 需要认证', '已连上校园局域网，请点击登录', 'wait');
      }
      $('btnLogin').classList.remove('online-mode');
      $('btnLoginText').textContent = paused ? '恢复登录' : '立即登录';
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
$('ipChip').addEventListener('click', (e) => {
  if (!currentIp || currentIp === '未检测到') return;

  navigator.clipboard.writeText(currentIp).then(() => {
    const chip = $('ipChip');
    const copyIcon = $('copyIcon');
    const oldHtml = copyIcon.innerHTML;
    chip.classList.add('copied');
    copyIcon.innerHTML = '<polyline points="20 6 9 17 4 12" stroke="#10b981" stroke-width="2.5" fill="none"/>';
    setMsg(`已复制 IP: ${currentIp}`, 'ok', 1800);
    showFloatingBubble(e, '已复制 IP ✓');

    setTimeout(() => {
      copyIcon.innerHTML = oldHtml;
      chip.classList.remove('copied');
    }, 1500);
  }).catch(() => {
    setMsg(`IP 地址: ${currentIp}`, 'info', 2500);
  });
});

// --- 一键复制账号 ---
function copyAccount(e) {
  if (!currentAccount || currentAccount === '未设置') {
    setMsg('当前未设置认证账号', 'info', 2000);
    return;
  }

  navigator.clipboard.writeText(currentAccount).then(() => {
    const btn = $('btnCopyAccount');
    const icon = $('copyAccountIcon');
    const card = $('accountDockItem');
    if (card) {
      card.classList.add('copied-flash');
      setTimeout(() => card.classList.remove('copied-flash'), 450);
    }
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
    showFloatingBubble(e, '已复制账号 ✓');
  }).catch(() => {
    setMsg(`账号: ${currentAccount}`, 'info', 2500);
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
    copyAccount(e);
  });
}

// --- 点击版本号胶囊快速打开设置页 ---
const verEl = $('ver');
if (verEl) {
  verEl.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
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

refresh();

// --- Linear/Raycast 级卡片鼠标光斑跟随 ---
if (window.matchMedia('(hover: hover)').matches) {
  document.querySelectorAll('.card, .dock-item').forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
      card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
    });
  });
}
