@echo off
chcp 936 >nul
title 校园网自动登录 · 安装开机自启
cd /d "%~dp0"

:: 检查是否具有管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ============================================================
    echo   校园网自动登录 · 计划任务安装
    echo ============================================================
    echo.
    echo   注册系统计划任务需要管理员权限。
    echo   正在弹出系统 UAC 授权窗口，请在弹窗中点击 [是] 允许继续...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd.exe -ArgumentList '/c ""%~f0""' -Verb RunAs"
    exit /b
)

:: 已具有管理员权限，调用安装脚本
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0安装开机自启.ps1"
echo.
echo ------------------------------------------------------------
echo   按任意键关闭窗口...
echo ------------------------------------------------------------
pause >nul
exit /b 0
