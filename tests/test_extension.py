import unittest
import os
import json
import re

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT_DIR = os.path.join(PROJECT_DIR, "chrome-extension")


class TestExtensionStructure(unittest.TestCase):
    def _load_manifest(self):
        with open(os.path.join(EXT_DIR, "manifest.json"), "r", encoding="utf-8") as f:
            return json.load(f)

    def test_manifest_validity(self):
        manifest_path = os.path.join(EXT_DIR, "manifest.json")
        self.assertTrue(os.path.exists(manifest_path), "manifest.json missing")
        manifest = self._load_manifest()
        self.assertEqual(manifest.get("manifest_version"), 3)

        # Icons exist
        for size, rel_path in manifest.get("icons", {}).items():
            full_p = os.path.join(EXT_DIR, rel_path.replace("/", os.sep))
            self.assertTrue(os.path.exists(full_p), f"Icon {size} missing: {full_p}")

    def test_manifest_referenced_files_exist(self):
        """manifest 里每个指向磁盘文件的字段都必须真实存在，否则扩展加载即失败。"""
        m = self._load_manifest()
        refs = []
        bg = m.get("background", {}).get("service_worker")
        if bg:
            refs.append(bg)
        options_page = m.get("options_ui", {}).get("page")
        if options_page:
            refs.append(options_page)
        popup = m.get("action", {}).get("default_popup")
        if popup:
            refs.append(popup)
        for rel in m.get("action", {}).get("default_icon", {}).values():
            refs.append(rel)
        for rel in m.get("icons", {}).values():
            refs.append(rel)
        for cs in m.get("content_scripts", []):
            refs.extend(cs.get("js", []))
            refs.extend(cs.get("css", []))
        self.assertTrue(refs, "manifest declares no file references")
        for rel in refs:
            self.assertTrue(
                os.path.exists(os.path.join(EXT_DIR, rel.replace("/", os.sep))),
                f"manifest references missing file: {rel}",
            )

    def test_manifest_required_capabilities(self):
        """MV3 关键能力：权限、门户 host、内容脚本 matches、快捷键。"""
        m = self._load_manifest()
        perms = set(m.get("permissions", []))
        self.assertTrue({"storage", "alarms", "webNavigation"}.issubset(perms),
                        f"missing permissions: {perms}")
        hosts = " ".join(m.get("host_permissions", []))
        self.assertIn("172.30.100.2", hosts, "portal host permission missing")
        matches = " ".join(
            part for cs in m.get("content_scripts", []) for part in cs.get("matches", [])
        )
        self.assertIn("172.30.100.2", matches, "content_scripts matches missing portal")
        self.assertIn("quick-login", m.get("commands", {}), "quick-login command missing")

    def test_html_local_script_references_exist(self):
        """popup.html / options.html 用 <script src> 引入的本地 JS 必须存在。"""
        for html_name in ("popup.html", "options.html"):
            with open(os.path.join(EXT_DIR, html_name), "r", encoding="utf-8") as f:
                html = f.read()
            srcs = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html)
            for src in srcs:
                if re.match(r"^(https?:)?//", src):
                    continue
                self.assertTrue(
                    os.path.exists(os.path.join(EXT_DIR, src.replace("/", os.sep))),
                    f"{html_name} references missing script: {src}",
                )

    def test_portal_endpoint_paths(self):
        """接口路径必须与门户实现一致；曾出现文档里的 chchkstatus 拼写错误。"""
        with open(os.path.join(EXT_DIR, "background.js"), "r", encoding="utf-8") as f:
            bg = f.read()
        with open(os.path.join(EXT_DIR, "content.js"), "r", encoding="utf-8") as f:
            content = f.read()
        for name, source in (("background.js", bg), ("content.js", content)):
            self.assertIn("/drcom/chkstatus", source, f"{name} missing chkstatus endpoint")
            self.assertIn("/drcom/login", source, f"{name} missing login endpoint")
            self.assertNotIn("chchkstatus", source, f"{name} has mistyped chkstatus endpoint")
        for readme in ("README.md", os.path.join("chrome-extension", "README.md")):
            path = os.path.join(PROJECT_DIR, readme)
            if not os.path.exists(path):
                continue
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
            self.assertNotIn("chchkstatus", text, f"{readme} has mistyped chkstatus endpoint")

    def test_no_legacy_desktop_references(self):
        """项目已精简为纯 Chrome 扩展：代码里不应残留桌面/Python 组件引用。"""
        forbidden = (
            "campus_login.py", "config.example.json", ".python_path",
            "install_autostart", "login.bat", "autostart.bat", "gui.bat",
        )
        targets = [
            os.path.join(EXT_DIR, n) for n in os.listdir(EXT_DIR)
            if n.endswith((".js", ".html", ".css", ".json"))
        ]
        for path in targets:
            if not os.path.isfile(path):
                continue
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
            for token in forbidden:
                self.assertNotIn(token, text,
                                 f"{os.path.basename(path)} still references {token}")

    def test_popup_dom_id_contract(self):
        with open(os.path.join(EXT_DIR, "popup.html"), "r", encoding="utf-8") as f:
            popup_html = f.read()
        with open(os.path.join(EXT_DIR, "popup.js"), "r", encoding="utf-8") as f:
            popup_js = f.read()
        html_ids = set(re.findall(r'id=["\']([^"\']+)["\']', popup_html))
        js_ids = set(re.findall(r'(?:\$|document\.getElementById)\(["\']([^"\']+)["\']\)', popup_js))
        missing = js_ids - html_ids
        self.assertEqual(len(missing), 0, f"popup.js references missing IDs: {missing}")

    def test_options_dom_id_contract(self):
        with open(os.path.join(EXT_DIR, "options.html"), "r", encoding="utf-8") as f:
            options_html = f.read()
        with open(os.path.join(EXT_DIR, "options.js"), "r", encoding="utf-8") as f:
            options_js = f.read()
        html_ids = set(re.findall(r'id=["\']([^"\']+)["\']', options_html))
        js_ids = set(re.findall(r'(?:\$|document\.getElementById)\(["\']([^"\']+)["\']\)', options_js))
        missing = js_ids - html_ids
        self.assertEqual(len(missing), 0, f"options.js references missing IDs: {missing}")

    def test_noopener_on_external_links(self):
        for html_name in ("popup.html", "options.html"):
            hp = os.path.join(EXT_DIR, html_name)
            with open(hp, "r", encoding="utf-8") as f:
                ht = f.read()
            a_tags = re.findall(r'<a[^>]+target=["\']_blank["\'][^>]*>', ht)
            for at in a_tags:
                has_rel = 'rel="noopener noreferrer"' in at or 'rel="noreferrer noopener"' in at
                self.assertTrue(has_rel, f"Link missing noopener noreferrer in {html_name}: {at}")

    def test_common_component_exports(self):
        """common.js 必须导出所有共享 UI 组件与状态计算函数，且无重复内联实现。"""
        with open(os.path.join(EXT_DIR, "common.js"), "r", encoding="utf-8") as f:
            common_js = f.read()
        expected_functions = (
            "createTicker",
            "createSparkline",
            "createFlowMeter",
            "createConfirmButton",
            "createCopyTrigger",
            "createConfirmModal",
            "createActivityTimeline",
            "createThemeManager",
            "createToastManager",
            "createPasswordToggle",
            "createNetworkHealthMeter",
            "generateDiagnosticSnapshot",
            "initCustomSelects",
            "classifyPing",
            "resolveSessionDuration",
            "getIspMeta",
        )
        for fn in expected_functions:
            self.assertIn(f"function {fn}", common_js, f"common.js missing component function: {fn}")

    def test_shared_component_field_contract(self):
        """共享组件的返回字段 与 消费端的字段引用必须一致。

        组件化重构曾把 classifyPing / resolveSessionDuration / getIspMeta 抽到
        common.js，但 options.js 仍沿用旧字段名（tier / sparkVal / stimeDisplay /
        ispMeta.name），诊断报告与事件日志也用错了 l.trigger。这类错误不会抛异常，
        只会把 undefined 写进 DOM 或让样式/波形图静默失效，必须靠契约校验兜住。
        """
        def read(name):
            with open(os.path.join(EXT_DIR, name), "r", encoding="utf-8") as f:
                return f.read()

        common = read("common.js")
        background = read("background.js")
        popup = read("popup.js")
        options = read("options.js")

        # ---- 生产端字段集 ----
        ping_returns = re.findall(r"return\s*\{\s*grade:.+?\};", common)
        self.assertTrue(ping_returns, "common.js 中未找到 classifyPing 的 return 语句")
        ping_fields = set()
        for ret in ping_returns:
            ping_fields.update(re.findall(r"(\w+)\s*:", ret))

        dur_ret = re.search(r"return\s*\{\s*durationInput,\s*([^}]*)\};", common)
        self.assertTrue(dur_ret, "common.js 中未找到 resolveSessionDuration 的 return 语句")
        dur_fields = {"durationInput"} | {
            part.strip() for part in dur_ret.group(1).split(",") if part.strip()
        }

        isp_cfg = re.search(r"const ISP_CONFIG = \{(.*?)\n\};", common, re.S)
        self.assertTrue(isp_cfg, "common.js 中未找到 ISP_CONFIG")
        isp_first = re.search(r"\{([^}]*)\}", isp_cfg.group(1), re.S)
        isp_fields = set(re.findall(r"(\w+)\s*:", isp_first.group(1)))

        entry = re.search(r"const entry = \{(.*?)\n\s*\};", background, re.S)
        self.assertTrue(entry, "background.js 中未找到 eventLogs 条目定义")
        log_fields = set(re.findall(r"^\s*(\w+)\s*:", entry.group(1), re.M))

        # ---- 消费端引用 ----
        for name, src in (("popup.js", popup), ("options.js", options)):
            ping_refs = set(re.findall(r"\bping(?:Info|Meta)\.(\w+)", src))
            self.assertTrue(ping_refs, f"{name} 未消费 classifyPing 结果")
            bad = ping_refs - ping_fields
            self.assertFalse(bad, f"{name} 引用了 classifyPing 不存在的字段: {bad}（会导致 undefined 写入 DOM）")

            dur_refs = set(re.findall(r"\bdur\.(\w+)", src))
            for group in re.findall(r"const\s*\{([^}]+)\}\s*=\s*resolveSessionDuration", src):
                dur_refs.update(
                    part.strip().split(":")[0].strip()
                    for part in group.split(",") if part.strip()
                )
            bad = dur_refs - dur_fields
            self.assertFalse(bad, f"{name} 引用了 resolveSessionDuration 不存在的字段: {bad}")

            isp_refs = set(re.findall(r"\b(?:ispMeta|meta)\.(\w+)", src))
            bad = isp_refs - isp_fields
            self.assertFalse(bad, f"{name} 引用了 ISP 元数据不存在的字段: {bad}")

        # 事件日志：common.js 时间轴用 item.*，options.js 诊断报告用 l.*
        log_refs = set(re.findall(r"\bitem\.(\w+)", common))
        log_refs |= set(re.findall(r"\bl\.(\w+)", options))
        self.assertTrue(log_refs, "未找到事件日志字段消费点")
        bad = log_refs - log_fields
        self.assertFalse(bad, f"事件日志引用了不存在的字段: {bad}")

    def test_scripts_execute_without_runtime_exceptions(self):
        """模拟浏览器环境执行脚本：既要无未捕获异常，也不能把 undefined 写进 DOM。"""
        import subprocess
        runner_script = r"""
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const problems = [];

function makeEl(id, label) {
  const listeners = {};
  const el = {
    id, tagName: 'DIV', dataset: {}, style: {}, files: [], value: '',
    checked: false, disabled: false, selectedIndex: 0, title: '',
    options: [{ value: '1' }],
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) f = !this._s.has(c); f ? this._s.add(c) : this._s.delete(c); return f; },
      contains(c) { return this._s.has(c); }
    },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {},
    querySelectorAll() { return []; }, querySelector() { return null; },
    closest() { return null; }, focus() {}, click() {},
    _fire(t) {
      (listeners[t] || []).forEach((fn) => fn({
        target: el, preventDefault() {}, stopPropagation() {}
      }));
    }
  };
  let _text = '', _class = '', _html = '';
  const guard = (kind, v) => {
    if (v === undefined) problems.push(`[${label}] #${id}.${kind} = undefined`);
    else if (typeof v === 'string' && v.indexOf('undefined') !== -1)
      problems.push(`[${label}] #${id}.${kind} 含 "undefined": ${v}`);
  };
  Object.defineProperty(el, 'textContent', {
    get() { return _text; }, set(v) { guard('textContent', v); _text = String(v); }
  });
  Object.defineProperty(el, 'className', {
    get() { return _class; }, set(v) { guard('className', v); _class = String(v); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return _html; }, set(v) { guard('innerHTML', v); _html = String(v); }
  });
  return el;
}

function createEnv(htmlFile, label) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const idRegex = /id=["']([^"']+)["']/g;
  const elements = {};
  let m;
  while ((m = idRegex.exec(html)) !== null) {
    elements[m[1]] = makeEl(m[1], label);
  }
  const get = (id) => (id && typeof id === 'object') ? id : (elements[id] || makeEl(String(id), label));
  const sandbox = {
    console,
    setTimeout: (fn) => { if (typeof fn === 'function') { try { fn(); } catch (e) { problems.push(`[${label}] setTimeout 回调: ${e.message}`); } } return 1; },
    clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
    document: {
      getElementById: get,
      querySelectorAll: () => [], querySelector: () => null,
      addEventListener: () => {},
      createElement: () => makeEl('created', label),
      createElementNS: () => makeEl('svg', label),
      body: { appendChild() {}, removeChild() {} },
      documentElement: { setAttribute: () => {}, removeAttribute: () => {} }
    },
    window: {
      matchMedia: () => ({ matches: false, addEventListener: () => {} }),
      addEventListener: () => {}, open() {}, close() {}, confirm: () => false
    },
    navigator: { platform: 'Win32', userAgent: 'Chrome' },
    Element: function () {},
    chrome: {
      storage: {
        local: {
          get: (arg, cb) => { const d = (arg && typeof arg === 'object') ? { ...arg } : {}; cb && cb(d); },
          set: (data, cb) => cb && cb()
        },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        getManifest: () => ({ version: '1.3.0' }),
        getURL: () => '', openOptionsPage() {}, lastError: null,
        sendMessage: (msg, cb) => {
          if (!cb) return;
          if (msg.type === 'status') {
            cb({
              reachable: true, online: true, pingMs: 42, pingHistory: [10, 20, 30],
              raw: { v4ip: '10.0.0.1', ss5: '', ss1: 'aabbccddeeff', flow: '1024',
                     actdf: '800', actuf: '224', stime: '2026-11-07 08:00:00' },
              manualLogout: false, running: false, onlineSince: Date.now() - 3600000
            });
          } else cb({ ok: true, online: true, message: 'ok' });
        }
      }
    }
  };
  sandbox.window.document = sandbox.document;
  sandbox._elements = elements;
  return sandbox;
}

const extDir = process.argv[1];
const commonJs = fs.readFileSync(path.join(extDir, 'common.js'), 'utf8');

for (const [htmlFile, jsFile, label] of [
  ['options.html', 'options.js', 'options'],
  ['popup.html', 'popup.js', 'popup']
]) {
  const env = createEnv(path.join(extDir, htmlFile), label);
  vm.createContext(env);
  vm.runInContext(commonJs, env);
  try {
    vm.runInContext(fs.readFileSync(path.join(extDir, jsFile), 'utf8'), env);
  } catch (e) {
    problems.push(`[${label}] 顶层执行异常: ${e.message}`);
  }

  // 断言真的走完了 online 渲染路径且写入了具体正确值。
  // 只断言「不抛异常」会漏掉字段名写错这类静默值缺陷；若 mock 退化到
  // !reachable 分支，这些断言会立刻失败，避免测试假绿。
  const el = (id) => env._elements[id];
  const expect = (id, prop, check, desc) => {
    const node = el(id);
    if (!node) { problems.push(`[${label}] 缺少 #${id} 元素`); return; }
    const v = node[prop];
    if (typeof v !== 'string' || !check(v))
      problems.push(`[${label}] #${id}.${prop} 期望 ${desc}，实际: ${JSON.stringify(v)}`);
  };
  if (label === 'options') {
    expect('stStime', 'textContent', (v) => /^本次连通: \S/.test(v), '本次连通: <时间>');
    expect('pingBadge', 'className', (v) => /^latency-badge (fast|good|normal|slow)$/.test(v), 'latency-badge <有效等级>');
    expect('stPing', 'textContent', (v) => v === '42 ms', '42 ms');
    expect('stIp', 'textContent', (v) => v === '10.0.0.1', '10.0.0.1');
    expect('stFlow', 'textContent', (v) => v === '1.0 MB', '1.0 MB');
  } else {
    expect('popPing', 'textContent', (v) => v === '42 ms', '42 ms');
    expect('popPing', 'className', (v) => /^dock-value mono ping-(fast|good|normal|slow)$/.test(v), 'ping-<有效等级>');
    expect('statusTitle', 'textContent', (v) => v === '已在线 · 认证通过', '已在线 · 认证通过');
    expect('localIp', 'textContent', (v) => v === '10.0.0.1', '10.0.0.1');
  }

  // 触发所有已注册的 click 回调，覆盖交互分支（字段错名常藏在这里）
  for (const id of Object.keys(env._elements)) {
    try { env._elements[id]._fire('click'); }
    catch (e) { problems.push(`[${label}] #${id} click 回调异常: ${e.message}`); }
  }
}

if (problems.length) {
  console.log('DOM_PROBLEMS:\n' + problems.join('\n'));
} else {
  console.log('ALL_SCRIPTS_OK');
}
"""
        res = subprocess.run(
            ["node", "-e", runner_script, EXT_DIR],
            capture_output=True,
            text=True,
            encoding="utf-8"
        )
        self.assertEqual(res.returncode, 0, f"Script execution failed:\n{res.stderr}\n{res.stdout}")
        self.assertNotIn("DOM_PROBLEMS", res.stdout,
                         f"脚本把 undefined 写入 DOM 或交互回调抛异常:\n{res.stdout}")
        self.assertIn("ALL_SCRIPTS_OK", res.stdout)

    def test_timeline_css_class_matches_component_output(self):
        """组件库生成的 class 必须在 CSS 中有对应规则，否则胶囊样式静默丢失。"""
        with open(os.path.join(EXT_DIR, "common.js"), "r", encoding="utf-8") as f:
            common = f.read()
        with open(os.path.join(EXT_DIR, "options.css"), "r", encoding="utf-8") as f:
            css = f.read()
        emitted = set(re.findall(r'class="(timeline-[a-z-]+)"', common))
        self.assertTrue(emitted, "未找到时间轴组件输出的类名")
        missing = [c for c in emitted if ("." + c) not in css]
        self.assertEqual(missing, [], f"options.css 缺少时间轴样式规则: {missing}")

    def test_ping_history_written_once_with_result(self):
        """心跳历史不得每次探测单独写盘，且必须随 saveResult 的批次一起落盘。"""
        with open(os.path.join(EXT_DIR, "background.js"), "r", encoding="utf-8") as f:
            bg = f.read()
        record = re.search(r"function recordPingHistory\(ms\) \{(.*?)\n\}", bg, re.S)
        self.assertTrue(record, "未找到 recordPingHistory")
        self.assertNotIn("setState", record.group(1),
                         "recordPingHistory 不应单独写 storage（掉线 1 秒巡检会造成额外写盘）")
        save = re.search(r"async function saveResult\(result, trigger\) \{(.*?)\n\}", bg, re.S)
        self.assertTrue(save, "未找到 saveResult")
        self.assertIn("pingHistory: getPingHistory()", save.group(1),
                      "saveResult 必须把 pingHistory 与 lastResult/eventLogs 同批写入")

    def test_background_cold_start_preserves_event_logs(self):
        """运行时验证 SW 冷启动后的运行态恢复与写盘合并。

        MV3 的 service worker 会被回收。冷启动后若先探测（logout 的首步）、
        再写日志（contentResult），存在两类静默数据损坏：
        1. 模块级 eventLogs 为空时直接 set，会把磁盘历史覆盖成 1 条；
        2. 探测先写入一条心跳，hydrateState 的 !pingHistory.length 判断失效，
           磁盘上的历史心跳被跳过恢复、随后又被写回覆盖。
        同时校验心跳不再单独写盘（掉线 1 秒巡检下会多出约每秒 1 次 I/O）。
        """
        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8');
