@echo off
chcp 936 >nul
rem 供计划任务调用的静默版本：不弹窗，日志写入 logs\autologin.log
cd /d "%~dp0"
if not exist "%~dp0logs" mkdir "%~dp0logs"

set "PYEXE="
where py >nul 2>nul
if not errorlevel 1 set "PYEXE=py"
if defined PYEXE goto :run
where python >nul 2>nul
if not errorlevel 1 set "PYEXE=python"
if defined PYEXE goto :run
exit /b 2

:run
echo. >> "%~dp0logs\autologin.log"
echo [%date% %time%] ---- 开始 ---- >> "%~dp0logs\autologin.log"
%PYEXE% "%~dp0campus_login.py" wait -q >> "%~dp0logs\autologin.log" 2>&1
echo [%date% %time%] 退出: %ERRORLEVEL% >> "%~dp0logs\autologin.log"
exit /b %ERRORLEVEL%
