import unittest
import os
import sys
import unicodedata

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

from campus_login import (
    _parse_result,
    _card_line,
    _format_flow,
    _calculate_duration,
    _explain_error,
    build_parser,
    main,
    EXIT_CONFIG,
    EXIT_OK,
    _DIRECT_OPENER,
)


class TestPortalParsing(unittest.TestCase):
    def test_parse_result_success(self):
        for val in (1, "1", "1.0", "ok", "OK", "true", "TRUE", True, 1.0):
            self.assertEqual(_parse_result(val), 1, f"Failed on {val}")

    def test_parse_result_failure(self):
        for val in (0, "0", "false", False, None, "", "   ", [], {}, float("nan"), float("inf"), -1):
            self.assertEqual(_parse_result(val), 0, f"Failed on {val}")


class TestCardFormatting(unittest.TestCase):
    @staticmethod
    def _disp_width(c: str) -> int:
        cp, eaw = ord(c), unicodedata.east_asian_width(c)
        if eaw in ("W", "F"):
            return 2
        if 0x2500 <= cp <= 0x257F:
            return 1
        if 0x2190 <= cp <= 0x21FF:
            return 1
        if cp in (0x00B7, 0x00B0, 0x00B1):
            return 1
        if cp in (0x25CF, 0x25CB, 0x25A0):
            return 2
        return 1

    def test_card_line_exact_56_columns(self):
        bar = "─" * 54
        lines = [
            "┌" + bar + "┐",
            _card_line("        校园网自动登录 · Dr.COM ePortal"),
            "├" + bar + "┤",
            _card_line("状态:      ● 已在线 (认证通过)"),
            _card_line("账号:      REDACTED_CAMPUS_ACCOUNT"),
            _card_line("本机 IP:   10.102.5.222"),
            _card_line("在线时长:  1小时 27分 05秒"),
            _card_line("已用流量:  3.11 GB (↓2.11 GB ↑1.16 GB)"),
            _card_line("账户余额:  10.50 元"),
            _card_line("上线时间:  2026-10-30 08:30:00"),
            "└" + bar + "┘",
        ]
        for idx, line in enumerate(lines, 1):
            dw = sum(self._disp_width(c) for c in line)
            self.assertEqual(dw, 56, f"Line {idx} width was {dw}, expected 56: {line}")


class TestCliBoundaries(unittest.TestCase):
    def test_retry_bounds(self):
        self.assertEqual(main(["status", "--retry", "-1"]), EXIT_CONFIG)
        self.assertEqual(main(["status", "--retry", "11"]), EXIT_CONFIG)

    def test_timeout_bounds(self):
        self.assertEqual(main(["status", "--timeout", "0.2"]), EXIT_CONFIG)
        self.assertEqual(main(["status", "--timeout", "3601"]), EXIT_CONFIG)


class TestSecurityFeatures(unittest.TestCase):
    def test_direct_opener_bypasses_proxy(self):
        # build_opener(ProxyHandler({})) 会显式移除 ProxyHandler，确保内网门户直连
        has_proxy = any(type(h).__name__ == "ProxyHandler" for h in _DIRECT_OPENER.handlers)
        self.assertFalse(has_proxy, "Direct opener should have no ProxyHandler to guarantee bypassing system proxies")


if __name__ == "__main__":
    unittest.main()
