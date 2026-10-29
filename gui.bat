@echo off
chcp 936 >nul
title Campus Network Auto Login - Control Center
cd /d "%~dp0"

set "PYEXE="
where pythonw >nul 2>nul
if not errorlevel 1 set "PYEXE=pythonw"
if defined PYEXE goto :run
where pyw >nul 2>nul
if not errorlevel 1 set "PYEXE=pyw"
if defined PYEXE goto :run
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
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\pythonw.exe" (
    set "PYEXE=%%D\pythonw.exe"
    goto :run
)
for /d %%D in ("%ProgramFiles%\Python3*") do if exist "%%D\pythonw.exe" (
    set "PYEXE=%%D\pythonw.exe"
    goto :run
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
start "" "%PYEXE%" "%~dp0campus_login.py" gui
exit /b 0
