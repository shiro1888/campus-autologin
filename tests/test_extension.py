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


if __name__ == "__main__":
    unittest.main()