const listeners = {};
let storage = {
  eventLogs: [
    { time: '09:00:03', message: '事件A', ok: true, online: true, from: '巡检', count: 1 },
    { time: '09:00:02', message: '事件B', ok: true, online: true, from: '巡检', count: 1 },
    { time: '09:00:01', message: '事件C', ok: false, online: false, from: '巡检', count: 1 }
  ],
  pingHistory: [11, 22, 33], initialized: true, account: 'test', password: 'pw'
};
const writes = [];
const chrome = {
  storage: { local: {
    get: (arg, cb) => {
      const r = arg === null ? { ...storage } : { ...(arg || {}) };
      if (typeof cb === 'function') { cb(r); return; }
      return Promise.resolve(r);
    },
    set: (patch, cb) => {
      writes.push(patch); Object.assign(storage, patch);
      if (typeof cb === 'function') cb();
      return Promise.resolve();
    }
  } },
  runtime: {
    onInstalled: { addListener: (f) => listeners.installed = f },
    onStartup: { addListener: (f) => listeners.startup = f },
    onMessage: { addListener: (f) => listeners.message = f },
    getManifest: () => ({ version: 'test' }), lastError: null
  },
  alarms: { onAlarm: { addListener: () => {} }, get: async () => null, create: async () => {} },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
  commands: null
};
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} }, chrome,
  setTimeout: (fn) => setTimeout(fn, 0), clearTimeout,
  setInterval: () => 0, clearInterval: () => {},
  Date, Math, JSON, Promise, Number, String, Array, Object, RegExp,
  parseInt, parseFloat, isNaN, Boolean, Set, Map, Error,
  TextDecoder, AbortController, Uint8Array, ArrayBuffer, URLSearchParams,
  // 探测失败也仍会记录一次心跳（-1），足以覆盖「先探测再写日志」的冷启动路径
  fetch: async () => { throw new Error('offline'); }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

