/**
 * 校园网自动登录 — 控制中心设置脚本
 */
'use strict';

// 默认设置。账号密码留空 —— 绝不在此处写入任何真实凭据。
const DEFAULTS = {
  account: '',
  password: '',
  isp: '1',
  intervalMin: 10 / 60,
  offlineIntervalMin: 1 / 60,
  adaptive: true,
  autoOnStartup: true,
  contentAutoFill: true,
  instantTrigger: true
};

/** 顶部浮动消息通知管理组件 (Component: createToastManager) */
const toastManager = createToastManager({ containerId: 'toastContainer', maxStack: 3 });
function showToast(text, kind = 'info', duration = 4000) {
  toastManager.show(text, kind, duration);
}

/** 自习室防窥遮罩管理组件 (Component: createPrivacyMaskManager) */
const privacyMask = createPrivacyMaskManager({
  toggleBtnId: 'btnToggleMask',
  iconId: 'maskIcon',
  onUpdate: (masked) => {
    $('account')?.classList.toggle('account-masked', masked);
  },
  onNotify: (msg) => showToast(msg, 'info', 2000)
});

/** 动态在线计时器与可视化组件 (来自 common.js 组件库) */
const durationTicker = createTicker((text) => {
  $('stTime').textContent = text;
});

const renderOptPingSparkline = createSparkline('optPingSparkline', 8);

const optFlowMeter = createFlowMeter({
  cardEl: 'cardStatFlow',
  totalEl: 'stFlow',
  detailEl: 'stFlowDetail',
  wrapId: 'optFlowBarWrap',
  dlId: 'optFlowBarDl',
  ulId: 'optFlowBarUl'
});

const activityTimeline = createActivityTimeline({
  drawerId: 'logTimelineDrawer',
  toggleBtnId: 'btnToggleLogDrawer',
  countBadgeId: 'logCountBadge',
  listId: 'logTimelineList'
});

const confirmModal = createConfirmModal({
  overlayId: 'confirmModalOverlay',
  titleId: 'confirmModalTitle',
  descId: 'confirmModalDesc',
  cancelBtnId: 'btnModalCancel',
  confirmBtnId: 'btnModalConfirm'
});

const healthMeter = createNetworkHealthMeter({
  badgeId: 'heroHealthBadge',
  scoreId: 'heroHealthScore'
});

const passwordToggle = createPasswordToggle({
  inputId: 'password',
  toggleBtnId: 'togglePwd',
  iconId: 'eyeIcon',
  timeoutMs: 10000
});

// --- 顶部快捷：注销下线 (Component: createConfirmButton) ---
const logoutConfirmBtn = createConfirmButton({
  btnEl: 'btnLogoutNow',
  labelSelector: 'span',
  idleText: '注销下线',
  confirmText: '确认注销？',
  timeoutMs: 3500,
  onArmed: () => {
    showToast('再次点击「确认注销」即可断开校园网连接', 'info');
  },
  onConfirm: (btn) => {
    btn.disabled = true;
    showToast('正在请求注销下线…', 'info');

    chrome.runtime.sendMessage({ type: 'logout' }, (res) => {
      btn.disabled = false;
      if (chrome.runtime.lastError || !res) {
        showToast('注销超时，请到登录网站手动注销', 'err');
        return;
      }
      showToast(res.message || '注销完成', res.skipped ? 'info' : (res.ok ? 'ok' : 'err'));
      refreshStatus();
    });
  }
});


/** 动态更新网络全链路拓扑指示器 */
function updateTopology(res) {
  const clientIp = $('topoClientIp');
  if (!clientIp) return;
  const pingVal = $('topoPingVal');
  const pingChip = $('topoPingChip');
  const authVal = $('topoAuthVal');
  const authChip = $('topoAuthChip');
  const internetVal = $('topoInternetVal');
  const internetNode = $('topoNodeInternet');
  const linkPing = $('topoLinkPing');
  const linkAuth = $('topoLinkAuth');

  if (!res) {
    clientIp.textContent = '未获取到';
    if (pingVal) pingVal.textContent = '离线';
    if (pingChip) pingChip.className = 'topo-chip-badge off';
    if (authVal) authVal.textContent = '未连接';
    if (authChip) authChip.className = 'topo-chip-badge off';
    if (internetVal) internetVal.textContent = '无网络';
    setTooltip(internetNode, '在线时点击刷新连通状态，离线时点击立即登录');
    if (linkPing) linkPing.className = 'topo-link off';
    if (linkAuth) linkAuth.className = 'topo-link off';
    return;
  }

  const raw = res.raw || {};
  const ip = [raw.v4ip, raw.ss5].find((v) => v && v !== '0.0.0.0') || '';
  clientIp.textContent = ip || (res.reachable ? '已连接网关' : '未连接');

  if (res.pingMs !== undefined && res.pingMs >= 0) {
    if (pingVal) pingVal.textContent = res.pingMs + ' ms';
    if (pingChip) pingChip.className = 'topo-chip-badge ' + (res.pingMs <= 50 ? 'fast' : (res.pingMs <= 150 ? 'normal' : 'slow'));
  } else {
    if (pingVal) pingVal.textContent = res.reachable ? '< 10 ms' : '超时';
    if (pingChip) pingChip.className = 'topo-chip-badge ' + (res.reachable ? 'fast' : 'off');
  }

  if (linkPing) {
    linkPing.className = 'topo-link ' + (res.reachable ? 'on' : 'off');
  }

  if (!res.reachable) {
    if (authVal) authVal.textContent = '连接失败';
    if (authChip) authChip.className = 'topo-chip-badge off';
    if (internetVal) internetVal.textContent = '未连接';
    setTooltip(internetNode, '网关不可达 · 点击尝试立即登录');
    if (linkAuth) linkAuth.className = 'topo-link off';
  } else if (res.online) {
    if (authVal) authVal.textContent = '已认证 ✓';
    if (authChip) authChip.className = 'topo-chip-badge on';
    if (internetVal) internetVal.textContent = '认证放行 ✓';
    setTooltip(internetNode, '外网链路畅通 · 点击刷新连通状态');
    if (linkAuth) linkAuth.className = 'topo-link on';
  } else {
    if (authVal) authVal.textContent = res.manualLogout ? '已暂停' : '待认证';
    if (authChip) authChip.className = 'topo-chip-badge wait';
    if (internetVal) internetVal.textContent = '局域网受限';
    setTooltip(internetNode, '外网未放行 · 点击立即登录');
    if (linkAuth) linkAuth.className = 'topo-link wait';
  }
}



