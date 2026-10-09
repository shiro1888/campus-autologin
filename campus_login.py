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

VERSION = "1.0.0"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

# 账号密码一律留空：真实凭据只应写在 config.json（已被 .gitignore 忽略），
# 绝不硬编码进源码。空值会触发 _make_portal 的「账号或密码为空」配置错误提示。
DEFAULT_CONFIG = {
    "portal_host": "172.30.100.2",
    "portal_port": 80,
    "eportal_port": 801,
    "username": "",
    "password": "",
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
_JSON_MODE = False


# --------------------------------------------------------------------------
# 输出
# --------------------------------------------------------------------------
def say(msg: str = "") -> None:
    """按需输出到控制台(静默模式下不输出)。"""
    if not _QUIET and sys.stdout is not None:
        try:
            print(msg, flush=True)
        except (UnicodeEncodeError, OSError):
            enc = getattr(sys.stdout, "encoding", None) or "utf-8"
            print(msg.encode(enc, "replace").decode(enc, "replace"), flush=True)


def say_err(msg: str = "") -> None:
    """输出错误信息。静默模式下**仍然输出** —— 否则 -q 会把失败原因一起吞掉，
    autostart.bat 的日志里就只剩一个 EXIT 码，完全无法排查。

    例外：--json 模式下 stdout 必须保持只有 JSON，此时改写到 stderr，
    这样既不影响人类排查，也不会污染给程序消费的 JSON。"""
    if sys.stdout is None:
        return
    stream = sys.stderr if _JSON_MODE else sys.stdout
    if stream is None:
        return
    try:
        print(msg, file=stream, flush=True)
    except (UnicodeEncodeError, OSError):
        try:
            enc = getattr(stream, "encoding", None) or "utf-8"
            print(msg.encode(enc, "replace").decode(enc, "replace"), file=stream, flush=True)
        except OSError:
            pass


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
                # 过滤 None 与以 _ 开头的说明字段（config.example.json 用 _xxx 写注释）。
                # 否则回退读模板时会把 _说明/_username 等 12 个文档键并入 cfg，
                # 而 GUI 的「保存账号」是直接把 cfg 写回 config.json 的 ——
                # 用户的配置文件就被塞进一堆说明字段（且会被后续读写反复携带）。
                cfg.update({k: v for k, v in user_cfg.items()
                            if v is not None and not str(k).startswith("_")})
        except (OSError, ValueError) as exc:
            raise ConfigError("配置文件 %s 无法解析: %s" % (os.path.basename(config_file), exc))
    return cfg


class ConfigError(Exception):
    pass


# --------------------------------------------------------------------------
# 网络工具
# --------------------------------------------------------------------------
def decode_body(raw: bytes, declared: str | None = None) -> str:
    """解码门户响应体。门户页面 gb2312 / utf-8 混用。

    优先使用响应头声明的 charset（实测门户会明确声明：
      http://172.30.100.2/          -> text/html; charset=gbk
      .../drcom/chkstatus           -> application/javascript; charset=gbk
      ...:801/eportal/              -> text/html; charset=utf-8
    ）。声明缺失或不可用时，再按「utf-8 -> gb18030」猜测。

    不遵从声明的风险：GBK 里存在「字节序列恰好也是合法 UTF-8」的组合，
    此时 raw.decode('utf-8') 会“成功”返回乱码而不抛异常，于是静默错译。
    """
    order: list[str] = []
    if declared:
        order.append(declared)
    order.extend(["utf-8", "gb18030"])
    seen = set()
    for enc in order:
        key = enc.lower()
        if key in seen:
            continue
        seen.add(key)
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", "replace")


def _declared_charset(headers) -> str | None:
    """从响应头安全地取出 charset；任何异常都返回 None（退回猜测策略）。"""
    try:
        if headers is None:
            return None
        return headers.get_content_charset()
    except Exception:
        return None


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
            return resp.getcode(), decode_body(resp.read(), _declared_charset(resp.headers))
    except urllib.error.HTTPError as exc:
        return exc.code, decode_body(exc.read() or b"", _declared_charset(getattr(exc, "headers", None)))
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
        if not self.host_only:
            raise ConfigError("portal_host 不能为空，请检查 config.json")
        # 端口/超时可能是用户手写的内容，类型不对时给配置错误提示，
        # 而不是抛裸的 ValueError traceback（main 只捕获 ConfigError/NetworkError）。
        try:
            web_port = int(cfg["portal_port"])
            ep_port = int(cfg["eportal_port"])
        except (KeyError, TypeError, ValueError):
            raise ConfigError("portal_port / eportal_port 必须是数字，请检查 config.json")
        try:
            self.timeout = float(cfg["timeout"])
        except (KeyError, TypeError, ValueError):
            raise ConfigError("timeout 必须是数字（秒），请检查 config.json")
        if not (0 < web_port < 65536) or not (0 < ep_port < 65536):
            raise ConfigError("portal_port / eportal_port 必须在 1~65535 之间")
        if self.timeout <= 0:
            raise ConfigError("timeout 必须大于 0 秒")
        self.web_base = "http://%s:%s" % (self.host_only, web_port)
        self.ep_base = "http://%s:%s" % (self.host_only, ep_port)
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
    "userid error4": "账号已欠费或已停机",
    "userid error5": "账号状态异常，请联系网络中心",
    "userid error6": "该账号已在别处登录",
    "userid error0": "账号或密码错误",
    "password error": "密码错误",
    "error1": "账号不存在",
    "error2": "密码错误",
    "error3": "账号或密码错误",
    "ip has been online": "该 IP 已经在线，无需重复登录",
    "supplicant version too low": "客户端版本过低",
    "auth error": "认证失败",
    "out of service": "账号已停机，请充值后使用",
    "本时段禁止使用": "当前时段禁止使用校园网（夜间断网/宵禁时段）",
    "禁止使用": "当前时段禁止使用校园网（夜间断网/宵禁时段）",
    "禁止上网": "当前时段禁止上网",
}


