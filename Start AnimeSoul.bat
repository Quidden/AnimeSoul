@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title AnimeSoul Launcher

if not exist ".env.local" (
  echo YUMMYANIME_TOKEN=1ha--f8b1x84w_75>".env.local"
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js 22 or newer from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\.bin\vinext.cmd" (
  echo Installing AnimeSoul dependencies...
  call npm.cmd install
  if errorlevel 1 goto :error
)

echo Starting AnimeSoul at http://localhost:3001/
start "AnimeSoul Server" /min cmd /c "cd /d ""%~dp0"" && npm.cmd run dev -- --port 3001"
timeout /t 6 /nobreak >nul
start "" "http://localhost:3001/"
exit /b 0

:error
echo AnimeSoul could not be started.
pause
exit /b 1
