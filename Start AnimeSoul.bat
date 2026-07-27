@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title AnimeSoul Launcher

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

node launcher\start.mjs
if errorlevel 1 goto :error
pause
exit /b 0

:error
echo AnimeSoul could not be started.
pause
exit /b 1
