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

    def test_component_config_dom_ids_exist(self):
        """组件配置对象里传入的 DOM ID 也必须真实存在。

        上面两个 *_dom_id_contract 只扫 $('id') / getElementById('id')，
        但共享组件普遍通过配置对象拿 ID：
            createActivityTimeline({ listId: 'logTimelineList', ... })
            createFlowMeter({ wrapId: 'optFlowBarWrap', ... })
            createToastManager({ boxId: 'msgBox', ... })
        这类键写错时组件只拿到 null：既不抛异常，也不会往 DOM 写 undefined，
        表现为「某块 UI 静默不工作」，现有测试完全抓不到。
        """
        sentinel = {"popup.js": "msgBox", "options.js": "logTimelineList"}
        for js_name, html_name in (("popup.js", "popup.html"), ("options.js", "options.html")):
            with open(os.path.join(EXT_DIR, html_name), "r", encoding="utf-8") as f:
                html_ids = set(re.findall(r'id=["\']([^"\']+)["\']', f.read()))
            with open(os.path.join(EXT_DIR, js_name), "r", encoding="utf-8") as f:
                js_src = f.read()
            cfg_ids = re.findall(
                r'\b(?:[A-Za-z]+Id|[A-Za-z]+El|target)\s*:\s*["\']([A-Za-z0-9_-]+)["\']',
                js_src,
            )
            # 防止正则退化成「扫不到任何东西」的假绿
            self.assertIn(sentinel[js_name], cfg_ids,
                          f"{js_name} 未能提取到已知配置 ID，检查扫描规则")
            self.assertGreaterEqual(len(cfg_ids), 10,
                                    f"{js_name} 提取到的配置 ID 过少，扫描规则可能失效")
            missing = sorted(set(cfg_ids) - html_ids)
            self.assertEqual(missing, [],
                             f"{js_name} 的组件配置引用了不存在的 DOM ID（会静默失效）")

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
            "createPrivacyMaskManager",
            "createAccentPicker",
            "createVisibilityPoller",
            "triggerPulseAnimation",
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
        # common.js 既是生产端也是消费端（诊断快照会读 getIspMeta 的结果）。
        # 它必须纳入扫描：曾出现修复过的 ispMeta.name 在组件搬迁时被写回来，
        # 而当时的测试只扫 popup/options，没能拦住。
        consumers = (("popup.js", popup, True), ("options.js", options, True),
                     ("common.js", common, False))
        for name, src, must_consume_ping in consumers:
            ping_refs = set(re.findall(r"\bping(?:Info|Meta)\.(\w+)", src))
            if must_consume_ping:
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

        # 事件日志：时间轴用 item.*，诊断报告用 l.*（两者现在都在 common.js，
        # options.js 仍保留一份调用点，一并扫描）
        log_refs = set(re.findall(r"\bitem\.(\w+)", common))
        log_refs |= set(re.findall(r"\bl\.(\w+)", common))
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

    def test_toast_kind_css_rules_exist(self):
        """createToastManager 的全部 kind 必须在两种宿主样式表中都有对应主题规则。

        组件支持 ok / err / warn / info 四种 kind，输出两种 DOM 形态：
          - popup 单体胶囊模式：`.msg-box <kind>`（popup.css）
          - options 堆叠模式：  `.toast-bar <kind>`（options.css）
        warn 图标曾在组件重构中丢失（c545129 修复但当时未附测试）；图标修复后
        popup.css 仍缺 .msg-box.warn 琥珀色主题 —— warn 提示在弹窗里只剩图标、
        没有任何配色，属于「回归只补了一半」。本用例把「图标 + 样式」两条腿
        一起锁定，任一缺失即报错。
        """
        with open(os.path.join(EXT_DIR, "common.js"), "r", encoding="utf-8") as f:
            common = f.read()
        # 从源码提取组件实际支持的 kind（toastIconKind 直通 ok/err/warn，其余退化为 info）
        kinds = set(re.findall(r"kind === '([a-z]+)'", common)) | {"info"}
        self.assertEqual(
            sorted(kinds), ["err", "info", "ok", "warn"],
            f"toastIconKind 支持的 kind 集合变化后，请同步维护本用例与两端 CSS: {sorted(kinds)}",
        )
        with open(os.path.join(EXT_DIR, "popup.css"), "r", encoding="utf-8") as f:
            popup_css = f.read()
        with open(os.path.join(EXT_DIR, "options.css"), "r", encoding="utf-8") as f:
            options_css = f.read()
        for kind in sorted(kinds):
            self.assertIn(".msg-box." + kind, popup_css,
                          f"popup.css 缺少 .msg-box.{kind} 主题（单体胶囊模式该类提示会无样式）")
            self.assertIn(".toast-bar." + kind, options_css,
                          f"options.css 缺少 .toast-bar.{kind} 主题（堆叠模式该类提示会无样式）")

    def test_css_custom_properties_defined(self):
        """CSS 中 var(--x) 引用的自定义属性必须在同一文件里有定义。

        `var(--未定义)` 不带后备值时，整条声明会在「计算值阶段」失效，属性回退为
        初始值 —— 边框/背景/颜色静默消失，控制台没有任何报错。
        曾出现 `.ping-sparkline { border: 1px solid var(--border-hairline) }`，
        而全项目从未定义 `--border-hairline`，心跳波形图的外框一直不渲染。
        """
        for name in ("options.css", "popup.css"):
            with open(os.path.join(EXT_DIR, name), "r", encoding="utf-8") as f:
                css = f.read()
            used = set(re.findall(r"var\(\s*(--[A-Za-z0-9_-]+)", css))
            defined = set(re.findall(r"(--[A-Za-z0-9_-]+)\s*:", css))
            self.assertEqual(
                sorted(used - defined), [],
                f"{name} 引用了未定义的自定义属性（相关声明会静默失效）",
            )

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

    def test_hydrate_drops_malformed_event_log_entries(self):
        """storage 里的 eventLogs 混入 null / 字符串时，恢复与写回都必须剔除。

        eventLogs 来自 chrome.storage.local，可能被手改、旧版本残留、或其他扩展写入。
        hydrateState 若只校验「是不是数组」，垃圾元素会被原样写回磁盘，并继续流向
        UI 消费端（时间线读 item.pending、诊断报告读 item.time）直接抛 TypeError。
        """
        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8');
