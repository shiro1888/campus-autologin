@echo off
chcp 65001 >nul
title Campus AutoLogin - Install AutoStart
cd /d "%~dp0"

set "THIS_BAT=%~f0"
set "SAFE_BAT=%THIS_BAT:'=''%"

:: Check admin rights (query Administrators membership; net session depends on the
:: Server service and can false-negative even when already elevated)
powershell -NoProfile -Command "if(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 0}else{exit 1}"
if %errorlevel% neq 0 (
    echo.
    echo ============================================================
    echo   Campus AutoLogin - Install Scheduled Task
    echo ============================================================
    echo.
    echo   Admin privileges required.
    echo   Requesting UAC elevation...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process cmd.exe -ArgumentList ('/c \"\"' + '%SAFE_BAT%' + '\"\"') -Verb RunAs -Wait -PassThru; exit $p.ExitCode"
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
