@echo off
chcp 936 >nul
title Campus Network Auto Login - Control Center
cd /d "%~dp0"

set "PYEXE="
rem Search PATH for an interpreter, skipping the WindowsApps store alias
rem (that is a placeholder that opens Microsoft Store, not a real Python).
for /f "delims=" %%P in ('where pythonw 2^>nul') do (
    echo %%P | findstr /i "WindowsApps" >nul
    if errorlevel 1 ( set "PYEXE=%%P" & goto :run )
)
for /f "delims=" %%P in ('where pyw 2^>nul') do (
    echo %%P | findstr /i "WindowsApps" >nul
    if errorlevel 1 ( set "PYEXE=%%P" & goto :run )
)
for /f "delims=" %%P in ('where py 2^>nul') do (
    echo %%P | findstr /i "WindowsApps" >nul
    if errorlevel 1 ( set "PYEXE=%%P" & goto :run )
)
for /f "delims=" %%P in ('where python 2^>nul') do (
    echo %%P | findstr /i "WindowsApps" >nul
    if errorlevel 1 ( set "PYEXE=%%P" & goto :run )
)
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