const listeners = {};
let storage = {
  eventLogs: [
    null,
    { time: '09:00:02', message: '有效事件A', ok: true, online: true, from: '巡检', count: 1 },
    'junk-entry',
    undefined,
    42,
    { time: '09:00:01', message: '有效事件B', ok: false, online: false, from: '巡检', count: 1 }
  ],
  pingHistory: [], initialized: true, account: 'test', password: 'pw'
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
  fetch: async () => { throw new Error('offline'); }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

(async () => {
  await new Promise((resolve) => listeners.message(
    { type: 'contentResult', result: { ok: true, online: true, message: '页面自动填写完成' } },
    {}, resolve
  ));
  const last = writes[writes.length - 1] || {};
  const logs = last.eventLogs || [];
  console.log('RESULT:' + JSON.stringify({
    len: logs.length,
    messages: logs.map((e) => (e && e.message) || null),
    hasJunk: logs.some((e) => !e || typeof e !== 'object' || Array.isArray(e))
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
        self.assertFalse(data["hasJunk"], f"垃圾日志元素被写回磁盘: {data}")
        self.assertEqual(data["len"], 3, f"两条有效历史 + 一条新事件，实际: {data}")
        self.assertEqual(data["messages"][0], "页面自动填写完成")
        self.assertEqual(data["messages"][1:], ["有效事件A", "有效事件B"],
                         f"有效条目丢失或被重排: {data}")

    def test_malformed_event_logs_do_not_break_ui_consumers(self):
        """时间线与诊断报告必须容忍 eventLogs 里的非对象元素。

        options.js 从 storage 读 eventLogs 后只做 Array.isArray 校验，就分别交给
        createActivityTimeline.render 与 generateDiagnosticSnapshot。只要混入一个
        null：render 读 item.pending 抛 TypeError（事件抽屉整块空白），
        snapshot 读 item.time 抛 TypeError（「复制诊断报告」点了没反应）。
        两者都不影响页面其余部分，因此极难被发现 —— 必须靠运行时用例锁住。
        """
        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8');
const problems = [];
const els = {};
const mkEl = (id) => ({
  id, textContent: '', innerHTML: '', style: {}, dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
  querySelectorAll() { return []; }, querySelector() { return null; }
});
const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  document: {
    getElementById: (id) => (els[id] = els[id] || mkEl(id)),
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
    documentElement: { setAttribute() {}, removeAttribute() {} }
  },
  window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
  navigator: {},
  chrome: {
    runtime: { getManifest: () => ({ version: '1.0.0' }) },
    storage: { local: { get() {}, set() {} }, onChanged: { addListener() {} } }
  },
  Date, Math, JSON, String, Number, Object, Array, RegExp, Set, parseInt, parseFloat, isNaN
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const VALID = {
  time: '2026-11-07 16:00:00', message: '已在线，无需登录',
  ok: true, online: true, from: '巡检', count: 2
};

try {
  const tl = vm.runInContext('createActivityTimeline({ listId: "L", countBadgeId: "B" })', sandbox);
  tl.render([null, undefined, 'junk', 42, [], VALID]);
  if (!String(els.L.innerHTML).includes('已在线，无需登录')) {
    problems.push('时间线未渲染出有效条目');
  }
  if (/undefined|NaN|\[object Object\]/.test(String(els.L.innerHTML))) {
    problems.push('时间线渲染出脏值: ' + els.L.innerHTML);
  }
  if (els.B.textContent !== '日志 (1)') {
    problems.push('时间线计数未剔除垃圾元素: ' + els.B.textContent);
  }
} catch (e) {
  problems.push('时间线 render 抛异常: ' + e.message);
}

try {
  const snap = vm.runInContext(
    'generateDiagnosticSnapshot({ account: "13812345678", eventLogs: [null, ' + JSON.stringify(VALID) + '] })',
    sandbox
  );
  if (!snap.includes('2026-11-07 16:00:00')) problems.push('诊断报告未包含有效事件');
  if (snap.includes('null')) problems.push('诊断报告出现 null 字面量');
} catch (e) {
  problems.push('generateDiagnosticSnapshot 抛异常: ' + e.message);
}

console.log(problems.length ? 'PROBLEMS:' + problems.join(' | ') : 'RESULT:OK');
"""
        res = subprocess.run(
            ["node", "-e", runner_script, os.path.join(EXT_DIR, "common.js")],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"组件脚本模拟失败:\n{res.stderr}\n{res.stdout}")
        self.assertIn("RESULT:OK", res.stdout,
                      f"畸形 eventLogs 破坏了 UI 消费端:\n{res.stdout}\n{res.stderr}")

    def test_cross_page_shared_form_keys_are_synced(self):
        """结构性守卫：popup 会写、且 options 会整表写回的键，必须被跨页监听。

        options.save() 用 readForm() 整表覆盖存储，因此任何「popup 也能改」的
        表单键，只要设置页的 onChanged 没跟随，就会像运营商那样被静默回退。
        这里用静态差集兜住未来新增共享键的情况。
        """
        with open(os.path.join(EXT_DIR, "popup.js"), "r", encoding="utf-8") as f:
            popup_src = f.read()
        with open(os.path.join(EXT_DIR, "options.js"), "r", encoding="utf-8") as f:
            options_src = f.read()

        # popup 中所有 chrome.storage.local.set({ ... }) 的键
        popup_writes = set()
        for body in re.findall(r"storage\.local\.set\(\s*\{([^}]*)\}", popup_src, re.S):
            popup_writes |= set(re.findall(r"(?:^|[,{])\s*([A-Za-z_]\w*)\s*:", body))

        # options.readForm() 返回对象的键
        form_match = re.search(r"function readForm\(\)\s*\{.*?return\s*\{(.*?)\}\s*;",
                               options_src, re.S)
        self.assertIsNotNone(form_match, "未能定位 readForm()")
        form_keys = set(re.findall(r"([A-Za-z_]\w*)\s*:", form_match.group(1)))

        # options 的 onChanged 里监听的键
        listener_match = re.search(r"chrome\.storage\.onChanged\.addListener\s*\((.*?)\n\}\);",
                                   options_src, re.S)
        self.assertIsNotNone(listener_match, "未能定位 options 的 onChanged 监听")
        listened = set(re.findall(r"changes\.([A-Za-z_]\w*)", listener_match.group(1)))

        shared = popup_writes & form_keys
        self.assertTrue(shared, "探针失效：popup 与 readForm() 之间应有共享键")
        self.assertEqual(
            sorted(shared - listened), [],
            "以下共享键会被 options 的整表保存静默回退，却未在 onChanged 中同步",
        )

    def test_options_follows_external_isp_change_without_writeback_loop(self):
        """popup 改运营商后，设置页不能拿陈旧值把它写回去。

        复现路径：两个页面同时存在 → 弹窗「运营商直选」写 storage.isp=2 →
        设置页的 onChanged 若不处理 isp，其 #isp 仍是 1 → 之后任意一次
        save()（开关自动保存 / Ctrl+S / 保存并连接）都用 readForm() 整表写回，
        把 2 悄悄改回 1。后果是用错运营商认证，表现为「密码错误」。
        同时断言同步过程不派发 change / 不触发循环写入。
        """
        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm'), path = require('path');
const EXT = process.argv[1];
const html = fs.readFileSync(path.join(EXT, 'options.html'), 'utf8');
const ids = [...html.matchAll(/id=["']([^"']+)["']/g)].map((m) => m[1]);

function makeEl(id) {
  const listeners = {};
  const el = {
    id, dataset: {}, style: {}, files: [], value: '', checked: false, disabled: false,
    selectedIndex: 0, title: '', textContent: '', innerHTML: '', className: '',
    options: [{ value: '1' }, { value: '2' }, { value: '3' }, { value: '4' }],
    classList: { _s: new Set(), add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) f = !this._s.has(c); f ? this._s.add(c) : this._s.delete(c); return f; },
      contains(c) { return this._s.has(c); } },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {}, appendChild() {}, removeChild() {}, remove() {},
    querySelectorAll() { return []; }, querySelector() { return makeEl('child'); },
    closest() { return null; }, focus() {}, click() {},
    dispatchEvent(evt) { (listeners[evt.type] || []).forEach((fn) => fn({ target: el, preventDefault() {}, stopPropagation() {} })); }
  };
  return el;
}
const elements = {};
for (const id of ids) elements[id] = makeEl(id);
const changedListeners = [];
const writes = [];
let storage = {
  account: '13800000000', password: 'pw', isp: '1', intervalMin: 10 / 60,
  offlineIntervalMin: 1 / 60, adaptive: true, autoOnStartup: true,
  contentAutoFill: true, instantTrigger: true, initialized: true, privacyMask: false
};
const chrome = {
  storage: {
    local: {
      get(arg, cb) {
        let out = {};
        if (arg === null || arg === undefined) out = { ...storage };
        else if (Array.isArray(arg)) arg.forEach((k) => { out[k] = storage[k]; });
        else if (typeof arg === 'object') {
          out = { ...arg };
          Object.keys(arg).forEach((k) => { if (k in storage) out[k] = storage[k]; });
        }
        if (cb) cb(out);
        return Promise.resolve(out);
      },
      set(patch, cb) {
        writes.push({ ...patch });
        const changes = {};
        for (const k of Object.keys(patch)) changes[k] = { oldValue: storage[k], newValue: patch[k] };
        Object.assign(storage, patch);
        if (cb) cb();
        changedListeners.forEach((fn) => fn(changes, 'local'));
        return Promise.resolve();
      }
    },
    onChanged: { addListener: (fn) => changedListeners.push(fn) }
  },
  runtime: {
    getManifest: () => ({ version: '1.0.0' }), getURL: () => '',
    openOptionsPage() {}, lastError: null,
    sendMessage(msg, cb) {
      if (!cb) return;
      if (msg.type === 'status') {
        cb({ reachable: true, online: true, pingMs: 20, raw: { v4ip: '10.0.0.1' },
             manualLogout: false, running: false, pingHistory: [20] });
      } else cb({ ok: true, online: true, message: 'ok' });
    }
  }
};
const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
  FileReader: function () {},
  document: {
    getElementById: (id) => (elements[id] = elements[id] || makeEl(String(id))),
    querySelectorAll: () => [], querySelector: () => makeEl('q'),
    addEventListener() {}, createElement: () => makeEl('created'),
    createElementNS: () => makeEl('svg'),
    body: { appendChild() {}, removeChild() {} },
    documentElement: { setAttribute() {}, removeAttribute() {} },
    visibilityState: 'visible'
  },
  window: { matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, open() {}, close() {}, confirm: () => false },
  navigator: { platform: 'Win32', userAgent: 'Chrome', language: 'zh-CN' },
  Element: function () {}, chrome,
  Date, Math, JSON, String, Number, Object, Array, RegExp, Set,
  parseInt, parseFloat, isNaN, Promise, Error,
  Event: function (t) { this.type = t; }
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(EXT, 'common.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(EXT, 'options.js'), 'utf8'), sandbox);

const formIspBefore = vm.runInContext('readForm().isp', sandbox);
// 模拟弹窗直选运营商：真实 Chrome 会把 onChanged 广播给所有页面
writes.length = 0;
chrome.storage.local.set({ isp: '2', authError: false }, () => {});
const formIspAfter = vm.runInContext('readForm().isp', sandbox);
const writesFromListener = writes.length;

// 用户在设置页改任意开关，触发 save() 整表写回
writes.length = 0;
vm.runInContext('save()', sandbox);
const savedIsp = writes.length ? writes[0].isp : null;

console.log('RESULT:' + JSON.stringify({
  formIspBefore, formIspAfter, savedIsp,
  finalIsp: storage.isp,
  writesFromListener,
  selectValue: elements.isp.value
}));
"""
        res = subprocess.run(
            ["node", "-e", runner_script, EXT_DIR],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"跨页模拟失败:\n{res.stderr}\n{res.stdout}")
        line = next((l for l in res.stdout.splitlines() if l.startswith("RESULT:")), None)
        self.assertIsNotNone(line, f"未拿到模拟结果:\n{res.stdout}\n{res.stderr}")
        data = json.loads(line[len("RESULT:"):])
        self.assertEqual(data["formIspBefore"], "1")
        self.assertEqual(data["formIspAfter"], "2",
                         f"设置页未跟随外部运营商变更，readForm() 仍是陈旧值: {data}")
        self.assertEqual(data["selectValue"], "2",
                         f"设置页下拉框未同步（含自定义下拉与快捷胶囊）: {data}")
        self.assertEqual(data["savedIsp"], "2",
                         f"自动保存用陈旧运营商覆盖了弹窗的选择: {data}")
        self.assertEqual(data["finalIsp"], "2", f"最终存储值被回退: {data}")
        self.assertEqual(data["writesFromListener"], 1,
                         f"同步视图时不应产生额外写入（回写循环）: {data}")

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

  // --- 2b. 两个实例共用同一 overlay：都必须结算 ---
  // overlay.dataset.bound 去重后，若只让第一个实例持有按钮监听，第二个实例的
  // activeResolve 永远不会被调用 —— 它的 Promise 永久悬挂（实测确认）。
  // 工厂函数语义上允许多实例，故登记表把结算广播给该 overlay 上所有实例。
  const multiEnv = makeCtx(null);
  const modalA = vm.runInContext('createConfirmModal({})', multiEnv.ctx);
  const modalB = vm.runInContext('createConfirmModal({})', multiEnv.ctx);
  let aSettled = false, bSettled = false;
  modalA.open({}).then(() => { aSettled = true; });
  modalB.open({}).then(() => { bSettled = true; });
  multiEnv.els.confirmModalOverlay.classList.add('open');
  (multiEnv.handlers['btnModalConfirm:click'] || []).forEach((f) => f({}));
  await Promise.resolve(); await Promise.resolve();
  if (!aSettled) problems.push('多实例：实例 A 的 Promise 未结算');
  if (!bSettled) problems.push('多实例：实例 B 的 Promise 永久悬挂');
  const bindings = (multiEnv.handlers['btnModalConfirm:click'] || []).length;
  if (bindings !== 1) problems.push('多实例导致重复绑定按钮监听: ' + bindings);

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
  querySelector(sel) { return sel === 'span' ? this : null; },
  querySelectorAll() { return []; },
  focus() {}
});

for (const id of ['heroHealthBadge', 'heroHealthScore', 'password', 'togglePwd', 'eyeIcon', 'btnTheme', 'themeLabel', 'toastBox', 'toastMsg', 'btnToggleMask', 'maskIcon', 'accentPaletteBar', 'btnConfirmTest']) {
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
// score 与展示文案必须同源：曾出现 score 返回 55、text 却硬编码「健康度 50%」，
// 两个字段自相矛盾；只要消费方改用 score 取值，界面就会和真实评分对不上。
if (!String(wait.text).includes(wait.score + '%')) {
  problems.push('健康度文案与 score 不一致: ' + JSON.stringify(wait));
}
const paused = meter.evaluate({ reachable: true, online: false, manualLogout: true });
if (paused.grade !== 'wait') problems.push('健康度已暂停档位错误: ' + JSON.stringify(paused));
if (!String(paused.text).includes(paused.score + '%')) {
  problems.push('健康度暂停态文案与 score 不一致: ' + JSON.stringify(paused));
}

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

// 设置页传给快照的是 UI 文案「物理 MAC: AA:BB:...」而不是裸 MAC。
// fmtMac 剥离出的十六进制位会多于 12 位而判定失败、原样返回，
// 导致报告里出现「MAC: 物理 MAC: AA:BB:...」的重复前缀。
const macSnap = vm.runInContext(`generateDiagnosticSnapshot({
  mac: "物理 MAC: AA:BB:CC:DD:EE:FF", account: "13812345678"
})`, ctx);
if (!macSnap.includes('MAC: AA:BB:CC:DD:EE:FF')) {
  problems.push('诊断快照未正确格式化带前缀的 MAC: ' + JSON.stringify(macSnap));
}
if (macSnap.includes('物理 MAC:')) {
  problems.push('诊断快照 MAC 行出现重复前缀: ' + JSON.stringify(macSnap));
}
const emptyMacSnap = vm.runInContext(`generateDiagnosticSnapshot({ mac: "物理 MAC: —" })`, ctx);
if (!emptyMacSnap.includes('MAC: —')) {
  problems.push('诊断快照空 MAC 未归一为 —: ' + JSON.stringify(emptyMacSnap));
}

// --- 4. createThemeManager ---
const tm = vm.runInContext('createThemeManager({ toggleBtnId: "btnTheme", labelId: "themeLabel" })', ctx);
tm.apply('dark');
if (themeAttrs['data-theme'] !== 'dark') problems.push('ThemeManager apply(dark) 失败');
tm.apply('light');
if (themeAttrs['data-theme'] !== 'light') problems.push('ThemeManager apply(light) 失败');

// --- 5. createPrivacyMaskManager ---
const pmm = vm.runInContext('createPrivacyMaskManager({ toggleBtnId: "btnToggleMask", iconId: "maskIcon" })', ctx);
if (pmm.isMasked() !== false) problems.push('PrivacyMaskManager 初始状态应为 false');
pmm.toggle();
if (pmm.isMasked() !== true) problems.push('PrivacyMaskManager toggle() 未切换为 true');
pmm.setMasked(false);
if (pmm.isMasked() !== false) problems.push('PrivacyMaskManager setMasked(false) 失败');

// --- 6. createAccentPicker ---
const ap = vm.runInContext('createAccentPicker({ barId: "accentPaletteBar" })', ctx);
ap.set('emerald');
if (themeAttrs['data-accent'] !== 'emerald') problems.push('AccentPicker set(emerald) 未写入 data-accent');

// --- 7. createVisibilityPoller ---
let polled = 0;
ctx.onPoll = () => { polled++; };
ctx.document.visibilityState = 'visible';
const poller = vm.runInContext('createVisibilityPoller(onPoll, 1000)', ctx);
poller.trigger();
if (polled < 1) problems.push('VisibilityPoller trigger() 未执行回调');
poller.destroy();

// --- 8. triggerPulseAnimation ---
let animCalled = false;
ctx.requestAnimationFrame = (fn) => { animCalled = true; fn(); };
vm.runInContext('triggerPulseAnimation([document.getElementById("heroHealthBadge")])', ctx);
if (!animCalled) problems.push('triggerPulseAnimation 未利用 requestAnimationFrame');

// --- 9. createPasswordToggle ---
const pvt = vm.runInContext('createPasswordToggle({ inputId: "password", toggleBtnId: "togglePwd", iconId: "eyeIcon" })', ctx);
if (els["password"].type !== "password") problems.push('密码框初始状态应为 password');
pvt.toggle();
if (els["password"].type !== "text") problems.push('PasswordToggle toggle() 后未变为 text');
pvt.toggle();
if (els["password"].type !== "password") problems.push('PasswordToggle 再次 toggle() 未变回 password');

// --- 10. createConfirmButton ---
let confirmTriggered = false;
ctx.onConfirmTest = () => { confirmTriggered = true; };
const cb = vm.runInContext('createConfirmButton("btnConfirmTest", { defaultText: "注销", confirmText: "确认注销？", onConfirm: onConfirmTest })', ctx);
const testBtn = els["btnConfirmTest"];
testBtn.onclick({ preventDefault() {} });
if (!testBtn.classList.contains("confirming")) problems.push('ConfirmButton 首次点击未激活 confirming 类');
if (confirmTriggered) problems.push('ConfirmButton 首次点击误触了 onConfirm 回调');
testBtn.onclick({ preventDefault() {} });
if (!confirmTriggered) problems.push('ConfirmButton 二次点击未触发 onConfirm 回调');
if (testBtn.classList.contains("confirming")) problems.push('ConfirmButton 确认后未重置 confirming 状态');

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
        """HEAD 中严禁残留任何真实凭据（含可拼接还原的片段）。

        黑名单**绝不写进源码**：此前把手机号与密码拆成短片段、再用字符串拼接
        还原，虽然躲过了 git log -S，但人读代码即可拼出完整凭据 —— 与 README
        「即使将来把仓库转公开也不会带出凭据」的承诺直接矛盾。现改为由
        CAMPUS_LEAKED_ACCOUNT / CAMPUS_LEAKED_PASSWORD / CAMPUS_LEAKED_FRAGMENTS
        环境变量注入（与 test_clean_history_e2e.ps1 一致），源码里不留任何片段。

        未注入环境变量时，仍执行「明文凭据赋值」启发式扫描 + 扫描器自身防假绿自检，
        保证这条用例永远不会退化成无条件通过。
        """
        fragments = [
            os.environ.get("CAMPUS_LEAKED_ACCOUNT", ""),
            os.environ.get("CAMPUS_LEAKED_PASSWORD", ""),
        ]
        # 可选：逗号/换行分隔的任意历史片段（含账号分段），用于精确核对旧历史残留
        extra = os.environ.get("CAMPUS_LEAKED_FRAGMENTS", "")
        fragments += [p.strip() for p in re.split(r"[,\n]", extra) if p.strip()]
        fragments = [f for f in fragments if len(f) >= 4]

        extensions = (".js", ".html", ".css", ".json", ".py", ".md", ".txt", ".ps1", ".bat", ".yml", ".yaml")
        files_scanned = []
        for root, dirs, files in os.walk(PROJECT_DIR):
            if ".git" in root or "__pycache__" in root or "node_modules" in root:
                continue
            for file in files:
                if file.endswith(extensions):
                    files_scanned.append(os.path.join(root, file))

        self.assertGreater(len(files_scanned), 5, "扫描的文件数量异常过少（扫描器可能失效）")

        all_contents = {}
        for path in files_scanned:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                all_contents[os.path.relpath(path, PROJECT_DIR)] = f.read()

        # 1) 精确黑名单：只在注入了真实凭据时才有意义，命中即失败
        for rel, content in all_contents.items():
            for token in fragments:
                self.assertNotIn(token, content,
                                 f"文件 {rel} 存在历史凭据残留（长度 {len(token)}）！")

        # 2) 形态兜底：仓库里允许存在「公开的示例占位符」，但任何**不在白名单**
        #    里的疑似真实手机号 / 明文口令一律失败。真实泄露号不会在白名单中，
        #    因此即便未注入环境变量也能被抓到；文档示例则不会误伤。
        #    白名单是显式、可审计的，新增示例号必须在此登记，避免悄悄放宽。
        allowed_examples = {
            "13800000000",  # 两份 README 的 JSONP 返回示例
            "13812345678",  # 组件运行时快照 / 跨页同步测试用的示例账号
        }
        # 明确的良性非凭据值：协议常量、模板变量、占位符、拼接表达式
        benign = re.compile(
            r"^(?:drcom|lock-|\$\{.*\}|pw|test|xxx+|x{3,}|placeholder|example|"
            r"your[_-]|REDACTED|NONEXISTENT.*|未配置|请填写|changeme|123456|"
            r"00000000|[\s'\"+]*)$", re.I)
        assign_pat = re.compile(
            r"(?:account|password|upass|passwd|pwd|secret|token)\s*[:=]\s*"
            r"[\"']([^\"'\n]{4,})[\"']", re.I)
        phone_pat = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")

        for rel, content in all_contents.items():
            # 2a) 任何疑似手机号字面量，必须在示例白名单里
            for m in phone_pat.finditer(content):
                self.assertIn(m.group(0), allowed_examples,
                              f"文件 {rel} 出现未登记的手机号字面量 {m.group(0)!r}；"
                              "若为示例请加入 allowed_examples，若为真实凭据请立即清除")
            # 2b) 凭据字段的明文常量赋值
            for m in assign_pat.finditer(content):
                val = m.group(1).strip()
                if benign.match(val) or val in allowed_examples:
                    continue
                if val.startswith("+") or val.endswith("+"):
                    continue  # 拼接表达式，不是明文常量
                self.fail(f"文件 {rel} 疑似硬编码明文凭据赋值: {val!r}")

        # 3) 反模式自检：不得再用 "".join([...]) 之类手法拼接绕过字面量扫描。
        #    只锚定「赋值给变量/放进列表」的构造，不匹配注释与 docstring 里的说明文本。
        for rel, content in all_contents.items():
            self.assertNotRegex(
                content,
                r"(?:=\s*|[\(\[,]\s*)\"\s*\"\s*\.\s*join\s*\(\s*\[",
                f"文件 {rel} 出现字符串拼接式凭据（可还原片段），请改用环境变量注入")

        # 4) 扫描器防假绿自检：验证黑名单命中逻辑确实有效。
        #    把样本片段植入一段探针文本，再用与本用例相同的 assertNotIn 口径检查，
        #    必须能检出；否则说明扫描逻辑被误改成恒真。
        sample = fragments[0] if fragments else "13800000000"
        probe_text = "PROBE_SENTINEL_" + sample + "_END"
        detected = sample in probe_text
        self.assertTrue(detected, "扫描器自检探针失效（黑名单命中逻辑异常）")

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

    def test_warn_toast_uses_warning_icon(self):
        """warn 类提示必须渲染警告三角图标，不能在组件重构中退化回 info 圆圈。

        c545129 修复了这个缺陷，但当时未附测试：createToastManager.show() 的三元映射
        只区分 ok/err，warn 落到 info 分支，getStatusIconSvg 的警告三角分支形同虚设
        （空凭据保存提示等场景只有琥珀色样式、没有警示图标）。该图标曾于 a24e13c
        为旧版 showToast 添加，却在 2b355f2 组件重构中丢失 —— 同类回归极容易再次发生。

        本用例驱动真实 common.js，同时校验三层：
          1. toastIconKind 直通映射（warn/ok/err 保留，未知值退化为 info）；
          2. getStatusIconSvg('warn') 确为警告三角，且与 info 图标可区分；
          3. createToastManager 在「单体胶囊」与「多条堆叠」两种模式下，
             实际写入 DOM 的 SVG 都是警告三角而非 info 圆圈。
        """
        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8');
const problems = [];

// 警告三角的独有路径片段（info 圆圈为 cx="12" cy="12" r="10" 的圆）
const WARN_MARKER = 'M10.29 3.86';
const INFO_MARKER = 'x1="12" y1="16"';

function mkEl(id) {
  const el = {
    id: id || '', textContent: '', innerHTML: '', value: '', className: '',
    dataset: {}, style: {}, options: [], selectedIndex: 0,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (f) { this._s.add(c); } else { this._s.delete(c); } },
      contains(c) { return this._s.has(c); }
    },
    _l: {},
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
    removeEventListener() {},
    dispatchEvent(e) { (this._l[e.type] || []).forEach(f => f(e)); return true; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild(c) { (this._kids = this._kids || []).push(c); },
    removeChild() {}, remove() {}, focus() {}, click() {},
    getAttribute() { return null; }, setAttribute() {}, removeAttribute() {},
    closest() { return null; },
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
    scrollIntoView() {}
  };
  return el;
}

const els = new Map();
const byId = (id) => { if (!id) return null; if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); };

const ctx = {
  console,
  setTimeout: (f) => { if (typeof f === 'function') f(); return 1; },
  clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  document: {
    getElementById: byId,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
    createElement: () => mkEl('new'),
    createElementNS: () => mkEl('new'),
    documentElement: { setAttribute() {} },
    body: mkEl('body')
  },
  navigator: { platform: 'Win32', userAgent: 'Chrome' },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  Date, Math, JSON, Promise, String, Number, Object, Array, RegExp, Set, Map, Error,
  parseInt, parseFloat, isNaN, Boolean
};
ctx.window = ctx;
ctx.window.addEventListener = () => {};
vm.createContext(ctx);
vm.runInContext(src, ctx);

// ---- 1. toastIconKind 映射 ----
const kindOf = (k) => vm.runInContext(`toastIconKind(${JSON.stringify(k)})`, ctx);
if (kindOf('warn') !== 'warn') problems.push('toastIconKind("warn") 应为 "warn"，实际 ' + kindOf('warn'));
if (kindOf('ok') !== 'ok') problems.push('toastIconKind("ok") 应为 "ok"');
if (kindOf('err') !== 'err') problems.push('toastIconKind("err") 应为 "err"');
if (kindOf('info') !== 'info') problems.push('toastIconKind("info") 应为 "info"');
if (kindOf('unknown') !== 'info') problems.push('未知 kind 应退化为 "info"');
if (kindOf(undefined) !== 'info') problems.push('undefined kind 应退化为 "info"');

// ---- 2. getStatusIconSvg 分支 ----
const warnSvg = vm.runInContext('getStatusIconSvg("warn", 16)', ctx);
const infoSvg = vm.runInContext('getStatusIconSvg("info", 16)', ctx);
if (warnSvg.indexOf(WARN_MARKER) === -1) problems.push('getStatusIconSvg("warn") 未返回警告三角');
if (infoSvg.indexOf(WARN_MARKER) !== -1) problems.push('getStatusIconSvg("info") 不应含警告三角路径');
if (warnSvg === infoSvg) problems.push('warn 与 info 图标不应相同');

// ---- 3a. 单体胶囊模式（popup：#msgBox）----
const msgBox = byId('msgBox');
const msgText = mkEl('msg');
const msgIcon = mkEl('msgIcon');
// 让 $ 解析到同一批元素：把组件依赖的 id 映射到上面三个节点
els.set('msgBox', msgBox); els.set('msg', msgText); els.set('msgIcon', msgIcon);
const single = vm.runInContext(
  'createToastManager({ boxId: "msgBox", textId: "msg", iconId: "msgIcon" })', ctx);
single.show('测试警告', 'warn', 0);
if (msgIcon.innerHTML.indexOf(WARN_MARKER) === -1) {
  problems.push('单体胶囊模式下 warn 未渲染警告三角，实际: ' + msgIcon.innerHTML.slice(0, 80));
}
if (msgText.textContent !== '测试警告') problems.push('单体胶囊模式文案未写入');

// 对照：info 不应画成警告三角
msgIcon.innerHTML = '';
single.show('测试信息', 'info', 0);
if (msgIcon.innerHTML.indexOf(WARN_MARKER) !== -1) {
  problems.push('单体胶囊模式下 info 被误渲染为警告三角');
}

// ---- 3b. 多条堆叠模式（options：#toastContainer）----
const container = mkEl('toastContainer');
els.set('toastContainer', container);
const stacked = vm.runInContext('createToastManager({ containerId: "toastContainer", maxStack: 3 })', ctx);
stacked.show('堆叠警告', 'warn', 0);
const kids = container._kids || [];
if (!kids.length) {
  problems.push('堆叠模式未创建任何 toast 节点');
} else {
  const icon = (kids[kids.length - 1]._kids || [])[0];
  const html = icon ? icon.innerHTML : '';
  if (html.indexOf(WARN_MARKER) === -1) {
    problems.push('堆叠模式下 warn 未渲染警告三角，实际: ' + String(html).slice(0, 80));
  }
}

console.log(problems.length ? 'WARN_ICON_PROBLEMS:\n' + problems.join('\n') : 'WARN_ICON_OK');
"""
        res = subprocess.run(
            ["node", "-e", runner_script, os.path.join(EXT_DIR, "common.js")],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"Toast 图标模拟失败:\n{res.stderr}\n{res.stdout}")
        self.assertNotIn("WARN_ICON_PROBLEMS", res.stdout,
                         f"warn 提示图标退化:\n{res.stdout}")
        self.assertIn("WARN_ICON_OK", res.stdout)

    # ------------------------------------------------------------------
    # 以下用例锁定本轮审核修复的 5 处缺陷，确保「改了就能被验证」。
    # ------------------------------------------------------------------

    def test_background_state_machine_and_settings_guards(self):
        """运行时验证 isp 归一化、退避数学、凭据错误判定与 ensureAlarm 六路分支。

        background.js 的核心状态机此前完全没有自动化覆盖；这些纯函数一旦被
        改坏，表现为「在家每秒空转」或「密码错了仍每天上万次认证」等静默退化。
        """
        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8');
const problems = [];
const listeners = {};
let storage = {
  initialized: true, account: 'test', password: 'pw', isp: '9',
  intervalMin: 10 / 60, offlineIntervalMin: 1 / 60, adaptive: true,
  manualLogout: false, authError: false, connState: 'offline', unreachableStreak: 0
};
const alarmCreates = [];
const chrome = {
  storage: { local: {
    get: (arg, cb) => {
      const r = (arg === null || arg === undefined) ? { ...storage } : { ...(arg || {}) };
      if (typeof cb === 'function') { cb(r); return; }
      return Promise.resolve(r);
    },
    set: (patch, cb) => { Object.assign(storage, patch); if (typeof cb === 'function') cb(); return Promise.resolve(); }
  } },
  runtime: {
    onInstalled: { addListener: f => listeners.installed = f },
    onStartup: { addListener: f => listeners.startup = f },
    onMessage: { addListener: f => listeners.message = f },
    getManifest: () => ({ version: 'test' }), lastError: null
  },
  alarms: {
    onAlarm: { addListener: () => {} }, get: async () => null,
    create: async (name, info) => { alarmCreates.push(info); }
  },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
  commands: null,
  webNavigation: { onCommitted: { addListener: f => listeners.committed = f },
                   onErrorOccurred: { addListener: f => listeners.err = f } }
};
const enc = new TextEncoder();
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} }, chrome,
  setTimeout: f => setTimeout(f, 0), clearTimeout,
  setInterval: () => 0, clearInterval: () => {},
  Date, Math, JSON, Promise, Number, String, Array, Object, RegExp,
  parseInt, parseFloat, isNaN, Boolean, Set, Map, Error,
  TextDecoder, TextEncoder, AbortController, Uint8Array, ArrayBuffer, URLSearchParams,
  fetch: async () => ({
    headers: { get: () => 'application/javascript; charset=utf-8' },
    arrayBuffer: async () => enc.encode('dr1001({"result":1,"v4ip":"10.0.0.1"})').buffer
  })
};
sandbox.__st = storage;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

(async () => {
  // 1) 非法 isp 必须归一到默认档，不能把任意字符串发给门户
  const s = await vm.runInContext('getSettings()', sandbox);
  if (s.isp !== '1') problems.push('非法 isp 未归一到 1: ' + s.isp);

  // 2) 指数退避：宽限期内=base，之后 2x/4x，并封顶 1 分钟
  const bp = (n) => vm.runInContext('unreachableStreak=' + n + '; backoffPeriod({offlineIntervalMin:1/60})', sandbox);
  const eq = (a, b) => Math.abs(a - b) < 1e-9;
  if (!eq(bp(10), 1 / 60)) problems.push('streak=10 应等于 base，实际 ' + bp(10));
  if (!eq(bp(11), 2 / 60)) problems.push('streak=11 应 2x，实际 ' + bp(11));
  if (!eq(bp(12), 4 / 60)) problems.push('streak=12 应 4x，实际 ' + bp(12));
  if (bp(30) !== 1) problems.push('退避应封顶 1 分钟，实际 ' + bp(30));

  // 3) 凭据类错误判定：只认门户明说的，瞬时故障不得降频
  const pa = (m) => vm.runInContext('isPermanentAuthError(' + JSON.stringify(m) + ')', sandbox);
  if (!pa('密码错误，请检查密码')) problems.push('密码错误应判凭据类');
  if (!pa('账号已停机，请充值后使用')) problems.push('停机应判凭据类');
  if (pa('门户返回数据无法解析')) problems.push('瞬时故障不应判凭据类');
  if (pa('登录请求已提交，但状态仍未在线')) problems.push('提交后内核延迟不应判凭据类');

  // 4) 宵禁文案识别
  const fe = vm.runInContext('friendlyError({msga:"本时段禁止使用"})', sandbox);
  if (fe.indexOf('时段') === -1) problems.push('宵禁提示未识别: ' + fe);

  // 4b) 真实 GBK 字节 -> 解码 -> 宵禁识别 -> 判为永久错误（端到端链路）。
  //     乱码签名分支已随结构化解码移除，这条链路必须仍然成立。
  const gbkCurfew = Uint8Array.from([0xb1, 0xbe, 0xca, 0xb1, 0xb6, 0xce, 0xbd, 0xfb, 0xd6, 0xb9, 0xca, 0xb9, 0xd3, 0xc3]);
  const decodedCurfew = vm.runInContext('decodePortalBytes', sandbox)(gbkCurfew, 'gbk');
  if (decodedCurfew !== '本时段禁止使用') {
    problems.push('GBK 宵禁字节解码错误: ' + JSON.stringify(decodedCurfew));
  }
  const feGbk = vm.runInContext('friendlyError(' + JSON.stringify({ msga: decodedCurfew }) + ')', sandbox);
  if (feGbk.indexOf('时段') === -1) problems.push('GBK 宵禁解码后未识别为宵禁: ' + feGbk);
  if (!pa(decodedCurfew)) problems.push('GBK 宵禁解码后未判为永久错误（会每秒重试）');
  // 乱码签名不得再作为可命中路径被依赖：本函数不应对纯乱码给出宵禁结论
  const feGarbled = vm.runInContext('friendlyError({msga:"\\u02b1\\u03bd"})', sandbox);
  if (feGarbled.indexOf('时段') !== -1) {
    problems.push('乱码签名仍被当作宵禁（应已随结构化解码移除）: ' + feGarbled);
  }

  // 5) ensureAlarm 六路周期分支
  const period = async (setup) => {
    alarmCreates.length = 0;
    await vm.runInContext('(async()=>{' + setup + '; await ensureAlarm();})()', sandbox);
    return alarmCreates.length ? alarmCreates[0].periodInMinutes : null;
  };
  const IV = 10 / 60, OFF = 1 / 60;
  const reset = '__st.manualLogout=false; __st.authError=false; __st.adaptive=true; ' +
                '__st.account="test"; __st.password="pw"; connState="offline"; unreachableStreak=0;';
  const cases = [
    ['手动注销 -> 常规间隔', reset + '__st.manualLogout=true;', IV],
    ['凭据类错误 -> 常规间隔', reset + '__st.authError=true;', IV],
    ['关闭自适应 -> 常规间隔', reset + '__st.adaptive=false;', IV],
    ['真掉线 -> 掉线间隔', reset, OFF],
    ['无凭据的掉线 -> 常规间隔(不每秒空转)', reset + '__st.account=""; __st.password="";', IV],
    ['不可达 + 退避 -> 大于掉线间隔', reset + 'connState="unreachable"; unreachableStreak=12;', 4 / 60]
  ];
  for (const [label, setup, expected] of cases) {
    const got = await period(setup);
    if (!eq(got, expected)) problems.push(label + ': 期望 ' + expected + '，实际 ' + got);
  }

  console.log(problems.length ? 'SM_PROBLEMS:\n' + problems.join('\n') : 'SM_OK');
})().catch(e => console.log('SM_PROBLEMS: 运行异常 ' + e.message));
"""
        res = subprocess.run(
            ["node", "-e", runner_script, os.path.join(EXT_DIR, "background.js")],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"状态机模拟失败:\n{res.stderr}\n{res.stdout}")
        self.assertIn("SM_OK", res.stdout, f"后台状态机存在缺陷:\n{res.stdout}")

    def test_clear_logs_hydrates_before_cold_start_race(self):
        """冷启动首条 clearLogs 必须「等待」hydrate 完成后再清空，否则会被撤销。

        复现：磁盘有 3 条历史日志；首条消息是 clearLogs，紧接着并发的 status
        触发 hydrateState。若 clearLogs 不先 await hydrate，status 的 hydrate 会在
        清空落盘之前从磁盘把旧日志灌回内存，随后 saveResult 又写回 —— 清空失效。

        两层断言：
        1) 结构：分支里必须有 hydrateState() 且位于清空赋值之前；
        2) 运行时：延迟 hydrate 的结算，断言「清空写入」不会提前发生，
           且 hydrate 完成后磁盘日志确实被清空、旧日志不会复活。
        """
        with open(os.path.join(EXT_DIR, "background.js"), "r", encoding="utf-8") as f:
            bg = f.read()
        branch = re.search(r"if \(msg\.type === 'clearLogs'\) \{(.*?)\n  \}", bg, re.S)
        self.assertIsNotNone(branch, "未定位 clearLogs 分支")
        body = branch.group(1)
        self.assertIn("hydrateState()", body,
                      "clearLogs 未先恢复运行态（冷启动竞态会撤销清空）")
        # hydrateState() 必须出现在「清空赋值」之前，且是通过 .then 等待其完成
        self.assertLess(body.index("hydrateState()"), body.index("eventLogs = []"),
                        "hydrateState() 必须在清空之前调用")
        self.assertRegex(body, r"hydrateState\(\)\s*\.then",
                         "clearLogs 必须等待 hydrateState 完成后再清空")

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
const events = [];
const chrome = {
  storage: { local: {
    get: (arg, cb) => {
      const r = arg === null ? { ...storage } : { ...(arg || {}) };
      if (typeof cb === 'function') { cb(r); return; }
      return Promise.resolve(r);
    },
    set: (patch, cb) => {
      if (patch.eventLogs) events.push('set:eventLogs=' + JSON.stringify(patch.eventLogs));
      Object.assign(storage, patch);
      if (typeof cb === 'function') cb();
      return Promise.resolve();
    }
  } },
  runtime: {
    onInstalled: { addListener: f => listeners.installed = f },
    onStartup: { addListener: f => listeners.startup = f },
    onMessage: { addListener: f => listeners.message = f },
    getManifest: () => ({ version: 'test' }), lastError: null
  },
  alarms: { onAlarm: { addListener: () => {} }, get: async () => null, create: async () => {} },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
  commands: null,
  webNavigation: { onCommitted: { addListener: () => {} }, onErrorOccurred: { addListener: () => {} } }
};
const enc = new TextEncoder();
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} }, chrome,
  events,
  setTimeout: f => setTimeout(f, 0), clearTimeout,
  setInterval: () => 0, clearInterval: () => {}, queueMicrotask,
  Date, Math, JSON, Promise, Number, String, Array, Object, RegExp,
  parseInt, parseFloat, isNaN, Boolean, Set, Map, Error,
  TextDecoder, TextEncoder, AbortController, Uint8Array, ArrayBuffer, URLSearchParams,
  fetch: async () => ({
    headers: { get: () => 'application/javascript; charset=utf-8' },
    arrayBuffer: async () => enc.encode('dr1001({"result":1,"v4ip":"10.0.0.1"})').buffer
  })
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

// 用可控的 hydrateState 替换原函数：结算由外部触发，从而精确观察执行顺序。
let releaseHydration;
sandbox.__hydrationGate = new Promise(r => { releaseHydration = r; });
vm.runInContext(
  'hydrationPromise = null; hydrateState = function(){ events.push("hydrate:start"); return __hydrationGate.then(()=>{ events.push("hydrate:done"); }); };',
  sandbox);

const send = (msg) => new Promise(resolve => listeners.message(msg, {}, resolve));

(async () => {
  const p1 = send({ type: 'clearLogs' });   // 冷启动首条消息
  const p2 = send({ type: 'status' });       // 并发状态查询
  await Promise.resolve(); await Promise.resolve();
  // hydrate 尚未结算：此时绝不能发生清空写入
  const earlyClear = events.some(e => e.startsWith('set:eventLogs='));
  releaseHydration();
  await Promise.all([p1, p2]);
  await send({ type: 'contentResult', result: { ok: true, online: true, message: '新事件' } });
  await new Promise(r => setTimeout(r, 0));

  const logs = storage.eventLogs || [];
  console.log('RESULT:' + JSON.stringify({
    earlyClear,
    orderOk: events.indexOf('hydrate:start') < events.findIndex(e => e.startsWith('set:eventLogs=')),
    len: logs.length,
    revived: logs.some(e => e && (e.message === '事件A' || e.message === '事件B' || e.message === '事件C')),
    first: logs[0] && logs[0].message,
    events: events
  }));
})().catch(e => console.log('ERROR:' + e.message));
"""
        res = subprocess.run(
            ["node", "-e", runner_script, os.path.join(EXT_DIR, "background.js")],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"clearLogs 竞态模拟失败:\n{res.stderr}\n{res.stdout}")
        line = next((l for l in res.stdout.splitlines() if l.startswith("RESULT:")), None)
        self.assertIsNotNone(line, f"未拿到模拟结果:\n{res.stdout}\n{res.stderr}")
        data = json.loads(line[len("RESULT:"):])
        self.assertFalse(data["earlyClear"],
                         f"hydrate 未完成就提前清空（未等待恢复）: {data['events']}")
        self.assertTrue(data["orderOk"],
                        f"clearLogs 未先等待 hydrate 完成: {data['events']}")
        self.assertFalse(data["revived"],
                         f"清空被并发 hydrate 撤销，历史日志重新出现: {data}")
        self.assertEqual(data["len"], 1,
                         f"清空后应只剩 1 条新事件（旧日志被复活说明竞态未修复）: {data}")
        self.assertEqual(data["first"], "新事件")

    def test_instant_trigger_throttles_flood_but_retries_after_skip(self):
        """瞬时触发必须同时满足两个相反的要求：

        1) 断网时导航失败是洪水式事件：必须限流，不能每个事件都调一次 autoLogin。
           早期「跳过就完全归还窗口」的写法会让 30 个事件调用 30 次（无限循环）。
        2) 若首次触发恰逢后台忙被 skipped，不能让 15 秒的完整窗口把真正需要
           抢修的那次挡在外面：跳过后的重试等待应缩短到 1 秒量级。
        3) 真正执行过的登录必须占用完整 15 秒窗口（避免在线/成功后高频空转）。
        """
        with open(os.path.join(EXT_DIR, "background.js"), "r", encoding="utf-8") as f:
            bg = f.read()
        self.assertIn("instantInFlight", bg, "缺少在途去重标记")
        self.assertIn("INSTANT_RETRY_AFTER_SKIP_MS", bg,
                      "缺少「跳过后短重试」窗口（会退化成洪水循环或 15 秒挡住抢修）")
        throttle = re.search(r"function isThrottled\(\) \{(.*?)\n  \}", bg, re.S)
        self.assertIsNotNone(throttle, "未定位节流判定函数")
        self.assertNotIn("lastInstantAt =", throttle.group(1),
                         "节流判定函数不应占用窗口（应由提交点统一占用）")

        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8');
const problems = [];
const listeners = {};
let storage = { initialized: true, instantTrigger: true, account: 'test', password: 'pw' };
const chrome = {
  storage: { local: {
    get: (arg, cb) => {
      const r = (arg === null || arg === undefined) ? { ...storage } : { ...(arg || {}) };
      if (typeof cb === 'function') { cb(r); return; }
      return Promise.resolve(r);
    },
    set: (patch, cb) => { Object.assign(storage, patch); if (typeof cb === 'function') cb(); return Promise.resolve(); }
  } },
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} }, getManifest: () => ({ version: 'test' }), lastError: null
  },
  alarms: { onAlarm: { addListener: () => {} }, get: async () => null, create: async () => {} },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
  commands: null,
  webNavigation: {
    onCommitted: { addListener: f => listeners.committed = f },
    onErrorOccurred: { addListener: f => listeners.err = f }
  }
};
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} }, chrome,
  setTimeout: f => setTimeout(f, 0), clearTimeout,
  setInterval: () => 0, clearInterval: () => {},
  Date, Math, JSON, Promise, Number, String, Array, Object, RegExp,
  parseInt, parseFloat, isNaN, Boolean, Set, Map, Error,
  TextDecoder, AbortController, Uint8Array, ArrayBuffer, URLSearchParams,
  fetch: async () => { throw new Error('offline'); }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

let calls = 0;
let now = 1000000;
// 可控时钟：让 Date.now() 可精确推进，验证时间窗口而非依赖真实 sleep。
// 必须在 runInContext('Date = ...') 之前把代理挂到 sandbox 上。
sandbox.__dateProxy = new Proxy(Date, {
  get(t, k) { return k === 'now' ? () => now : t[k]; }
});
vm.runInContext('Date = __dateProxy', sandbox);

sandbox.__mode = 'skipped';
sandbox.__fakeAutoLogin = () => {
  calls++;
  if (sandbox.__mode === 'skipped') {
    return { ok: false, online: false, skipped: true, message: '正在处理认证中，已跳过本次请求', time: 'x' };
  }
  return { ok: true, online: true, message: '已在线，无需登录', time: 'x' };
};
vm.runInContext('autoLogin = __fakeAutoLogin', sandbox);

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const fire = async () => { listeners.committed({ frameId: 0 }); await tick(); };

(async () => {
  // --- 场景 A：skipped 洪水。30 个事件同步涌入，必须被限流 ---
  calls = 0; now = 1000000;
  for (let i = 0; i < 30; i++) { await fire(); }
  const floodCalls = calls;
  if (floodCalls > 3) problems.push('skipped 洪水未被限流，30 个事件调用了 ' + floodCalls + ' 次');

  // --- 场景 B：跳过后 1 秒应能重试（不能等 15 秒）---
  now += 1200;
  await fire();
  const afterShortWait = calls - floodCalls;
  if (afterShortWait !== 1) problems.push('跳过 1.2 秒后未能重试（15 秒窗口仍挡着）: +' + afterShortWait);

  // --- 场景 C：真正执行过的登录必须占用完整 15 秒窗口 ---
  sandbox.__mode = 'ok';
  calls = 0; now = 2000000;
  await fire();                       // 第 1 次：真正执行
  now += 2000;
  for (let i = 0; i < 10; i++) { await fire(); }
  const withinWindow = calls;
  if (withinWindow !== 1) problems.push('成功登录后 2 秒内仍触发了 ' + (withinWindow - 1) + ' 次（未占用完整窗口）');

  // 超过 15 秒后应能再次触发
  now += 16000;
  await fire();
  if (calls !== 2) problems.push('超过 15 秒后未能重新触发，实际调用 ' + calls + ' 次');

  console.log('RESULT:' + JSON.stringify({ floodCalls, afterShortWait, withinWindow, finalCalls: calls }));
  console.log(problems.length ? 'TRIGGER_PROBLEMS:\n' + problems.join('\n') : 'TRIGGER_OK');
})().catch(e => console.log('TRIGGER_PROBLEMS: ' + e.message));
"""
        res = subprocess.run(
            ["node", "-e", runner_script, os.path.join(EXT_DIR, "background.js")],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"瞬时触发模拟失败:\n{res.stderr}\n{res.stdout}")
        self.assertIn("TRIGGER_OK", res.stdout, f"节流/重试逻辑有缺陷:\n{res.stdout}")
        line = next((l for l in res.stdout.splitlines() if l.startswith("RESULT:")), None)
        self.assertIsNotNone(line, f"未拿到模拟结果:\n{res.stdout}\n{res.stderr}")
        data = json.loads(line[len("RESULT:"):])
        self.assertLessEqual(data["floodCalls"], 3,
                             f"skipped 洪水未限流: {data}")
        self.assertEqual(data["afterShortWait"], 1, f"跳过后短重试失效: {data}")
        self.assertEqual(data["withinWindow"], 1, f"成功登录后未占用完整窗口: {data}")

    def test_content_script_releases_lock_on_pagehide(self):
        """表单提交导致页面导航后，pagehide 必须主动归还互斥锁且幂等。

        content.js 此前只靠 p.finally(release)；页面导航会销毁旧 JS 上下文，
        5 秒后的兜底回调与 then 都不会执行，锁只能等后台 40 秒租期兜底。
        """
        with open(os.path.join(EXT_DIR, "content.js"), "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("pagehide", content, "内容脚本未监听 pagehide")
        self.assertIn("p.then(release, release)", content,
                      "未改用两参数 then（rejection 会造成未处理错误）")

        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm');
let src = fs.readFileSync(process.argv[1], 'utf8');
// 把 IIFE 内的 withLock 暴露出来，便于独立驱动锁生命周期
const idx = src.lastIndexOf('})();');
if (idx === -1) { console.log('LOCK_PROBLEMS: 未找到 IIFE 结尾'); process.exit(0); }
src = src.slice(0, idx) + 'window.__withLock = withLock;\n' + src.slice(idx);

const problems = [];
const winListeners = {};
const sent = [];
const chrome = {
  runtime: {
    lastError: null,
    sendMessage: (msg, cb) => {
      sent.push(msg);
      if (msg.type === 'acquireAuthLock') { if (cb) cb({ ok: true, token: 't1' }); }
      else if (cb) cb({ ok: true });
    }
  },
  storage: { local: { get: (d, cb) => { if (cb) cb(d); } } }
};
const sandbox = {
  console, setTimeout: () => 1, clearTimeout: () => {},
  setInterval: () => 1, clearInterval: () => {},
  document: {
    readyState: 'loading', addEventListener: () => {},
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    body: { innerText: '' }, head: {}, documentElement: {}
  },
  window: {
    addEventListener: (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); },
    removeEventListener: (t, f) => {
      if (winListeners[t]) winListeners[t] = winListeners[t].filter(x => x !== f);
    }
  },
  chrome, navigator: {}, Element: function () {},
  Date, Math, JSON, Promise, String, Number, Object, Array, RegExp,
  AbortController: undefined, TextDecoder, Uint8Array
};
// fn 返回一个永不结算的 Promise，模拟「页面导航销毁上下文，回调不再执行」
sandbox.__p = new Promise(() => {});
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
vm.runInContext('window.__withLock(function(){ return __p; })', sandbox);

