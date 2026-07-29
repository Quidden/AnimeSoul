@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Creating isolated Python environment...
  py -3 -m venv .venv
  if errorlevel 1 goto :error
)

echo Installing Python dependencies...
".venv\Scripts\python.exe" -m pip install -q -r backend\requirements.txt
if errorlevel 1 goto :error

if not exist "frontend\node_modules" (
  echo Installing React dependencies...
  call npm --prefix frontend install
  if errorlevel 1 goto :error
)

echo Building React interface...
call npm --prefix frontend run build
if errorlevel 1 goto :error

".venv\Scripts\python.exe" run.py %*
exit /b %errorlevel%

:error
echo.
echo AnimeSoul could not be started. Check that Python 3.11+ and Node.js 22+ are installed.
pause
exit /b 1