/** 主题切换管理组件 (Component: createThemeManager) */
const themeManager = createThemeManager({
  toggleBtnId: 'btnThemeToggle',
  labelId: 'themeLabel',
  supportAuto: true,
  onNotify: (msg) => showToast(msg, 'info')
});



// 下拉选择组件（formatOptionContent / syncCustomSelect / closeAllCustomSelects / initCustomSelects）
// 已抽象为全局通用组件，定义于 common.js。

let savedCredentials = { account: '', password: '' };

/** 清除单个表单字段的校验失败高亮与错误提示 */
function clearFieldError(id) {
  const el = $(id);
  if (!el) return;
  el.classList.remove('field-invalid');
  el.removeAttribute('aria-invalid');
  el.removeAttribute('aria-describedby');
  const err = $(id + 'Error');
  if (err) err.textContent = '';
}

function clearAllFieldErrors() {
  clearFieldError('account');
  clearFieldError('password');
}

/** 比对输入框当前凭据与已落盘凭据快照，更新未保存状态提示 */
function syncDirtyState() {
  const curAccount = ($('account')?.value || '').trim();
  const curPassword = $('password')?.value || '';
  setDirtyState(curAccount !== savedCredentials.account || curPassword !== savedCredentials.password);
}

/** 从本地存储加载配置到表单 */
function load() {
  const verEl = $('ver');
  if (verEl) {
    try {
      const ver = chrome.runtime?.getManifest?.()?.version;
      verEl.textContent = 'v' + (ver || '1.0.0');
    } catch (e) {
      if (!verEl.textContent) verEl.textContent = 'v1.0.0';
    }
  }

  chrome.storage.local.get(DEFAULTS, (s) => {
    if (chrome.runtime.lastError || !s) {
      showToast('读取本地配置失败，请重试', 'err');
      return;
    }
    clearAllFieldErrors();
    // 只接受字符串：storage 里的值可能被手改或来自旧版本。
    // 注意不能只用 String() —— String({}) 会得到字面量 "[object Object]"，照样显示难看。
    // 非字符串一律当作空值处理（下面 isp 也用同样的思路）。
    $('account').value = typeof s.account === 'string' ? s.account : '';
    syncClearBtn();
    $('password').value = typeof s.password === 'string' ? s.password : '';
    savedCredentials = {
      account: $('account').value.trim(),
      password: $('password').value
    };
    // 非法 isp（手改 storage / 旧版本残留）赋给 select 会静默失败：
    // selectedIndex 变 -1，界面显示与实际生效值脱节，统一归一到默认档
    const storedIsp = typeof s.isp === 'string' ? s.isp : String(s.isp || '1');
    $('isp').value = ['1', '2', '3', '4'].indexOf(storedIsp) !== -1 ? storedIsp : '1';
    syncCustomSelect('isp');
    syncIspQuickPills();

    pickClosest('intervalMin', s.intervalMin === undefined ? DEFAULTS.intervalMin : s.intervalMin);
    pickClosest('offlineIntervalMin', s.offlineIntervalMin === undefined ? DEFAULTS.offlineIntervalMin : s.offlineIntervalMin);

    $('adaptive').checked = s.adaptive !== false;
    $('autoOnStartup').checked = s.autoOnStartup !== false;
    $('contentAutoFill').checked = s.contentAutoFill !== false;
    $('instantTrigger').checked = s.instantTrigger !== false;
    syncOfflineRow();
    updatePolicySummaryPill();
    setDirtyState(false);
  });

  refreshStatus();
}

/** 同步运营商快捷胶囊按钮高亮状态 */
function syncIspQuickPills() {
  const wrap = $('ispQuickPills');
  const sel = $('isp');
  if (!wrap || !sel) return;
  const cur = sel.value || '1';
  wrap.querySelectorAll('.isp-pill').forEach((btn) => {
    const active = btn.getAttribute('data-isp') === cur;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
    btn.tabIndex = active ? 0 : -1;
  });
}

