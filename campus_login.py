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
import shutil
import socket
import subprocess
import sys
import time
import traceback
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
    # 归一化运营商配置，避免脏数据导致 R3 非法透传或 GUI 单选框全部失选
    raw_isp = str(cfg.get("isp") or "1").strip()
    cfg["isp"] = raw_isp if raw_isp in ISP_CHOICES else "1"
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


def _parse_result(val) -> int:
    """安全解析门户返回的 result 状态值，返回 1 (在线/成功) 或 0 (离线/失败)。
    容错处理 1, "1", "ok", True, 空串, None 及异常 HTML，避免抛出 ValueError。
    """
    if val is None:
        return 0
    if isinstance(val, bool):
        return 1 if val else 0
    if isinstance(val, (int, float)):
        try:
            return 1 if int(val) == 1 else 0
        except (ValueError, OverflowError):
            return 0
    s = str(val).strip().lower()
    if s in ("1", "ok", "true", "success"):
        return 1
    return 0


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

    def check_online_state(self) -> str:
        """检测在线三态: 'online' (确认在线), 'offline' (确认未在线), 'unknown' (网络异常无法确认)。"""
        try:
            st = self.status()
            return "online" if _parse_result(st.get("result", 0)) == 1 else "offline"
        except (NetworkError, TypeError, ValueError):
            return "unknown"

    def is_online(self) -> bool:
        """是否确认在线。网络异常时不会误判为在线。"""
        return self.check_online_state() == "online"

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
            "R3": str(self.cfg.get("isp", "1") if str(self.cfg.get("isp", "1")) in ISP_CHOICES else "1"),
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
            ip = next((str(v) for v in [st.get("v4ip"), st.get("ss5")] if v and v != "0.0.0.0"), "")
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
                # 内核异步处理，给它一点时间确认下线
                for _ in range(5):
                    time.sleep(1)
                    state = self.check_online_state()
                    if state == "offline":
                        return {"ok": True, "detail": detail, "offline": True, "state": "offline"}
                    elif state == "unknown":
                        # 网络异常，无法确认真实下线状态（避免假成功误报）
                        return {
                            "ok": True,
                            "detail": detail,
                            "offline": False,
                            "state": "unknown",
                            "message": "网络异常，无法确认注销结果，请稍后复查",
                        }
                return {"ok": True, "detail": detail, "offline": False, "state": "online"}
        return {"ok": False, "detail": detail, "offline": False, "state": "unknown"}


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
    dw = 0
    for c in text:
        cp = ord(c)
        eaw = unicodedata.east_asian_width(c)
        if eaw in ("W", "F"):
            dw += 2
        elif 0x2500 <= cp <= 0x257F:          # Box Drawing 字符
            dw += 1
        elif 0x2190 <= cp <= 0x21FF:          # 箭头 (↓, ↑ 等)
            dw += 1
        elif cp in (0x00B7, 0x00B0, 0x00B1):  # · ° ± 等常渲染为半角
            dw += 1
        elif cp in (0x25CF, 0x25CB, 0x25A0):  # ● ○ ■ 终端中常渲染为全角 2 列
            dw += 2
        else:
            dw += 1
    pad = max(0, width - dw)
    return "│  " + text + (" " * pad) + " │"


