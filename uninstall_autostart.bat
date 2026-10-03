@echo off
chcp 936 >nul
title Campus AutoLogin - Uninstall AutoStart
cd /d "%~dp0"

:: Check admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Admin privileges required to uninstall...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd.exe -ArgumentList ('/c \"\"%~f0\"\"') -Verb RunAs"
    exit /b
)

:: Run uninstaller with elevated rights
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_autostart.ps1" -Uninstall
echo.
echo ------------------------------------------------------------
echo   Press any key to exit...
echo ------------------------------------------------------------
pause >nul
exit /b 0
