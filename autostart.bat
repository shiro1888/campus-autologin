@echo off
chcp 936 >nul
rem Silent runner for scheduled task, writes logs to logs\autologin.log
cd /d "%~dp0"
if not exist "%~dp0logs" mkdir "%~dp0logs"
set "LOGFILE=%~dp0logs\autologin.log"
if exist "%LOGFILE%" for %%A in ("%LOGFILE%") do if %%~zA gtr 1048576 (
    copy /y "%LOGFILE%" "%~dp0logs\autologin.old.log" >nul 2>nul
    type nul > "%LOGFILE%"
)

set "PYEXE="
if exist "%~dp0.python_path" (
    set /p PYEXE=<"%~dp0.python_path"
    if exist "%PYEXE%" goto :run
)
rem Search PATH for an interpreter, skipping the WindowsApps store alias
rem (that is a placeholder that opens Microsoft Store, not a real Python).
for /f "delims=" %%P in ('where py 2^>nul') do (
    echo %%P | findstr /i "WindowsApps" >nul
    if errorlevel 1 ( set "PYEXE=%%P" & goto :run )
)
for /f "delims=" %%P in ('where python 2^>nul') do (
    echo %%P | findstr /i "WindowsApps" >nul
    if errorlevel 1 ( set "PYEXE=%%P" & goto :run )
)
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%D\python.exe" (
    set "PYEXE=%%D\python.exe"
    goto :run
)
for /d %%D in ("%ProgramFiles%\Python3*") do if exist "%%D\python.exe" (
    set "PYEXE=%%D\python.exe"
    goto :run
)

echo [%date% %time%] [ERROR] Python environment not found (neither py nor python in PATH) >> "%LOGFILE%"
exit /b 2

:run
echo. >> "%LOGFILE%"
echo [%date% %time%] ---- START ---- >> "%LOGFILE%"
"%PYEXE%" "%~dp0campus_login.py" wait -q >> "%LOGFILE%" 2>&1
echo [%date% %time%] EXIT: %ERRORLEVEL% >> "%LOGFILE%"
exit /b %ERRORLEVEL%