def cmd_status(args, cfg) -> int:
    # 只查状态，不需要账号密码
    portal = _make_portal(args, cfg, require_credentials=False)
    st = portal.status()
    online = _parse_result(st.get("result", 0)) == 1
    ip = next((v for v in [st.get("v4ip"), st.get("ss5")] if v and v != "0.0.0.0"), None) or detect_local_ip(portal.host_only)
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
        try:
            cols = shutil.get_terminal_size((80, 24)).columns
        except Exception:
            cols = 80

        if cols < 58:
            # 窄终端（< 58 列，如分屏/窄视口）自动降级为紧凑无边框列表，防止 ASCII 边框换行破裂
            div_len = max(20, min(cols - 1, 48))
            div = "─" * div_len
            say("校园网自动登录 · Dr.COM ePortal")
            say(div)
            if online:
                say("状态:     ● 已在线 (认证通过)")
                say("账号:     %s" % info["account"])
                say("本机 IP:  %s" % (ip or "未连接"))
                if dur_text:
                    say("在线时长: %s" % dur_text)
                say("已用流量: %s" % flow_detail)
                if fee_text != "—":
                    say("账户余额: %s" % fee_text)
                if info["stime"]:
                    say("上线时间: %s" % info["stime"])
            else:
                say("状态:     ○ 未在线 (需要认证)")
                if ip:
                    say("本机 IP:  %s" % ip)
            say(div)
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

    # 这两个值来自用户手写的 config.json，类型不对或超界时规范化，避免负数延时崩溃或无限挂起
    try:
        retry = max(1, min(10, int(cfg.get("retry", 3))))
        delay = max(0.0, min(3600.0, float(cfg.get("retry_delay", 3))))
    except (TypeError, ValueError):
        raise ConfigError("retry / retry_delay 必须是数字，请检查 config.json")
    if args.retry is not None:
        if args.retry < 0 or args.retry > 10:
            raise ConfigError("--retry 必须在 0 到 10 之间")
        retry = max(1, args.retry)
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
    state = resp.get("state", "offline" if success else "online")
    if args.json:
        emit_json({"action": "logout", "success": success, "state": state,
                   "still_online": not success, "raw": resp.get("detail", [])})
    else:
        if success:
            say("✓ 已注销下线。")
        elif not resp.get("ok"):
            say_err("✗ 注销失败。")
            say("  如需下线，请到门户页面手动操作: %s/" % portal.web_base)
        elif state == "unknown":
            say_err("✗ 网络异常，无法确认注销结果，请稍后复查。")
            say("  若网线或 Wi-Fi 已断开，可能无需额外注销；如需确认请访问: %s/" % portal.web_base)
        else:
            say_err("✗ 注销请求已被接受，但会话仍在(部分 AC 不支持自助注销)。")
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
            if _parse_result(portal.status().get("result", 0)) == 1:
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
        online = _parse_result(st.get("result", 0)) == 1
        http_code = int(st.get("_http", 200))
        checks["认证接口"] = http_code
        if http_code == 200:
            say("  [OK] 认证接口 -> HTTP 200 (result=%s)" % st.get("result"))
        else:
            say_err("  [!!] 认证接口 -> HTTP %s (result=%s)" % (http_code, st.get("result")))
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
            say("\n结论: 网络连接失败，请确认已连接校园网 Wi-Fi 或插好网线")
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
    force = bool(getattr(args, "force", False))
    is_online = False
    try:
        is_online = int(st.get("result", 0)) == 1
    except (ValueError, TypeError):
        is_online = str(st.get("result", "")).strip().lower() in ("1", "ok")

    if not force and is_online:
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
        root.update_idletasks()
        inner_hwnd = root.winfo_id()
        hwnd = ctypes.windll.user32.GetAncestor(inner_hwnd, 2) or int(root.wm_frame(), 16)
        val = c_int(1)
        for attr in (20, 19):
            if ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, attr, byref(val), sizeof(val)) == 0:
                break
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

    THEME = {
        "bg": "#0f172a",
        "card": "#1e293b",
        "input_bg": "#0b1120",
        "border": "#334155",
        "hover": "#475569",
        "text": "#f8fafc",
        "text_muted": "#94a3b8",
        "accent": "#2563eb",
        "accent_hover": "#1d4ed8",
        "info": "#3b82f6",
        "success": "#10b981",
        "success_border": "#059669",
        "warning": "#f59e0b",
        "danger": "#ef4444",
        "danger_text": "#f87171",
        "danger_hover_bg": "#7f1d1d",
        "danger_hover_fg": "#fca5a5",
        "white": "#ffffff",
    }

    FONTS = {
        "title": ("Microsoft YaHei", 15, "bold"),
        "card_title": ("Microsoft YaHei", 10, "bold"),
        "label": ("Microsoft YaHei", 9, "bold"),
        "status": ("Microsoft YaHei", 13, "bold"),
        "body": ("Microsoft YaHei", 9),
        "button": ("Microsoft YaHei", 10),
        "button_bold": ("Microsoft YaHei", 10, "bold"),
        "mono": ("Consolas", 10),
    }

    bg = THEME["bg"]
    card_bg = THEME["card"]
    text_color = THEME["text"]
    text_muted = THEME["text_muted"]
    accent = THEME["accent"]
    success_color = THEME["success"]
    danger_color = THEME["danger"]

    # Header
    head = tk.Frame(root, bg=THEME["bg"], pady=10, padx=18)
    head.pack(side="top", fill="x")
    title = tk.Label(head, text="校园网自动登录", font=FONTS["title"], fg=THEME["text"], bg=THEME["bg"])
    title.pack(anchor="w")
    sub = tk.Label(head, text="Dr.COM ePortal · 实时自动刷新 (30s)", font=FONTS["body"], fg=THEME["text_muted"], bg=THEME["bg"])
    sub.pack(anchor="w", pady=(2, 0))

    # Actions Frame（提前固定在窗口底部，确保小屏或高 DPI 缩放下按钮绝不被裁切）
    btn_frame = tk.Frame(root, bg=THEME["bg"], padx=18, pady=(4, 12))
    btn_frame.pack(side="bottom", fill="x")

    # 中部可滚动视口 (Canvas + Scrollbar)，适配小屏笔记本与 150%/200% 高 DPI
    scroll_wrap = tk.Frame(root, bg=THEME["bg"])
    scroll_wrap.pack(side="top", fill="both", expand=True)

    scrollbar = tk.Scrollbar(scroll_wrap, orient="vertical", bg=THEME["border"],
                             activebackground=THEME["hover"], troughcolor=THEME["bg"],
                             bd=0, highlightthickness=0, width=10, relief="flat")
    canvas = tk.Canvas(scroll_wrap, bg=THEME["bg"], highlightthickness=0, bd=0, yscrollcommand=scrollbar.set)
    scrollbar.config(command=canvas.yview)

    scrollbar.pack(side="right", fill="y")
    canvas.pack(side="left", fill="both", expand=True)

    body_frame = tk.Frame(canvas, bg=THEME["bg"])
    canvas_window = canvas.create_window((0, 0), window=body_frame, anchor="nw")

    def _on_canvas_configure(event):
        canvas.itemconfig(canvas_window, width=event.width)

    def _on_frame_configure(event):
        canvas.configure(scrollregion=canvas.bbox("all"))

    canvas.bind("<Configure>", _on_canvas_configure)
    body_frame.bind("<Configure>", _on_frame_configure)

    def _on_mousewheel(event):
        try:
            if not root.winfo_exists():
                return
            canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        except Exception:
            pass

    root.bind_all("<MouseWheel>", _on_mousewheel)

    # Status Card
    st_card = tk.Frame(body_frame, bg=THEME["card"], padx=16, pady=12, highlightthickness=1, highlightbackground=THEME["border"])
    st_card.pack(fill="x", padx=18, pady=(2, 6))

    st_lbl = tk.Label(st_card, text="● 检测状态中…", font=FONTS["status"], fg=THEME["warning"], bg=THEME["card"])
    st_lbl.pack(anchor="w")

    # IP Row with Copy Button
    ip_frame = tk.Frame(st_card, bg=THEME["card"])
    ip_frame.pack(fill="x", pady=(6, 0))
    ip_lbl = tk.Label(ip_frame, text="本机 IP: —", font=FONTS["mono"], fg=THEME["text"], bg=THEME["card"])
    ip_lbl.pack(side="left")

    current_detected_ip = [""]

    def do_copy_ip():
        ip_val = current_detected_ip[0]
        if ip_val:
            root.clipboard_clear()
            root.clipboard_append(ip_val)
            btn_copy_ip.config(text="已复制 ✓", fg=THEME["success"])
            root.after(1500, lambda: btn_copy_ip.config(text="复制", fg=THEME["text_muted"]))

    btn_copy_ip = tk.Button(ip_frame, text="复制", font=FONTS["body"], bg=THEME["border"], fg=THEME["text_muted"],
                            activebackground=THEME["hover"], activeforeground=THEME["text"], relief="flat",
                            cursor="hand2", padx=6, command=do_copy_ip)
    btn_copy_ip.pack(side="right")

    meta_lbl = tk.Label(st_card, text="已用流量: —  |  时长: —", font=FONTS["body"], fg=THEME["text_muted"], bg=THEME["card"])
    meta_lbl.pack(anchor="w", pady=(2, 0))

    # 记录从磁盘加载的原始凭据与配置快照，作为未保存修改检测的权威基准
    raw_init_isp = str(cfg.get("isp", "1")).strip()
    _saved_snapshot = {
        "username": str(cfg.get("username", "")).strip(),
        "password": str(cfg.get("password", "")).strip(),
        "isp": raw_init_isp if raw_init_isp in ISP_CHOICES else "1",
    }

    # Form Card
    form_card = tk.Frame(body_frame, bg=THEME["card"], padx=16, pady=12, highlightthickness=1, highlightbackground=THEME["border"])
    form_card.pack(fill="x", padx=18, pady=(4, 6))

    # 上网账号
    tk.Label(form_card, text="上网账号", font=FONTS["label"], fg=THEME["text"], bg=THEME["card"]).pack(anchor="w")
    user_ent = tk.Entry(form_card, font=FONTS["button"], bg=THEME["input_bg"], fg=THEME["text"],
                        insertbackground=THEME["text"], relief="flat", highlightthickness=1,
                        highlightbackground=THEME["border"], highlightcolor=THEME["accent"])
    user_ent.insert(0, str(cfg.get("username", "")).strip())
    user_ent.pack(fill="x", pady=(3, 10), ipady=4)

    # 登录密码（带显示/隐藏切换小眼睛）
    tk.Label(form_card, text="登录密码", font=FONTS["label"], fg=THEME["text"], bg=THEME["card"]).pack(anchor="w")
    pwd_wrap = tk.Frame(form_card, bg=THEME["input_bg"], highlightthickness=1, highlightbackground=THEME["border"])
    pwd_wrap.pack(fill="x", pady=(3, 10))

    pass_ent = tk.Entry(pwd_wrap, show="●", font=FONTS["button"], bg=THEME["input_bg"], fg=THEME["text"],
                        insertbackground=THEME["text"], relief="flat", bd=0)
    pass_ent.bind("<FocusIn>", lambda e: pwd_wrap.config(highlightbackground=THEME["accent"]))
    pass_ent.bind("<FocusOut>", lambda e: pwd_wrap.config(highlightbackground=THEME["border"]))
    pass_ent.insert(0, str(cfg.get("password", "")).strip())
    pass_ent.pack(side="left", fill="x", expand=True, padx=6, ipady=4)

    pwd_visible = [False]
    pwd_timer = [None]

    def _auto_rehide_pwd():
        if pwd_visible[0]:
            pwd_visible[0] = False
            pass_ent.config(show="●")
            btn_pwd_toggle.config(text="显示")

    def toggle_pwd():
        if pwd_timer[0]:
            try:
                root.after_cancel(pwd_timer[0])
            except Exception:
                pass
            pwd_timer[0] = None
        pwd_visible[0] = not pwd_visible[0]
        pass_ent.config(show="" if pwd_visible[0] else "●")
        btn_pwd_toggle.config(text="隐藏" if pwd_visible[0] else "显示")
        if pwd_visible[0]:
            pwd_timer[0] = root.after(10000, _auto_rehide_pwd)

    btn_pwd_toggle = tk.Button(pwd_wrap, text="显示", font=FONTS["body"], bg=THEME["card"],
                               fg=THEME["text_muted"], activebackground=THEME["border"], activeforeground=THEME["text"],
                               relief="flat", bd=0, cursor="hand2", padx=6, command=toggle_pwd)
    btn_pwd_toggle.pack(side="right", padx=4, pady=2)

    # 运营商选择 (R3 参数)
    tk.Label(form_card, text="运营商选择 (R3 认证参数)", font=FONTS["label"],
             fg=THEME["text"], bg=THEME["card"]).pack(anchor="w", pady=(2, 2))
    isp_frame = tk.Frame(form_card, bg=THEME["card"])
    isp_frame.pack(fill="x", pady=(2, 4))
    raw_cfg_isp = str(cfg.get("isp", "1")).strip()
    isp_var = tk.StringVar(value=raw_cfg_isp if raw_cfg_isp in ISP_CHOICES else "1")
    for isp_k, isp_name in [("1", "校园用户"), ("2", "校园电信"), ("3", "校园联通"), ("4", "校园其他")]:
        r = tk.Radiobutton(isp_frame, text=isp_name, value=isp_k, variable=isp_var,
                           font=FONTS["body"], fg=THEME["text"], bg=THEME["card"],
                           selectcolor=THEME["bg"], activebackground=THEME["card"], activeforeground=THEME["text"],
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

    import queue
    _ui_queue = queue.Queue()

    def safe_ui(fn):
        """将 UI 更新投递到线程安全队列，由主线程消费，避免 Tkinter 跨线程卡顿与异常。"""
        _ui_queue.put(fn)

    def _process_ui_queue():
        while not _ui_queue.empty():
            try:
                cb = _ui_queue.get_nowait()
                cb()
            except Exception:
                pass
        try:
            if root.winfo_exists():
                root.after(40, _process_ui_queue)
        except Exception:
            pass

    root.after(40, _process_ui_queue)

    # Autostart Card (Windows 计划任务开机自启)
    auto_card = tk.Frame(body_frame, bg=THEME["card"], padx=16, pady=10, highlightthickness=1, highlightbackground=THEME["border"])
    auto_card.pack(fill="x", padx=18, pady=(4, 8))

    auto_head = tk.Frame(auto_card, bg=THEME["card"])
    auto_head.pack(fill="x")
    tk.Label(auto_head, text="Windows 计划任务开机自启", font=FONTS["card_title"], fg=THEME["text"], bg=THEME["card"]).pack(side="left")
    auto_st_lbl = tk.Label(auto_head, text="● 检测中…", font=FONTS["body"], fg=THEME["warning"], bg=THEME["card"])
    auto_st_lbl.pack(side="right")

    auto_body = tk.Frame(auto_card, bg=THEME["card"])
    auto_body.pack(fill="x", pady=(4, 0))
    tk.Label(auto_body, text="系统启动及网络连接时静默后台认证", font=FONTS["body"], fg=THEME["text_muted"], bg=THEME["card"]).pack(side="left")

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

    _autostart_cache = {"time": 0.0, "active": False}

    def update_autostart_ui(force: bool = False):
        def _task():
            now = time.time()
            if not force and (now - _autostart_cache["time"] < 300):
                is_active = _autostart_cache["active"]
            else:
                is_active = check_autostart()
                _autostart_cache["time"] = now
                _autostart_cache["active"] = is_active
            autostart_active[0] = is_active
            def _ui():
                if is_active:
                    auto_card.config(highlightbackground=THEME["success_border"])
                    auto_st_lbl.config(text="● 计划任务生效中", fg=THEME["success"])
                    btn_autostart.config(text="卸载自启", bg=THEME["border"], fg=THEME["danger_text"],
                                         activebackground=THEME["hover"], activeforeground=THEME["danger_hover_fg"])
                    btn_autostart.bind("<Enter>", lambda e: btn_autostart.config(bg=THEME["hover"]))
                    btn_autostart.bind("<Leave>", lambda e: btn_autostart.config(bg=THEME["border"]))
                else:
                    auto_card.config(highlightbackground=THEME["border"])
                    auto_st_lbl.config(text="○ 未配置自启任务", fg=THEME["text_muted"])
                    btn_autostart.config(text="一键配置", bg=THEME["accent"], fg=THEME["white"],
                                         activebackground=THEME["accent_hover"], activeforeground=THEME["white"])
                    btn_autostart.bind("<Enter>", lambda e: btn_autostart.config(bg=THEME["accent_hover"]))
                    btn_autostart.bind("<Leave>", lambda e: btn_autostart.config(bg=THEME["accent"]))
            safe_ui(_ui)
        run_async(_task, 'autostart')

    def toggle_autostart():
        if autostart_active[0]:
            if not messagebox.askyesno("卸载确认", "确定要移除 Windows 开机自启计划任务吗？\n移除后开机将不会自动登录校园网。"):
                return
            bat_path = os.path.join(BASE_DIR, "uninstall_autostart.bat")
            if not os.path.isfile(bat_path):
                st_lbl.config(text="✗ 未找到 uninstall_autostart.bat，请检查项目完整性", fg=THEME["danger"])
                return
            try:
                os.startfile(bat_path)
            except Exception as e:
                messagebox.showerror("启动失败", str(e))
        else:
            bat_path = os.path.join(BASE_DIR, "install_autostart.bat")
            if not os.path.isfile(bat_path):
                st_lbl.config(text="✗ 未找到 install_autostart.bat，请检查项目完整性", fg=THEME["danger"])
                return
            try:
                os.startfile(bat_path)
            except Exception as e:
                messagebox.showerror("启动失败", str(e))
        root.after(3000, lambda: update_autostart_ui(force=True))

    btn_autostart = tk.Button(auto_body, text="—", font=FONTS["body"], bg=THEME["border"], fg=THEME["text"],
                              relief="flat", cursor="hand2", padx=8, pady=1, command=toggle_autostart)
    btn_autostart.pack(side="right")


    def do_refresh():
        st_lbl.config(text="● 检测中…", fg=THEME["warning"])
        st_card.config(highlightbackground=THEME["border"])
        update_autostart_ui()
        def _task():
            try:
                t0 = time.time()
                portal = Portal(cfg)
                st = portal.status()
                ping_ms = int((time.time() - t0) * 1000)
                online = _parse_result(st.get("result", 0)) == 1
                ip = next((v for v in [st.get("v4ip"), st.get("ss5")] if v and v != "0.0.0.0"), None) or detect_local_ip(portal.host_only)
                current_detected_ip[0] = ip
                flow = _format_flow(st.get("flow", 0))
                time_str = st.get("stime", "")
                def _ui():
                    if online:
                        st_lbl.config(text="● 已在线 (认证通过)", fg=THEME["success"])
                        st_card.config(highlightbackground=THEME["success_border"])
                    else:
                        st_lbl.config(text="○ 未在线 (需要认证)", fg=THEME["danger"])
                        st_card.config(highlightbackground=THEME["danger"])
                    ip_lbl.config(text="本机 IP: %s" % (ip or "—"))
                    dur_text = _calculate_duration(st)
                    dur_display = ("时长: %s" % dur_text) if dur_text else ("上线: %s" % time_str if time_str else "时长: —")
                    refreshed_at = time.strftime("%H:%M:%S")
                    meta_lbl.config(text="流量: %s  |  %s  |  延迟: %d ms  |  更新: %s" % (flow, dur_display, ping_ms, refreshed_at))
                safe_ui(_ui)
            except Exception as e:
                # 同样必须在 except 块内先取出消息：Python 会在块结束时删除 e，
                # 内层 def 闭包引用 e 时回调会抛 NameError，界面就永远停在「检测中…」。
                err_msg = "%s" % e
                def _err():
                    st_lbl.config(text="! 网络连接失败", fg=THEME["danger"])
                    st_card.config(highlightbackground=THEME["danger"])
                    ip_lbl.config(text="错误: %s" % err_msg)
                    meta_lbl.config(text="已用流量: —  |  时长: —  |  更新: %s" % time.strftime("%H:%M:%S"))
                safe_ui(_err)
        run_async(_task, 'refresh')

    def do_test():
        st_lbl.config(text="→ 正在运行网络自检…", fg=THEME["info"])
        st_card.config(highlightbackground=THEME["accent"])
        def _task():
            try:
                portal = Portal(cfg)
                c_home, _ = http_request(portal.web_base + "/", portal.timeout)
                c_ep, _ = http_request(portal.ep_base + "/", portal.timeout)
                st = portal.status()
                c_auth = st.get("_http", 200)
                online = _parse_result(st.get("result", 0)) == 1
                ip = next((v for v in [st.get("v4ip"), st.get("ss5")] if v and v != "0.0.0.0"), None) or detect_local_ip(portal.host_only)
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
                        "校园网网关与认证服务全部连通正常！" if (c_home == 200 and c_auth == 200 and c_ep == 200) else "部分接口响应异常，请检查网线或 Wi-Fi 连接。"
                    )
                )
                safe_ui(lambda: [messagebox.showinfo("网络自检诊断", diag), do_refresh()])
            except Exception as e:
                # 必须在 except 块内先把消息取出来：Python 会在块结束时删除变量 e，
                # 若让 lambda 延迟引用 e，回调执行时会抛 NameError 而不是弹出错误框。
                err_msg = "网络自检失败: %s" % e
                safe_ui(lambda m=err_msg: [messagebox.showerror("自检异常", m), do_refresh()])
        run_async(_task, 'selftest')

    def _is_btn_hovered(btn):
        try:
            return root.winfo_containing(root.winfo_pointerx(), root.winfo_pointery()) == btn
        except Exception:
            return getattr(btn, "_is_hovered", False)

    def set_auth_busy(busy):
        st = "disabled" if busy else "normal"
        try:
            btn_login.config(state=st)
            btn_logout.config(state=st)
            if not busy:
                login_bg = THEME["accent_hover"] if _is_btn_hovered(btn_login) else THEME["accent"]
                btn_login.config(bg=login_bg, fg=THEME["white"])
                logout_bg = THEME["danger_hover_bg"] if _is_btn_hovered(btn_logout) else THEME["card"]
                logout_fg = THEME["danger_hover_fg"] if _is_btn_hovered(btn_logout) else THEME["danger_text"]
                btn_logout.config(bg=logout_bg, fg=logout_fg)
        except Exception:
            pass

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
        raw_isp = str(isp_var.get() or "1").strip()
        current_isp = raw_isp if raw_isp in ISP_CHOICES else "1"
        login_cfg = dict(cfg)
        login_cfg["username"] = u
        login_cfg["password"] = p
        login_cfg["isp"] = current_isp
        def _task():
            try:
                portal = Portal(login_cfg)
                # C1: 先查在线状态，若已在线则弹窗确认，默认不重登
                try:
                    curr_st = portal.status()
                    if _parse_result(curr_st.get("result", 0)) == 1:
                        confirm = [False]
                        ev = threading.Event()
                        def _prompt():
                            confirm[0] = messagebox.askyesno(
                                "提示",
                                "当前网络已处于在线认证状态，确定要重新登录吗？\n（重新登录可能踢掉现有会话）",
                                default="no",
                            )
                            ev.set()
                        safe_ui(_prompt)
                        # 增加 120s 超时兜底，防止弹窗未弹或主循环异常退出导致工作线程永久挂起
                        if not ev.wait(timeout=120) or not confirm[0]:
                            safe_ui(lambda: [
                                set_auth_busy(False),
                                st_lbl.config(text="● 已保持在线", fg=THEME["success"]),
                                do_refresh(),
                            ])
                            return
                except NetworkError:
                    pass

                res = portal.login(u, p)
                def _ui():
                    set_auth_busy(False)
                    if res.get("ok"):
                        st_lbl.config(text="● 登录成功，已确认在线！", fg=THEME["success"])
                        st_card.config(highlightbackground=THEME["success_border"])
                    else:
                        messagebox.showerror("失败", "登录失败: " + str(res.get("message", "未知错误")))
                    do_refresh()
                safe_ui(_ui)
            except Exception as e:
                # 同上：先取值再交给延迟回调，避免 NameError
                err_msg = str(e)
                safe_ui(lambda m=err_msg: [set_auth_busy(False), messagebox.showerror("错误", m)])
        if not run_async(_task, 'auth'):
            st_lbl.config(text="⏳ 认证操作进行中，请稍候…", fg=THEME["warning"])
            return
        set_auth_busy(True)
        st_lbl.config(text="→ 正在登录…", fg=THEME["info"])
        st_card.config(highlightbackground=THEME["accent"])

    def do_logout():
        if not messagebox.askyesno("注销确认", "确定要注销下线当前校园网会话吗？\n注销后电脑将断开互联网连接。"):
            return
        def _task():
            try:
                portal = Portal(cfg)
                res = portal.logout()
                def _ui():
                    set_auth_busy(False)
                    if res.get("offline"):
                        st_lbl.config(text="○ 已注销下线", fg=THEME["text_muted"])
                        st_card.config(highlightbackground=THEME["border"])
                    elif res.get("ok"):
                        messagebox.showwarning("注销", "注销请求已被接受，但会话仍在。\n部分网关不支持客户端自助注销，请到门户页面手动注销。")
                    else:
                        messagebox.showwarning("注销失败", "注销请求未被网关接受。\n请确认已连接校园网，或到门户页面手动注销。")
                    do_refresh()
                safe_ui(_ui)
            except Exception as e:
                # 同上：先取值再交给延迟回调，避免 NameError
                err_msg = str(e)
                safe_ui(lambda m=err_msg: [set_auth_busy(False), messagebox.showerror("错误", m)])
        if not run_async(_task, 'auth'):
            st_lbl.config(text="⏳ 认证操作进行中，请稍候…", fg=THEME["warning"])
            return
        set_auth_busy(True)
        st_lbl.config(text="→ 正在注销…", fg=THEME["warning"])
        st_card.config(highlightbackground=THEME["warning"])

    def do_save():
        # 仅持久化合法配置字段，避免命令行临时参数（如 --user, --timeout）污染配置文件，
        # 并显式校验 dict 类型与剔除 _ 前缀的注释键
        saved_cfg = {}
        if os.path.exists(CONFIG_PATH):
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8-sig") as rf:
                    loaded = json.load(rf)
                    if isinstance(loaded, dict):
                        saved_cfg = {k: v for k, v in loaded.items() if not str(k).startswith("_")}
            except Exception:
                saved_cfg = {}
        saved_cfg["username"] = user_ent.get().strip()
        saved_cfg["password"] = pass_ent.get().strip()
        raw_isp = str(isp_var.get() or "1").strip()
        saved_cfg["isp"] = raw_isp if raw_isp in ISP_CHOICES else "1"
        for k in DEFAULT_CONFIG:
            if k not in saved_cfg and k in cfg:
                saved_cfg[k] = cfg[k]
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
                json.dump(saved_cfg, fh, indent=2, ensure_ascii=False)
            cfg.update(saved_cfg)
            _saved_snapshot["username"] = str(saved_cfg.get("username", ""))
            _saved_snapshot["password"] = str(saved_cfg.get("password", ""))
            _saved_snapshot["isp"] = str(saved_cfg.get("isp", "1"))
            if user_ent.get() != saved_cfg["username"]:
                user_ent.delete(0, tk.END)
                user_ent.insert(0, saved_cfg["username"])
            if pass_ent.get() != saved_cfg["password"]:
                pass_ent.delete(0, tk.END)
                pass_ent.insert(0, saved_cfg["password"])
            btn_save.config(text="已保存 ✓", fg=THEME["success"])
            root.after(1500, lambda: btn_save.config(text="保存", fg=THEME["text"]))
            st_lbl.config(text="● 配置已成功保存至 config.json", fg=THEME["success"])
        except Exception as e:
            messagebox.showerror("保存失败", str(e))

    # 回车键快捷提交登录
    user_ent.bind("<Return>", lambda e: do_login())
    pass_ent.bind("<Return>", lambda e: do_login())

    btn_login = tk.Button(btn_frame, text="登录", font=FONTS["button_bold"], bg=THEME["accent"], fg=THEME["white"], activebackground=THEME["accent_hover"], activeforeground=THEME["white"], relief="flat", cursor="hand2", command=do_login)
    btn_login.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    btn_test = tk.Button(btn_frame, text="自检", font=FONTS["button"], bg=THEME["border"], fg=THEME["text"], activebackground=THEME["hover"], activeforeground=THEME["white"], relief="flat", cursor="hand2", command=do_test)
    btn_test.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    btn_refresh = tk.Button(btn_frame, text="刷新", font=FONTS["button"], bg=THEME["card"], fg=THEME["text"], activebackground=THEME["border"], activeforeground=THEME["text"], relief="flat", cursor="hand2", command=do_refresh)
    btn_refresh.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    btn_save = tk.Button(btn_frame, text="保存", font=FONTS["button"], bg=THEME["card"], fg=THEME["text"], activebackground=THEME["border"], activeforeground=THEME["text"], relief="flat", cursor="hand2", command=do_save)
    btn_save.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    btn_logout = tk.Button(btn_frame, text="注销", font=FONTS["button"], bg=THEME["card"], fg=THEME["danger_text"], activebackground=THEME["hover"], activeforeground=THEME["danger_hover_fg"], relief="flat", cursor="hand2", command=do_logout)
    btn_logout.pack(side="left", expand=True, fill="x", padx=2, ipady=6)

    def bind_hover(btn, normal_bg, hover_bg, normal_fg=None, hover_fg=None):
        btn._is_hovered = False
        def on_enter(e):
            btn._is_hovered = True
            try:
                if str(btn.cget("state")) == "disabled":
                    return
            except Exception:
                pass
            d = {"bg": hover_bg}
            if hover_fg: d["fg"] = hover_fg
            btn.config(**d)
        def on_leave(e):
            btn._is_hovered = False
            try:
                if str(btn.cget("state")) == "disabled":
                    return
            except Exception:
                pass
            d = {"bg": normal_bg}
            if normal_fg: d["fg"] = normal_fg
            btn.config(**d)
        btn.bind("<Enter>", on_enter)
        btn.bind("<Leave>", on_leave)

    bind_hover(btn_login, THEME["accent"], THEME["accent_hover"])
    bind_hover(btn_test, THEME["border"], THEME["hover"])
    bind_hover(btn_refresh, THEME["card"], THEME["border"])
    bind_hover(btn_save, THEME["card"], THEME["border"])
    bind_hover(btn_logout, THEME["card"], THEME["danger_hover_bg"], normal_fg=THEME["danger_text"], hover_fg=THEME["danger_hover_fg"])
    bind_hover(btn_copy_ip, THEME["border"], THEME["hover"])
    bind_hover(btn_pwd_toggle, THEME["card"], THEME["border"])

    # 周期性后台状态心跳检测 (每 30 秒，自动刷新在线状态与流量，避免遥测数据停滞)
    _heartbeat_timer = [None]

    def _heartbeat():
        try:
            if root.winfo_exists():
                do_refresh()
                _heartbeat_timer[0] = root.after(30000, _heartbeat)
        except Exception:
            pass

    def _destroy_window():
        try:
            if pwd_timer[0]:
                root.after_cancel(pwd_timer[0])
        except Exception:
            pass
        try:
            if _heartbeat_timer[0]:
                root.after_cancel(_heartbeat_timer[0])
        except Exception:
            pass
        try:
            root.unbind_all("<MouseWheel>")
        except Exception:
            pass
        root.destroy()

    def _on_close():
        _handle_escape()

    def _handle_escape(e=None):
        u = user_ent.get().strip()
        p = pass_ent.get().strip()
        raw_isp = str(isp_var.get() or "1").strip()
        current_isp = raw_isp if raw_isp in ISP_CHOICES else "1"
        is_dirty = (
            u != _saved_snapshot["username"] or
            p != _saved_snapshot["password"] or
            current_isp != _saved_snapshot["isp"]
        )
        if is_dirty and (u or p or current_isp != _saved_snapshot["isp"]):
            if messagebox.askyesno("退出确认", "检测到账号、密码或运营商有未保存的修改，确定要退出吗？"):
                _destroy_window()
        else:
            _destroy_window()

    root.protocol("WM_DELETE_WINDOW", _on_close)

    # 快捷键绑定 (Ctrl+R / F5 刷新, Ctrl+S 保存, Ctrl+Q 退出, Esc 退出防误触)
    root.bind("<Control-r>", lambda e: do_refresh())
    root.bind("<Control-R>", lambda e: do_refresh())
    root.bind("<F5>", lambda e: do_refresh())
    root.bind("<Control-s>", lambda e: do_save())
    root.bind("<Control-S>", lambda e: do_save())
    root.bind("<Control-q>", lambda e: _on_close())
    root.bind("<Control-Q>", lambda e: _on_close())
    root.bind("<Escape>", _handle_escape)

    do_refresh()
    _heartbeat_timer[0] = root.after(30000, _heartbeat)
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
    # 严格校验命令行参数边界，避免负数延时或异常高频请求
    if args.retry is not None and not (0 <= args.retry <= 10):
        say_err("✗ 参数错误: --retry 必须在 0 到 10 之间")
        return EXIT_CONFIG
    if args.timeout is not None and not (0.5 <= args.timeout <= 3600.0):
        say_err("✗ 参数错误: --timeout 必须在 0.5 到 3600 秒之间")
        return EXIT_CONFIG

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
    except Exception as exc:
        say_err("✗ 未预期的错误: %s" % exc)
        try:
            log_dir = os.path.join(BASE_DIR, "logs")
            os.makedirs(log_dir, exist_ok=True)
            with open(os.path.join(log_dir, "crash.log"), "a", encoding="utf-8") as f:
                f.write("%s [%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), type(exc).__name__, exc))
                traceback.print_exc(file=f)
        except Exception:
            pass
        if args.command == "gui":
            try:
                from tkinter import messagebox as mb
                mb.showerror("系统异常", "桌面控制中心运行遇到未捕获的错误:\n%s\n\n详情已写入 logs/crash.log" % exc)
            except Exception:
                pass
        if args.json:
            emit_json({"success": False, "error": str(exc), "type": type(exc).__name__})
        return EXIT_FAIL


if __name__ == "__main__":
    sys.exit(main())