@echo off
chcp 936 >nul
title Campus AutoLogin - Install AutoStart
cd /d "%~dp0"

set "THIS_BAT=%~f0"
set "SAFE_BAT=%THIS_BAT:'=''%"

:: Check admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ============================================================
    echo   Campus AutoLogin - Install Scheduled Task
    echo ============================================================
    echo.
    echo   Admin privileges required.
    echo   Requesting UAC elevation...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd.exe -ArgumentList ('/c \"\"' + '%SAFE_BAT%' + '\"\"') -Verb RunAs"
    exit /b
)

:: Run installer with elevated rights
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_autostart.ps1"
set "EXIT_CODE=%errorlevel%"
echo.
echo ------------------------------------------------------------
echo   Press any key to exit...
echo ------------------------------------------------------------
pause >nul
exit /b %EXIT_CODE%
