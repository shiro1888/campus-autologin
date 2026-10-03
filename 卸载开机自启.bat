@echo off
chcp 936 >nul
title 校园网自动登录 · 卸载开机自启
cd /d "%~dp0"

:: 检查是否具有管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   正在请求管理员权限以卸载计划任务...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd.exe -ArgumentList '/c ""%~f0""' -Verb RunAs"
    exit /b
)

:: 已具有管理员权限，调用卸载
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0安装开机自启.ps1" -Uninstall
echo.
echo ------------------------------------------------------------
echo   按任意键关闭窗口...
echo ------------------------------------------------------------
pause >nul
exit /b 0
