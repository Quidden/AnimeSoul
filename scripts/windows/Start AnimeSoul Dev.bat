@echo off
setlocal
cd /d "%~dp0..\.."

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 before starting AnimeSoul.
  goto failed
)
node -e "if(Number(process.versions.node.split('.')[0])!==24)process.exit(1)"
if errorlevel 1 (
  echo AnimeSoul requires Node.js 24.
  goto failed
)

node --env-file-if-exists=.env scripts/workspace/dev-status.mjs
if errorlevel 11 goto failed
if errorlevel 10 goto already_running
if errorlevel 1 goto failed

where pnpm.cmd >nul 2>nul
if errorlevel 1 (
  where npx.cmd >nul 2>nul
  if errorlevel 1 (
    echo Install pnpm 11.25.0 or a Node.js installation with npm.
    goto failed
  )
  set "ANIMESOUL_PNPM=npx --yes pnpm@11.25.0"
) else (
  set "ANIMESOUL_PNPM=pnpm"
)

if not exist "node_modules\.modules.yaml" (
  call :pnpm install --frozen-lockfile
  if errorlevel 1 goto failed
)
call :pnpm run setup
if errorlevel 1 goto failed
echo Starting AnimeSoul: website http://localhost:8021
echo API http://127.0.0.1:8020 - administration http://localhost:8022
echo Press Ctrl+C to stop this run.
call :pnpm run dev --open
if errorlevel 1 goto failed
exit /b 0

:already_running
node --env-file-if-exists=.env scripts/workspace/open-development-site.mjs
if errorlevel 1 goto failed
exit /b 0

:pnpm
call %ANIMESOUL_PNPM% %*
exit /b %errorlevel%

:failed
echo AnimeSoul could not start. Check the error above.
pause
exit /b 1