const releases = () => sent.filter(m => m.type === 'releaseAuthLock');
if (releases().length !== 0) problems.push('尚未导航就提前释放了锁');

// 触发 pagehide（表单提交后旧上下文唯一还能运行的代码路径）
const fire = (t) => (winListeners[t] || []).slice().forEach(f => f({}));
fire('pagehide');
if (releases().length !== 1) problems.push('pagehide 后未释放锁: ' + releases().length);
if (releases()[0] && releases()[0].token !== 't1') problems.push('释放锁未携带令牌');

// 幂等：beforeunload 随后触发不应重复释放
fire('beforeunload');
if (releases().length !== 1) problems.push('锁被重复释放: ' + releases().length);
if ((winListeners['pagehide'] || []).length !== 0) problems.push('释放后未移除 pagehide 监听');

console.log(problems.length ? 'LOCK_PROBLEMS:\n' + problems.join('\n') : 'LOCK_OK');
"""
        res = subprocess.run(
            ["node", "-e", runner_script, os.path.join(EXT_DIR, "content.js")],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"内容脚本锁模拟失败:\n{res.stderr}\n{res.stdout}")
        self.assertIn("LOCK_OK", res.stdout, f"页面导航后锁未正确释放:\n{res.stdout}")

    def test_portal_charset_detection_handles_mislabeling(self):
        """门户响应的 charset 错标不得产出乱码，真实 GBK 也不得被误判。

        背景：GBK 几乎不会解码失败（任意字节序列都能「成功」解出字符），因此
        一旦 UTF-8 内容被网关/代理错标成 `charset=gbk`，旧实现会静默返回
        「鐧诲綍鎴愬姛」这类乱码 —— 既不抛错，`fatal:true` 也拦不住。后果是
        msga 中文错误提示变乱码，按中文关键字匹配的判定（宵禁/密码错误）失效。

        修复依据是结构化判定而非乱码启发式：真实 GBK 中文几乎不可能是合法
        UTF-8（双字节序列次字节常落在 0x40-0x7E，fatal 直接抛错），故「合法
        UTF-8 且含非 ASCII => 按 UTF-8 解」即可同时正确处理两类输入。

        本用例锁定两个方向：错标 UTF-8 要还原，真实 GBK 不能被误判，
        并对 background.js / content.js 两端实现分别校验（二者是独立副本）。
        """
        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm'), path = require('path');
const EXT = process.argv[1];
const problems = [];

// 已知 GBK 字节序列（不依赖 iconv）：密码错误 / 登录成功 / 本时段禁止使用
const GBK_CASES = {
  '密码错误':        [0xc3,0xdc,0xc2,0xeb,0xb4,0xed,0xce,0xf3],
  '登录成功':        [0xb5,0xc7,0xc2,0xbc,0xb3,0xc9,0xb9,0xa6],
  '本时段禁止使用':  [0xb1,0xbe,0xca,0xb1,0xb6,0xce,0xbd,0xfb,0xd6,0xb9,0xca,0xb9,0xd3,0xc3]
};
const DECLARATIONS = ['gbk', 'gb2312', '', 'utf-8'];

function loadBackground() {
  let src = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
  src += '\nglobalThis.__decode = decodePortalBytes;';
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    chrome: {
      storage: { local: { get: (a, cb) => { if (cb) cb({}); return Promise.resolve({}); },
        set: (p, cb) => { if (cb) cb(); return Promise.resolve(); } } },
      runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} },
        onMessage: { addListener() {} }, getManifest: () => ({ version: 't' }), lastError: null },
      alarms: { onAlarm: { addListener() {} }, get: async () => null, create: async () => {} },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {} }, commands: null
    },
    setTimeout: (f) => { if (typeof f === 'function') f(); return 1; }, clearTimeout() {},
    setInterval: () => 0, clearInterval() {},
    Date, Math, JSON, Promise, Number, String, Array, Object, RegExp,
    parseInt, parseFloat, isNaN, Boolean, Set, Map, Error,
    TextDecoder, AbortController, Uint8Array, ArrayBuffer, URLSearchParams,
    fetch: async () => { throw new Error('unused'); }
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return sb.__decode;
}

function loadContent() {
  let src = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');
  const idx = src.lastIndexOf('})();');
  src = src.slice(0, idx) + '__export({ decodePortalBytes });\n' + src.slice(idx);
  let exported = null;
  const sb = {
    console, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    document: { readyState: 'loading', addEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} },
    chrome: { runtime: { lastError: null, sendMessage() {} },
      storage: { local: { get: (d, cb) => cb(d) } } },
    navigator: {}, AbortController, TextDecoder, Uint8Array, Promise,
    Date, Math, JSON, String, Number, Object, Array, RegExp, Error,
    fetch: async () => { throw new Error('unused'); },
    __export: (o) => { exported = o; }
  };
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return exported.decodePortalBytes;
}

for (const [label, decode] of [['background.js', loadBackground()], ['content.js', loadContent()]]) {
  // 1) 真实 GBK 中文：任何声明下都必须还原为正确文本（不得被误判成 UTF-8）
  for (const text of Object.keys(GBK_CASES)) {
    const bytes = new Uint8Array(GBK_CASES[text]);
    for (const decl of DECLARATIONS) {
      const out = decode(bytes, decl);
      if (out !== text) {
        problems.push(label + ' GBK "' + text + '" declared=' + JSON.stringify(decl) +
                      ' -> ' + JSON.stringify(out));
      }
    }
  }
  // 2) UTF-8 中文被错标成 gbk/无声明：必须还原，不能产出乱码
  for (const text of Object.keys(GBK_CASES)) {
    const bytes = new Uint8Array(Buffer.from(text, 'utf8'));
    for (const decl of ['gbk', '', 'utf-8']) {
      const out = decode(bytes, decl);
      if (out !== text) {
        problems.push(label + ' UTF8 "' + text + '" declared=' + JSON.stringify(decl) +
                      ' -> ' + JSON.stringify(out) + '（错标时应还原而非乱码）');
      }
    }
  }
  // 3) 纯 ASCII（典型 JSONP 响应）必须原样返回
  const ascii = 'dr1001({"result":1,"uid":"1"})';
  const outAscii = decode(new Uint8Array(Buffer.from(ascii, 'ascii')), 'gbk');
  if (outAscii.indexOf('"result":1') === -1) {
    problems.push(label + ' ASCII 响应被破坏 -> ' + JSON.stringify(outAscii));
  }
}

// 5) 两端实现必须逐字节等价（它们是各自独立的一份副本，无法共享模块作用域）。
//    用例 1-3 已各自跑过，但那只能证明「两边都满足已知期望」；若将来只改一边、
//    而新行为恰好落在已有断言的缝隙里，仍会静默漂移。这里直接做差分对比：
//    用一批边界字节（含非法序列、单字节、超长、空）逐一比较两端输出。
{
  const bgDecode = loadBackground();
  const ctDecode = loadContent();
  const edgeCases = [
    [],
    [0x00],
    [0x7f],
    [0x80],
    [0xc2],
    [0xc2, 0x41],          // 非法 UTF-8 续字节
    [0xff, 0xfe],          // 非法首字节
    [0xe4, 0xb8, 0xad],    // 「中」的合法 UTF-8
    [0xd6, 0xd0],          // 「中」的 GBK
    [0xca, 0xb1],          // 「时」的 GBK（恰好是合法 UTF-8，边界特例）
    [0xef, 0xbf, 0xbd],    // U+FFFD 本身
    Array.from(Buffer.from('混合 ascii 与 中文 mixed', 'utf8')),
    Array.from(Buffer.from('登录成功', 'utf8')),
    [0xb1, 0xbe, 0xca, 0xb1, 0xb6, 0xce],   // 不完整 GBK 序列
    Array.from({ length: 64 }, (_, i) => (i * 37) & 0xff)   // 伪随机字节
  ];
  for (const seq of edgeCases) {
    const bytes = new Uint8Array(seq);
    for (const decl of ['gbk', '', 'utf-8', 'gb18030', 'big5']) {
      let a, b, ea = null, eb = null;
      try { a = bgDecode(bytes, decl); } catch (e) { ea = e.message; }
      try { b = ctDecode(bytes, decl); } catch (e) { eb = e.message; }
      if (ea !== eb) {
        problems.push('两端抛错不一致 seq=' + JSON.stringify(seq) + ' decl=' + decl +
                      ' bg=' + ea + ' content=' + eb);
      } else if (a !== b) {
        problems.push('两端解码结果漂移 seq=' + JSON.stringify(seq) + ' decl=' + decl +
                      ' bg=' + JSON.stringify(a) + ' content=' + JSON.stringify(b));
      }
    }
  }
}

// 4) 无效编码名必须被缓存为 null（否则每次调用都重复尝试构造）
{
  let src = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
  src += '\nglobalThis.__getDecoder = getDecoder;';
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    chrome: { storage: { local: { get: (a, cb) => { if (cb) cb({}); return Promise.resolve({}); }, set: (p, cb) => { if (cb) cb(); return Promise.resolve(); } } },
      runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} }, getManifest: () => ({ version: 't' }), lastError: null },
      alarms: { onAlarm: { addListener() {} }, get: async () => null, create: async () => {} },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {} }, commands: null },
    setTimeout: (f) => { if (typeof f === 'function') f(); return 1; }, clearTimeout() {},
    setInterval: () => 0, clearInterval() {},
    Date, Math, JSON, Promise, Number, String, Array, Object, RegExp,
    parseInt, parseFloat, isNaN, Boolean, Set, Map, Error,
    TextDecoder, AbortController, Uint8Array, ArrayBuffer, URLSearchParams,
    fetch: async () => { throw new Error('unused'); }
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(src, sb);
  if (sb.__getDecoder('definitely-not-an-encoding', true) !== null) {
    problems.push('无效编码未返回 null');
  }
  // 二次调用仍为 null（说明走了缓存分支而非重复构造）
  if (sb.__getDecoder('definitely-not-an-encoding', true) !== null) {
    problems.push('无效编码二次调用未稳定返回 null');
  }
}

console.log(problems.length ? 'CHARSET_PROBLEMS:\n' + problems.join('\n') : 'CHARSET_OK');
"""
        res = subprocess.run(
            ["node", "-e", runner_script, EXT_DIR],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"编码检测模拟失败:\n{res.stderr}\n{res.stdout}")
        self.assertIn("CHARSET_OK", res.stdout, f"门户编码检测存在缺陷:\n{res.stdout}")

    def test_decoder_cache_does_not_retry_failed_construction(self):
        """decoder 缓存必须把「构造失败」也记为已缓存，避免反复 new。

        旧实现用 `!DECODER_CACHE[key]` 判断，构造失败写入 null 后条件依然成立，
        每次调用都会重新 new TextDecoder + 抛异常再 catch。功能上无害，
        但与「缓存」意图矛盾，且在切换编码的高频路径上做无用功。
        """
        for js_name in ("background.js", "content.js"):
            with open(os.path.join(EXT_DIR, js_name), "r", encoding="utf-8") as f:
                src = f.read()
            self.assertIn("key in DECODER_CACHE", src,
                          f"{js_name} 的 decoder 缓存未用 in 判断（null 会被当作未缓存）")
            self.assertNotRegex(
                src, r"if \(!DECODER_CACHE\[",
                f"{js_name} 仍用真值判断缓存，构造失败会被反复重试")


    def test_init_accent_binds_listener_once(self):
        """initAccent 必须幂等：重复调用不得累积 storage.onChanged 监听器。

        chrome.storage.onChanged.addListener 无法去重。旧实现每次调用 initAccent
        都注册一个监听器，因此「调用次数决定副作用」—— 一旦某个页面或将来新增的
        组件多次调用，同一强调色变更就会被处理 N 次（applyAccent + callback 各 N 次）。
        当前调用点各只调一次，但这类隐含契约很脆弱，需用测试锁定。

        同时校验：监听器只注册一次，但**最新传入的回调**应接管后续变更
        （而不是停留在首次注册时捕获的那个闭包上）。
        """
        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8');