function initIspQuickPills() {
  const wrap = $('ispQuickPills');
  const sel = $('isp');
  if (!wrap || !sel) return;
  const selectPill = (btn) => {
    const ispVal = btn?.getAttribute?.('data-isp');
    if (ispVal && sel.value !== ispVal) {
      sel.value = ispVal;
      syncCustomSelect('isp');
      syncIspQuickPills();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  wrap.addEventListener('click', (e) => {
    const btn = e && e.target && typeof e.target.closest === 'function' ? e.target.closest('.isp-pill') : null;
    if (btn) selectPill(btn);
  });
  wrap.addEventListener('keydown', (e) => {
    const pills = Array.from(wrap.querySelectorAll('.isp-pill'));
    const idx = pills.indexOf(e && e.target && typeof e.target.closest === 'function' ? e.target.closest('.isp-pill') : null);
    if (idx === -1) return;
    let nextIdx = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIdx = (idx + 1) % pills.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIdx = (idx - 1 + pills.length) % pills.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = pills.length - 1;
    }
    if (nextIdx !== -1) {
      e.preventDefault();
      const targetBtn = pills[nextIdx];
      selectPill(targetBtn);
      targetBtn?.focus();
    }
  });
}

/** 实时更新 Hero 区域保活策略摘要胶囊 */
function updatePolicySummaryPill() {
  const pill = $('stPolicyPill');
  if (!pill) return;
  const isAdaptive = $('adaptive') ? $('adaptive').checked : true;
  const iv = fmt($('intervalMin') ? $('intervalMin').value : DEFAULTS.intervalMin).replace(/\s+/g, '');
  const off = fmt($('offlineIntervalMin') ? $('offlineIntervalMin').value : DEFAULTS.offlineIntervalMin).replace(/\s+/g, '');
  if (isAdaptive) {
    pill.textContent = `⚡ 自适应保活 · 在线 ${iv} / 掉线 ${off}`;
    pill.className = 'stat-policy-pill';
  } else {
    pill.textContent = `⏱ 常规轮询 · 每 ${iv}`;
    pill.className = 'stat-policy-pill regular';
  }
}

/** 在 select 里选中最接近给定值的项 */
function pickClosest(id, value) {
  const sel = $(id);
  const v = parseFloat(value);
  if (!Number.isFinite(v)) {
    sel.selectedIndex = 0;
    syncCustomSelect(sel);
    return;
  }
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < sel.options.length; i++) {
    const diff = Math.abs(parseFloat(sel.options[i].value) - v);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  sel.selectedIndex = best;
  syncCustomSelect(sel);
}

/** 返回 select 里与给定值最接近的预设值（数值），用于导入时把存储值对齐到 UI 预设 */
function snapToPresetValue(id, value) {
  const v = parseFloat(value);
  const clamp = (n) => Math.max(1 / 60, Math.min(60, n));
  if (!Number.isFinite(v)) return clamp(0);
  const sel = $(id);
  if (!sel || !sel.options || !sel.options.length) return clamp(v);
  let best = parseFloat(sel.options[0].value);
  let bestDiff = Infinity;
  for (let i = 0; i < sel.options.length; i++) {
    const optVal = parseFloat(sel.options[i].value);
    const diff = Math.abs(optVal - v);
    if (diff < bestDiff) { bestDiff = diff; best = optVal; }
  }
  return best;
}

/** 自适应关闭时，置灰「掉线重连间隔」（保持双列布局对称不坍塌并禁用键盘操作） */
function syncOfflineRow() {
  const row = $('offlineRow');
  if (!row) return;
  const enabled = !!($('adaptive') && $('adaptive').checked);
  row.classList.toggle('is-disabled', !enabled);
  row.style.display = '';
  const sel = $('offlineIntervalMin');
  if (sel) {
    sel.disabled = !enabled;
    sel.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  }
  const trigger = typeof row.querySelector === 'function' ? row.querySelector('.custom-select-trigger') : null;
  if (trigger) {
    trigger.disabled = !enabled;
    trigger.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    trigger.tabIndex = enabled ? 0 : -1;
  }
}

let statusReqSeq = 0;
let statusSpinTimer = null;

function setTelemetryAria(id, label) {
  const el = $(id);
  if (el) el.setAttribute('aria-label', label);
}

let lastOnlineState = null;
let heroRippleRaf = 0;

/** 触发 Hero 状态卡网络认证成功的形态扩散波纹（双 rAF 零同步回流重播） */
function triggerHeroRipple() {
  const wave = $('heroRippleWave');
  if (!wave) return;
  if (!wave.dataset.rippleCleanupBound && typeof wave.addEventListener === 'function') {
    wave.dataset.rippleCleanupBound = '1';
    wave.addEventListener('animationend', () => wave.classList.remove('burst'));
  }
  if (heroRippleRaf && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(heroRippleRaf);
    heroRippleRaf = 0;
  }
  wave.classList.remove('burst');
  if (typeof requestAnimationFrame === 'function') {
    heroRippleRaf = requestAnimationFrame(() => {
      heroRippleRaf = requestAnimationFrame(() => {
        heroRippleRaf = 0;
        wave.classList.add('burst');
      });
    });
  } else {
    wave.classList.add('burst');
  }
}

/** 刷新顶部诊断卡片状态 */
function refreshStatus(cb) {
  const reqId = ++statusReqSeq;
  const checkBtn = $('btnCheckStatus');
  const topoStrip = $('networkTopology');
  const spinStart = Date.now();
  if (statusSpinTimer) {
    clearTimeout(statusSpinTimer);
    statusSpinTimer = null;
  }
  if (checkBtn) checkBtn.classList.add('spinning');
  if (topoStrip) topoStrip.classList.add('probing');

  const stopSpin = () => {
    const elapsed = Date.now() - spinStart;
    const minSpinMs = 600;
    const remaining = Math.max(0, minSpinMs - elapsed);
    if (statusSpinTimer) clearTimeout(statusSpinTimer);
    statusSpinTimer = setTimeout(() => {
      statusSpinTimer = null;
      if (checkBtn) checkBtn.classList.remove('spinning');
      const topo = $('networkTopology');
      if (topo) topo.classList.remove('probing');
    }, remaining);
  };

  chrome.storage.local.get(['lastResult', 'eventLogs'], (s) => {
    if (reqId !== statusReqSeq) return;
    if (chrome.runtime.lastError || !s) return;
    const r = s && s.lastResult;
    // 逐字段兜底：lastResult 可能来自旧版本或手改，缺字段时直接相加会显示成
    // 「12345 · undefined」；而对象经 String() 会变成 "[object Object]"，同样难看。
    // 故只接受字符串/数字（时间是 "HH:MM:SS" 字符串，也可能是时间戳）。
    const text = (v) => (typeof v === 'string' || typeof v === 'number') ? String(v) : '';
    const t = text(r && r.time);
    const m = normalizeStatusMessage(text(r && r.message));
    $('stLast').textContent = [t, m].filter(Boolean).join(' · ') || '暂无记录';
    activityTimeline.render((s && Array.isArray(s.eventLogs)) ? s.eventLogs : []);
  });

  chrome.runtime.sendMessage({ type: 'status' }, (res) => {
    if (reqId !== statusReqSeq) return;
    stopSpin();

    const pill = $('stPill');
    const textEl = $('stOnline');
    const heroEl = $('statusWidget');
    const logoAv = $('logoBeacon');
    const portalDot = $('portalDot');

    if (chrome.runtime.lastError || !res) {
      lastOnlineState = false;
      // 与 !reachable 分支保持一致：停掉计时器，否则上一轮在线状态启动的
      // 秒表会继续每秒跳动，把这里的占位符覆盖掉，显示一个无人校验的时长
      durationTicker.stop();
      pill.className = 'status-pill off';
      if (heroEl) {
        heroEl.classList.remove('hero-on', 'hero-wait');
        heroEl.classList.add('hero-off');
      }
      if (logoAv) logoAv.className = 'logo-beacon off';
      if (portalDot) portalDot.className = 'portal-dot off';
      textEl.textContent = '后台未响应';
      $('stIp').textContent = '—';
      $('stMac').textContent = '物理 MAC: —';
      setTelemetryAria('stIp', '本机局域网 IP 暂不可用');
      setTelemetryAria('stMac', '物理 MAC 地址暂不可用');
      $('stTime').textContent = '—';
      $('stPing').textContent = '—';
      const errPingBadge = $('pingBadge');
      if (errPingBadge) {
        errPingBadge.className = 'latency-badge slow';
        errPingBadge.textContent = '超时';
      }
      renderOptPingSparkline(-1);
      optFlowMeter.reset();
      $('stStime').textContent = '上线时间: —';
      $('btnLogoutNow').disabled = true;
      logoutConfirmBtn.reset();
      healthMeter.render(null);
      updateTopology(null);
      if (cb) cb();
      return;
    }

    const raw = res.raw || {};
    const ip = [raw.v4ip, raw.ss5].find((v) => v && v !== '0.0.0.0') || '';
    const formattedMac = raw.ss1 ? fmtMac(raw.ss1) : '';
    $('stIp').textContent = ip || '未获取到';
    $('stMac').textContent = formattedMac ? ('物理 MAC: ' + formattedMac) : '物理 MAC: —';
    setTelemetryAria('stIp', ip ? `本机 IP ${ip}，点击复制` : '本机局域网 IP 未获取到');
    setTelemetryAria('stMac', formattedMac ? `物理 MAC 地址 ${formattedMac}，点击复制` : '物理 MAC 地址暂未获取到');

    if (res.online) {
      const { durationInput, optionsSubtitle } = resolveSessionDuration(res, raw);
      if (durationInput != null) {
        durationTicker.start(durationInput);
        $('stStime').textContent = optionsSubtitle;
      } else {
        durationTicker.stop();
        $('stTime').textContent = '在线中';
        $('stStime').textContent = '上线时间: —';
      }
    } else {
      durationTicker.stop();
      $('stTime').textContent = '未在线';
      $('stStime').textContent = '上线时间: —';
    }

    // Ping & Latency Rating
    const pingEl = $('stPing');
    const badgeEl = $('pingBadge');
    const hist = Array.isArray(res.pingHistory) && res.pingHistory.length ? res.pingHistory : null;
    const pingMeta = classifyPing(res.pingMs, res.reachable);
    pingEl.textContent = pingMeta.text;
    if (badgeEl) {
      badgeEl.className = 'latency-badge ' + pingMeta.grade;
      badgeEl.textContent = pingMeta.label;
    }
    renderOptPingSparkline(hist || pingMeta.fallbackMs);

    // Flow & Traffic Detail (下行 / 上行 / 总计明细)
    optFlowMeter.render(raw, res.online);

    if (!res.reachable) {
      lastOnlineState = false;
      durationTicker.stop();
      pill.className = 'status-pill off';
      if (heroEl) {
        heroEl.classList.remove('hero-on', 'hero-wait');
        heroEl.classList.add('hero-off');
      }
      if (logoAv) logoAv.className = 'logo-beacon off';
      if (portalDot) portalDot.className = 'portal-dot off';
      textEl.textContent = res.manualLogout ? '网络连接失败 · 已暂停' : '网络连接失败';
    } else if (res.online) {
      if (lastOnlineState !== true) {
        triggerHeroRipple();
      }
      lastOnlineState = true;
      pill.className = 'status-pill on';
      if (heroEl) {
        heroEl.classList.remove('hero-off', 'hero-wait');
        heroEl.classList.add('hero-on');
      }
      if (logoAv) logoAv.className = 'logo-beacon on';
      if (portalDot) portalDot.className = 'portal-dot on';
      textEl.textContent = '已在线 ✓';
    } else {
      lastOnlineState = false;
      durationTicker.stop();
      pill.className = 'status-pill wait';
      if (heroEl) {
        heroEl.classList.remove('hero-on', 'hero-off');
        heroEl.classList.add('hero-wait');
      }
      if (logoAv) logoAv.className = 'logo-beacon wait';
      if (portalDot) portalDot.className = 'portal-dot on';
      textEl.textContent = res.manualLogout ? '已手动注销 · 自动登录暂停' : '未登录';
    }

    const logoutBtn = $('btnLogoutNow');
    if (logoutBtn) {
      logoutBtn.disabled = !res.online;
      if (!res.online) logoutConfirmBtn.reset();
    }

    updateTopology(res);
    healthMeter.render(res);
    triggerTelemetryFade();
    if (cb) cb();
  });
}

/** 遥测数据刷新时的平滑微动效 (Component: triggerPulseAnimation, 60fps 无 Layout Thrashing) */
const triggerTelemetryFade = () => triggerPulseAnimation('.stat-val, .topo-val');


/** 读取表单当前值 */
function readForm() {
  const interval = parseFloat($('intervalMin').value);
  const offline = parseFloat($('offlineIntervalMin').value);

  return {
    account: $('account').value.trim(),
    password: $('password').value,
    isp: $('isp').value,
    intervalMin: Number.isFinite(interval) ? interval : DEFAULTS.intervalMin,
    offlineIntervalMin: Number.isFinite(offline) ? offline : DEFAULTS.offlineIntervalMin,
    adaptive: $('adaptive').checked,
    autoOnStartup: $('autoOnStartup').checked,
    contentAutoFill: $('contentAutoFill').checked,
    instantTrigger: $('instantTrigger').checked,
    initialized: true
  };
}

/** 切换「有未保存改动」提示状态（保存按钮高亮与同步状态胶囊文案） */
function setDirtyState(dirty) {
  const btn = $('btnSave');
  const syncPill = $('dockSyncStatus');
  if (btn) {
    btn.classList.toggle('has-changes', !!dirty);
  }
  if (syncPill) {
    syncPill.classList.toggle('dirty', !!dirty);
    syncPill.textContent = dirty ? '● 有未保存的凭据改动' : '✓ 配置已实时同步';
  }
}

/**
 * 保存当前表单到 chrome.storage 并通知后台刷新定时器。
 *
 * 注意：这里**不校验**账号密码。开关类与间隔类设置（自适应、开机自启、
 * 轮询间隔、运营商等）本身就是合法的，与是否填写凭据无关；在此拦截会导致
 * 全新安装（凭据默认为空）的用户无论怎么点都存不上，而且调用方还会弹出
 * 「已自动保存」的成功提示，属于静默失败。凭据校验只在真正发起认证时进行
 * （设置页的「保存并连接」与后台的定时巡检）。
 */
function save(cb) {
  const data = readForm();
  // 显式保存表单（如输入框回车 / 保存并连接）时清除凭据错误降频标记，
  // 使新凭据或运算符配置立即恢复正常重试节奏。
  const payload = Object.assign({}, data, { authError: false });
  chrome.storage.local.set(payload, () => {
    if (chrome.runtime && chrome.runtime.lastError) {
      showToast('保存配置失败，请重试', 'err');
      if (cb) cb(false);
      return;
    }
    savedCredentials = { account: data.account, password: data.password };
    setDirtyState(false);
    updatePolicySummaryPill();
    syncIspQuickPills();
    chrome.runtime.sendMessage({ type: 'settingsChanged' }, () => {
      void chrome.runtime.lastError;
      if (cb) cb(true);
    });
  });
}

/** 局部保存即时设置，避免把未提交的半成品账号/密码连带落盘并误清脏状态 */
function savePartialSetting(patch, cb) {
  const payload = Object.assign({}, patch, { initialized: true });
  chrome.storage.local.set(payload, () => {
    if (chrome.runtime && chrome.runtime.lastError) {
      showToast('保存设置失败，请重试', 'err');
      if (cb) cb(false);
      return;
    }
    updatePolicySummaryPill();
    syncIspQuickPills();
    syncDirtyState();
    chrome.runtime.sendMessage({ type: 'settingsChanged' }, () => {
      void chrome.runtime.lastError;
      if (cb) cb(true);
    });
  });
}

/** 表单里是否已填写账号和密码（用于「保存并连接」） */
function hasCredentials() {
  const s = readForm();
  return !!(s.account && s.password);
}

// --- 仅凭据输入变更需要提示「有未保存的凭据改动」 ---
['account', 'password'].forEach((id) => {
  const el = $(id);
  if (el) {
    el.addEventListener('input', syncDirtyState);
    el.addEventListener('change', syncDirtyState);
  }
});

/** 左侧导航分段映射与滑块单焦点面板切换 */
const SECTION_META = {
  overview: { navId: 'navOverview', panelId: 'panelOverview' },
  credentials: { navId: 'navCredentials', panelId: 'panelCredentials' },
  automation: { navId: 'navAutomation', panelId: 'panelAutomation' },
  backup: { navId: 'navBackup', panelId: 'panelBackup' }
};
const SECTION_ORDER = ['overview', 'credentials', 'automation', 'backup'];
let currentSectionKey = 'overview';
let lastIndicatorW = 0;
let lastIndicatorH = 0;
let sidebarResizeRaf = 0;

function updateSidebarIndicator(activeNavEl, immediate = false) {
  const ind = $('sidebarNavIndicator');
  if (!ind || !activeNavEl || typeof activeNavEl.offsetTop !== 'number') return;
  const w = activeNavEl.offsetWidth;
  const h = activeNavEl.offsetHeight;
  if (!w || !h) return;

  const x = activeNavEl.offsetLeft || 0;
  const y = activeNavEl.offsetTop || 0;
  if (immediate) {
    ind.style.transition = 'none';
  }
  if (w !== lastIndicatorW) {
    ind.style.width = `${w}px`;
    lastIndicatorW = w;
  }
  if (h !== lastIndicatorH) {
    ind.style.height = `${h}px`;
    lastIndicatorH = h;
  }
  ind.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  ind.style.opacity = '1';
  if (immediate) {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        ind.style.transition = '';
      });
    } else {
      ind.style.transition = '';
    }
  } else if (ind.style.transition === 'none') {
    ind.style.transition = '';
  }
}

