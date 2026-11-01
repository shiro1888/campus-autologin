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

/** 顶部浮动消息通知 (支持多条轻量级堆叠与独立自动隐退) */
function showToast(text, kind = 'info', duration = 4000) {
  const container = $('toastContainer') || $('toastBar')?.parentElement;
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-bar show ${kind}`;

  const iconSpan = document.createElement('span');
  iconSpan.className = 'toast-icon';
  if (kind === 'ok') {
    iconSpan.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  } else if (kind === 'err') {
    iconSpan.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  } else {
    iconSpan.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  }

  const msgSpan = document.createElement('span');
  msgSpan.className = 'toast-msg';
  msgSpan.textContent = text;

  toast.appendChild(iconSpan);
  toast.appendChild(msgSpan);

  // 点击悬浮 Toast 胶囊即可立即快速关闭
  toast.addEventListener('click', () => {
    dismissToast(toast);
  });

  // 最多保持 3 条并存，超出时自动顶替最早的一条
  const activeToasts = container.querySelectorAll('.toast-bar.show');
  if (activeToasts.length >= 3) {
    dismissToast(activeToasts[0]);
  }

  container.appendChild(toast);

  // 自动倒计时退出
  toast._timer = setTimeout(() => {
    dismissToast(toast);
  }, duration);

  // 保持对静态 DOM 元素的向后兼容
  const staticMsg = $('toastMsg');
  if (staticMsg) staticMsg.textContent = text;
}

function dismissToast(toast) {
  if (!toast || toast._dismissing) return;
  toast._dismissing = true;
  if (toast._timer) clearTimeout(toast._timer);
  toast.classList.remove('show');
  toast.classList.add('hide');

  let finished = false;
  const onEnd = () => {
    if (finished) return;
    finished = true;
    toast.removeEventListener('transitionend', onEnd);
    if (toast.id !== 'toastBar') {
      toast.remove();
    } else {
      toast.classList.remove('hide');
      toast._dismissing = false;
    }
  };

  toast.addEventListener('transitionend', onEnd, { once: true });
  setTimeout(onEnd, 300);
}

// 点击默认静态 Toast 胶囊立即关闭
$('toastBar')?.addEventListener('click', () => {
  dismissToast($('toastBar'));
});

/** 自习室防窥遮罩管理 */
let isMasked = false;

function updateAccountMaskDisplay() {
  const accInput = $('account');
  const maskBtn = $('btnToggleMask');
  const maskIcon = $('maskIcon');
  if (!accInput) return;

  if (isMasked) {
    accInput.classList.add('account-masked');
    if (maskBtn) {
      maskBtn.classList.add('active');
      maskBtn.title = '当前：自习室防窥（点击显示明文）';
      maskBtn.setAttribute('aria-label', '当前：自习室防窥（点击显示明文）');
    }
    if (maskIcon) {
      maskIcon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
    }
  } else {
    accInput.classList.remove('account-masked');
    if (maskBtn) {
      maskBtn.classList.remove('active');
      maskBtn.title = '当前：明文显示（点击开启自习室防窥）';
      maskBtn.setAttribute('aria-label', '当前：明文显示（点击开启自习室防窥）');
    }
    if (maskIcon) {
      maskIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
  }
}

/** 动态在线计时器 (秒表实时跳动) */
const durationTicker = createTicker((text) => {
  $('stTime').textContent = text;
});

const renderOptPingSparkline = createSparkline('optPingSparkline', 5);


/** 动态更新网络全链路拓扑指示器 */
function updateTopology(res) {
  const clientIp = $('topoClientIp');
  if (!clientIp) return;
  const pingVal = $('topoPingVal');
  const pingChip = $('topoPingChip');
  const authVal = $('topoAuthVal');
  const authChip = $('topoAuthChip');
  const internetVal = $('topoInternetVal');
  const linkPing = $('topoLinkPing');
  const linkAuth = $('topoLinkAuth');

  if (!res) {
    clientIp.textContent = '未获取到';
    if (pingVal) pingVal.textContent = '离线';
    if (pingChip) pingChip.className = 'topo-chip-badge off';
    if (authVal) authVal.textContent = '未连接';
    if (authChip) authChip.className = 'topo-chip-badge off';
    if (internetVal) internetVal.textContent = '无网络';
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
    if (linkAuth) linkAuth.className = 'topo-link off';
  } else if (res.online) {
    if (authVal) authVal.textContent = '已认证 ✓';
    if (authChip) authChip.className = 'topo-chip-badge on';
    if (internetVal) internetVal.textContent = '认证放行 ✓';
    if (linkAuth) linkAuth.className = 'topo-link on';
  } else {
    if (authVal) authVal.textContent = res.manualLogout ? '已暂停' : '待认证';
    if (authChip) authChip.className = 'topo-chip-badge wait';
    if (internetVal) internetVal.textContent = '局域网受限';
    if (linkAuth) linkAuth.className = 'topo-link wait';
  }
}



/** 主题切换管理 */
let currentThemePref = 'auto';

function applyTheme(theme) {
  currentThemePref = theme || 'auto';
  const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effectiveTheme = currentThemePref === 'auto' ? (sysDark ? 'dark' : 'light') : currentThemePref;
  document.documentElement.setAttribute('data-theme', effectiveTheme);
  const label = $('themeLabel');
  if (label) {
    label.textContent = currentThemePref === 'dark' ? '深色' : (currentThemePref === 'light' ? '浅色' : '自动');
  }
}

function initTheme() {
  chrome.storage.local.get({ theme: 'auto' }, (s) => {
    applyTheme(s.theme || 'auto');
  });

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentThemePref === 'auto') {
        applyTheme('auto');
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.theme) {
      applyTheme(changes.theme.newValue);
    }
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



/** HTML 特殊字符转义 */
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

/** 格式化下拉选项展示内容（提取括号内的提示并转为美观微型徽章） */
function formatOptionContent(text) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^(.*?)[（\(](.*?)[）\)]$/);
  if (!match) {
    return `<span class="opt-label">${escapeHtml(trimmed)}</span>`;
  }
  const main = match[1].trim();
  const sub = match[2].trim();
  let badgeClass = 'opt-badge';
  if (sub.includes('推荐') || sub.includes('最快') || sub.includes('最灵敏')) {
    badgeClass += ' primary';
  } else if (sub.startsWith('@')) {
    badgeClass += ' mono';
  }
  return `<div class="opt-body"><span class="opt-label">${escapeHtml(main)}</span><span class="${badgeClass}">${escapeHtml(sub)}</span></div>`;
}

/** 同步自定义下拉选框显示状态 */
function syncCustomSelect(target) {
  const el = typeof target === 'string' ? $(target) : target;
  if (el && typeof el._syncCustomSelect === 'function') {
    el._syncCustomSelect();
  }
}

/** 关闭页面所有开启的自定义下拉选框 */
function closeAllCustomSelects() {
  document.querySelectorAll('.select-wrap.open').forEach((w) => {
    w.classList.remove('open');
    const t = w.querySelector('.custom-select-trigger');
    if (t) t.setAttribute('aria-expanded', 'false');
    const card = w.closest('.card');
    if (card) card.style.zIndex = '';
    const field = w.closest('.field');
    if (field) field.style.zIndex = '';
  });
}

/** 初始化现代美化下拉选框组件 */
function initCustomSelects() {
  const wraps = document.querySelectorAll('.select-wrap');
  wraps.forEach((wrap) => {
    const select = wrap.querySelector('select');
    if (!select || wrap.dataset.customized === 'true') return;
    wrap.dataset.customized = 'true';

    // 隐藏原生 select（保持可访问性与表单兼容）
    select.classList.add('custom-select-hidden');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    // 移除原有静态小箭头
    const oldArrow = wrap.querySelector('.select-arrow');
    if (oldArrow) oldArrow.remove();

    const menuId = 'menu-' + (select.id || 'select-' + Math.floor(Math.random() * 10000));

    // 创建触发按钮
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', menuId);

    const labelWrap = document.createElement('div');
    labelWrap.className = 'custom-select-label';

    const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrowSvg.setAttribute('class', 'custom-select-arrow');
    arrowSvg.setAttribute('viewBox', '0 0 24 24');
    arrowSvg.setAttribute('fill', 'none');
    arrowSvg.setAttribute('stroke', 'currentColor');
    arrowSvg.setAttribute('stroke-width', '2');
    arrowSvg.innerHTML = '<polyline points="6 9 12 15 18 9"/>';

    trigger.appendChild(labelWrap);
    trigger.appendChild(arrowSvg);
    wrap.appendChild(trigger);

    // 创建浮层菜单
    const menu = document.createElement('div');
    menu.id = menuId;
    menu.className = 'custom-select-menu';
    menu.setAttribute('role', 'listbox');

    // 生成选项
    Array.from(select.options).forEach((opt, idx) => {
      const item = document.createElement('div');
      item.id = `${menuId}-opt-${idx}`;
      item.className = 'custom-select-option' + (idx === select.selectedIndex ? ' active' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('data-value', opt.value);
      item.setAttribute('data-index', String(idx));
      item.setAttribute('aria-selected', idx === select.selectedIndex ? 'true' : 'false');

      item.innerHTML = formatOptionContent(opt.textContent) +
        '<svg class="custom-select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        selectOption(idx);
        closeMenu();
        trigger.focus();
      });

      menu.appendChild(item);
    });

    wrap.appendChild(menu);

    function selectOption(index) {
      if (select.selectedIndex !== index) {
        select.selectedIndex = index;
        syncUI();
        select.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        syncUI();
      }
    }

    function syncUI() {
      const curOpt = select.options[select.selectedIndex];
      if (curOpt) {
        labelWrap.innerHTML = formatOptionContent(curOpt.textContent);
      }
      trigger.setAttribute('aria-activedescendant', `${menuId}-opt-${select.selectedIndex}`);
      const allItems = menu.querySelectorAll('.custom-select-option');
      allItems.forEach((it, idx) => {
        const isMatch = idx === select.selectedIndex;
        it.classList.toggle('active', isMatch);
        it.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });

      if (wrap.classList.contains('open')) {
        const activeItem = menu.querySelector('.custom-select-option.active');
        if (activeItem) {
          activeItem.scrollIntoView({ block: 'nearest' });
        }
      }
    }

    // 挂载到 select 元素对象便于外界调用
    select._syncCustomSelect = syncUI;
    select.addEventListener('change', syncUI);
    syncUI();

    function openMenu() {
      closeAllCustomSelects();

      // 检测视口下方空间，不足时向上弹出
      const rect = trigger.getBoundingClientRect();
      const menuHeight = 240;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
        menu.classList.add('placement-top');
      } else {
        menu.classList.remove('placement-top');
      }

      wrap.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');

      const parentCard = wrap.closest('.card');
      if (parentCard) parentCard.style.zIndex = '50';
      const parentField = wrap.closest('.field');
      if (parentField) parentField.style.zIndex = '60';

      const activeItem = menu.querySelector('.custom-select-option.active');
      if (activeItem) {
        activeItem.scrollIntoView({ block: 'nearest' });
      }
    }

    function closeMenu() {
      wrap.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      const parentCard = wrap.closest('.card');
      if (parentCard) parentCard.style.zIndex = '';
      const parentField = wrap.closest('.field');
      if (parentField) parentField.style.zIndex = '';
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (wrap.classList.contains('open')) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    // 键盘支持
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!wrap.classList.contains('open')) {
          openMenu();
        } else {
          let curIdx = select.selectedIndex;
          if (e.key === 'ArrowDown') {
            curIdx = Math.min(select.options.length - 1, curIdx + 1);
          } else if (e.key === 'ArrowUp') {
            curIdx = Math.max(0, curIdx - 1);
          } else if (e.key === 'Enter' || e.key === ' ') {
            closeMenu();
            return;
          }
          selectOption(curIdx);
        }
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        closeMenu();
      }
    });

    // 点击 label 自动聚焦并切换打开
    if (select.id) {
      const label = document.querySelector(`label[for="${select.id}"]`);
      if (label) {
        label.addEventListener('click', (e) => {
          e.preventDefault();
          // 必须阻止冒泡：label 是 .select-wrap 的兄弟节点（不在其内部），
          // 事件冒泡到 document 时会被「点击空白处关闭」的监听器判定为外部点击，
          // 于是刚打开的下拉框立刻又被关掉 —— 表现为点 label 完全没反应。
          e.stopPropagation();
          trigger.focus();
          trigger.click();
        });
      }
    }
  });
}

// 点击空白区域自动关闭
document.addEventListener('click', (e) => {
  if (!e.target.closest('.select-wrap')) {
    closeAllCustomSelects();
  }
});

// ESC 键收起
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllCustomSelects();
  }
});

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

  chrome.storage.local.get(Object.assign({}, DEFAULTS, { privacyMask: false }), (s) => {
    isMasked = !!s.privacyMask;
    updateAccountMaskDisplay();
    // 只接受字符串：storage 里的值可能被手改或来自旧版本。
    // 注意不能只用 String() —— String({}) 会得到字面量 "[object Object]"，照样显示难看。
    // 非字符串一律当作空值处理（下面 isp 也用同样的思路）。
    $('account').value = typeof s.account === 'string' ? s.account : '';
    syncClearBtn();
    $('password').value = typeof s.password === 'string' ? s.password : '';
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
  });
}

function initIspQuickPills() {
  const wrap = $('ispQuickPills');
  const sel = $('isp');
  if (!wrap || !sel) return;
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.isp-pill');
    if (!btn) return;
    const ispVal = btn.getAttribute('data-isp');
    if (ispVal && sel.value !== ispVal) {
      sel.value = ispVal;
      syncCustomSelect('isp');
      syncIspQuickPills();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
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

/** 自适应关闭时，置灰「掉线重连间隔」（保持双列布局对称不坍塌） */
function syncOfflineRow() {
  const row = $('offlineRow');
  if (!row) return;
  if ($('adaptive').checked) {
    row.classList.remove('is-disabled');
    row.style.display = '';
  } else {
    row.classList.add('is-disabled');
    row.style.display = '';
  }
}

/** 刷新顶部诊断卡片状态 */
function refreshStatus(cb) {
  const checkBtn = $('btnCheckStatus');
  const spinStart = Date.now();
  if (checkBtn) checkBtn.classList.add('spinning');

  const stopSpin = () => {
    if (!checkBtn) return;
    const elapsed = Date.now() - spinStart;
    const minSpinMs = 600;
    const remaining = Math.max(0, minSpinMs - elapsed);
    setTimeout(() => {
      checkBtn.classList.remove('spinning');
    }, remaining);
  };

  chrome.storage.local.get(['lastResult'], (s) => {
    const r = s && s.lastResult;
    // 逐字段兜底：lastResult 可能来自旧版本或手改，缺字段时直接相加会显示成
    // 「12345 · undefined」；而对象经 String() 会变成 "[object Object]"，同样难看。
    // 故只接受字符串/数字（时间是 "HH:MM:SS" 字符串，也可能是时间戳）。
    const text = (v) => (typeof v === 'string' || typeof v === 'number') ? String(v) : '';
    const t = text(r && r.time);
    const m = text(r && r.message);
    $('stLast').textContent = [t, m].filter(Boolean).join(' · ') || '暂无记录';
  });

  chrome.runtime.sendMessage({ type: 'status' }, (res) => {
    stopSpin();

    const pill = $('stPill');
    const textEl = $('stOnline');
    const heroEl = $('statusWidget');
    const logoAv = $('logoBeacon');
    const portalDot = $('portalDot');

    if (chrome.runtime.lastError || !res) {
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
      $('stTime').textContent = '—';
      $('stMac').textContent = '物理 MAC: —';
      $('stPing').textContent = '—';
      renderOptPingSparkline(-1);
      $('stFlow').textContent = '—';
      $('stFee').textContent = '流量明细: —';
      $('stStime').textContent = '上线时间: —';
      $('btnLogoutNow').disabled = true;
      $('btnLogoutNow').classList.remove('confirming');
      updateTopology(null);
      if (cb) cb();
      return;
    }

    const raw = res.raw || {};
    const ip = [raw.v4ip, raw.ss5].find((v) => v && v !== '0.0.0.0') || '';
    $('stIp').textContent = ip || '未获取到';
    $('stMac').textContent = raw.ss1 ? ('物理 MAC: ' + fmtMac(raw.ss1)) : '物理 MAC: —';

    if (res.online) {
      let durationInput = null;
      let stimeDisplay = '上线时间: —';

      const now = Date.now();
      const localSince = res.onlineSince ? Number(res.onlineSince) : null;

      if (localSince && Number.isFinite(localSince) && localSince <= now) {
        durationInput = localSince;
        stimeDisplay = '本次连通: ' + new Date(localSince).toLocaleTimeString();
      } else if (raw.stime) {
        const stimeDate = new Date(String(raw.stime).replace(/-/g, '/'));
        const stimeMs = stimeDate.getTime();
        const isStimeValid = Number.isFinite(stimeMs) && !isNaN(stimeMs);
        const isSameDay = isStimeValid && new Date().toDateString() === stimeDate.toDateString();

        const MAX_SESSION_SEC = 90 * 86400; // 90 天合理上限（过滤 4294967295 / 0xFFFFFFFF 哨兵值）
        const parseSec = (v) => {
          const n = parseInt(v, 10);
          return (Number.isFinite(n) && n > 0 && n < MAX_SESSION_SEC) ? n : 0;
        };
        const validSec = parseSec(raw.actt) || parseSec(raw.oltime);

        if (validSec) {
          durationInput = validSec;
          stimeDisplay = `活跃在线: ${fmtDuration(validSec)}`;
        } else if (isSameDay) {
          durationInput = raw.stime;
          stimeDisplay = '上线时间: ' + raw.stime;
        } else if (isStimeValid && (now - stimeMs) > 16 * 3600 * 1000) {
          durationInput = Date.now();
          stimeDisplay = '本次在线中';
        } else if (isStimeValid) {
          durationInput = raw.stime;
          stimeDisplay = '上线时间: ' + raw.stime;
        }
      } else if (raw.actt && parseInt(raw.actt, 10) > 0 && parseInt(raw.actt, 10) < 90 * 86400) {
        durationInput = parseInt(raw.actt, 10);
        stimeDisplay = '网关活跃在线计时';
      } else if (raw.oltime && parseInt(raw.oltime, 10) > 0 && parseInt(raw.oltime, 10) < 90 * 86400) {
        durationInput = parseInt(raw.oltime, 10);
        stimeDisplay = '网关在线计时';
      }

      if (durationInput != null) {
        durationTicker.start(durationInput);
        $('stStime').textContent = stimeDisplay;
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
    if (res.pingMs !== undefined && res.pingMs >= 0) {
      pingEl.textContent = res.pingMs + ' ms';
      if (badgeEl) {
        if (res.pingMs <= 50) {
          badgeEl.className = 'latency-badge fast';
          badgeEl.textContent = '极佳';
        } else if (res.pingMs <= 150) {
          badgeEl.className = 'latency-badge normal';
          badgeEl.textContent = '良好';
        } else {
          badgeEl.className = 'latency-badge slow';
          badgeEl.textContent = '较高';
        }
      }
      renderOptPingSparkline(res.pingMs);
    } else {
      pingEl.textContent = res.reachable ? '< 10 ms' : '超时';
      if (badgeEl) {
        badgeEl.className = res.reachable ? 'latency-badge fast' : 'latency-badge slow';
        badgeEl.textContent = res.reachable ? '连通' : '超时';
      }
      renderOptPingSparkline(res.reachable ? 8 : -1);
    }

    // Flow & Fee (下行 / 上行 / 总计 / 余额)
    const optFlowWrap = $('optFlowBarWrap');
    const optFlowDl = $('optFlowBarDl');
    const optFlowUl = $('optFlowBarUl');
    if (raw.flow !== undefined) {
      $('stFlow').textContent = fmtFlow(raw.flow);
      const dl = parseFloat(raw.actdf) || 0;
      const ul = parseFloat(raw.actuf) || 0;
      const total = dl + ul;
      if (total > 0 && optFlowDl && optFlowUl && optFlowWrap) {
        const dlPct = Math.max(6, Math.min(94, Math.round((dl / total) * 100)));
        const ulPct = 100 - dlPct;
        optFlowDl.style.width = dlPct + '%';
        optFlowUl.style.width = ulPct + '%';
        optFlowWrap.style.display = 'flex';
        optFlowWrap.title = `下载 ${dlPct}% (${fmtFlow(dl)}) · 上传 ${ulPct}% (${fmtFlow(ul)})`;
      } else if (optFlowWrap) {
        optFlowWrap.style.display = 'none';
      }
      const sub = [];
      if (raw.actdf !== undefined && raw.actuf !== undefined) {
        sub.push(`↓ ${fmtFlow(raw.actdf)} · ↑ ${fmtFlow(raw.actuf)}`);
      }
      $('stFee').textContent = sub.length ? sub.join(' · ') : '校园网流量统计';
    } else {
      $('stFlow').textContent = res.online ? '计量中' : '—';
      $('stFee').textContent = '流量明细: —';
      if (optFlowWrap) optFlowWrap.style.display = 'none';
    }

    if (!res.reachable) {
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
      pill.className = 'status-pill on';
      if (heroEl) {
        heroEl.classList.remove('hero-off', 'hero-wait');
        heroEl.classList.add('hero-on');
      }
      if (logoAv) logoAv.className = 'logo-beacon on';
      if (portalDot) portalDot.className = 'portal-dot on';
      textEl.textContent = '已在线 ✓';
    } else {
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
      if (!res.online) logoutBtn.classList.remove('confirming');
    }

    updateTopology(res);
    triggerTelemetryFade();
    if (cb) cb();
  });
}

/** 遥测数据刷新时的平滑微动效 */
function triggerTelemetryFade() {
  const vals = document.querySelectorAll('.stat-val, .topo-val');
  vals.forEach((el) => {
    el.classList.remove('val-pulse');
    void el.offsetWidth;
    el.classList.add('val-pulse');
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
    intervalMin: Number.isFinite(interval) ? interval : DEFAULTS.intervalMin,
    offlineIntervalMin: Number.isFinite(offline) ? offline : DEFAULTS.offlineIntervalMin,
    adaptive: $('adaptive').checked,
    autoOnStartup: $('autoOnStartup').checked,
    contentAutoFill: $('contentAutoFill').checked,
    instantTrigger: $('instantTrigger').checked,
    initialized: true
  };
}

/**
 * 保存当前表单到 chrome.storage 并通知后台刷新定时器。
 *
 * 注意：这里**不校验**账号密码。开关类与间隔类设置（自适应、开机自启、
 * 轮询间隔、运营商等）本身就是合法的，与是否填写凭据无关；在此拦截会导致
 * 全新安装（凭据默认为空）的用户无论怎么点都存不上，而且调用方还会弹出
 * 「已自动保存」的成功提示，属于静默失败。凭据校验只放在「立即测试」那一步。
 */
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

function save(cb) {
  chrome.storage.local.set(readForm(), () => {
    setDirtyState(false);
    updatePolicySummaryPill();
    syncIspQuickPills();
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

// --- 监听表单变更，实时提示未保存状态 ---
['input', 'change'].forEach((evt) => {
  $('form').addEventListener(evt, () => setDirtyState(true));
});

// --- 保存并连接 ---
$('form').addEventListener('submit', (e) => {
  e.preventDefault();

  // 只有「测试登录」才需要凭据；非凭据设置先保存下来（U6）
  if (!hasCredentials()) {
    save(() => {
      showToast('设置已保存（提示：账号或密码为空，未发起登录连接）。', 'warn');
    });
    const s = readForm();
    if (!s.account) {
      const acc = $('account');
      acc.classList.add('field-invalid');
      acc.setAttribute('aria-invalid', 'true');
      acc.setAttribute('aria-describedby', 'accountError');
      const errEl = $('accountError');
      if (errEl) errEl.textContent = '上网账号不能为空，请填写手机号或学号';
      acc.focus();
    } else if (!s.password) {
      const pwd = $('password');
      pwd.classList.add('field-invalid');
      pwd.setAttribute('aria-invalid', 'true');
      pwd.setAttribute('aria-describedby', 'passwordError');
      const errEl = $('passwordError');
      if (errEl) errEl.textContent = '认证密码不能为空，请填写校园网密码';
      pwd.focus();
    }
    return;
  }

  const btn = $('btnSave');
  btn.disabled = true;
  btn.classList.add('loading');
  $('btnSaveText').textContent = '正在保存并连接…';
  showToast('正在向校园网门户发起验证…', 'info');

  save(() => {
    chrome.runtime.sendMessage({ type: 'login' }, (res) => {
      btn.disabled = false;
      btn.classList.remove('loading');
      $('btnSaveText').textContent = '保存并连接';

      if (chrome.runtime.lastError || !res) {
        showToast('保存成功，但后台未响应测试请求', 'err');
        return;
      }

      showToast(res.message || '配置已生效', res.skipped ? 'info' : (res.ok ? 'ok' : 'err'));
      refreshStatus();
    });
  });
});

// 全局快捷键 Ctrl+S / Cmd+S 快速保存
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
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

  chrome.runtime.sendMessage({ type: 'login' }, (res) => {
    btn.disabled = false;
    if (chrome.runtime.lastError || !res) {
      showToast('后台未响应', 'err');
      return;
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
        save(() => {
          showToast('设置已自动保存', 'ok');
        });
      }
    });
  }
});

// --- 点击本机 IP 卡片快速单项复制 ---
const cardStatIp = $('cardStatIp');
if (cardStatIp) {
  cardStatIp.addEventListener('click', (e) => {
    const pill = $('ipCopyPill');
    if (pill && pill.classList.contains('copied')) return;
    const ip = $('stIp').textContent.trim();
    if (ip && ip !== '—' && ip !== '正在获取…' && ip !== '未获取到') {
      navigator.clipboard.writeText(ip).then(() => {
        showToast('已复制本机 IP: ' + ip, 'ok');
        if (pill) {
          pill.textContent = '已复制 ✓';
          pill.classList.add('copied');
          setTimeout(() => {
            pill.textContent = '点击复制';
            pill.classList.remove('copied');
          }, 1500);
        }
      }).catch(() => {
        showToast('复制失败', 'err');
      });
    }
  });
  cardStatIp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      cardStatIp.click();
    }
  });
}

// --- 点击物理 MAC 快捷复制 ---
const stMac = $('stMac');
if (stMac) {
  stMac.addEventListener('click', (e) => {
    e.stopPropagation();
    const txt = stMac.textContent;
    const match = txt.match(/([0-9a-fA-F:-]{12,17})/);
    if (match && match[1]) {
      navigator.clipboard.writeText(match[1]).then(() => {
        showToast('已复制物理 MAC: ' + match[1], 'ok');
      }).catch(() => {
        showToast('复制失败', 'err');
      });
    }
  });
  stMac.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      stMac.click();
    }
  });
}

// --- 顶部快捷：注销下线 (防误触二次确认) ---
let optLogoutTimer = null;
$('btnLogoutNow').addEventListener('click', () => {
  const btn = $('btnLogoutNow');
  if (btn.disabled) return;
  const span = btn.querySelector('span');

  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    if (span) span.textContent = '确认注销？';
    showToast('再次点击「确认注销」即可断开校园网连接', 'info');
    optLogoutTimer = setTimeout(() => {
      btn.classList.remove('confirming');
      if (span) span.textContent = '注销下线';
    }, 3500);
    return;
  }

  // 确认注销
  clearTimeout(optLogoutTimer);
  btn.classList.remove('confirming');
  if (span) span.textContent = '注销下线';
  btn.disabled = true;
  showToast('正在请求注销下线…', 'info');

  chrome.runtime.sendMessage({ type: 'logout' }, (res) => {
    btn.disabled = false;
    if (chrome.runtime.lastError || !res) {
      showToast('注销超时，请到门户手动注销', 'err');
      return;
    }
    showToast(res.message || '注销完成', res.skipped ? 'info' : (res.ok ? 'ok' : 'err'));
    refreshStatus();
  });
});

// --- 恢复默认设置 ---
$('btnResetDefaults').addEventListener('click', () => {
  if (!confirm('确定要将所有设置恢复为默认值吗？\n（账号和密码会被清空，需要你重新填写）')) {
    return;
  }
  // 一并清除全部运行态标记：解除「手动注销暂停」、重置退避计数、
  // 清掉「凭据类错误」标记（否则用户改好密码后点恢复默认，仍会被低频重试挡着）。
  chrome.storage.local.set({
    ...DEFAULTS,
    manualLogout: false,
    unreachableStreak: 0,
    connState: 'unknown',
    authError: false
  }, () => {
    $('btnSave').classList.remove('has-changes');
    load();
    chrome.runtime.sendMessage({ type: 'settingsChanged' });
    showToast('已恢复为默认配置，请重新填写账号密码。', 'ok');
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
      syncClearBtn();
      acct.focus();
      $('btnSave').classList.add('has-changes');
    }
  });
}

// --- 配置一键导出 (JSON 备份) ---
if ($('btnExportConfig')) {
  $('btnExportConfig').addEventListener('click', () => {
    chrome.storage.local.get(null, (all) => {
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
        if (!data || typeof data !== 'object') {
          throw new Error('无效的 JSON 配置文件');
        }

        const toSave = {};
        // 账号：手机号在 JSON 里很容易写成裸数字（13800000000 没加引号）。
        // 若只接受 string，用户会"导入成功"但账号没进去 —— 静默丢数据。
        // 这里接受 string 或 number 并归一为字符串；其他类型（对象/数组）才算非法。
        if (typeof data.account === 'string' || typeof data.account === 'number') {
          toSave.account = String(data.account).trim();
        }
        if (typeof data.password === 'string' || typeof data.password === 'number') {
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
        if (data.intervalMin !== undefined) {
          const v = parseFloat(data.intervalMin);
          if (Number.isFinite(v)) toSave.intervalMin = snapToPresetValue('intervalMin', v);
        }
        if (data.offlineIntervalMin !== undefined) {
          const v = parseFloat(data.offlineIntervalMin);
          if (Number.isFinite(v)) toSave.offlineIntervalMin = snapToPresetValue('offlineIntervalMin', v);
        }
        if (data.adaptive !== undefined) toSave.adaptive = !!data.adaptive;
        if (data.autoOnStartup !== undefined) toSave.autoOnStartup = !!data.autoOnStartup;
        if (data.contentAutoFill !== undefined) toSave.contentAutoFill = !!data.contentAutoFill;
        if (data.instantTrigger !== undefined) toSave.instantTrigger = !!data.instantTrigger;

        // 导入的是一份「新的」配置：清掉凭据错误标记，让新凭据立刻按正常节奏生效。
        // 否则若之前因密码错而降频，导入正确配置后仍会被低频重试挡着。
        toSave.authError = false;

        chrome.storage.local.set(toSave, () => {
          load();
          chrome.runtime.sendMessage({ type: 'settingsChanged' });
          showToast('配置已成功导入并生效！', 'ok');
          $('btnSave').classList.remove('has-changes');
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

// --- 显示/隐藏密码（带 10 秒无操作自动回隐，防止公共自习室遗忘暴露）---
let pwdRehideTimer = null;
$('togglePwd')?.addEventListener('click', () => {
  const el = $('password');
  if (!el) return;
  const isPwd = el.type === 'password';
  el.type = isPwd ? 'text' : 'password';

  if (pwdRehideTimer) {
    clearTimeout(pwdRehideTimer);
    pwdRehideTimer = null;
  }

  const eyeIcon = $('eyeIcon');
  if (isPwd) {
    // 隐藏状态图标 (带有斜线)
    if (eyeIcon) {
      eyeIcon.innerHTML = '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>';
    }
    // 10 秒后自动回隐为密文
    pwdRehideTimer = setTimeout(() => {
      if (el.type === 'text') {
        el.type = 'password';
        if (eyeIcon) {
          eyeIcon.innerHTML = '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
        }
      }
      pwdRehideTimer = null;
    }, 10000);
  } else {
    // 正常眼睛图标
    if (eyeIcon) {
      eyeIcon.innerHTML = '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
    }
  }
});

// --- 自习室防窥模式切换 ---
$('btnToggleMask')?.addEventListener('click', (e) => {
  e.preventDefault();
  isMasked = !isMasked;
  chrome.storage.local.set({ privacyMask: isMasked });
  updateAccountMaskDisplay();
  showToast(isMasked ? '已开启自习室防窥模式' : '已恢复明文显示', 'info', 2000);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.privacyMask) {
    isMasked = !!changes.privacyMask.newValue;
    updateAccountMaskDisplay();
  }
});

// 输入时即刻清除表单校验失败高亮与错误提示
$('account')?.addEventListener('input', () => {
  $('account').classList.remove('field-invalid');
  $('account').removeAttribute('aria-invalid');
  $('account').removeAttribute('aria-describedby');
  const err = $('accountError');
  if (err) err.textContent = '';
});
$('password')?.addEventListener('input', () => {
  $('password').classList.remove('field-invalid');
  $('password').removeAttribute('aria-invalid');
  $('password').removeAttribute('aria-describedby');
  const err = $('passwordError');
  if (err) err.textContent = '';
});

// --- 即时保存的切换项 ---
['autoOnStartup', 'contentAutoFill', 'instantTrigger'].forEach((id) => {
  $(id).addEventListener('change', () => {
    save(() => showToast('设置已自动保存。', 'ok'));
  });
});

$('adaptive').addEventListener('change', () => {
  syncOfflineRow();
  updatePolicySummaryPill();
  save(() => {
    showToast($('adaptive').checked
      ? `已启用自适应重连加速（掉线重试：${fmt($('offlineIntervalMin').value)}）`
      : '已关闭自适应加速，统一使用常规间隔。', 'ok');
  });
});

// --- 下拉框改动即时保存 ---
['intervalMin', 'offlineIntervalMin', 'isp'].forEach((id) => {
  $(id).addEventListener('change', () => {
    if (id === 'isp') syncIspQuickPills();
    updatePolicySummaryPill();
    save(() => showToast('参数已自动保存并生效。', 'ok'));
  });
});

// --- 启动初始化 ---
initTheme();
initCustomSelects();
initIspQuickPills();
load();

// 适配 macOS / Windows 键盘快捷键指示徽章
if (/Mac/i.test(navigator.platform || navigator.userAgent)) {
  const kbdPill = document.querySelector('.kbd-pill');
  if (kbdPill) {
    kbdPill.textContent = '⌘S';
    kbdPill.title = '快捷键 ⌘S 保存';
  }
}

// 当偏好设置页面在前台激活时，每 15 秒自动向后台刷新一次网关状态（流量与Ping）
const statusPollTimer = setInterval(() => {
  if (document.visibilityState === 'visible') {
    refreshStatus();
  }
}, 15000);

// 标签页重新切回前台时立即快速刷新
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    refreshStatus();
  }
});

// 页面卸载时清理所有计时器
window.addEventListener('beforeunload', () => {
  clearInterval(statusPollTimer);
  durationTicker.stop();
});

// --- 强调色切换选择器 ---
function setAccentColor(accent) {
  chrome.storage.local.set({ accentColor: accent }, () => {
    applyAccent(accent);
    syncAccentDots(accent);
    showToast(`已应用强调色：${getAccentName(accent)}`, 'ok');
  });
}

function getAccentName(accent) {
  const map = {
    blue: '科技蓝',
    purple: '极光紫',
    emerald: '翡翠绿',
    amber: '落日橙',
    rose: '玫瑰粉'
  };
  return map[accent] || '默认蓝';
}

function syncAccentDots(currentAccent) {
  const dots = document.querySelectorAll('.accent-dot');
  dots.forEach((dot) => {
    if (dot.dataset.accent === currentAccent) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
}

function initAccentColorPicker() {
  initAccent((cur) => syncAccentDots(cur));
  const bar = $('accentPaletteBar');
  if (!bar) return;
  bar.addEventListener('click', (e) => {
    const dot = e.target.closest('.accent-dot');
    if (!dot) return;
    const acc = dot.dataset.accent;
    if (acc) setAccentColor(acc);
  });
}

initAccentColorPicker();