def _explain_error(msg: str) -> str:
    msg = (msg or "").strip()
    if not msg:
        return ""
    low = msg.lower()
    # 宵禁 / 乱码模式匹配（兼容 GBK 误按 UTF-8 解码的 \u02b1(ʱ) 与 \u03bd(ν)）
    if re.search(r"[\u02b1].{0,3}[\u03bd]|ʱ.{0,3}ν|本时段|禁止使用|禁止上网", msg):
        return "%s (%s)" % ("当前时段禁止使用校园网（夜间断网/宵禁时段）", msg)
    for key, hint in ERROR_HINTS.items():
        if key.lower() in low:
            return "%s (%s)" % (hint, msg)
    return msg


# --------------------------------------------------------------------------
# 命令实现
# --------------------------------------------------------------------------
def _make_portal(args, cfg, require_credentials: bool = True) -> Portal:
    """构造 Portal 对象。

    require_credentials=False 用于「不需要账号密码」的命令（status / test /
    logout 等）——这些操作只查询状态或注销会话，门户并不校验凭据。
    此前无条件校验会导致 config.json 里没填账号时连 `status` / `test` 都用不了。
    """
    if args.user:
        cfg["username"] = args.user
    if args.password:
        cfg["password"] = args.password
    if args.timeout:
        cfg["timeout"] = args.timeout
    if args.retry is not None:
        cfg["retry"] = args.retry
    if require_credentials and (
        not str(cfg.get("username", "")).strip() or not str(cfg.get("password", "")).strip()
    ):
        raise ConfigError("账号或密码为空，请在 config.json 中填写，或使用 --user/--password 临时指定")
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


