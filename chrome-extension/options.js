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

/** 页面快捷导航与滚动高亮 (Scroll Spy) */
function initNavigation() {
  const navItems = document.querySelectorAll('.sticky-nav .nav-item');
  const btt = $('btnBackToTop');
  const sectionIds = ['statusWidget', 'cardCredentials', 'cardPolicy', 'cardTriggers', 'cardFaq'];

  let isClickScrolling = false;
  let clickTimer = null;
  let isScrollTicking = false;

  function setActiveNav(targetId) {
    navItems.forEach((item) => {
      item.classList.toggle('active', item.getAttribute('data-target') === targetId);
    });
  }

  function getTargetScrollTop(targetEl, targetId) {
    if (targetId === 'statusWidget') return 0;
    const navBar = document.querySelector('.sticky-nav');
    const navOffset = (navBar ? navBar.offsetHeight : 44) + 26;
    const rect = targetEl.getBoundingClientRect();
    return Math.max(0, Math.round(window.scrollY + rect.top - navOffset));
  }

  function updateActiveNav() {
    if (isClickScrolling) return;

    const scrollY = window.scrollY;
    const viewportHeight = window.innerHeight;
    const docHeight = document.documentElement.scrollHeight;

    // 页面处于顶部区域时，固定高亮首个模块（监控中心）
    if (scrollY < 80) {
      setActiveNav(sectionIds[0]);
      return;
    }

    // 页面滚动至接近底部（距底 70px 内）时，锁定高亮末尾模块（常见问题）
    if (scrollY + viewportHeight >= docHeight - 70) {
      setActiveNav(sectionIds[sectionIds.length - 1]);
      return;
    }

    // 正常区间：从上往下检测，最后一个 top 进入可视区的模块为当前高亮
    const triggerOffset = 110;
    let activeId = sectionIds[0];

    for (const id of sectionIds) {
      const el = $(id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top <= triggerOffset) {
        activeId = id;
      }
    }

    setActiveNav(activeId);
  }

  // 平滑滚动快速跳转
  navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = item.getAttribute('data-target');
      const targetEl = $(targetId);
      if (!targetEl) return;

      // 若目标为 FAQ 折叠栏，点击导航时自动展开
      if (targetId === 'cardFaq' && targetEl.tagName === 'DETAILS') {
        targetEl.open = true;
      }

      // 锁定滚动监听，防止平滑滚动过程中的中间区域抢占高亮
      isClickScrolling = true;
      if (clickTimer) clearTimeout(clickTimer);
      setActiveNav(targetId);

      const targetTop = getTargetScrollTop(targetEl, targetId);
      window.scrollTo({
        top: targetTop,
        behavior: 'smooth'
      });

      clickTimer = setTimeout(() => {
        isClickScrolling = false;
        updateActiveNav();
      }, 800);
    });
  });

  // 现代浏览器 scrollend 事件即时解除点击锁定
  if ('onscrollend' in window) {
    window.addEventListener('scrollend', () => {
      if (isClickScrolling) {
        if (clickTimer) clearTimeout(clickTimer);
        isClickScrolling = false;
        updateActiveNav();
      }
    }, { passive: true });
  }

  // 监听 FAQ 折叠状态变化，展开/折叠时重新校验视口高亮
  const faqEl = $('cardFaq');
  if (faqEl) {
    faqEl.addEventListener('toggle', () => {
      if (!isClickScrolling) updateActiveNav();
    });
  }

  // 滚动与视口尺寸变化监听（节流）
  const onScroll = () => {
    // 处理返回顶部按钮显隐
    if (btt) {
      if (window.scrollY > 180) {
        btt.classList.add('visible');
      } else {
        btt.classList.remove('visible');
      }
    }

    // 更新导航高亮
    if (!isClickScrolling && !isScrollTicking) {
      window.requestAnimationFrame(() => {
        updateActiveNav();
        isScrollTicking = false;
      });
      isScrollTicking = true;
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  // 返回顶部按钮逻辑
  if (btt) {
    btt.addEventListener('click', () => {
      isClickScrolling = true;
      if (clickTimer) clearTimeout(clickTimer);
      setActiveNav(sectionIds[0]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      clickTimer = setTimeout(() => {
        isClickScrolling = false;
        updateActiveNav();
      }, 800);
    });
  }

  // 页面就绪时初始化一次高亮状态
  updateActiveNav();
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

    // 创建触发按钮
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

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
    menu.className = 'custom-select-menu';
    menu.setAttribute('role', 'listbox');

    // 生成选项
    Array.from(select.options).forEach((opt, idx) => {
      const item = document.createElement('div');
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
  try {
    const ver = chrome.runtime.getManifest().version;
    $('ver').textContent = 'v' + (ver || '1.0.0');
  } catch (e) {
    $('ver').textContent = '';
  }

  chrome.storage.local.get(DEFAULTS, (s) => {
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

    pickClosest('intervalMin', s.intervalMin === undefined ? DEFAULTS.intervalMin : s.intervalMin);
    pickClosest('offlineIntervalMin', s.offlineIntervalMin === undefined ? DEFAULTS.offlineIntervalMin : s.offlineIntervalMin);

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

    if (chrome.runtime.lastError || !res) {
      // 与 !reachable 分支保持一致：停掉计时器，否则上一轮在线状态启动的
      // 秒表会继续每秒跳动，把这里的占位符覆盖掉，显示一个无人校验的时长
      durationTicker.stop();
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
    } else {
      pingEl.textContent = res.reachable ? '< 10 ms' : '超时';
      if (badgeEl) {
        badgeEl.className = res.reachable ? 'latency-badge fast' : 'latency-badge slow';
        badgeEl.textContent = res.reachable ? '连通' : '超时';
      }
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
      textEl.textContent = res.manualLogout ? '不在校园网内 · 已暂停' : '不在校园网内';
    } else if (res.online) {
      pill.className = 'status-pill on';
      textEl.textContent = '已在线 ✓';
    } else {
      durationTicker.stop();
      pill.className = 'status-pill wait';
      textEl.textContent = res.manualLogout ? '已手动注销 · 自动登录暂停' : '未登录';
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
function save(cb) {
  chrome.storage.local.set(readForm(), () => {
    $('btnSave').classList.remove('has-changes');
    chrome.runtime.sendMessage({ type: 'settingsChanged' }, () => {
      void chrome.runtime.lastError;
      if (cb) cb(true);
    });
  });
}

/** 表单里是否已填写账号和密码（用于「保存并立即测试」） */
function hasCredentials() {
  const s = readForm();
  return !!(s.account && s.password);
}

// --- 监听表单变更，实时提示未保存状态 ---
$('form').addEventListener('input', () => {
  $('btnSave').classList.add('has-changes');
});
$('form').addEventListener('change', () => {
  $('btnSave').classList.add('has-changes');
});

// --- 保存并立即测试 ---
$('form').addEventListener('submit', (e) => {
  e.preventDefault();

  // 只有「测试登录」才需要凭据；设置本身先保存下来
  if (!hasCredentials()) {
    showToast('请先填写上网账号和密码，再点「保存并立即测试」。', 'err');
    $('account').focus();
    return;
  }

  const btn = $('btnSave');
  btn.disabled = true;
  btn.classList.add('loading');
  $('btnSaveText').textContent = '正在保存并测试…';
  showToast('正在向校园网门户发起验证…', 'info');

  save(() => {
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

// --- 顶部快捷：一键复制完整诊断报告 ---
$('btnCopyReport').addEventListener('click', () => {
  const btn = $('btnCopyReport');
  const span = $('btnCopyReportText');
  const originalText = span.textContent;

  chrome.storage.local.get(null, (settings) => {
    const rawIp = $('stIp').textContent;
    const rawMac = $('stMac').textContent;
    const rawTime = $('stTime').textContent;
    const rawPing = $('stPing').textContent;
    const rawFlow = $('stFlow').textContent;
    const isOnline = $('stOnline').textContent;
    const account = (settings && settings.account) || '未设置';
    const ispMap = { '1': '校园用户', '2': '校园电信(@dx)', '3': '校园联通(@lt)', '4': '校园其他' };
    const ispName = ispMap[(settings && settings.isp) || '1'] || '校园用户';

    const report = [
      '================ 校园网连接诊断报告 ================',
      `诊断时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      `网关门户: http://172.30.100.2/ (Dr.COM ePortal)`,
      `网络状态: ${isOnline}`,
      `本机出口 IP: ${rawIp}`,
      `${rawMac}`,
      `网关延迟: ${rawPing}`,
      `在线时长: ${rawTime}`,
      `已用流量: ${rawFlow}`,
      `认证账号: ${account} (${ispName})`,
      '===================================================='
    ].join('\n');

    navigator.clipboard.writeText(report).then(() => {
      span.textContent = '已复制 ✓';
      showToast('诊断报告已成功复制到剪贴板', 'ok');
      setTimeout(() => {
        span.textContent = originalText;
      }, 2000);
    }).catch(() => {
      showToast('复制失败，请手动记录', 'err');
    });
  });
});

// --- 顶部快捷：注销下线 (防误触二次确认) ---
let optLogoutTimer = null;
$('btnLogoutNow').addEventListener('click', () => {
  const btn = $('btnLogoutNow');
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
    showToast(res.message || '注销完成', res.ok ? 'ok' : 'err');
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
        _version: chrome.runtime.getManifest().version || '1.0.0',
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
          if (Number.isFinite(v)) toSave.intervalMin = Math.max(1 / 60, Math.min(60, v));
        }
        if (data.offlineIntervalMin !== undefined) {
          const v = parseFloat(data.offlineIntervalMin);
          if (Number.isFinite(v)) toSave.offlineIntervalMin = Math.max(1 / 60, Math.min(60, v));
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

// --- 启动初始化 ---
initTheme();
initNavigation();
initCustomSelects();
load();

// 当偏好设置页面在前台激活时，每 15 秒自动向后台刷新一次网关状态（流量与Ping）
setInterval(() => {
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

// 监听跨标签页的主题变动
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.theme) {
    applyTheme(changes.theme.newValue || 'auto');
  }
});