/**
 * 切换控制中心左侧导航对应的单焦点工作区视图。
 * 无论用户从哪一页提交保存、触发凭据校验错误或从外部深链进入，均可保持视图与焦点一致。
 */
function switchOptionsSection(sectionKey, syncHash = true, immediateIndicator = false) {
  const key = SECTION_META[sectionKey] ? sectionKey : 'overview';
  currentSectionKey = key;

  if (typeof closeAllCustomSelects === 'function') {
    closeAllCustomSelects();
  }
  if (key !== 'overview' && activityTimeline && typeof activityTimeline.toggle === 'function') {
    activityTimeline.toggle(false);
  }

  for (const k of SECTION_ORDER) {
    const item = SECTION_META[k];
    const active = k === key;
    const navEl = $(item.navId);
    const panelEl = $(item.panelId);
    if (navEl) {
      navEl.classList.toggle('active', active);
      navEl.setAttribute('aria-selected', active ? 'true' : 'false');
      navEl.tabIndex = active ? 0 : -1;
    }
    if (panelEl) {
      panelEl.classList.toggle('is-active', active);
      panelEl.hidden = !active;
    }
  }

  updateSidebarIndicator($(SECTION_META[key].navId), immediateIndicator);

  if (syncHash) {
    try {
      if (typeof window !== 'undefined' && window.history && typeof window.history.replaceState === 'function') {
        window.history.replaceState(null, '', '#' + key);
      }
    } catch (_) {
      // 测试沙箱或无 history 环境静默跳过
    }
  }
}

