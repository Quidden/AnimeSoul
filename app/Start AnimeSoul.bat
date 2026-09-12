@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Creating isolated Python environment...
  py -3 -m venv .venv
  if errorlevel 1 goto :error
)

rem Never let a mobile build flag leak into the desktop bundle.
set "VITE_ANIMESOUL_PLATFORM="
".venv\Scripts\python.exe" tools\prepare_runtime.py
if errorlevel 1 goto :error

".venv\Scripts\python.exe" run.py %*
exit /b %errorlevel%

:error
echo.
echo AnimeSoul could not be started. Check that Python 3.11+ and Node.js 22+ are installed.
pause
exit /b 1