def _calculate_duration(st: dict) -> str:
    """计算在线会话时长。
    优先采用网关返回的有效秒数 actt (实际活跃时长) 或 oltime (过滤 4294967295 / 0xFFFFFFFF 哨兵值)。
    若网关未返回有效秒数，再由上线时间 stime 计算。
    """
    MAX_VALID_SESSION_SEC = 90 * 86400  # 90 天合理上限
    sec = -1

    # 1. 优先采用网关实时秒数 actt / oltime
    for key in ("actt", "oltime"):
        val = st.get(key)
        if val is not None and str(val).isdigit():
            try:
                n = int(val)
                if 0 < n < MAX_VALID_SESSION_SEC:
                    sec = n
                    break
            except (ValueError, TypeError):
                pass

    # 2. 回退到网关上线时间 stime
    if sec < 0 and st.get("stime"):
        try:
            t_struct = time.strptime(str(st["stime"]), "%Y-%m-%d %H:%M:%S")
            diff = max(0, int(time.time() - time.mktime(t_struct)))
            if 0 <= diff < MAX_VALID_SESSION_SEC:
                sec = diff
        except (ValueError, TypeError, OverflowError):
            pass

    if sec < 0:
        return ""

    h = sec // 3600
    m = (sec % 3600) // 60
    s = sec % 60
    return ("%d小时 %02d分 %02d秒" % (h, m, s)) if h > 0 else ("%02d分 %02d秒" % (m, s))


def _card_line(text: str, width: int = 51) -> str:
    """计算 CJK 全角与半角字符在控制台中的视觉显示宽度，保证卡片右边框 100% 垂直对齐。"""
    dw = sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in text)
    pad = max(0, width - dw)
    return "│  " + text + (" " * pad) + " │"


