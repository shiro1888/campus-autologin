@echo off
chcp 936 >nul
title 校园网自动登录 — 卸载开机自启
cd /d "%~dp0"

:: 检查是否有管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   需要管理员权限来卸载计划任务...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd.exe -ArgumentList ('/c \"\"%~f0\"\"') -Verb RunAs"
    exit /b
)

:: 已经有管理员权限，执行卸载
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0安装开机自启.ps1" -Uninstall
echo.
echo ------------------------------------------------------------
echo   按任意键关闭此窗口...
echo ------------------------------------------------------------
pause >nul
exit /b 0
