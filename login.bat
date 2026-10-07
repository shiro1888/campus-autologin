@echo off
chcp 936 >nul
title Campus Network Auto Login
cd /d "%~dp0"

set "PYEXE="
where py >nul 2>nul
if not errorlevel 1 set "PYEXE=py"
if defined PYEXE goto :run
where python >nul 2>nul
if not errorlevel 1 set "PYEXE=python"
if defined PYEXE goto :run

echo [!] Python not found in PATH.
pause
exit /b 2

:run
"%PYEXE%" "%~dp0campus_login.py" %*
exit /b %ERRORLEVEL%
