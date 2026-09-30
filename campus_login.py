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
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

VERSION = "1.0.0"

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
    if not _QUIET:
        try:
            print(msg, flush=True)
        except UnicodeEncodeError:
            enc = sys.stdout.encoding or "utf-8"
            print(msg.encode(enc, "replace").decode(enc, "replace"), flush=True)


def emit_json(payload: dict) -> None:
    """--json 模式：无论是否静默都输出结构化结果。"""
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
    if os.path.isfile(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8-sig") as fh:
                user_cfg = json.load(fh)
            if isinstance(user_cfg, dict):
                cfg.update({k: v for k, v in user_cfg.items() if v is not None})
        except (OSError, ValueError) as exc:
            raise ConfigError("配置文件 config.json 无法解析: %s" % exc)
    return cfg


class ConfigError(Exception):
    pass


# --------------------------------------------------------------------------
# 网络工具
# --------------------------------------------------------------------------
def decode_body(raw: bytes) -> str:
    """门户页面存在 gb2312 / utf-8 混用，依次尝试解码。"""
    for enc in ("utf-8", "gb18030", "latin-1"):
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
        raise NetworkError("无法连接门户 %s (%s)" % (url, exc.reason))
    except (socket.timeout, TimeoutError):
        raise NetworkError("连接门户超时: %s" % url)
    except OSError as exc:
        raise NetworkError("网络错误: %s" % exc)


class NetworkError(Exception):
    pass


def parse_jsonp(text: str) -> dict:
    """门户返回形如 ` dr1001({"result":1,...}); `，提取其中的 JSON 对象。"""
    match = re.search(r"\(\s*(\{.*\})\s*\)", text, re.S)
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


def cmd_status(args, cfg) -> int:
    portal = _make_portal(args, cfg)
    st = portal.status()
    online = int(st.get("result", 0)) == 1
    ip = st.get("v4ip") or st.get("ss5") or detect_local_ip(portal.host_only)
    info = {
        "action": "status",
        "online": online,
        "ip": ip,
        "account": st.get("uid") or st.get("AC") or "",
        "stime": st.get("stime", ""),
        "raw": st,
    }
    if args.json:
        emit_json(info)
    else:
        if online:
            say("● 已在线")
            say("  账号: %s" % info["account"])
            say("  本机IP: %s" % ip)
            if info["stime"]:
                say("  上线时间: %s" % info["stime"])
        else:
            say("○ 未在线(需要认证)")
            if ip:
                say("  本机IP: %s" % ip)
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
               "  python campus_login.py status     查看状态\n"
               "  python campus_login.py test       自检\n",
    )
    parser.add_argument("command", nargs="?", default="auto",
                        choices=["auto", "login", "logout", "status", "wait", "test"],
                        help="要执行的操作 (默认 auto)")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出结果")
    parser.add_argument("-q", "--quiet", action="store_true", help="静默模式")
    parser.add_argument("--user", help="临时覆盖账号")
    parser.add_argument("--password", help="临时覆盖密码")
    parser.add_argument("--force", action="store_true", help="即使已在线也强制重新登录")
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
