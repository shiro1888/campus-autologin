/**
 * 校园网自动登录 — 设置页
 */
'use strict';

const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  account: 'REDACTED_CAMPUS_ACCOUNT',
  password: 'REDACTED_CAMPUS_PASSWORD',
  isp: '1',
  intervalMin: 0.5,
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
    // 兼容旧版本存进来的任意分钟数：不在选项里就退到最近的档位
    const iv = String(s.intervalMin === undefined ? 0.5 : s.intervalMin);
    const opt = $('intervalMin').querySelector('option[value="' + iv + '"]');
    $('intervalMin').value = opt ? iv : '0.5';
    $('autoOnStartup').checked = s.autoOnStartup !== false;
    $('contentAutoFill').checked = s.contentAutoFill !== false;
    $('instantTrigger').checked = s.instantTrigger !== false;
  });
  refreshStatus();
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
  let interval = parseFloat($('intervalMin').value);
  if (!Number.isFinite(interval)) interval = 0.5;
  interval = Math.min(60, Math.max(0.5, interval));

  return {
    account: $('account').value.trim(),
    password: $('password').value,
    isp: $('isp').value,
    intervalMin: interval,
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

// --- 间隔改变立即保存 -----------------------------------------------------
$('intervalMin').addEventListener('change', () => {
  save(() => showResult('已改为每 ' + formatInterval(parseFloat($('intervalMin').value)) + '检查一次。', 'ok'));
});

/** 把分钟数显示成人话 */
function formatInterval(min) {
  if (!Number.isFinite(min)) return '';
  if (min < 1) return Math.round(min * 60) + ' 秒';
  return min + ' 分钟';
}

load();