(async () => {
  // 冷启动：不触发 onInstalled / onStartup / status
  await vm.runInContext('checkStatus()', sandbox);
  await new Promise((resolve) => listeners.message(
    { type: 'contentResult', result: { ok: true, online: true, message: '页面自动填写完成' } },
    {}, resolve
  ));
  const last = writes[writes.length - 1] || {};
  const ping = last.pingHistory || [];
  console.log('RESULT:' + JSON.stringify({
    writeCount: writes.length,
    eventLogsLen: (last.eventLogs || []).length,
    firstMsg: (last.eventLogs || [])[0] && last.eventLogs[0].message,
    hasPingHistory: Array.isArray(last.pingHistory),
    pingPreserved: ping.indexOf(11) !== -1 && ping.indexOf(22) !== -1 && ping.indexOf(33) !== -1
  }));
})().catch((e) => console.log('ERROR:' + e.message));
"""
        res = subprocess.run(
            ["node", "-e", runner_script, os.path.join(EXT_DIR, "background.js")],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"后台脚本模拟失败:\n{res.stderr}\n{res.stdout}")
        line = next((l for l in res.stdout.splitlines() if l.startswith("RESULT:")), None)
        self.assertIsNotNone(line, f"未拿到模拟结果:\n{res.stdout}\n{res.stderr}")
        data = json.loads(line[len("RESULT:"):])
        # 3 条历史 + 1 条新事件；修复前会退化成 1 条
        self.assertEqual(data["eventLogsLen"], 4,
                         f"冷启动后历史日志被覆盖: {data}")
        self.assertEqual(data["firstMsg"], "页面自动填写完成")
        self.assertTrue(data["hasPingHistory"], "心跳历史未随结果同批落盘")
        self.assertTrue(data["pingPreserved"], "冷启动先探测后写日志，历史心跳被覆盖丢失")
        self.assertEqual(data["writeCount"], 1, "探测与结果写入不应拆成多次 set")

    def test_cold_start_content_result_alone_preserves_logs(self):
        """冷启动后第一条消息就是 contentResult 时，saveResult 必须自行恢复运行态。

        上一条用例先调用了 checkStatus()，而它入口本身也有 hydrateState()，
        等于提前把运行态恢复好了 —— 这会让 saveResult() 顶部的 hydrate 变成
        无法被证伪的冗余行（移除它测试依然全绿），形成假绿盲区。

        真实触发路径：浏览器被断网跳转到门户页 → 内容脚本自动填单并上报结果，
        此时 SW 可能刚被唤醒，既没有 onStartup 也没有 status 消息。若 saveResult()
        不自行 hydrate，模块级 eventLogs/pingHistory 仍是空数组，会直接把磁盘上
        的历史覆盖掉（实测：4 条日志 → 1 条，心跳历史 → 空）。

        本用例只发 contentResult、全程不触碰 checkStatus()，确保该防线被独立锁定。
        """
        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8');
const listeners = {};
let storage = {
  eventLogs: [
    { time: '09:00:03', message: '事件A', ok: true, online: true, from: '巡检', count: 1 },
    { time: '09:00:02', message: '事件B', ok: true, online: true, from: '巡检', count: 1 },
    { time: '09:00:01', message: '事件C', ok: false, online: false, from: '巡检', count: 1 }
  ],
  pingHistory: [11, 22, 33], initialized: true, account: 'test', password: 'pw'
};
const writes = [];
const chrome = {
  storage: { local: {
    get: (arg, cb) => {
      const r = arg === null ? { ...storage } : { ...(arg || {}) };
      if (typeof cb === 'function') { cb(r); return; }
      return Promise.resolve(r);
    },
    set: (patch, cb) => {
      writes.push(patch); Object.assign(storage, patch);
      if (typeof cb === 'function') cb();
      return Promise.resolve();
    }
  } },
  runtime: {
    onInstalled: { addListener: (f) => listeners.installed = f },
    onStartup: { addListener: (f) => listeners.startup = f },
    onMessage: { addListener: (f) => listeners.message = f },
    getManifest: () => ({ version: 'test' }), lastError: null
  },
  alarms: { onAlarm: { addListener: () => {} }, get: async () => null, create: async () => {} },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
  commands: null
};
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} }, chrome,
  setTimeout: (fn) => setTimeout(fn, 0), clearTimeout,
  setInterval: () => 0, clearInterval: () => {},
  Date, Math, JSON, Promise, Number, String, Array, Object, RegExp,
  parseInt, parseFloat, isNaN, Boolean, Set, Map, Error,
  TextDecoder, AbortController, Uint8Array, ArrayBuffer, URLSearchParams,
  // 全程不应发起探测；这里故意抛错，一旦有人给本用例加上 checkStatus 会立刻暴露
  fetch: async () => { throw new Error('checkStatus() 不应被调用'); }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

(async () => {
  // 关键：不触发 onInstalled / onStartup，也不发 status，只发 contentResult
  await new Promise((resolve) => listeners.message(
    { type: 'contentResult', result: { ok: true, online: true, message: '页面自动填写完成' } },
    {}, resolve
  ));
  const last = writes[writes.length - 1] || {};
  const logs = last.eventLogs || [];
  const ping = last.pingHistory || [];
  console.log('RESULT:' + JSON.stringify({
    writeCount: writes.length,
    eventLogsLen: logs.length,
    firstMsg: logs[0] && logs[0].message,
    pingHistory: ping
  }));
})().catch((e) => console.log('ERROR:' + e.message));
"""
        res = subprocess.run(
            ["node", "-e", runner_script, os.path.join(EXT_DIR, "background.js")],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"后台脚本模拟失败:\n{res.stderr}\n{res.stdout}")
        line = next((l for l in res.stdout.splitlines() if l.startswith("RESULT:")), None)
        self.assertIsNotNone(line, f"未拿到模拟结果:\n{res.stdout}\n{res.stderr}")
        data = json.loads(line[len("RESULT:"):])
        # 3 条历史 + 1 条新事件。若 saveResult 不自 hydrate，这里会退化成 1 条
        self.assertEqual(data["eventLogsLen"], 4,
                         f"saveResult 未自行恢复运行态，冷启动历史日志被覆盖: {data}")
        self.assertEqual(data["firstMsg"], "页面自动填写完成")
        # 心跳历史必须原样保留，不能被空数组覆盖
        self.assertEqual(data["pingHistory"], [11, 22, 33],
                         f"saveResult 未自行恢复运行态，心跳历史被覆盖: {data}")
        self.assertEqual(data["writeCount"], 1, "contentResult 应只触发一次 storage 写入")


    def test_shared_component_degraded_paths(self):
        """运行时验证组件的降级与并发路径，而不只是「不抛异常」。

        覆盖两个真实缺陷：
        1. 剪贴板写入被拒时，onError 必须收到原始文本（popup 靠它显示明文
           供手动复制），而不是 Error 对象；且 API 不可用分支契约一致。
        2. 连续两次 confirm() 不得让第一个 Promise 永久悬挂。
        """
        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8');