function initSidebarNavigation() {
  SECTION_ORDER.forEach((key, idx) => {
    const navEl = $(SECTION_META[key].navId);
    if (!navEl) return;
    navEl.addEventListener('click', () => {
      switchOptionsSection(key);
    });
    navEl.addEventListener('keydown', (e) => {
      let nextIdx = -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        nextIdx = (idx + 1) % SECTION_ORDER.length;
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        nextIdx = (idx - 1 + SECTION_ORDER.length) % SECTION_ORDER.length;
      } else if (e.key === 'Home') {
        nextIdx = 0;
      } else if (e.key === 'End') {
        nextIdx = SECTION_ORDER.length - 1;
      }
      if (nextIdx !== -1) {
        e.preventDefault();
        const nextKey = SECTION_ORDER[nextIdx];
        switchOptionsSection(nextKey);
        $(SECTION_META[nextKey].navId)?.focus();
      }
    });
  });

  let initial = 'overview';
  try {
    if (typeof window !== 'undefined' && window.location && typeof window.location.hash === 'string') {
      const h = window.location.hash.replace(/^#/, '');
      if (SECTION_META[h]) initial = h;
    }
  } catch (_) {}
  switchOptionsSection(initial, false, true);

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      updateSidebarIndicator($(SECTION_META[currentSectionKey].navId), true);
    });
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', () => {
      if (sidebarResizeRaf) return;
      const run = () => {
        sidebarResizeRaf = 0;
        updateSidebarIndicator($(SECTION_META[currentSectionKey].navId), true);
      };
      if (typeof requestAnimationFrame === 'function') {
        sidebarResizeRaf = requestAnimationFrame(run);
      } else {
        run();
      }
    }, { passive: true });
  }
}