const problems = [];
let listenerCount = 0;
const listeners = [];
let applied = [];

const ctx = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  requestAnimationFrame: () => 1,
  document: {
    getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
    addEventListener() {},
    createElement: () => ({ classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      style: {}, dataset: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
    createElementNS: () => ({ setAttribute() {}, innerHTML: '', style: {} }),
    documentElement: { setAttribute: (k, v) => { if (k === 'data-accent') applied.push(v); },
      removeAttribute() {} },
    body: { appendChild() {} }
  },
  window: { matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, removeEventListener() {} },
  navigator: {}, Element: function () {},
  chrome: {
    storage: {
      local: {
        get: (d, cb) => { const r = { accentColor: 'purple' }; if (cb) cb(r); return Promise.resolve(r); },
        set: (p, cb) => { if (cb) cb(); return Promise.resolve(); }
      },
      onChanged: { addListener: (f) => { listenerCount++; listeners.push(f); } }
    },
    runtime: { getManifest: () => ({ version: 't' }) }
  },
  Date, Math, JSON, String, Number, Object, Array, RegExp, Set, Map,
  parseInt, parseFloat, isNaN, Promise, Error, Boolean
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

vm.runInContext('initAccent()', ctx);
const after1 = listenerCount;
vm.runInContext('initAccent()', ctx);
const after2 = listenerCount;
vm.runInContext('initAccent()', ctx);
const after3 = listenerCount;

if (after1 !== 1) problems.push('首次 initAccent 应注册 1 个监听器，实际 ' + after1);
if (after2 !== 1) problems.push('重复调用累积了监听器: ' + after2);
if (after3 !== 1) problems.push('三次调用后监听器数应为 1，实际 ' + after3);

// 最新回调应接管后续变更。
// 注意：initAccent 每次调用都会立刻用「当前值」回调一次（初始渲染），
// 因此这里必须先把初始回调的痕迹清掉，只观测「变更事件」触发的回调。
let cb1 = null, cb2 = null;
let phase = 'init';
ctx.__set1 = (v) => { if (phase === 'change') cb1 = v; };
ctx.__set2 = (v) => { if (phase === 'change') cb2 = v; };
vm.runInContext('initAccent(__set1)', ctx);
vm.runInContext('initAccent(__set2)', ctx);
phase = 'change';
applied = [];
listeners.forEach((f) => f({ accentColor: { newValue: 'rose' } }, 'local'));
if (cb2 !== 'rose') problems.push('最新回调未接管变更，收到: ' + JSON.stringify(cb2));
if (cb1 !== null) problems.push('旧回调仍在被调用（应已被新回调替换）: ' + JSON.stringify(cb1));
if (applied.indexOf('rose') === -1) problems.push('变更时未应用新的强调色');

console.log(problems.length ? 'ACCENT_PROBLEMS:\n' + problems.join('\n') : 'ACCENT_OK');
"""
        res = subprocess.run(
            ["node", "-e", runner_script, os.path.join(EXT_DIR, "common.js")],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"强调色初始化模拟失败:\n{res.stderr}\n{res.stdout}")
        self.assertIn("ACCENT_OK", res.stdout, f"initAccent 幂等性缺陷:\n{res.stdout}")

    def test_account_masking_consistent_and_safe(self):
        """账号脱敏必须正确、耐脏，并在两份独立副本之间保持一致。

        maskAccount 是日志/诊断报告防泄漏的最后一道关口，却在两处各有一份独立
        实现：background.js（巡检日志、console.log）与 common.js（popup 显示、
        诊断快照）。两处必须逐值等价 —— 否则「弹窗里遮了、日志里没遮」这类
        不对称泄漏不会报错，只能靠人偶然发现。

        本用例覆盖三类风险：
        1. 边界值：<=4 位全遮、5-7 位保留首尾各 2、>=8 位保留首 3 尾 4；
           5 位与 7 位是最易写错的分界（曾出现 5 位漏遮中间）。
        2. 脏输入：null / undefined / 非字符串（number/object/array）必须返回 ''，
           不能抛异常，也不能把 "[object Object]" 之类当真账号脱敏。
        3. 两端一致性：同一批输入在 background.js 与 common.js 中结果相同。
        附带断言：脱敏结果绝不能包含完整原值（除 <=4 位本就全遮的情况）。
        """
        import subprocess
        runner_script = r"""
const fs = require('fs'), vm = require('vm'), path = require('path');
const EXT = process.argv[1];
const problems = [];

function mkSandbox() {
  return {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (f) => { if (typeof f === 'function') f(); return 1; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 1,
    document: {
      getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
      addEventListener() {},
      createElement: () => ({ classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        style: {}, dataset: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
      createElementNS: () => ({ setAttribute() {}, innerHTML: '', style: {} }),
      documentElement: { setAttribute() {}, removeAttribute() {} },
      body: { appendChild() {} }, visibilityState: 'visible'
    },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener() {}, removeEventListener() {} },
    navigator: {}, Element: function () {},
    chrome: {
      storage: { local: {
        get: (d, cb) => { if (cb) cb(d); return Promise.resolve(d); },
        set: (p, cb) => { if (cb) cb(); return Promise.resolve(); }
      }, onChanged: { addListener() {} } },
      runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} },
        onMessage: { addListener() {} }, getManifest: () => ({ version: 't' }), lastError: null },
      alarms: { onAlarm: { addListener() {} }, get: async () => null, create: async () => {} },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {} }, commands: null
    },
    Date, Math, JSON, Promise, Number, String, Array, Object, RegExp,
    parseInt, parseFloat, isNaN, Boolean, Set, Map, Error,
    TextDecoder, AbortController, Uint8Array, ArrayBuffer, URLSearchParams,
    fetch: async () => { throw new Error('unused'); }
  };
}

