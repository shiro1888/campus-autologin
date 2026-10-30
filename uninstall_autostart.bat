@echo off
chcp 65001 >nul
title Campus AutoLogin - Uninstall AutoStart
cd /d "%~dp0"

set "THIS_BAT=%~f0"
set "SAFE_BAT=%THIS_BAT:'=''%"

:: Check admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Admin privileges required to uninstall...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process cmd.exe -ArgumentList ('/c \"\"' + '%SAFE_BAT%' + '\"\"') -Verb RunAs -Wait -PassThru; exit $p.ExitCode"
    exit /b
)

:: Run uninstaller with elevated rights
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_autostart.ps1" -Uninstall
set "EXIT_CODE=%errorlevel%"
echo.
echo ------------------------------------------------------------
echo   Press any key to exit...
echo ------------------------------------------------------------
pause >nul
exit /b %EXIT_CODE%
