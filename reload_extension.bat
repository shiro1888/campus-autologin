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

set "CHROME_BIN="
where chrome.exe >nul 2>nul && set "CHROME_BIN=chrome.exe"
if not defined CHROME_BIN if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_BIN=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_BIN if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_BIN=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_BIN if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME_BIN=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if defined CHROME_BIN (
    start "" "%CHROME_BIN%" "chrome://extensions/"
) else (
    start "" "chrome://extensions/"
)
timeout /t 5 >nul
exit /b 0
