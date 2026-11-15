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
where chrome.exe >nul 2>nul && for /f "delims=" %%I in ('where chrome.exe 2^>nul') do if not defined CHROME_BIN set "CHROME_BIN=%%~I"
if not defined CHROME_BIN for /f "tokens=2*" %%A in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| findstr /i "REG_"') do if exist "%%~B" set "CHROME_BIN=%%~B"
if not defined CHROME_BIN for /f "tokens=2*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| findstr /i "REG_"') do if exist "%%~B" set "CHROME_BIN=%%~B"
if not defined CHROME_BIN if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_BIN=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_BIN if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_BIN=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_BIN if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME_BIN=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if defined CHROME_BIN (
    start "" "%CHROME_BIN%" "chrome://extensions/"
    ping -n 3 127.0.0.1 >nul
    exit /b 0
)

echo [ERROR] Google Chrome (chrome.exe) was not found.
echo         Please open chrome://extensions/ manually and reload the extension.
exit /b 1
