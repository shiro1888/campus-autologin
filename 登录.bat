@echo off
chcp 936 >nul
title 校园网自动登录
cd /d "%~dp0"

set "PYEXE="
where py >nul 2>nul
if not errorlevel 1 set "PYEXE=py"
if defined PYEXE goto :run
where python >nul 2>nul
if not errorlevel 1 set "PYEXE=python"
if defined PYEXE goto :run

echo.
echo   [错误] 没有检测到 Python。
echo   请先到 https://www.python.org/downloads/ 安装 Python 3，
echo   安装时记得勾选 "Add Python to PATH"。
echo.
pause
exit /b 2

:run
echo ============================================
echo   校园网自动登录  http://172.30.100.2/
echo ============================================
echo.
%PYEXE% "%~dp0campus_login.py" %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" echo   完成。
if not "%RC%"=="0" echo   [失败] 退出码 %RC%
echo.
pause
exit /b %RC%