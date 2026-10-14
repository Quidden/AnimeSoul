@echo off
setlocal
cd /d "%~dp0..\.."

where docker.exe >nul 2>nul
if errorlevel 1 (
  echo Install and start Docker Desktop before starting AnimeSoul.
  goto failed
)
docker info >nul 2>nul
if errorlevel 1 (
  echo Start Docker Desktop and wait for the Linux engine to become ready.
  goto failed
)
if not exist ".env" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\Setup Docker.ps1"
  if errorlevel 1 goto failed
)
docker compose up -d --build --wait
if errorlevel 1 goto failed
echo AnimeSoul is running in Docker: http://localhost:8021
echo Administration: http://localhost:8022
echo To stop: docker compose stop
start "" "http://localhost:8021"
exit /b 0

:failed
echo AnimeSoul could not start. Check the error above.
pause
exit /b 1
