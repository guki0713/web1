@echo off
rem YouTube playlist CC downloader - Windows launcher (double-click)
chcp 65001 >nul
cd /d "%~dp0"

set "PY=python"
where py >nul 2>nul
if %errorlevel%==0 set "PY=py -3"

if not exist ".venv\Scripts\python.exe" (
  echo [1/2] First run: creating Python environment...
  %PY% -m venv .venv
  if errorlevel 1 (
    echo.
    echo Python is not installed. Install it from https://www.python.org/downloads/
    echo  - check "Add python.exe to PATH" during install, then run this file again.
    pause
    exit /b 1
  )
)

echo [2/2] Updating yt-dlp ^(YouTube changes often, so this runs every time^)...
".venv\Scripts\python.exe" -m pip install -q -U "yt-dlp[default]"
".venv\Scripts\python.exe" -m pip install -q -U curl-cffi >nul 2>nul

".venv\Scripts\python.exe" cc_downloader.py %*
echo.
pause
