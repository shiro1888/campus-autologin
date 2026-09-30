/**
 * 校园网自动登录 — 设置页
 */
'use strict';

const $ = (id) => document.getElementById(id);

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

/** 显示结果条 */
function showResult(text, kind) {
  const el = $('result');
  el.textContent = text;
  el.className = 'result show ' + (kind || 'info');
}

/** 从存储加载设置到表单 */
function load() {
  // 显示版本号 —— 用来确认 Chrome 是否已加载到最新代码
  try {
    $('ver').textContent = 'v' + (chrome.runtime.getManifest().version || '?');
  } catch (e) {
    $('ver').textContent = '';
  }

  chrome.storage.local.get(DEFAULTS, (s) => {
    $('account').value = s.account || '';
    $('password').value = s.password || '';
    $('isp').value = String(s.isp || '1');

    // 间隔：旧版本可能存过任意分钟数，不在选项里就选最接近的档位
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

/** 在 select 里选中最接近给定值的档位 */
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

/** 自适应关闭时，隐藏「掉线间隔」那一行 */
function syncOfflineRow() {
  $('offlineRow').style.display = $('adaptive').checked ? '' : 'none';
}

/** 更新底部状态栏 */
function refreshStatus() {
  chrome.storage.local.get(['lastResult'], (s) => {
    const r = s && s.lastResult;
    $('stLast').textContent = r ? (r.time + ' · ' + r.message) : '—';
  });

  chrome.runtime.sendMessage({ type: 'status' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      $('stOnline').textContent = '后台未响应';
      return;
    }
    if (!res.reachable) $('stOnline').textContent = '不在校园网内';
    else $('stOnline').textContent = res.online ? '已在线 ✓' : '未登录';
  });
}

/** 读取表单 */
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

/** 保存 + 通知后台重建闹钟 */
function save(cb) {
  const s = readForm();
  if (!s.account || !s.password) {
    showResult('请先填写账号和密码。', 'err');
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

// --- 保存并立即测试 -------------------------------------------------------
$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const btn = $('btnSave');
  btn.disabled = true;
  btn.textContent = '测试中…';
  showResult('正在保存并连接门户测试…', 'info');

  save((okSaved) => {
    if (!okSaved) {
      btn.disabled = false;
      btn.textContent = '保存并立即测试';
      return;
    }
    chrome.runtime.sendMessage({ type: 'login' }, (res) => {
      btn.disabled = false;
      btn.textContent = '保存并立即测试';
      if (chrome.runtime.lastError || !res) {
        showResult('后台无响应，请在 chrome://extensions 里重新加载插件。', 'err');
        return;
      }
      showResult(res.message || '完成', res.ok ? 'ok' : 'err');
      refreshStatus();
    });
  });
});

// --- 立即登录（不保存） ---------------------------------------------------
$('btnLoginNow').addEventListener('click', () => {
  const btn = $('btnLoginNow');
  btn.disabled = true;
  btn.textContent = '登录中…';
  showResult('正在登录…', 'info');
  chrome.runtime.sendMessage({ type: 'login' }, (res) => {
    btn.disabled = false;
    btn.textContent = '立即登录';
    if (chrome.runtime.lastError || !res) {
      showResult('后台无响应，请重新加载插件。', 'err');
      return;
    }
    showResult(res.message || '完成', res.ok ? 'ok' : 'err');
    refreshStatus();
  });
});

// --- 显示/隐藏密码 -------------------------------------------------------
$('togglePwd').addEventListener('click', () => {
  const el = $('password');
  const show = el.type === 'password';
  el.type = show ? 'text' : 'password';
  $('togglePwd').textContent = show ? '隐藏' : '显示';
});

// --- 勾选类改动立即保存 ---------------------------------------------------
['autoOnStartup', 'contentAutoFill', 'instantTrigger'].forEach((id) => {
  $(id).addEventListener('change', () => save());
});

$('adaptive').addEventListener('change', () => {
  syncOfflineRow();
  save(() => {
    showResult($('adaptive').checked
      ? '已开启自适应加速：在线时 ' + fmt($('intervalMin').value) + '，掉线后 ' + fmt($('offlineIntervalMin').value) + '。'
      : '已关闭自适应加速，统一用 ' + fmt($('intervalMin').value) + '。', 'ok');
  });
});

// --- 间隔改变立即保存 -----------------------------------------------------
['intervalMin', 'offlineIntervalMin'].forEach((id) => {
  $(id).addEventListener('change', () => {
    save(() => showResult('检查间隔已更新。', 'ok'));
  });
});

/** 把 select 的值转成人话 */
function fmt(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return '';
  return n < 1 ? Math.round(n * 60) + ' 秒' : n + ' 分钟';
}

load();
