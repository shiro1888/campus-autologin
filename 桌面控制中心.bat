@echo off
chcp 936 >nul
title 校园网自动登录 · 桌面控制中心
cd /d "%~dp0"

set "PYEXE="
where py >nul 2>nul
if not errorlevel 1 set "PYEXE=py"
if defined PYEXE goto :run
where python >nul 2>nul
if not errorlevel 1 set "PYEXE=python"
if defined PYEXE goto :run

echo.
echo   [错误] 没有检测到 Python 运行环境
echo.
pause
exit /b 2

:run
start "" %PYEXE% "%~dp0campus_login.py" gui
exit /b 0