// --- 保存并连接 ---
$('form').addEventListener('submit', (e) => {
  e.preventDefault();

  // 只有「测试登录」才需要凭据；非凭据设置先保存下来（U6）
  if (!hasCredentials()) {
    save((ok) => {
      if (ok) showToast('设置已保存（提示：账号或密码为空，未发起登录连接）。', 'warn');
    });
    const s = readForm();
    // 自动切回凭据视图，避免用户停留在其他分页时校验红框与焦点不可见
    switchOptionsSection('credentials');
    let firstInvalid = null;
    if (!s.account) {
      const acc = $('account');
      acc.classList.add('field-invalid');
      acc.setAttribute('aria-invalid', 'true');
      acc.setAttribute('aria-describedby', 'accountError');
      const errEl = $('accountError');
      if (errEl) errEl.textContent = '上网账号不能为空，请填写手机号或学号';
      firstInvalid = firstInvalid || acc;
    }
    if (!s.password) {
      const pwd = $('password');
      pwd.classList.add('field-invalid');
      pwd.setAttribute('aria-invalid', 'true');
      pwd.setAttribute('aria-describedby', 'passwordError');
      const errEl = $('passwordError');
      if (errEl) errEl.textContent = '认证密码不能为空，请填写校园网密码';
      firstInvalid = firstInvalid || pwd;
    }
    if (firstInvalid) firstInvalid.focus();
    return;
  }

  const btn = $('btnSave');
  btn.disabled = true;
  btn.classList.add('loading');
  $('btnSaveText').textContent = '正在保存并连接…';
  showToast('正在向校园网登录网站发起验证…', 'info');
  const topoStrip = $('networkTopology');
  if (topoStrip) topoStrip.classList.add('authenticating');

  save((ok) => {
    if (!ok) {
      btn.disabled = false;
      btn.classList.remove('loading');
      $('btnSaveText').textContent = '保存并连接';
      const topo = $('networkTopology');
      if (topo) topo.classList.remove('authenticating');
      return;
    }
    chrome.runtime.sendMessage({ type: 'login' }, (res) => {
      btn.disabled = false;
      btn.classList.remove('loading');
      $('btnSaveText').textContent = '保存并连接';
      const topo = $('networkTopology');
      if (topo) topo.classList.remove('authenticating');

      if (chrome.runtime.lastError || !res) {
        showToast('保存成功，但后台未响应测试请求', 'err');
        return;
      }

      if (res.online) {
        triggerHeroRipple();
        lastOnlineState = true;
      }
      showToast(res.message || '配置已生效', res.skipped ? 'info' : (res.ok ? 'ok' : 'err'));
      refreshStatus();
    });
  });
});

// 全局快捷键 Ctrl+S / Cmd+S 快速保存（确认框打开时忽略，避免穿透误提交）
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    if (confirmModal.isOpen && confirmModal.isOpen()) return;
    e.preventDefault();
    const btn = $('btnSave');
    if (btn && !btn.disabled) {
      $('form').dispatchEvent(new Event('submit', { cancelable: true }));
    }
  }
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
  const topoStrip = $('networkTopology');
  if (topoStrip) topoStrip.classList.add('authenticating');

  chrome.runtime.sendMessage({ type: 'login' }, (res) => {
    btn.disabled = false;
    const topo = $('networkTopology');
    if (topo) topo.classList.remove('authenticating');
    if (chrome.runtime.lastError || !res) {
      showToast('后台未响应', 'err');
      return;
    }
    if (res.online) {
      triggerHeroRipple();
      lastOnlineState = true;
    }
    showToast(res.message || '登录请求完成', res.skipped ? 'info' : (res.ok ? 'ok' : 'err'));
    refreshStatus();
  });
});

// --- U7: 输入框内回车仅保存设置，不触发登录连接 ---
['account', 'password'].forEach((id) => {
  const el = $(id);
  if (el) {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearFieldError('account');
        clearFieldError('password');
        save((ok) => {
          if (ok) showToast('设置已自动保存', 'ok');
        });
      }
    });
  }
});

// --- 点击本机 IP 卡片快速单项复制 (Component: createCopyTrigger) ---
createCopyTrigger({
  triggerEl: $('cardStatIp'),
  badgeEl: $('ipCopyPill'),
  getText: () => {
    const ip = $('stIp')?.textContent?.trim();
    return (ip && ip !== '—' && ip !== '正在获取…' && ip !== '未获取到') ? ip : '';
  },
  onCopied: (ip) => showToast('已复制本机 IP: ' + ip, 'ok'),
  onError: () => showToast('复制失败', 'err')
});

if ($('stIp')) {
  $('stIp').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      $('cardStatIp')?.click();
    }
  });
}

// --- 点击物理 MAC 快捷复制 (Component: createCopyTrigger) ---
createCopyTrigger({
  triggerEl: $('stMac'),
  stopPropagation: true,
  getText: () => {
    const txt = $('stMac')?.textContent || '';
    const match = txt.match(/([0-9a-fA-F:-]{12,17})/);
    return (match && match[1]) ? match[1] : '';
  },
  onCopied: (mac) => showToast('已复制物理 MAC: ' + mac, 'ok'),
  onError: () => showToast('复制失败', 'err')
});

// --- 全链路拓扑节点交互组件 (Component: Interactive Topology Nodes) ---
function bindInteractiveNode(nodeEl, actionFn) {
  if (!nodeEl) return;
  nodeEl.addEventListener('click', actionFn);
  nodeEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      actionFn();
    }
  });
}

bindInteractiveNode($('topoNodeClient'), () => {
  const ip = $('stIp')?.textContent?.trim();
  if (ip && ip !== '—' && ip !== '正在获取…' && ip !== '未获取到') {
    $('cardStatIp')?.click();
  } else {
    refreshStatus(() => showToast('已刷新终端节点状态', 'info'));
  }
});

bindInteractiveNode($('topoNodeGateway'), () => {
  refreshStatus(() => {
    const pingText = $('stPing')?.textContent || '—';
    showToast(`已完成网关探测 · 当前延迟 ${pingText}`, 'info');
  });
});

bindInteractiveNode($('topoNodeInternet'), () => {
  if ($('statusWidget')?.classList.contains('hero-on')) {
    refreshStatus(() => showToast('外网链路畅通 · 状态已同步', 'ok'));
  } else {
    $('btnLoginNow')?.click();
  }
});

// --- 巡检事件流抽屉操作：复制脱敏诊断报告 & 清空日志 ---
$('btnCopyDiagnostic')?.addEventListener('click', () => {
  chrome.storage.local.get(['eventLogs'], (s) => {
    const safeLogs = (!chrome.runtime.lastError && s && Array.isArray(s.eventLogs)) ? s.eventLogs : [];
    const reportText = generateDiagnosticSnapshot({
      account: $('account')?.value?.trim() || '',
      isp: $('isp')?.value || '1',
      ip: $('stIp')?.textContent || '',
      mac: $('stMac')?.textContent || '',
      statusText: $('stOnline')?.textContent || '',
      healthText: $('heroHealthScore')?.textContent || '',
      pingText: $('stPing')?.textContent || '',
      flowText: `${$('stFlow')?.textContent || '—'} (${$('stFlowDetail')?.textContent || '—'})`,
      policyText: $('stPolicyPill')?.textContent || '',
      eventLogs: safeLogs
    });

    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      showToast('复制诊断报告失败：剪贴板不可用', 'err');
      return;
    }
    navigator.clipboard.writeText(reportText).then(() => {
      showToast('已复制脱敏诊断报告到剪贴板', 'ok');
    }).catch(() => {
      showToast('复制诊断报告失败', 'err');
    });
  });
});

