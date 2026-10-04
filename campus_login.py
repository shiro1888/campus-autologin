#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
校园网自动登录脚本 —— Dr.COM / 哆点 ePortal 认证
================================================
目标门户: http://172.30.100.2/

特点:
  * 纯 Python 标准库实现，零第三方依赖
  * 自动探测本机校园网 IP
  * 先查状态，已在线则不重复登录（避免把已登录的会话踢掉）
  * 登录后自动复核，返回明确退出码，方便批处理 / 计划任务判断

用法:
  python campus_login.py              # 默认: 智能模式(已在线则跳过)
  python campus_login.py status       # 只查询在线状态
  python campus_login.py login        # 强制登录
  python campus_login.py logout       # 注销下线
  python campus_login.py wait         # 等待门户可达后再智能登录(开机自启用)
  python campus_login.py test         # 自检: 配置 + 网络 + 门户连通性

常用参数:
  --json          以 JSON 输出结果(供程序调用)
  -q, --quiet     静默模式, 只在失败时输出
  --user NAME     临时覆盖账号
  --pass PWD      临时覆盖密码
  --retry N       失败重试次数(默认取 config.json)
  --timeout N     单次请求超时秒数(默认取 config.json)

退出码:
  0 = 成功(在线 / 登录成功)
  1 = 失败(登录被拒 / 网络异常)
  2 = 配置或参数错误
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

# 确保在 Windows 控制台下输出 UTF-8 中文和框线符号不乱码
# 注意: pythonw.exe 无终端时 stdout/stderr 为 None
if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (OSError, ValueError):
        pass
if sys.stderr is not None and hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (OSError, ValueError):
        pass

VERSION = "1.3.0"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

DEFAULT_CONFIG = {
    "portal_host": "172.30.100.2",
    "portal_port": 80,
    "eportal_port": 801,
    "username": "REDACTED_CAMPUS_ACCOUNT",
    "password": "REDACTED_CAMPUS_PASSWORD",
    "isp": "1",
    "timeout": 8,
    "retry": 3,
    "retry_delay": 3,
    "wait_seconds": 90,
    "js_version": "4.1.3",
}

# 运营商 R3 取值(来自门户 carrier 配置):
#   1 = 校园用户(默认, 无后缀)   2 = 校园电信(@dx)
#   3 = 校园联通(@lt)            4 = 校园其他(无后缀)
ISP_CHOICES = {"1": "校园用户", "2": "校园电信", "3": "校园联通", "4": "校园其他"}

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_CONFIG = 2

_QUIET = False


# --------------------------------------------------------------------------
# 输出
# --------------------------------------------------------------------------
def say(msg: str = "") -> None:
    """按需输出到控制台(静默模式下只保留错误)。"""
    if not _QUIET and sys.stdout is not None:
        try:
            print(msg, flush=True)
        except (UnicodeEncodeError, OSError):
            enc = getattr(sys.stdout, "encoding", None) or "utf-8"
            print(msg.encode(enc, "replace").decode(enc, "replace"), flush=True)


def emit_json(payload: dict) -> None:
    """--json 模式：无论是否静默都输出结构化结果。"""
    if sys.stdout is None:
        return
    try:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except UnicodeEncodeError:
        sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
        sys.stdout.flush()


# --------------------------------------------------------------------------
# 配置
# --------------------------------------------------------------------------
def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    # 优先读取用户本地 config.json，不存在则回退到仓库模板 config.example.json
    config_file = CONFIG_PATH
    if not os.path.isfile(config_file):
        config_file = os.path.join(BASE_DIR, "config.example.json")
    if os.path.isfile(config_file):
        try:
            with open(config_file, "r", encoding="utf-8-sig") as fh:
                user_cfg = json.load(fh)
            if isinstance(user_cfg, dict):
                cfg.update({k: v for k, v in user_cfg.items() if v is not None})
        except (OSError, ValueError) as exc:
            raise ConfigError("配置文件 %s 无法解析: %s" % (os.path.basename(config_file), exc))
    return cfg


class ConfigError(Exception):
    pass


# --------------------------------------------------------------------------
# 网络工具
# --------------------------------------------------------------------------
def decode_body(raw: bytes) -> str:
    """门户页面存在 gb2312 / utf-8 混用，依次尝试解码。"""
    for enc in ("utf-8", "gb18030"):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", "replace")