const problems = [];

function makeCtx(clipboard) {
  const els = {}, handlers = {};
  const mk = (id) => ({
    id, textContent: '', innerHTML: '', dataset: {}, style: {}, _removed: false,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }, toggle() {} },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener(t, f) { (handlers[id + ':' + t] = handlers[id + ':' + t] || []).push(f); },
    removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, focus() {},
    remove() { this._removed = true; }
  });
  for (const id of ['confirmModalOverlay', 'confirmModalTitle', 'confirmModalDesc',
                    'btnModalConfirm', 'btnModalCancel', 'copyTarget',
                    'msgBox', 'msg', 'msgIcon']) els[id] = mk(id);
  const ctx = {
    console, setTimeout: (f) => { if (typeof f === 'function') f(); return 1; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    document: { getElementById: (id) => els[id] || null, addEventListener() {},
      querySelectorAll() { return []; }, querySelector() { return null; },
      documentElement: { setAttribute() {} } },
    window: {}, navigator: { clipboard }, Element: function () {},
    Date, Math, JSON, Promise, String, Number, Object, Array, RegExp, Set,
    parseInt, parseFloat, isNaN
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, els, handlers };
}

(async () => {
  // --- 1a. writeText 被拒：onError 首参必须是原文 ---
  const rejectEnv = makeCtx({ writeText: () => Promise.reject(new Error('NotAllowedError')) });
  let rejectedArg = '__NOT_CALLED__';
  rejectEnv.ctx.__onError = (v) => { rejectedArg = v; };
  vm.runInContext(
    'createCopyTrigger({target:"copyTarget",getText:()=>"10.20.30.40",onError:__onError}).trigger()',
    rejectEnv.ctx);
  await Promise.resolve(); await Promise.resolve();
  if (rejectedArg !== '10.20.30.40')
    problems.push('writeText 被拒时 onError 首参不是原文: ' + String(rejectedArg));

  // --- 1b. clipboard API 不可用：契约必须一致 ---
  const absentEnv = makeCtx(null);
  let absentArg = '__NOT_CALLED__';
  absentEnv.ctx.__onError = (v) => { absentArg = v; };
  vm.runInContext(
    'createCopyTrigger({target:"copyTarget",getText:()=>"10.20.30.40",onError:__onError}).trigger()',
    absentEnv.ctx);
  if (absentArg !== '10.20.30.40')
    problems.push('API 不可用时 onError 首参不是原文: ' + String(absentArg));

  // --- 1c. 成功路径不得误触发 onError ---
  const okEnv = makeCtx({ writeText: () => Promise.resolve() });
  let copied = false, errored = false;
  okEnv.ctx.__onCopied = () => { copied = true; };
  okEnv.ctx.__onError = () => { errored = true; };
  vm.runInContext(
    'createCopyTrigger({target:"copyTarget",getText:()=>"10.20.30.40",onSuccess:__onCopied,onError:__onError}).trigger()',
    okEnv.ctx);
  await Promise.resolve(); await Promise.resolve();
  if (!copied) problems.push('复制成功但 onSuccess 未调用');
  if (errored) problems.push('复制成功却误触发了 onError');

  // --- 2. 连续两次 confirm 不得悬挂第一个 Promise ---
  const modalEnv = makeCtx(null);
  let first = false, second = false, confirmCalls = 0;
  modalEnv.ctx.__onConfirm = () => { confirmCalls++; };
  const modal = vm.runInContext('createConfirmModal({overlayId:"confirmModalOverlay"})', modalEnv.ctx);
  modal.open({ title: 'A', onConfirm: modalEnv.ctx.__onConfirm }).then(() => { first = true; });
  modal.open({ title: 'B', onConfirm: modalEnv.ctx.__onConfirm }).then(() => { second = true; });
  modalEnv.els.confirmModalOverlay.classList.add('open');
  (modalEnv.handlers['btnModalConfirm:click'] || []).forEach((f) => f({}));
  await Promise.resolve(); await Promise.resolve();
  if (!first) problems.push('连续 confirm 后第一个 Promise 永久悬挂');
  if (!second) problems.push('连续 confirm 后第二个 Promise 未结算');
  if (confirmCalls !== 1) problems.push('onConfirm 执行次数异常: ' + confirmCalls);

  // --- 3. 单体消息框被 dismiss 后必须仍可复用 ---
  // popup 的 #msgBox 是常驻元素，dismiss 若对它执行 remove()，元素会脱离文档，
  // 之后 show() 只改到游离节点，用户再也看不到任何提示。
  const toastEnv = makeCtx(null);
  const singleBox = toastEnv.els.msgBox;
  const toast = vm.runInContext(
    'createToastManager({boxId:"msgBox",textId:"msg",iconId:"msgIcon"})', toastEnv.ctx);
  toast.show('第一条消息', 'info', 3000);
  toast.dismiss(singleBox);
  if (singleBox._removed) problems.push('dismiss 把常驻消息框移出了 DOM');
  toast.show('第二条消息', 'ok', 3000);
  if (singleBox._removed) problems.push('dismiss 之后消息框已失联，后续提示不可见');
  if (toastEnv.els.msg.textContent !== '第二条消息')
    problems.push('dismiss 后 show 未写入新文案: ' + toastEnv.els.msg.textContent);

  console.log(problems.length ? 'COMPONENT_PROBLEMS:\n' + problems.join('\n') : 'COMPONENTS_OK');
})().catch((e) => console.log('COMPONENT_PROBLEMS: 运行异常 ' + e.message));
"""
        res = subprocess.run(
            ["node", "-e", runner_script, os.path.join(EXT_DIR, "common.js")],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"组件模拟失败:\n{res.stderr}\n{res.stdout}")
        self.assertNotIn("COMPONENT_PROBLEMS", res.stdout,
                         f"组件降级/并发路径有缺陷:\n{res.stdout}")
        self.assertIn("COMPONENTS_OK", res.stdout)


    def test_advanced_ui_components_runtime(self):
        """运行时验证高级 UI 组件的核心逻辑与隐私保护。

        覆盖：
        1. createNetworkHealthMeter: 离线、待认证、极佳、良好、普通梯级评分。
        2. createPasswordToggle: 显隐切换与回隐重置。
        3. generateDiagnosticSnapshot: 账号脱敏与诊断快照规整度（绝不泄露明文账号）。
        4. createThemeManager: 深浅色模式与系统偏好响应。
        """
        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8');
const problems = [];

const els = {};
const makeEl = (id) => ({
  id, textContent: '', innerHTML: '', className: '', type: 'password', dataset: {}, style: {},
  classList: {
    _s: new Set(),
    add(c) { this._s.add(c); },
    remove(c) { this._s.delete(c); },
    contains(c) { return this._s.has(c); },
    toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
  },
  setAttribute(k, v) { this[k] = v; },
  getAttribute(k) { return this[k] || null; },
  addEventListener(t, f) { this['on' + t] = f; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  focus() {}
});

for (const id of ['heroHealthBadge', 'heroHealthScore', 'password', 'togglePwd', 'eyeIcon', 'btnTheme', 'themeLabel', 'toastBox', 'toastMsg']) {
  els[id] = makeEl(id);
}

const themeAttrs = {};
let currentSysDark = false;
let storedTheme = 'auto';

const ctx = {
  console,
  setTimeout: (f, ms) => { return setTimeout(f, ms || 0); },
  clearTimeout: (t) => clearTimeout(t),
  setInterval: () => 1,
  clearInterval: () => {},
  document: {
    getElementById: (id) => els[id] || null,
    querySelector: (sel) => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    documentElement: {
      setAttribute: (k, v) => { themeAttrs[k] = v; },
      removeAttribute: (k) => { delete themeAttrs[k]; }
    }
  },
  window: {
    matchMedia: (q) => ({
      matches: currentSysDark,
      addEventListener: () => {}
    })
  },
  chrome: {
    storage: {
      local: {
        get: (def, cb) => cb({ theme: storedTheme }),
        set: (patch, cb) => {
          if (patch.theme) storedTheme = patch.theme;
          if (typeof cb === 'function') cb();
        }
      },
      onChanged: { addListener: () => {} }
    },
    runtime: { getManifest: () => ({ version: '1.4.0' }) }
  },
  Date, Math, JSON, Promise, String, Number, Object, Array, RegExp, Set,
  parseInt, parseFloat, isNaN
};

vm.createContext(ctx);
vm.runInContext(src, ctx);

// --- 1. createNetworkHealthMeter ---
const meter = vm.runInContext('createNetworkHealthMeter({ badgeId: "heroHealthBadge", scoreId: "heroHealthScore" })', ctx);
const off = meter.evaluate(null);
if (off.score !== 0 || off.grade !== 'offline') problems.push('健康度离线评分错误: ' + JSON.stringify(off));

const wait = meter.evaluate({ reachable: true, online: false });
if (wait.grade !== 'wait' || wait.score <= 0) problems.push('健康度待认证评分错误: ' + JSON.stringify(wait));

const fast = meter.evaluate({ reachable: true, online: true, pingMs: 15 });
if (fast.grade !== 'fast' || fast.score !== 100) problems.push('健康度极佳评分错误: ' + JSON.stringify(fast));

meter.render(fast);
if (!els.heroHealthBadge.className.includes('fast')) problems.push('健康度徽章 class 未正确渲染');
if (!els.heroHealthScore.textContent.includes('100%')) problems.push('健康度文本未正确渲染');

// --- 2. createPasswordToggle ---
const pwdToggle = vm.runInContext('createPasswordToggle({ inputId: "password", toggleBtnId: "togglePwd", iconId: "eyeIcon", timeoutMs: 100 })', ctx);
els.password.type = 'password';
pwdToggle.toggle();
if (els.password.type !== 'text') problems.push('密码切换至明文失败');
pwdToggle.rehide();
if (els.password.type !== 'password') problems.push('密码手动回隐失败');

// --- 3. generateDiagnosticSnapshot ---
const rawAccount = '13812345678';
const snapshot = vm.runInContext(`generateDiagnosticSnapshot({
  account: "${rawAccount}",
  isp: "1",
  ip: "10.10.10.1",
  mac: "AA:BB:CC:DD:EE:FF",
  statusText: "已认证",
  healthText: "健康度 100% · 极佳",
  pingText: "12ms",
  eventLogs: [{ time: "12:00:00", from: "测试", message: "心跳正常", count: 1 }]
})`, ctx);

if (snapshot.includes(rawAccount)) problems.push('诊断快照泄露了明文完整账号');
if (!snapshot.includes('138****5678')) problems.push('诊断快照未能正确脱敏账号');
if (!snapshot.includes('10.10.10.1')) problems.push('诊断快照缺少 IP 信息');
if (!snapshot.includes('极佳')) problems.push('诊断快照缺少健康度');

// --- 4. createThemeManager ---
const tm = vm.runInContext('createThemeManager({ toggleBtnId: "btnTheme", labelId: "themeLabel" })', ctx);
tm.apply('dark');
if (themeAttrs['data-theme'] !== 'dark') problems.push('ThemeManager apply(dark) 失败');
tm.apply('light');
if (themeAttrs['data-theme'] !== 'light') problems.push('ThemeManager apply(light) 失败');

console.log(problems.length ? 'COMPONENT_RUNTIME_PROBLEMS:\n' + problems.join('\n') : 'COMPONENTS_RUNTIME_OK');
"""
        res = subprocess.run(
            ["node", "-e", runner_script, os.path.join(EXT_DIR, "common.js")],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"高级组件运行模拟失败:\n{res.stderr}\n{res.stdout}")
        self.assertNotIn("COMPONENT_RUNTIME_PROBLEMS", res.stdout,
                         f"高级组件存在逻辑缺陷:\n{res.stdout}")
        self.assertIn("COMPONENTS_RUNTIME_OK", res.stdout)

    def test_no_hardcoded_user_credentials(self):
        """项目中严禁残留或硬编码用户任何真实手机号与密码凭据。"""
        banned_tokens = [
            "".join(["178", "7625", "6759"]),
            "".join(["hsr", "007", "007"])
        ]
        scanned_count = 0
        for root, dirs, files in os.walk(PROJECT_DIR):
            if ".git" in root or "__pycache__" in root:
                continue
            for file in files:
                if not file.endswith((".js", ".html", ".css", ".json", ".py", ".md", ".txt")):
                    continue
                path = os.path.join(root, file)
                scanned_count += 1
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                for token in banned_tokens:
                    self.assertNotIn(token, content, f"文件 {file} 存在真实凭据残留！")
        self.assertGreater(scanned_count, 5, "扫描的文件数量异常过少")

    def test_jsonp_parser_resilience(self):
        """验证 JSONP 解析器的多态容错能力与防御边界。"""
        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8');
