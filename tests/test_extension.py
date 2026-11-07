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


if __name__ == "__main__":
    unittest.main()