def cmd_status(args, cfg) -> int:
    # 只查状态，不需要账号密码
    portal = _make_portal(args, cfg, require_credentials=False)
    st = portal.status()
    online = int(st.get("result", 0)) == 1
    ip = st.get("v4ip") or st.get("ss5") or detect_local_ip(portal.host_only)
    flow_text = _format_flow(st.get("flow", 0))
    # fee 由门户返回，可能是空串/非数字。此处必须容错，
    # 否则一个畸形字段就会让整个 status 命令抛 ValueError 崩掉。
    fee_text = "—"
    try:
        fee_val = float(st.get("fee") or 0)
        if fee_val:
            fee_text = "%.2f 元" % (fee_val / 10000)
    except (TypeError, ValueError):
        fee_text = "—"

    # 计算在线会话时长
    dur_text = _calculate_duration(st)

    # 包含下行与上行分项的流量字符串
    flow_detail = flow_text
    if st.get("actdf") is not None and st.get("actuf") is not None:
        flow_detail += " (↓%s ↑%s)" % (_format_flow(st["actdf"]), _format_flow(st["actuf"]))

    info = {
        "action": "status",
        "success": True,
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

    # 这两个值来自用户手写的 config.json，类型不对时给配置错误而不是裸 traceback
    try:
        retry = max(1, int(cfg.get("retry", 3)))
        delay = float(cfg.get("retry_delay", 3))
    except (TypeError, ValueError):
        raise ConfigError("retry / retry_delay 必须是数字，请检查 config.json")
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
            say_err("✗ %s" % exc)
        else:
            msg = resp.get("message", "")
            # 若提示「该 IP 已经在线」或已在线，说明会话已就绪，直接按成功退出，避免无意义重试
            if "已经在线" in msg or "ip has been online" in msg.lower():
                if args.json:
                    emit_json({
                        "action": "login", "success": True, "already_online": True,
                        "verified": True, "account": user, "raw": resp.get("raw", {}),
                    })
                else:
                    say("● 该 IP 已经在线，无需重复登录。")
                    say("  账号: %s" % user)
                return EXIT_OK

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
            say_err("✗ 登录失败: %s" % resp["message"])
            # 账号/密码类错误重试没有意义。
            # 「客户端版本过低」是客户端/固件问题，重试同样无用 —— 它与其它
            # ERROR_HINTS 译名不同，不含上面任何关键词，漏掉会让它按 retry 反复打门户。
            low_msg = resp["message"].lower()
            if any(k in resp["message"] or k in low_msg for k in ("账号", "密码", "锁定", "停机", "已经在线", "客户端版本过低", "禁止使用", "时段", "禁止上网", "password error", "userid error", "out of service")):
                break
        if attempt < retry:
            time.sleep(delay)

    if args.json:
        emit_json({"action": "login", "success": False, "account": user,
                   "message": last.get("message", ""), "raw": last.get("raw", {})})
    return EXIT_FAIL


def cmd_logout(args, cfg) -> int:
    # 注销只需要会话参数（从 chkstatus 取），不需要账号密码
    portal = _make_portal(args, cfg, require_credentials=False)

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
        say_err("✗ 注销失败: %s" % exc)
        return EXIT_FAIL

    success = bool(resp.get("offline"))
    if args.json:
        emit_json({"action": "logout", "success": success,
                   "still_online": not success, "raw": resp.get("detail", [])})
    else:
        if success:
            say("✓ 已注销下线。")
        elif resp.get("ok"):
            say_err("✗ 注销请求已被接受，但会话仍在(部分 AC 不支持自助注销)。")
            say("  如需下线，请到门户页面手动操作: %s/" % portal.web_base)
        else:
            say_err("✗ 注销失败。")
            say("  如需下线，请到门户页面手动操作: %s/" % portal.web_base)
    return EXIT_OK if success else EXIT_FAIL


def cmd_wait(args, cfg) -> int:
    """等待门户可达(适合开机自启：网卡还在获取 IP 时先等一会儿)。

    注意：必须用 portal.status() 而不是 portal.is_online() 来探测可达性。
    is_online() 内部已经捕获了 NetworkError 并返回 False，它无法区分
    「门户不可达（网卡还没拿到 IP）」和「门户可达但未认证」。原实现依赖它抛
    NetworkError 来 sleep，导致循环第一轮就 break —— 配置了 wait_seconds=90
    却 0 秒就直奔登录，开机自启的等待逻辑形同虚设。
    """
    portal = _make_portal(args, cfg, require_credentials=False)
    try:
        wait_seconds = float(cfg.get("wait_seconds", 90) or 0)
    except (TypeError, ValueError):
        raise ConfigError("wait_seconds 必须是数字（秒），请检查 config.json")
    deadline = time.time() + wait_seconds
    waited = False
    while True:
        try:
            if int(portal.status().get("result", 0)) == 1:
                if args.json:
                    emit_json({"action": "wait", "success": True, "online": True, "message": "已在线"})
                else:
                    say("● 已在线。")
                return EXIT_OK
            # 门户可达但未认证 -> 无需继续等待，直接去登录
            break
        except NetworkError:
            # 门户不可达：多半是网卡还在获取 IP，继续等到超时
            if time.time() >= deadline:
                break
            if not waited:
                say("… 等待校园网就绪 (最多 %ss)..." % int(wait_seconds))
                waited = True
            time.sleep(min(3, max(0.1, deadline - time.time())))
    return cmd_login(args, cfg)


def cmd_test(args, cfg) -> int:
    """自检：校验「配置 + 门户连通性」是否都已就绪。

    安装脚本 install_autostart.ps1 用它做开工前检查（其提示语即「config.json +
    门户连通性」）。因此这里必须**同时**检查凭据是否已填写：只探连通性的话，
    未填账号密码时也会报「一切正常」，用户以为配好了，而计划任务每次开机都会
    因缺凭据失败（日志里只有 EXIT: 2）。
    """
    portal = _make_portal(args, cfg, require_credentials=False)
    ip = detect_local_ip(portal.host_only)
    username = str(cfg.get("username", "") or "").strip()
    password = str(cfg.get("password", "") or "").strip()

    say("配置:")
    say("  门户: %s" % portal.web_base)
    say("  账号: %s" % (username or "(未填写)"))
    say("  运营商(R3): %s (%s)" % (cfg.get("isp", "1"), ISP_CHOICES.get(str(cfg.get("isp", "1")), "自定义")))
    has_credentials = bool(username and password)
    if has_credentials:
        say("  [OK] 账号密码已填写")
    else:
        say_err("  [!!] 账号密码未填写 —— 无法自动登录，请编辑 config.json")

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
            say_err("  [!!] %s -> %s" % (name, exc))

    # 认证接口必须带 jsonp callback，否则门户返回 400
    online = False
    try:
        st = portal.status()
        online = int(st.get("result", 0)) == 1
        checks["认证接口"] = 200
        say("  [OK] 认证接口 -> HTTP 200 (result=%s)" % st.get("result"))
    except NetworkError as exc:
        checks["认证接口"] = 0
        say_err("  [!!] 认证接口 -> %s" % exc)

    say("当前状态: %s" % ("在线" if online else "不在线"))
    reachable = checks.get("认证接口", 0) == 200
    ok = reachable and has_credentials
    if args.json:
        # 同时给出 success 与 ok：其余子命令（login/logout/auto）统一用 success，
        # 只有 test 曾用 ok，消费方要按命令分别判断很容易踩坑。
        # 保留 ok 以兼容既有脚本，新增 success 作为统一字段。
        emit_json({"action": "test", "success": ok, "ok": ok, "local_ip": ip, "checks": checks,
                   "online": online, "has_credentials": has_credentials})
    else:
        # 注意：必须放在 else 里。--json 时 _QUIET 为 True（见 main），
        # say() 会被静默；但仍不能把结论写在 emit_json 之后的分支外，
        # 否则任何文本都可能混进 stdout，导致 `json.loads(stdout)` 失败。
        if not reachable:
            say("\n结论: 门户不可达，请确认已连接校园网")
        elif not has_credentials:
            say("\n结论: 门户正常，但账号密码未填写 —— 请先编辑 config.json 再装开机自启")
        else:
            say("\n结论: 一切正常")
    return EXIT_OK if ok else EXIT_FAIL


def cmd_auto(args, cfg) -> int:
    """默认智能模式：在线即通过，否则尝试登录。"""
    # 先只查状态：已在线时压根不需要账号密码。
    # 真正需要登录时再交给 cmd_login 校验凭据并给出清晰提示。
    portal = _make_portal(args, cfg, require_credentials=False)
    # 用 status() 而非 is_online()：后者内部吞掉 NetworkError 只返回 False，
    # 无法区分「门户不可达」和「门户可达但未认证」，会让下面的 except 变成死代码，
    # 导致断网时给出「账号或密码错误」这种误导性提示。
    try:
        st = portal.status()
    except NetworkError as exc:
        say_err("✗ 无法连接门户: %s" % exc)
        if args.json:
            emit_json({"action": "auto", "success": False, "error": str(exc)})
        return EXIT_FAIL
    if int(st.get("result", 0)) == 1:
        if args.json:
            emit_json({"action": "auto", "success": True, "already_online": True,
                       "account": cfg.get("username", "")})
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
        say_err("✗ 当前 Python 环境未安装 tkinter，无法启动图形界面。")
        return EXIT_FAIL

    # 启用 Windows 高 DPI 感知，确保现代高分屏 (125%/150%/200%) 下文字与边框矢量渲染清晰，消除模糊
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        try:
            import ctypes
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass

    root = tk.Tk()
    root.title("校园网自动登录 · 桌面控制中心")
    root.configure(bg="#0f172a")

    # 动态根据系统 DPI 缩放基准几何尺寸
    scale = 1.0
    try:
        scale = max(1.0, float(root.tk.call("tk", "scaling")) / 1.333333)
    except Exception:
        scale = 1.0
    root.update_idletasks()
    sw = root.winfo_screenwidth()
    sh = root.winfo_screenheight()
    # 窗口宽高自适应 DPI，并限制不超过屏幕安全尺寸（预留系统任务栏），防止小屏笔记本溢出
    win_w = min(max(380, sw - 40), int(470 * scale))
    win_h = min(max(500, sh - 80), int(660 * scale))
    min_w = min(win_w, int(440 * scale))
    min_h = min(win_h, int(560 * scale))
    root.minsize(min_w, min_h)
    pos_x = max(0, (sw - win_w) // 2)
    pos_y = max(0, (sh - win_h) // 2)
    root.geometry(f"{win_w}x{win_h}+{pos_x}+{pos_y}")

    # 启用 Windows 10/11 原生沉浸式深色标题栏 (DWM Immersive Dark Titlebar)
    try:
        from ctypes import byref, c_int, sizeof
        DWMWA_USE_IMMERSIVE_DARK_MODE = 20
        hwnd = ctypes.windll.user32.GetParent(root.winfo_id()) or root.winfo_id()
        ctypes.windll.dwmapi.DwmSetWindowAttribute(
            hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, byref(c_int(1)), sizeof(c_int)
        )
    except Exception:
        pass

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
                        highlightbackground="#334155", highlightcolor="#2563eb")
    user_ent.insert(0, cfg.get("username", ""))
    user_ent.pack(fill="x", pady=(3, 10), ipady=4)

    # 登录密码（带显示/隐藏切换小眼睛）
    tk.Label(form_card, text="登录密码", font=("Microsoft YaHei", 9, "bold"), fg=text_color, bg=card_bg).pack(anchor="w")
    pwd_wrap = tk.Frame(form_card, bg="#0b1120", highlightthickness=1, highlightbackground="#334155")
    pwd_wrap.pack(fill="x", pady=(3, 10))

    pass_ent = tk.Entry(pwd_wrap, show="●", font=("Microsoft YaHei", 10), bg="#0b1120", fg=text_color,
                        insertbackground=text_color, relief="flat", bd=0)
    pass_ent.bind("<FocusIn>", lambda e: pwd_wrap.config(highlightbackground="#2563eb"))
    pass_ent.bind("<FocusOut>", lambda e: pwd_wrap.config(highlightbackground="#334155"))
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

    # 单飞（single-flight）保护：同类网络操作尚未结束时，忽略重复触发。
    # 只做后台静默跳过，不改变按钮外观（不置灰），因此不影响界面表现；
    # 但能避免用户连点「立即登录」时并发发起多次认证 —— 校园网 AC 对同一账号的
    # 并发认证会返回「该 IP 已经在线」，反而把刚建立的会话踢掉，并弹出多个互相矛盾的结果框。
    _busy = set()
    _busy_lock = threading.Lock()

    def run_async(fn, key=None):
        if key is not None:
            with _busy_lock:
                if key in _busy:
                    return False
                _busy.add(key)
            def _wrapped():
                try:
                    fn()
                finally:
                    with _busy_lock:
                        _busy.discard(key)
            threading.Thread(target=_wrapped, daemon=True).start()
            return True
        threading.Thread(target=fn, daemon=True).start()
        return True

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
                    auto_card.config(highlightbackground="#059669")
                    auto_st_lbl.config(text="● 计划任务生效中", fg=success_color)
                    btn_autostart.config(text="卸载自启", bg="#334155", fg="#f87171",
                                         activebackground="#475569", activeforeground="#fca5a5")
                    btn_autostart.bind("<Enter>", lambda e: btn_autostart.config(bg="#475569"))
                    btn_autostart.bind("<Leave>", lambda e: btn_autostart.config(bg="#334155"))
                else:
                    auto_card.config(highlightbackground="#334155")
                    auto_st_lbl.config(text="○ 未配置自启任务", fg=text_muted)
                    btn_autostart.config(text="一键配置", bg="#2563eb", fg="#ffffff",
                                         activebackground="#1d4ed8", activeforeground="#ffffff")
                    btn_autostart.bind("<Enter>", lambda e: btn_autostart.config(bg="#1d4ed8"))
                    btn_autostart.bind("<Leave>", lambda e: btn_autostart.config(bg="#2563eb"))
            safe_ui(_ui)
        run_async(_task, 'autostart')

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
        st_card.config(highlightbackground="#334155")
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
                        st_card.config(highlightbackground="#059669")
                    else:
                        st_lbl.config(text="○ 未在线 (需要认证)", fg=danger_color)
                        st_card.config(highlightbackground="#ef4444")
                    ip_lbl.config(text="本机 IP: %s" % (ip or "—"))
                    dur_text = _calculate_duration(st)
                    dur_display = ("时长: %s" % dur_text) if dur_text else ("上线: %s" % time_str if time_str else "时长: —")
                    meta_lbl.config(text="流量: %s  |  %s  |  延迟: %d ms" % (flow, dur_display, ping_ms))
                safe_ui(_ui)
            except Exception as e:
                # 同样必须在 except 块内先取出消息：Python 会在块结束时删除 e，
                # 内层 def 闭包引用 e 时回调会抛 NameError，界面就永远停在「检测中…」。
                err_msg = "%s" % e
                def _err():
                    st_lbl.config(text="! 网络不可达", fg=danger_color)
                    st_card.config(highlightbackground="#ef4444")
                    ip_lbl.config(text="错误: %s" % err_msg)
                    meta_lbl.config(text="已用流量: —  |  时长: —")
                safe_ui(_err)
        run_async(_task, 'refresh')

    def do_test():
        st_lbl.config(text="→ 正在运行网络自检…", fg="#3b82f6")
        st_card.config(highlightbackground="#2563eb")
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
                # 必须在 except 块内先把消息取出来：Python 会在块结束时删除变量 e，
                # 若让 lambda 延迟引用 e，回调执行时会抛 NameError 而不是弹出错误框。
                err_msg = "网络自检失败: %s" % e
                safe_ui(lambda m=err_msg: [messagebox.showerror("自检异常", m), do_refresh()])
        run_async(_task, 'selftest')

    def do_login():
        u = user_ent.get().strip()
        p = pass_ent.get().strip()
        if not u or not p:
            messagebox.showwarning("提示", "请先输入上网账号和密码。")
            if not u:
                user_ent.focus()
            else:
                pass_ent.focus()
            return
        cfg["username"] = u
        cfg["password"] = p
        cfg["isp"] = isp_var.get()
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
                # 同上：先取值再交给延迟回调，避免 NameError
                err_msg = str(e)
                safe_ui(lambda m=err_msg: messagebox.showerror("错误", m))
        if run_async(_task, 'login'):
            st_lbl.config(text="→ 正在登录…", fg="#3b82f6")
            st_card.config(highlightbackground="#2563eb")

    def do_logout():
        if not messagebox.askyesno("注销确认", "确定要注销下线当前校园网会话吗？\n注销后电脑将断开互联网连接。"):
            return
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
                # 同上：先取值再交给延迟回调，避免 NameError
                err_msg = str(e)
                safe_ui(lambda m=err_msg: messagebox.showerror("错误", m))
        if run_async(_task, 'logout'):
            st_lbl.config(text="→ 正在注销…", fg="#f59e0b")
            st_card.config(highlightbackground="#f59e0b")

    def do_save():
        # 仅持久化合法配置字段，避免命令行临时参数（如 --user, --timeout）污染配置文件
        saved_cfg = {}
        if os.path.exists(CONFIG_PATH):
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8-sig") as rf:
                    saved_cfg = json.load(rf)
            except Exception:
                saved_cfg = {}
        saved_cfg["username"] = user_ent.get().strip()
        saved_cfg["password"] = pass_ent.get().strip()
        saved_cfg["isp"] = isp_var.get()
        for k in DEFAULT_CONFIG:
            if k not in saved_cfg and k in cfg:
                saved_cfg[k] = cfg[k]
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
                json.dump(saved_cfg, fh, indent=2, ensure_ascii=False)
            messagebox.showinfo("提示", "配置已成功保存至 config.json")
        except Exception as e:
            messagebox.showerror("保存失败", str(e))

    # 回车键快捷提交登录
    user_ent.bind("<Return>", lambda e: do_login())
    pass_ent.bind("<Return>", lambda e: do_login())

    btn_login = tk.Button(btn_frame, text="立即登录", font=("Microsoft YaHei", 10, "bold"), bg=accent, fg="#fff", activebackground="#1d4ed8", activeforeground="#ffffff", relief="flat", cursor="hand2", command=do_login)
    btn_login.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    btn_test = tk.Button(btn_frame, text="自检", font=("Microsoft YaHei", 10), bg="#334155", fg="#f8fafc", activebackground="#475569", activeforeground="#ffffff", relief="flat", cursor="hand2", command=do_test)
    btn_test.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    btn_refresh = tk.Button(btn_frame, text="刷新", font=("Microsoft YaHei", 10), bg="#1e293b", fg=text_color, activebackground="#334155", activeforeground=text_color, relief="flat", cursor="hand2", command=do_refresh)
    btn_refresh.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    btn_save = tk.Button(btn_frame, text="保存账号", font=("Microsoft YaHei", 10), bg="#1e293b", fg=text_color, activebackground="#334155", activeforeground=text_color, relief="flat", cursor="hand2", command=do_save)
    btn_save.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    btn_logout = tk.Button(btn_frame, text="注销", font=("Microsoft YaHei", 10), bg="#1e293b", fg="#f87171", activebackground="#475569", activeforeground="#fca5a5", relief="flat", cursor="hand2", command=do_logout)
    btn_logout.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    def bind_hover(btn, normal_bg, hover_bg, normal_fg=None, hover_fg=None):
        def on_enter(e):
            d = {"bg": hover_bg}
            if hover_fg: d["fg"] = hover_fg
            btn.config(**d)
        def on_leave(e):
            d = {"bg": normal_bg}
            if normal_fg: d["fg"] = normal_fg
            btn.config(**d)
        btn.bind("<Enter>", on_enter)
        btn.bind("<Leave>", on_leave)

    bind_hover(btn_login, accent, "#1d4ed8")
    bind_hover(btn_test, "#334155", "#475569")
    bind_hover(btn_refresh, "#1e293b", "#334155")
    bind_hover(btn_save, "#1e293b", "#334155")
    bind_hover(btn_logout, "#1e293b", "#7f1d1d", normal_fg="#f87171", hover_fg="#fca5a5")
    bind_hover(btn_copy_ip, "#334155", "#475569")
    bind_hover(btn_pwd_toggle, "#1e293b", "#334155")

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
    global _QUIET, _JSON_MODE
    args = build_parser().parse_args(argv)
    # --json 时一律静默：JSON 是给程序消费的，stdout 必须只有一行 JSON。
    # 原先写成 `quiet and not json`，等于「带 --json 就强制不静默」，
    # 于是所有在 emit_json 之前的进度输出都会混进 stdout，
    # 导致 `json.loads(stdout)` 失败。
    _JSON_MODE = bool(args.json)
    _QUIET = bool(args.quiet) or _JSON_MODE
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
        say_err("✗ 配置错误: %s" % exc)
        if args.json:
            emit_json({"success": False, "error": str(exc)})
        return EXIT_CONFIG
    except KeyboardInterrupt:
        say("\n已取消。")
        return EXIT_FAIL
    except NetworkError as exc:
        say_err("✗ %s" % exc)
        if args.json:
            emit_json({"success": False, "error": str(exc)})
        return EXIT_FAIL


if __name__ == "__main__":
    sys.exit(main())