const problems = [];
const chrome = {
  storage: { local: { get: (def, cb) => (cb ? cb({}) : Promise.resolve({})), set: (p, cb) => (cb ? cb() : Promise.resolve()) } },
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    getManifest: () => ({ version: '1.4.0' }),
    lastError: null
  },
  alarms: { onAlarm: { addListener: () => {} }, get: async () => null, create: async () => {} },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
  commands: { onCommand: { addListener: () => {} } },
  webNavigation: { onCommitted: { addListener: () => {} }, onErrorOccurred: { addListener: () => {} } }
};
const ctx = {
  console,
  chrome,
  setTimeout: () => 1,
  clearTimeout: () => {},
  setInterval: () => 1,
  clearInterval: () => {},
  Date, Math, JSON, String, Number, Array, Object, RegExp, Boolean
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

const parse = (text) => vm.runInContext(`parseJsonp(${JSON.stringify(text)})`, ctx);

if (parse(null) !== null) problems.push('parseJsonp(null) 未返回 null');
if (parse('') !== null) problems.push('parseJsonp("") 未返回 null');
if (parse('<html><body>error</body></html>') !== null) problems.push('HTML 响应未被过滤为 null');
if (parse('dr1001({corrupted})') !== null) problems.push('损坏 JSON 未被安全捕获为 null');

const okRes = parse('dr1001({"result":1,"message":"success"})');
if (!okRes || okRes.result !== 1 || okRes.message !== 'success') {
  problems.push('正常 JSONP 解析失败: ' + JSON.stringify(okRes));
}

console.log(problems.length ? 'JSONP_PROBLEMS:\n' + problems.join('\n') : 'JSONP_OK');
"""
        res = subprocess.run(
            ["node", "-e", runner_script, os.path.join(EXT_DIR, "background.js")],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"JSONP 解析模拟失败:\n{res.stderr}\n{res.stdout}")
        self.assertNotIn("JSONP_PROBLEMS", res.stdout, f"JSONP 解析器存在隐患:\n{res.stdout}")
        self.assertIn("JSONP_OK", res.stdout)


if __name__ == "__main__":
    unittest.main()