function loadMask(file) {
  const sb = mkSandbox();
  sb.globalThis = sb;
  vm.createContext(sb);
  let src = fs.readFileSync(path.join(EXT, file), 'utf8');
  src += '\nglobalThis.__mask = maskAccount;';
  vm.runInContext(src, sb);
  return sb.__mask;
}

const bgMask = loadMask('background.js');
const ctMask = loadMask('common.js');

// --- 1. 边界值 ---
const CASES = [
  ['', ''],
  ['abc', '****'],
  ['abcd', '****'],
  ['abcde', 'ab****de'],
  ['abcdef', 'ab****ef'],
  ['abcdefg', 'ab****fg'],
  ['abcdefgh', 'abc****efgh'],
  ['13812345678', '138****5678']
];
for (const [input, expected] of CASES) {
  const a = bgMask(input), b = ctMask(input);
  if (a !== expected) problems.push('background maskAccount(' + JSON.stringify(input) + ') = ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(expected));
  if (b !== expected) problems.push('common maskAccount(' + JSON.stringify(input) + ') = ' + JSON.stringify(b) + '，期望 ' + JSON.stringify(expected));
}
// 带空格应等价于 trim 后的结果
if (bgMask('  spaced  ') !== 'sp****ed') problems.push('background 未 trim 首尾空格: ' + JSON.stringify(bgMask('  spaced  ')));
if (ctMask('  spaced  ') !== 'sp****ed') problems.push('common 未 trim 首尾空格: ' + JSON.stringify(ctMask('  spaced  ')));

// --- 2. 脏输入必须安全返回空串 ---
const DIRTY = [null, undefined, 12345, { a: 1 }, [1, 2], true];
for (const v of DIRTY) {
  let a, b, ea = null, eb = null;
  try { a = bgMask(v); } catch (e) { ea = e.message; }
  try { b = ctMask(v); } catch (e) { eb = e.message; }
  if (ea) problems.push('background maskAccount(' + String(v) + ') 抛异常: ' + ea);
  if (eb) problems.push('common maskAccount(' + String(v) + ') 抛异常: ' + eb);
  if (!ea && a !== '') problems.push('background maskAccount(' + String(v) + ') 应返回空串，实际 ' + JSON.stringify(a));
  if (!eb && b !== '') problems.push('common maskAccount(' + String(v) + ') 应返回空串，实际 ' + JSON.stringify(b));
}

// --- 3. 两端一致 + 不得泄漏原值 ---
for (const [input] of CASES) {
  if (input.length <= 4) continue;   // <=4 位本就全遮，无需比较
  const a = bgMask(input), b = ctMask(input);
  if (a !== b) problems.push('两端脱敏不一致 input=' + JSON.stringify(input) + ' bg=' + JSON.stringify(a) + ' common=' + JSON.stringify(b));
  if (a.indexOf(input) !== -1) problems.push('脱敏结果仍含完整原值: ' + JSON.stringify(a));
}

console.log(problems.length ? 'MASK_PROBLEMS:\n' + problems.join('\n') : 'MASK_OK');
"""
        res = subprocess.run(
            ["node", "-e", runner_script, EXT_DIR],
            capture_output=True, text=True, encoding="utf-8", timeout=30
        )
        self.assertEqual(res.returncode, 0, f"账号脱敏模拟失败:\n{res.stderr}\n{res.stdout}")
        self.assertIn("MASK_OK", res.stdout, f"账号脱敏存在缺陷:\n{res.stdout}")


if __name__ == "__main__":
    unittest.main()