$('btnClearLogs')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clearLogs' }, () => {
    void chrome.runtime.lastError;
    activityTimeline.render([]);
    showToast('已清空历史事件流记录', 'info');
  });
});

// --- 恢复默认设置 (Component: createConfirmModal) ---
$('btnResetDefaults').addEventListener('click', () => {
  confirmModal.open({
    title: '恢复出厂默认设置？',
    desc: '此操作将清空已保存的校园网账号与密码，并将所有轮询与自动化开关恢复为推荐默认值。',
    confirmText: '确认重置',
    onConfirm: () => {
      // 一并清除全部运行态标记：解除「手动注销暂停」、重置退避计数、
      // 清掉「凭据类错误」标记（否则用户改好密码后点恢复默认，仍会被低频重试挡着）。
      chrome.storage.local.set({
        ...DEFAULTS,
        initialized: true,
        manualLogout: false,
        logoutResidualOnline: false,
        unreachableStreak: 0,
        connState: 'unknown',
        authError: false,
        onlineSince: null
      }, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          showToast('恢复默认设置失败，请重试', 'err');
          return;
        }
        setDirtyState(false);
        load();
        chrome.runtime.sendMessage({ type: 'settingsChanged' }, () => { void chrome.runtime.lastError; });
        showToast('已恢复为默认配置，请重新填写账号密码。', 'ok');
      });
    }
  });
});

// --- 上网账号快速清空按钮 ---
function syncClearBtn() {
  const btn = $('clearAccount');
  const acct = $('account');
  if (btn && acct) {
    btn.classList.toggle('visible', acct.value.trim().length > 0);
  }
}

if ($('account')) {
  $('account').addEventListener('input', syncClearBtn);
  $('account').addEventListener('change', syncClearBtn);
}

if ($('clearAccount')) {
  $('clearAccount').addEventListener('click', () => {
    const acct = $('account');
    if (acct) {
      acct.value = '';
      clearFieldError('account');
      syncClearBtn();
      acct.focus();
      syncDirtyState();
    }
  });
}

