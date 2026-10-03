@echo off
chcp 936 >nul
rem Silent runner for scheduled task, writes logs to logs\autologin.log
cd /d "%~dp0"
if not exist "%~dp0logs" mkdir "%~dp0logs"

set "PYEXE="
where py >nul 2>nul
if not errorlevel 1 set "PYEXE=py"
if defined PYEXE goto :run
where python >nul 2>nul
if not errorlevel 1 set "PYEXE=python"
if defined PYEXE goto :run

echo [%date% %time%] [ERROR] Python environment not found (neither py nor python in PATH) >> "%~dp0logs\autologin.log"
exit /b 2

:run
echo. >> "%~dp0logs\autologin.log"
echo [%date% %time%] ---- START ---- >> "%~dp0logs\autologin.log"
%PYEXE% "%~dp0campus_login.py" wait -q >> "%~dp0logs\autologin.log" 2>&1
echo [%date% %time%] EXIT: %ERRORLEVEL% >> "%~dp0logs\autologin.log"
exit /b %ERRORLEVEL%