def http_request(url: str, timeout: float, data: dict | None = None) -> tuple[int, str]:
    """发起 HTTP 请求；data 不为空时使用 POST，否则 GET。返回 (状态码, 文本)。"""
    body = urllib.parse.urlencode(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, method="POST" if body else "GET")
    req.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CampusAutoLogin/%s" % VERSION)
    req.add_header("Accept", "*/*")
    if body:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.getcode(), decode_body(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, decode_body(exc.read() or b"")
    except urllib.error.URLError as exc:
        safe_url = urllib.parse.urlunparse(urllib.parse.urlparse(url)._replace(query=""))
        raise NetworkError("无法连接门户 %s (%s)" % (safe_url, exc.reason))
    except (socket.timeout, TimeoutError):
        safe_url = urllib.parse.urlunparse(urllib.parse.urlparse(url)._replace(query=""))
        raise NetworkError("连接门户超时: %s" % safe_url)
    except OSError as exc:
        safe_url = urllib.parse.urlunparse(urllib.parse.urlparse(url)._replace(query=""))
        raise NetworkError("网络错误: %s (%s)" % (safe_url, exc))


class NetworkError(Exception):
    pass


def parse_jsonp(text: str) -> dict:
    """门户返回形如 ` dr1001({"result":1,...}); `，提取其中的 JSON 对象。"""
    match = re.search(r"\(\s*(\{.*?\})\s*\)", text, re.S)
    if not match:
        snippet = " ".join(text.split())[:160]
        raise NetworkError("门户返回内容无法解析: %s" % snippet)
    try:
        return json.loads(match.group(1))
    except ValueError as exc:
        raise NetworkError("门户返回的 JSON 解析失败: %s" % exc)


def detect_local_ip(host: str) -> str:
    """通过 UDP 路由探测本机在该网段的出口 IP(不会真的发包)。"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect((host, 80))
        return sock.getsockname()[0]
    except OSError:
        return ""
    finally:
        sock.close()


# --------------------------------------------------------------------------
# 门户操作
# --------------------------------------------------------------------------
class Portal:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        host = str(cfg["portal_host"]).strip()
        host = re.sub(r"^https?://", "", host).rstrip("/")
        self.host_only = host.split(":")[0]
        self.web_base = "http://%s:%s" % (self.host_only, int(cfg["portal_port"]))
        self.ep_base = "http://%s:%s" % (self.host_only, int(cfg["eportal_port"]))
        self.timeout = float(cfg["timeout"])
        self.js_version = str(cfg["js_version"])
        self._seq = 1000

    # -- 基础 ------------------------------------------------------------
    def _callback(self) -> str:
        self._seq += 1
        return "dr%d" % self._seq

    def _get(self, url: str, params: dict | None = None) -> tuple[int, str]:
        if params:
            url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
        return http_request(url, self.timeout)

    # -- 状态 ------------------------------------------------------------
    def status(self) -> dict:
        """查询内核在线状态。result: 1=在线, 0=不在线。"""
        code, text = self._get(
            self.web_base + "/drcom/chkstatus",
            {
                "callback": self._callback(),
                "v": str(int(time.time() * 1000) % 100000),
                "lang": "zh",
                "jsVersion": self.js_version,
            },
        )
        data = parse_jsonp(text)
        data["_http"] = code
        return data

    def is_online(self) -> bool:
        try:
            return int(self.status().get("result", 0)) == 1
        except (NetworkError, TypeError, ValueError):
            return False

    # -- 登录 ------------------------------------------------------------
    def login(self, username: str, password: str) -> dict:
        """尝试认证。

        门户有两种应答格式，本方法统一归一化为:
            {"ok": bool, "message": str, "format": str, "http": int, "raw": dict}

        * GET  -> JSONP   : dr1002({"result":1,...});
        * POST -> HTML 结果页: Dr.COMWebLoginID_3.htm = 成功, _2/_1 = 失败
        """
        payload = {
            "DDDDD": username,
            "upass": password,
            "0MKKey": "123456",
            "R1": "0",
            "R2": "",
            "R3": str(self.cfg.get("isp", "1")),
            "R6": "0",
            "para": "00",
            "v6ip": "",
            "terminal_type": "1",
            "lang": "zh-cn",
            "jsVersion": self.js_version,
        }
        url = self.web_base + "/drcom/login"
        errors = []

        # 主通道: GET + JSONP，返回结构化结果，最易判断
        params = dict(payload)
        params["callback"] = self._callback()
        try:
            code, text = self._get(url, params)
            return self._normalize_login(text, code)
        except NetworkError as exc:
            errors.append("GET: %s" % exc)

        # 备通道: POST(部分固件只认 POST)
        params = dict(payload)
        params["callback"] = self._callback()
        try:
            code, text = http_request(url, self.timeout, params)
            return self._normalize_login(text, code)
        except NetworkError as exc:
            errors.append("POST: %s" % exc)

        raise NetworkError("登录请求失败 (%s)" % "; ".join(errors))

    @staticmethod
    def _normalize_login(text: str, code: int) -> dict:
        # 1) JSONP
        try:
            data = parse_jsonp(text)
        except NetworkError:
            data = None
        if isinstance(data, dict):
            result = str(data.get("result", ""))
            ok = result in ("1", "ok")
            raw_msg = str(data.get("msga") or data.get("msg") or "").strip()
            return {
                "ok": ok,
                "message": "登录成功" if ok else (_explain_error(raw_msg) or "认证被拒绝"),
                "format": "jsonp",
                "http": code,
                "raw": data,
            }

        # 2) HTML 结果页
        if "Dr.COMWebLoginID_3" in text:
            return {"ok": True, "message": "登录成功", "format": "html",
                    "http": code, "raw": {"page": "Dr.COMWebLoginID_3.htm"}}
        if "Dr.COMWebLoginID_" in text:
            match = re.search(r"msga\s*=\s*'([^']*)'", text)
            raw_msg = match.group(1).strip() if match else ""
            page = re.search(r"Dr\.COMWebLoginID_(\d)", text)
            return {
                "ok": False,
                "message": _explain_error(raw_msg) or "认证被拒绝(门户未说明原因)",
                "format": "html",
                "http": code,
                "raw": {"page": "Dr.COMWebLoginID_%s.htm" % (page.group(1) if page else "?"),
                        "msga": raw_msg},
            }

        # 3) 其他异常页面(如被重定向到运营商公告页)
        snippet = " ".join(text.split())[:160]
        if "认证成功" in text or "认证成功页" in text:
            return {"ok": True, "message": "登录成功", "format": "html",
                    "http": code, "raw": {"snippet": snippet}}
        return {"ok": False, "message": "门户返回了无法识别的内容", "format": "unknown",
                "http": code, "raw": {"snippet": snippet}}

    # -- 注销 ------------------------------------------------------------
    def logout(self) -> dict:
        """注销下线。

        门户实现: page.path + 'logout' -> http://<host>/drcom/logout (JSONP)

        注意: 内核要求带上真实的会话参数(wlan_user_ip / wlan_user_mac /
        wlan_ac_ip)，否则请求虽返回 result:1 但会话不会被真正清除。
        因此这里先从 chkstatus 取会话信息，再发起注销。
        """
        ip = mac = ac_ip = ""
        try:
            st = self.status()
            ip = str(st.get("v4ip") or st.get("ss5") or "")
            mac = str(st.get("ss1") or "")
            ac_ip = str(st.get("ss6") or "")
        except NetworkError:
            pass

        data = {
            "login_method": "0",
            "user_account": "drcom",
            "user_password": "123",
            "ac_logout": "0",
            "register_mode": "1",
            "wlan_user_ip": ip,
            "wlan_user_ipv6": "",
            "wlan_vlan_id": "1",
            "wlan_user_mac": mac or "000000000000",
            "wlan_ac_ip": ac_ip,
            "wlan_ac_name": "",
            "jsVersion": self.js_version,
        }
        detail = []
        for url in (
            self.web_base + "/drcom/logout",
            self.ep_base + "/eportal/?c=ACSetting&a=Logout&ver=1.0&url=drappal",
        ):
            params = dict(data)
            params["callback"] = self._callback()
            params["v"] = str(int(time.time() * 1000) % 100000)
            params["lang"] = "zh"
            try:
                code, text = self._get(url, params)
            except NetworkError as exc:
                detail.append({"url": url, "ok": False, "error": str(exc)})
                continue
            try:
                resp = parse_jsonp(text)
                ok = str(resp.get("result", "")) in ("1", "ok")
            except NetworkError:
                ok = "Logout success" in text
                resp = {"snippet": " ".join(text.split())[:120]}
            detail.append({"url": url, "http": code, "ok": ok, "raw": resp})
            if ok:
                # 内核异步处理，给它一点时间
                for _ in range(5):
                    time.sleep(1)
                    try:
                        if not self.is_online():
                            return {"ok": True, "detail": detail, "offline": True}
                    except NetworkError:
                        break
                return {"ok": True, "detail": detail, "offline": False}
        return {"ok": False, "detail": detail, "offline": False}


ERROR_HINTS = {
    "userid error1": "账号不存在或账号格式有误",
    "userid error2": "密码错误",
    "userid error3": "该账号已被锁定，请稍后再试",
    "userid error0": "账号或密码错误",
    "ip has been online": "该 IP 已经在线，无需重复登录",
    "supplicant version too low": "客户端版本过低",
    "auth error": "认证失败",
    "out of service": "账号已停机，请充值后使用",
}


def _explain_error(msg: str) -> str:
    msg = (msg or "").strip()
    if not msg:
        return ""
    low = msg.lower()
    for key, hint in ERROR_HINTS.items():
        if key.lower() in low:
            return "%s (%s)" % (hint, msg)
    return msg


# --------------------------------------------------------------------------
# 命令实现
# --------------------------------------------------------------------------
def _make_portal(args, cfg) -> Portal:
    if args.user:
        cfg["username"] = args.user
    if args.password:
        cfg["password"] = args.password
    if args.timeout:
        cfg["timeout"] = args.timeout
    if args.retry is not None:
        cfg["retry"] = args.retry
    if not str(cfg.get("username", "")).strip() or not str(cfg.get("password", "")).strip():
        raise ConfigError("账号或密码为空，请检查 config.json")
    return Portal(cfg)


def _format_flow(kb) -> str:
    try:
        n = float(kb)
        if n <= 0:
            return "0 MB"
        if n < 1024:
            return "%.1f KB" % n
        if n < 1024 * 1024:
            return "%.1f MB" % (n / 1024)
        return "%.2f GB" % (n / (1024 * 1024))
    except (TypeError, ValueError):
        return "—"


def _card_line(text: str, width: int = 51) -> str:
    """计算 CJK 全角与半角字符在控制台中的视觉显示宽度，保证卡片右边框 100% 垂直对齐。"""
    dw = sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in text)
    pad = max(0, width - dw)
    return "│  " + text + (" " * pad) + " │"


def cmd_status(args, cfg) -> int:
    portal = _make_portal(args, cfg)
    st = portal.status()
    online = int(st.get("result", 0)) == 1
    ip = st.get("v4ip") or st.get("ss5") or detect_local_ip(portal.host_only)
    flow_text = _format_flow(st.get("flow", 0))
    fee_val = st.get("fee", 0)
    fee_text = ("%.2f 元" % (float(fee_val) / 10000)) if fee_val else "—"

    # 计算在线会话时长
    dur_text = ""
    if st.get("stime"):
        try:
            t_struct = time.strptime(str(st["stime"]), "%Y-%m-%d %H:%M:%S")
            sec = max(0, int(time.time() - time.mktime(t_struct)))
            h = sec // 3600
            m = (sec % 3600) // 60
            s = sec % 60
            dur_text = ("%d小时 %02d分 %02d秒" % (h, m, s)) if h > 0 else ("%02d分 %02d秒" % (m, s))
        except (ValueError, TypeError, OverflowError):
            pass
    elif st.get("actt"):
        try:
            sec = int(st["actt"])
            h = sec // 3600
            m = (sec % 3600) // 60
            s = sec % 60
            dur_text = ("%d小时 %02d分 %02d秒" % (h, m, s)) if h > 0 else ("%02d分 %02d秒" % (m, s))
        except (ValueError, TypeError):
            pass

    # 包含下行与上行分项的流量字符串
    flow_detail = flow_text
    if st.get("actdf") and st.get("actuf"):
        flow_detail += " (↓%s ↑%s)" % (_format_flow(st["actdf"]), _format_flow(st["actuf"]))

    info = {
        "action": "status",
        "online": online,
        "ip": ip,
        "account": st.get("uid") or st.get("AC") or "",
        "stime": st.get("stime", ""),
        "duration": dur_text,
        "flow": flow_text,
        "flow_detail": flow_detail,
        "fee": fee_text,
        "raw": st,
    }
    if args.json:
        emit_json(info)
    else:
        bar = "─" * 54
        say("┌" + bar + "┐")
        say(_card_line("        校园网自动登录 · Dr.COM ePortal"))
        say("├" + bar + "┤")
        if online:
            say(_card_line("状态:      ● 已在线 (认证通过)"))
            say(_card_line("账号:      %s" % str(info["account"])[:36]))
            say(_card_line("本机 IP:   %s" % str(ip)[:36]))
            if dur_text:
                say(_card_line("在线时长:  %s" % dur_text[:36]))
            say(_card_line("已用流量:  %s" % flow_detail[:36]))
            if fee_text != "—":
                say(_card_line("账户余额:  %s" % fee_text[:36]))
            if info["stime"]:
                say(_card_line("上线时间:  %s" % str(info["stime"])[:36]))
        else:
            say(_card_line("状态:      ○ 未在线 (需要认证)"))
            if ip:
                say(_card_line("本机 IP:   %s" % str(ip)[:36]))
        say("└" + bar + "┘")
    return EXIT_OK if online else EXIT_FAIL


def cmd_login(args, cfg) -> int:
    portal = _make_portal(args, cfg)
    user = str(cfg["username"]).strip()

    if not args.force and portal.is_online():
        if args.json:
            emit_json({"action": "login", "success": True, "already_online": True, "account": user})
        else:
            say("● 当前已在线，无需重复登录。")
        return EXIT_OK

    retry = max(1, int(cfg.get("retry", 3)))
    delay = float(cfg.get("retry_delay", 3))
    last = {}
    for attempt in range(1, retry + 1):
        if retry > 1:
            say("→ 正在登录 (第 %d/%d 次)..." % (attempt, retry))
        else:
            say("→ 正在登录...")
        try:
            resp = portal.login(user, str(cfg["password"]))
        except NetworkError as exc:
            last = {"ok": False, "message": str(exc)}
            say("✗ %s" % exc)
        else:
            if resp["ok"]:
                # 复核一次，确认真的上线
                time.sleep(1)
                verified = portal.is_online()
                if args.json:
                    emit_json({
                        "action": "login", "success": True, "already_online": False,
                        "verified": verified, "account": user, "raw": resp["raw"],
                    })
                else:
                    say("✓ %s" % resp["message"])
                    say("  账号: %s" % user)
                    if verified:
                        say("  状态复核: 已在线")
                    else:
                        say("  状态复核: 未检测到在线(可能刚上线，稍后再试)")
                return EXIT_OK

            last = resp
            say("✗ 登录失败: %s" % resp["message"])
            # 账号/密码类错误重试没有意义
            if any(k in resp["message"] for k in ("账号", "密码", "锁定", "停机")):
                break
        if attempt < retry:
            time.sleep(delay)

    if args.json:
        emit_json({"action": "login", "success": False, "account": user,
                   "message": last.get("message", ""), "raw": last.get("raw", {})})
    return EXIT_FAIL


def cmd_logout(args, cfg) -> int:
    portal = _make_portal(args, cfg)

    # 执行注销前进行二次确认，防止手滑断网（可用 -y 或 --yes 跳过）
    if not getattr(args, "yes", False) and not args.json and not _QUIET:
        try:
            ans = input("确定要注销下线当前校园网会话吗？(y/N): ").strip().lower()
            if ans not in ("y", "yes"):
                say("已取消注销。")
                return EXIT_OK
        except (EOFError, KeyboardInterrupt):
            say("\n已取消注销。")
            return EXIT_OK

    try:
        resp = portal.logout()
    except NetworkError as exc:
        if args.json:
            emit_json({"action": "logout", "success": False, "error": str(exc)})
        say("✗ 注销失败: %s" % exc)
        return EXIT_FAIL

    success = bool(resp.get("offline"))
    if args.json:
        emit_json({"action": "logout", "success": success,
                   "still_online": not success, "raw": resp.get("detail", [])})
    else:
        if success:
            say("✓ 已注销下线。")
        elif resp.get("ok"):
            say("✗ 注销请求已被接受，但会话仍在(部分 AC 不支持自助注销)。")
            say("  如需下线，请到门户页面手动操作: %s/" % portal.web_base)
        else:
            say("✗ 注销失败。")
            say("  如需下线，请到门户页面手动操作: %s/" % portal.web_base)
    return EXIT_OK if success else EXIT_FAIL


def cmd_wait(args, cfg) -> int:
    """等待门户可达(适合开机自启：网卡还在获取 IP 时先等一会儿)。"""
    portal = _make_portal(args, cfg)
    deadline = time.time() + float(cfg.get("wait_seconds", 90))
    waited = False
    while time.time() < deadline:
        try:
            if portal.is_online():
                say("● 已在线。")
                return EXIT_OK
            break
        except NetworkError:
            if not waited:
                say("… 等待校园网就绪 (最多 %ss)..." % int(cfg.get("wait_seconds", 90)))
                waited = True
            time.sleep(3)
    return cmd_login(args, cfg)


def cmd_test(args, cfg) -> int:
    portal = _make_portal(args, cfg)
    ip = detect_local_ip(portal.host_only)
    say("配置:")
    say("  门户: %s" % portal.web_base)
    say("  账号: %s" % cfg["username"])
    say("  运营商(R3): %s (%s)" % (cfg.get("isp", "1"), ISP_CHOICES.get(str(cfg.get("isp", "1")), "自定义")))
    say("本机出口 IP: %s" % (ip or "未探测到"))
    checks = {}
    for name, url in (
        ("门户首页", portal.web_base + "/"),
        ("ePortal", portal.ep_base + "/"),
    ):
        try:
            code, _ = http_request(url, portal.timeout)
            checks[name] = code
            say("  [OK] %s -> HTTP %s" % (name, code))
        except NetworkError as exc:
            checks[name] = 0
            say("  [!!] %s -> %s" % (name, exc))

    # 认证接口必须带 jsonp callback，否则门户返回 400
    online = False
    try:
        st = portal.status()
        online = int(st.get("result", 0)) == 1
        checks["认证接口"] = 200
        say("  [OK] 认证接口 -> HTTP 200 (result=%s)" % st.get("result"))
    except NetworkError as exc:
        checks["认证接口"] = 0
        say("  [!!] 认证接口 -> %s" % exc)

    say("当前状态: %s" % ("在线" if online else "不在线"))
    ok = checks.get("认证接口", 0) == 200
    if args.json:
        emit_json({"action": "test", "ok": ok, "local_ip": ip, "checks": checks, "online": online})
    say("\n结论: %s" % ("一切正常" if ok else "门户不可达，请确认已连接校园网"))
    return EXIT_OK if ok else EXIT_FAIL


def cmd_auto(args, cfg) -> int:
    """默认智能模式：在线即通过，否则尝试登录。"""
    portal = _make_portal(args, cfg)
    try:
        online = portal.is_online()
    except NetworkError as exc:
        say("✗ 无法连接门户: %s" % exc)
        if args.json:
            emit_json({"action": "auto", "success": False, "error": str(exc)})
        return EXIT_FAIL
    if online:
        if args.json:
            emit_json({"action": "auto", "success": True, "already_online": True,
                       "account": cfg["username"]})
        else:
            say("● 网络正常，已在线。")
        return EXIT_OK
    return cmd_login(args, cfg)


def cmd_gui(args, cfg) -> int:
    """启动轻量级现代桌面图形控制台 (基于标准库 tkinter)"""
    import threading
    try:
        import tkinter as tk
        from tkinter import messagebox
    except ImportError:
        say("✗ 当前 Python 环境未安装 tkinter，无法启动图形界面。")
        return EXIT_FAIL

    root = tk.Tk()
    root.title("校园网自动登录 · 桌面控制中心")
    root.configure(bg="#0f172a")

    # 窗口尺寸与屏幕居中
    win_w, win_h = 470, 660
    root.minsize(440, 580)
    root.update_idletasks()
    sw = root.winfo_screenwidth()
    sh = root.winfo_screenheight()
    pos_x = max(0, (sw - win_w) // 2)
    pos_y = max(0, (sh - win_h) // 2)
    root.geometry(f"{win_w}x{win_h}+{pos_x}+{pos_y}")

    # 尝试加载高质感专属应用图标
    icon_path = os.path.join(BASE_DIR, "chrome-extension", "icons", "icon48.png")
    if os.path.isfile(icon_path):
        try:
            app_icon = tk.PhotoImage(file=icon_path)
            root.iconphoto(True, app_icon)
        except Exception:
            pass

    bg = "#0f172a"
    card_bg = "#1e293b"
    text_color = "#f8fafc"
    text_muted = "#94a3b8"
    accent = "#2563eb"
    success_color = "#10b981"
    danger_color = "#ef4444"

    # Header
    head = tk.Frame(root, bg=bg, pady=12, padx=18)
    head.pack(fill="x")
    title = tk.Label(head, text="校园网自动登录", font=("Microsoft YaHei", 15, "bold"), fg=text_color, bg=bg)
    title.pack(anchor="w")
    sub = tk.Label(head, text="Dr.COM ePortal (172.30.100.2) 桌面控制台", font=("Microsoft YaHei", 9), fg=text_muted, bg=bg)
    sub.pack(anchor="w", pady=(2, 0))

    # Status Card
    st_card = tk.Frame(root, bg=card_bg, padx=16, pady=14, highlightthickness=1, highlightbackground="#334155")
    st_card.pack(fill="x", padx=18, pady=6)

    st_lbl = tk.Label(st_card, text="● 检测状态中…", font=("Microsoft YaHei", 13, "bold"), fg="#f59e0b", bg=card_bg)
    st_lbl.pack(anchor="w")

    # IP Row with Copy Button
    ip_frame = tk.Frame(st_card, bg=card_bg)
    ip_frame.pack(fill="x", pady=(6, 0))
    ip_lbl = tk.Label(ip_frame, text="本机 IP: —", font=("Consolas", 10), fg=text_color, bg=card_bg)
    ip_lbl.pack(side="left")

    current_detected_ip = [""]

    def do_copy_ip():
        ip_val = current_detected_ip[0]
        if ip_val:
            root.clipboard_clear()
            root.clipboard_append(ip_val)
            btn_copy_ip.config(text="已复制 ✓", fg=success_color)
            root.after(1500, lambda: btn_copy_ip.config(text="复制", fg=text_muted))

    btn_copy_ip = tk.Button(ip_frame, text="复制", font=("Microsoft YaHei", 8), bg="#334155", fg=text_muted,
                            activebackground="#475569", activeforeground=text_color, relief="flat",
                            cursor="hand2", padx=6, command=do_copy_ip)
    btn_copy_ip.pack(side="right")

    meta_lbl = tk.Label(st_card, text="已用流量: —  |  时长: —", font=("Microsoft YaHei", 9), fg=text_muted, bg=card_bg)
    meta_lbl.pack(anchor="w", pady=(2, 0))

    # Form Card
    form_card = tk.Frame(root, bg=card_bg, padx=16, pady=14, highlightthickness=1, highlightbackground="#334155")
    form_card.pack(fill="x", padx=18, pady=(8, 8))

    # 上网账号
    tk.Label(form_card, text="上网账号", font=("Microsoft YaHei", 9, "bold"), fg=text_color, bg=card_bg).pack(anchor="w")
    user_ent = tk.Entry(form_card, font=("Microsoft YaHei", 10), bg="#0b1120", fg=text_color,
                        insertbackground=text_color, relief="flat", highlightthickness=1,
                        highlightbackground="#334155")
    user_ent.insert(0, cfg.get("username", ""))
    user_ent.pack(fill="x", pady=(3, 10), ipady=4)

    # 登录密码（带显示/隐藏切换小眼睛）
    tk.Label(form_card, text="登录密码", font=("Microsoft YaHei", 9, "bold"), fg=text_color, bg=card_bg).pack(anchor="w")
    pwd_wrap = tk.Frame(form_card, bg="#0b1120", highlightthickness=1, highlightbackground="#334155")
    pwd_wrap.pack(fill="x", pady=(3, 10))

    pass_ent = tk.Entry(pwd_wrap, show="●", font=("Microsoft YaHei", 10), bg="#0b1120", fg=text_color,
                        insertbackground=text_color, relief="flat", bd=0)
    pass_ent.insert(0, cfg.get("password", ""))
    pass_ent.pack(side="left", fill="x", expand=True, padx=6, ipady=4)

    pwd_visible = [False]

    def toggle_pwd():
        pwd_visible[0] = not pwd_visible[0]
        pass_ent.config(show="" if pwd_visible[0] else "●")
        btn_pwd_toggle.config(text="🙈 隐藏" if pwd_visible[0] else "👁 显示")

    btn_pwd_toggle = tk.Button(pwd_wrap, text="👁 显示", font=("Microsoft YaHei", 8), bg="#1e293b",
                               fg=text_muted, activebackground="#334155", activeforeground=text_color,
                               relief="flat", bd=0, cursor="hand2", padx=6, command=toggle_pwd)
    btn_pwd_toggle.pack(side="right", padx=4, pady=2)

    # 运营商选择 (R3 参数)
    tk.Label(form_card, text="运营商选择 (R3 认证参数)", font=("Microsoft YaHei", 9, "bold"),
             fg=text_color, bg=card_bg).pack(anchor="w", pady=(2, 2))
    isp_frame = tk.Frame(form_card, bg=card_bg)
    isp_frame.pack(fill="x", pady=(2, 4))
    isp_var = tk.StringVar(value=str(cfg.get("isp", "1")))
    for isp_k, isp_name in [("1", "校园用户"), ("2", "校园电信"), ("3", "校园联通"), ("4", "校园其他")]:
        r = tk.Radiobutton(isp_frame, text=isp_name, value=isp_k, variable=isp_var,
                           font=("Microsoft YaHei", 8), fg=text_color, bg=card_bg,
                           selectcolor="#0f172a", activebackground=card_bg, activeforeground=text_color,
                           highlightthickness=0)
        r.pack(side="left", padx=(0, 4))

    def run_async(fn, *a):
        threading.Thread(target=fn, args=a, daemon=True).start()

    def safe_ui(fn):
        """将 UI 更新调度到主线程。线程安全：不直接查询控件状态。"""
        try:
            root.after(0, fn)
        except (tk.TclError, RuntimeError):
            pass

    # Autostart Card (Windows 计划任务开机自启)
    auto_card = tk.Frame(root, bg=card_bg, padx=16, pady=10, highlightthickness=1, highlightbackground="#334155")
    auto_card.pack(fill="x", padx=18, pady=(0, 8))

    auto_head = tk.Frame(auto_card, bg=card_bg)
    auto_head.pack(fill="x")
    tk.Label(auto_head, text="Windows 计划任务开机自启", font=("Microsoft YaHei", 9, "bold"), fg=text_color, bg=card_bg).pack(side="left")
    auto_st_lbl = tk.Label(auto_head, text="● 检测中…", font=("Microsoft YaHei", 9), fg="#f59e0b", bg=card_bg)
    auto_st_lbl.pack(side="right")

    auto_body = tk.Frame(auto_card, bg=card_bg)
    auto_body.pack(fill="x", pady=(4, 0))
    tk.Label(auto_body, text="系统启动及网络连接时静默后台认证", font=("Microsoft YaHei", 8), fg=text_muted, bg=card_bg).pack(side="left")

    autostart_active = [False]

    def check_autostart() -> bool:
        try:
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
            res = subprocess.run(
                ["schtasks", "/query", "/tn", "CampusNetAutoLogin"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creationflags,
                timeout=3,
            )
            return res.returncode == 0
        except Exception:
            return False

    def update_autostart_ui():
        def _task():
            is_active = check_autostart()
            autostart_active[0] = is_active
            def _ui():
                if is_active:
                    auto_st_lbl.config(text="● 计划任务生效中", fg=success_color)
                    btn_autostart.config(text="卸载自启", bg="#334155", fg="#f87171",
                                         activebackground="#475569", activeforeground="#fca5a5")
                else:
                    auto_st_lbl.config(text="○ 未配置自启任务", fg=text_muted)
                    btn_autostart.config(text="一键配置", bg="#2563eb", fg="#ffffff",
                                         activebackground="#1d4ed8", activeforeground="#ffffff")
            safe_ui(_ui)
        run_async(_task)

    def toggle_autostart():
        if autostart_active[0]:
            if not messagebox.askyesno("卸载确认", "确定要移除 Windows 开机自启计划任务吗？\n移除后开机将不会自动登录校园网。"):
                return
            bat_path = os.path.join(BASE_DIR, "uninstall_autostart.bat")
            if not os.path.isfile(bat_path):
                messagebox.showerror("错误", "未找到卸载脚本:\n%s" % bat_path)
                return
            try:
                os.startfile(bat_path)
            except Exception as e:
                messagebox.showerror("启动失败", str(e))
        else:
            bat_path = os.path.join(BASE_DIR, "install_autostart.bat")
            if not os.path.isfile(bat_path):
                messagebox.showerror("错误", "未找到安装脚本:\n%s" % bat_path)
                return
            try:
                os.startfile(bat_path)
            except Exception as e:
                messagebox.showerror("启动失败", str(e))
        root.after(3000, update_autostart_ui)

    btn_autostart = tk.Button(auto_body, text="—", font=("Microsoft YaHei", 8), bg="#334155", fg=text_color,
                              relief="flat", cursor="hand2", padx=8, pady=1, command=toggle_autostart)
    btn_autostart.pack(side="right")

    # Actions Frame
    btn_frame = tk.Frame(root, bg=bg, padx=18, pady=6)
    btn_frame.pack(fill="x")

    def do_refresh():
        st_lbl.config(text="● 检测中…", fg="#f59e0b")
        update_autostart_ui()
        def _task():
            try:
                t0 = time.time()
                portal = Portal(cfg)
                st = portal.status()
                ping_ms = int((time.time() - t0) * 1000)
                online = int(st.get("result", 0)) == 1
                ip = st.get("v4ip") or st.get("ss5") or detect_local_ip(portal.host_only)
                current_detected_ip[0] = ip
                flow = _format_flow(st.get("flow", 0))
                time_str = st.get("stime", "")
                def _ui():
                    if online:
                        st_lbl.config(text="● 已在线 (认证通过)", fg=success_color)
                    else:
                        st_lbl.config(text="○ 未在线 (需要认证)", fg=danger_color)
                    ip_lbl.config(text="本机 IP: %s" % (ip or "—"))
                    dur_text = ("  |  上线: %s" % time_str) if time_str else ""
                    meta_lbl.config(text="流量: %s  |  延迟: %d ms%s" % (flow, ping_ms, dur_text))
                safe_ui(_ui)
            except Exception as e:
                def _err():
                    st_lbl.config(text="! 网络不可达", fg=danger_color)
                    ip_lbl.config(text="错误: %s" % e)
                    meta_lbl.config(text="已用流量: —  |  时长: —")
                safe_ui(_err)
        run_async(_task)

    def do_test():
        st_lbl.config(text="→ 正在运行网络自检…", fg="#3b82f6")
        def _task():
            try:
                portal = Portal(cfg)
                c_home, _ = http_request(portal.web_base + "/", portal.timeout)
                c_ep, _ = http_request(portal.ep_base + "/", portal.timeout)
                st = portal.status()
                c_auth = st.get("_http", 200)
                online = int(st.get("result", 0)) == 1
                ip = st.get("v4ip") or st.get("ss5") or detect_local_ip(portal.host_only)
                diag = (
                    "【校园网连接自检结果】\n\n"
                    "• 门户首页 (端口 80): HTTP %d %s\n"
                    "• ePortal 服务 (801): HTTP %d %s\n"
                    "• 认证查询接口: HTTP %d %s\n"
                    "• 本机出口 IP: %s\n"
                    "• 当前认证状态: %s\n\n"
                    "诊断结论: %s" % (
                        c_home, "✓ 正常" if c_home == 200 else "✗ 异常",
                        c_ep, "✓ 正常" if c_ep == 200 else "✗ 异常",
                        c_auth, "✓ 正常" if c_auth == 200 else "✗ 异常",
                        ip or "未探测到",
                        "已在线 (网络畅通)" if online else "未登录认证",
                        "校园网网关与认证服务全部连通正常！" if (c_home == 200 and c_auth == 200) else "部分接口响应异常，请检查网线或 Wi-Fi 连接。"
                    )
                )
                safe_ui(lambda: [messagebox.showinfo("网络自检诊断", diag), do_refresh()])
            except Exception as e:
                safe_ui(lambda: [messagebox.showerror("自检异常", "网络自检失败: %s" % e), do_refresh()])
        run_async(_task)

    def do_login():
        cfg["username"] = user_ent.get().strip()
        cfg["password"] = pass_ent.get().strip()
        cfg["isp"] = isp_var.get()
        st_lbl.config(text="→ 正在登录…", fg="#3b82f6")
        def _task():
            try:
                portal = Portal(cfg)
                res = portal.login(cfg["username"], cfg["password"])
                def _ui():
                    if res.get("ok"):
                        messagebox.showinfo("成功", "登录成功！已确认在线。")
                    else:
                        messagebox.showerror("失败", "登录失败: " + str(res.get("message", "未知错误")))
                    do_refresh()
                safe_ui(_ui)
            except Exception as e:
                safe_ui(lambda: messagebox.showerror("错误", str(e)))
        run_async(_task)

    def do_logout():
        if not messagebox.askyesno("注销确认", "确定要注销下线当前校园网会话吗？\n注销后电脑将断开互联网连接。"):
            return
        st_lbl.config(text="→ 正在注销…", fg="#f59e0b")
        def _task():
            try:
                portal = Portal(cfg)
                res = portal.logout()
                def _ui():
                    if res.get("offline") or res.get("ok"):
                        messagebox.showinfo("注销", "已注销下线。")
                    else:
                        messagebox.showwarning("注销", "注销请求已发出。")
                    do_refresh()
                safe_ui(_ui)
            except Exception as e:
                safe_ui(lambda: messagebox.showerror("错误", str(e)))
        run_async(_task)

    def do_save():
        cfg["username"] = user_ent.get().strip()
        cfg["password"] = pass_ent.get().strip()
        cfg["isp"] = isp_var.get()
        target_save_path = CONFIG_PATH
        try:
            with open(target_save_path, "w", encoding="utf-8") as fh:
                json.dump(cfg, fh, indent=2, ensure_ascii=False)
            messagebox.showinfo("提示", "配置已成功保存至 config.json")
        except Exception as e:
            messagebox.showerror("保存失败", str(e))

    # 回车键快捷提交登录
    user_ent.bind("<Return>", lambda e: do_login())
    pass_ent.bind("<Return>", lambda e: do_login())

    btn_login = tk.Button(btn_frame, text="立即登录", font=("Microsoft YaHei", 10, "bold"), bg=accent, fg="#fff", activebackground="#1d4ed8", relief="flat", cursor="hand2", command=do_login)
    btn_login.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    btn_test = tk.Button(btn_frame, text="自检", font=("Microsoft YaHei", 10), bg="#334155", fg="#f8fafc", activebackground="#475569", relief="flat", cursor="hand2", command=do_test)
    btn_test.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    btn_refresh = tk.Button(btn_frame, text="刷新", font=("Microsoft YaHei", 10), bg="#1e293b", fg=text_color, relief="flat", cursor="hand2", command=do_refresh)
    btn_refresh.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    btn_save = tk.Button(btn_frame, text="保存账号", font=("Microsoft YaHei", 10), bg="#1e293b", fg=text_muted, relief="flat", cursor="hand2", command=do_save)
    btn_save.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    btn_logout = tk.Button(btn_frame, text="注销", font=("Microsoft YaHei", 10), bg="#1e293b", fg="#f87171", activebackground="#475569", relief="flat", cursor="hand2", command=do_logout)
    btn_logout.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    do_refresh()
    root.mainloop()
    return EXIT_OK


# --------------------------------------------------------------------------
# 入口
# --------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="campus_login.py",
        description="校园网自动登录 (Dr.COM ePortal @172.30.100.2)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n"
               "  python campus_login.py            智能登录\n"
               "  python campus_login.py gui        启动桌面图形界面\n"
               "  python campus_login.py status     查看状态\n"
               "  python campus_login.py test       自检\n",
    )
    parser.add_argument("command", nargs="?", default="auto",
                        choices=["auto", "login", "logout", "status", "wait", "test", "gui"],
                        help="要执行的操作 (默认 auto)")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出结果")
    parser.add_argument("-q", "--quiet", action="store_true", help="静默模式")
    parser.add_argument("--user", help="临时覆盖账号")
    parser.add_argument("--password", help="临时覆盖密码")
    parser.add_argument("--force", action="store_true", help="即使已在线也强制重新登录")
    parser.add_argument("-y", "--yes", action="store_true", help="跳过注销等操作的二次确认")
    parser.add_argument("--retry", type=int, help="失败重试次数")
    parser.add_argument("--timeout", type=float, help="请求超时(秒)")
    parser.add_argument("-v", "--version", action="version", version="campus_login.py " + VERSION)
    return parser


def main(argv: list[str] | None = None) -> int:
    global _QUIET
    args = build_parser().parse_args(argv)
    _QUIET = bool(args.quiet) and not args.json
    try:
        cfg = load_config()
        handler = {
            "auto": cmd_auto,
            "login": cmd_login,
            "logout": cmd_logout,
            "status": cmd_status,
            "wait": cmd_wait,
            "test": cmd_test,
            "gui": cmd_gui,
        }[args.command]
        return handler(args, cfg)
    except ConfigError as exc:
        say("✗ 配置错误: %s" % exc)
        if args.json:
            emit_json({"success": False, "error": str(exc)})
        return EXIT_CONFIG
    except KeyboardInterrupt:
        say("\n已取消。")
        return EXIT_FAIL
    except NetworkError as exc:
        say("✗ %s" % exc)
        if args.json:
            emit_json({"success": False, "error": str(exc)})
        return EXIT_FAIL


if __name__ == "__main__":
    sys.exit(main())