// --- 配置一键导出 (JSON 备份) ---
if ($('btnExportConfig')) {
  $('btnExportConfig').addEventListener('click', () => {
    chrome.storage.local.get(null, (all) => {
      if (chrome.runtime.lastError || !all) {
        showToast('导出失败：读取本地配置时出错', 'err');
        return;
      }
      const cfg = {
        _app: 'Campus AutoLogin',
        _version: chrome.runtime?.getManifest?.()?.version || '1.0.0',
        _exported_at: new Date().toLocaleString(),
        account: all.account || '',
        password: all.password || '',
        isp: all.isp || '1',
        intervalMin: all.intervalMin !== undefined ? all.intervalMin : DEFAULTS.intervalMin,
        offlineIntervalMin: all.offlineIntervalMin !== undefined ? all.offlineIntervalMin : DEFAULTS.offlineIntervalMin,
        adaptive: all.adaptive !== false,
        autoOnStartup: all.autoOnStartup !== false,
        contentAutoFill: all.contentAutoFill !== false,
        instantTrigger: all.instantTrigger !== false
      };
      try {
        const jsonStr = JSON.stringify(cfg, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `campus-autologin-config-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('配置已导出为 JSON 备份文件（含明文凭据，请妥善保管）。', 'ok');
      } catch (err) {
        // 导出失败时给明确反馈，避免点了没反应
        showToast('导出失败：' + (err && err.message ? err.message : '未知错误'), 'err');
      }
    });
  });
}

// --- 配置一键导入 (JSON 还原) ---
if ($('btnImportConfig') && $('importFileInput')) {
  $('btnImportConfig').addEventListener('click', () => {
    $('importFileInput').click();
  });

  $('importFileInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const MAX_IMPORT_BYTES = 1024 * 1024;
    if (typeof file.size === 'number' && file.size > MAX_IMPORT_BYTES) {
      showToast('导入失败：配置文件过大（超过 1 MB），请确认选择了正确的 JSON 备份', 'err');
      $('importFileInput').value = '';
      return;
    }

    const reader = new FileReader();
    // 读取阶段的失败只触发 error、不触发 load，onload 里的 try/catch 兜不住。
    // 不处理的话，用户点「导入配置」后会毫无反馈（静默失败）。
    reader.onerror = () => {
      showToast('导入失败：无法读取所选文件（可能已被移动、损坏或没有权限）', 'err');
      $('importFileInput').value = '';
    };
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('无效的 JSON 配置文件（根节点必须为对象）');
        }

        const toSave = {};
        // 账号：手机号在 JSON 里很容易写成裸数字（13800000000 没加引号）。
        // 若只接受 string，用户会"导入成功"但账号没进去 —— 静默丢数据。
        // 这里接受 string 或 finite number 并归一为字符串；其他类型（对象/数组）才算非法。
        if (typeof data.account === 'string' || (typeof data.account === 'number' && Number.isFinite(data.account))) {
          toSave.account = String(data.account).trim();
        }
        if (typeof data.password === 'string' || (typeof data.password === 'number' && Number.isFinite(data.password))) {
          toSave.password = String(data.password);
        }
        // 账号/密码存在但类型非法时明确报错，不要静默忽略
        if (data.account !== undefined && toSave.account === undefined) {
          throw new Error('account 字段格式不对（应为字符串）');
        }
        if (data.password !== undefined && toSave.password === undefined) {
          throw new Error('password 字段格式不对（应为字符串）');
        }
        // isp 只接受四个合法档位。非法值（手改 / 恶意构造的字符串）若流入
        // content.js 会拼进 CSS 选择器直接抛异常，把自动填单整条链路炸断。
        if (data.isp !== undefined) {
          const ispVal = String(data.isp);
          if (['1', '2', '3', '4'].indexOf(ispVal) === -1) {
            throw new Error('isp 只能为 1-4（校园/电信/联通/其他）');
          }
          toSave.isp = ispVal;
        }
        const parseImportedNum = (val, fieldName) => {
          if (typeof val === 'number' && Number.isFinite(val)) return val;
          if (typeof val === 'string' && val.trim() !== '') {
            const n = Number(val);
            if (Number.isFinite(n)) return n;
          }
          throw new Error(`${fieldName} 字段格式不对（应为有限数字）`);
        };
        if (data.intervalMin !== undefined) {
          toSave.intervalMin = snapToPresetValue('intervalMin', parseImportedNum(data.intervalMin, 'intervalMin'));
        }
        if (data.offlineIntervalMin !== undefined) {
          toSave.offlineIntervalMin = snapToPresetValue('offlineIntervalMin', parseImportedNum(data.offlineIntervalMin, 'offlineIntervalMin'));
        }
        if (data.adaptive !== undefined) toSave.adaptive = !!data.adaptive;
        if (data.autoOnStartup !== undefined) toSave.autoOnStartup = !!data.autoOnStartup;
        if (data.contentAutoFill !== undefined) toSave.contentAutoFill = !!data.contentAutoFill;
        if (data.instantTrigger !== undefined) toSave.instantTrigger = !!data.instantTrigger;

        if (Object.keys(toSave).length === 0) {
          throw new Error('未找到可导入的有效配置字段（如 account/password/isp/intervalMin 等）');
        }

        // 导入的是一份「新的」配置：清掉凭据错误标记，让新凭据立刻按正常节奏生效。
        // 否则若之前因密码错而降频，导入正确配置后仍会被低频重试挡着。
        toSave.authError = false;
        toSave.initialized = true;

        chrome.storage.local.set(toSave, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            showToast('导入失败：写入本地配置时出错', 'err');
            return;
          }
          setDirtyState(false);
          load();
          chrome.runtime.sendMessage({ type: 'settingsChanged' }, () => { void chrome.runtime.lastError; });
          showToast('配置已成功导入并生效！', 'ok');
        });
      } catch (err) {
        showToast('导入失败：文件格式错误 (' + err.message + ')', 'err');
      } finally {
        $('importFileInput').value = '';
      }
    };
    reader.readAsText(file, 'utf-8');
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.lastResult) {
    const r = changes.lastResult.newValue;
    const text = (v) => (typeof v === 'string' || typeof v === 'number') ? String(v) : '';
    const t = text(r && r.time);
    const m = normalizeStatusMessage(text(r && r.message));
    if ($('stLast')) {
      $('stLast').textContent = [t, m].filter(Boolean).join(' · ') || '暂无记录';
    }
  }
  if (changes.eventLogs) {
    activityTimeline.render(Array.isArray(changes.eventLogs.newValue) ? changes.eventLogs.newValue : []);
  }
  // popup 的「运营商直选」会直接写 storage.isp。设置页若不跟随，之后任意一次
  // save()（自动保存 / Ctrl+S / 保存并连接）都会用 readForm() 把陈旧的运营商
  // 写回去，静默撤销用户在弹窗里的选择 —— 表现为「明明换了运营商还是报密码错误」。
  // 这里只同步视图，绝不派发 change / 调用 save()，否则会形成跨页回写循环。
  if (changes.isp) {
    const sel = $('isp');
    const raw = String(changes.isp.newValue);
    const next = ['1', '2', '3', '4'].indexOf(raw) !== -1 ? raw : '1';
    if (sel && sel.value !== next) {
      sel.value = next;
      syncCustomSelect('isp');
      syncIspQuickPills();
    }
  }
});

// 输入时即刻清除表单校验失败高亮与错误提示
$('account')?.addEventListener('input', () => clearFieldError('account'));
$('password')?.addEventListener('input', () => clearFieldError('password'));

// --- 即时保存的切换项（局部写盘，避免把未确认的凭据输入连带写入） ---
['autoOnStartup', 'contentAutoFill', 'instantTrigger'].forEach((id) => {
  const el = $(id);
  if (el) {
    el.addEventListener('change', () => {
      savePartialSetting({ [id]: !!el.checked }, (ok) => {
        if (ok) showToast('设置已自动保存。', 'ok');
      });
    });
  }
});

$('adaptive')?.addEventListener('change', () => {
  syncOfflineRow();
  updatePolicySummaryPill();
  savePartialSetting({ adaptive: !!$('adaptive').checked }, (ok) => {
    if (!ok) return;
    showToast($('adaptive').checked
      ? `已启用自适应重连加速（掉线重试：${fmt($('offlineIntervalMin').value)}）`
      : '已关闭自适应加速，统一使用常规间隔。', 'ok');
  });
});

// --- 下拉框与运营商改动即时保存 ---
['intervalMin', 'offlineIntervalMin'].forEach((id) => {
  const el = $(id);
  if (el) {
    el.addEventListener('change', () => {
      const parsed = parseFloat(el.value);
      const val = Number.isFinite(parsed) ? parsed : DEFAULTS[id];
      updatePolicySummaryPill();
      savePartialSetting({ [id]: val }, (ok) => {
        if (ok) showToast('参数已自动保存并生效。', 'ok');
      });
    });
  }
});

$('isp')?.addEventListener('change', () => {
  syncIspQuickPills();
  // 切换运营商后与弹窗保持一致，清除凭据降频标记以恢复正常重试节奏
  savePartialSetting({ isp: $('isp').value, authError: false }, (ok) => {
    if (ok) showToast('运营商已保存并生效。', 'ok');
  });
});

// --- 启动初始化 ---
initSidebarNavigation();
initCustomSelects();
initIspQuickPills();
initHoverTooltips();
load();

// 适配 macOS / Windows 键盘快捷键指示徽章
if (/Mac/i.test(navigator.platform || navigator.userAgent)) {
  const kbdPill = document.querySelector('.kbd-pill');
  if (kbdPill) {
    kbdPill.textContent = '⌘S';
    setTooltip(kbdPill, '快捷键 ⌘S 保存');
  }
}

// --- 智能前台状态轮询组件 (Component: createVisibilityPoller) ---
const statusPoller = createVisibilityPoller(refreshStatus, 15000);

// --- 个性化强调色切换选择器 (Component: createAccentPicker) ---
const accentPicker = createAccentPicker({
  barId: 'accentPaletteBar',
  onNotify: (msg) => showToast(msg, 'ok')
});

window.addEventListener('pagehide', () => {
  if (statusSpinTimer) {
    clearTimeout(statusSpinTimer);
    statusSpinTimer = null;
  }
  if (heroRippleRaf && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(heroRippleRaf);
    heroRippleRaf = 0;
  }
  if (sidebarResizeRaf && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(sidebarResizeRaf);
    sidebarResizeRaf = 0;
  }
  durationTicker.stop();
  logoutConfirmBtn.reset();
  passwordToggle.rehide();
  if (activityTimeline && activityTimeline.destroy) activityTimeline.destroy();
  if (privacyMask && privacyMask.destroy) privacyMask.destroy();
  if (statusPoller && statusPoller.destroy) statusPoller.destroy();
});


