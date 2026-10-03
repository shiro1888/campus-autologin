@echo off
chcp 936 >nul
title Reload Chrome Extension
cd /d "%~dp0"

echo.
echo ============================================================
echo   Reload Chrome Extension
echo ============================================================
echo.
echo   [1] Locate the "Campus AutoLogin" card
echo   [2] Click the reload icon
echo   [3] Reopen any options tabs
echo.

start "" chrome.exe "chrome://extensions/"
timeout /t 5 >nul
exit /b 0
