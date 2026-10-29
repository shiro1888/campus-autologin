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
if exist "%~dp0.python_path" (
    set /p PYEXE=<"%~dp0.python_path"
    if exist "%PYEXE%" goto :run
)
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" (
    set "PYEXE=%%D\python.exe"
    goto :run
)
for /d %%D in ("%ProgramFiles%\Python3*") do if exist "%%D\python.exe" (
    set "PYEXE=%%D\python.exe"
    goto :run
)

echo [!] Python not found in PATH.
pause
exit /b 2

:run
"%PYEXE%" "%~dp0campus_login.py" %*
set "EXIT_CODE=%ERRORLEVEL%"
if "%~1"=="" (
    echo.
    pause
)
exit /b %EXIT_CODE%
