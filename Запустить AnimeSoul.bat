@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".env.local" (
  echo Для AnimeSoul нужен публичный токен YummyAnime.
  echo Получить его можно в кабинете разработчика YummyAnime.
  set /p YUMMY_TOKEN="Введите публичный токен: "
  if "%YUMMY_TOKEN%"=="" (
    echo Токен не указан.
    pause
    exit /b 1
  )
  >".env.local" echo YUMMYANIME_TOKEN=%YUMMY_TOKEN%
)

if not exist "node_modules" (
  echo Первая установка AnimeSoul...
  call npm.cmd install
  if errorlevel 1 (
    echo Не удалось установить зависимости.
    pause
    exit /b 1
  )
)

if not exist "dist" (
  echo Сборка AnimeSoul...
  call npm.cmd run build
  if errorlevel 1 (
    echo Не удалось собрать AnimeSoul.
    pause
    exit /b 1
  )
)

start "AnimeSoul Server" /min cmd /c "cd /d ""%~dp0"" && npm.cmd run start -- --port 3001"
timeout /t 3 /nobreak >nul
start "" "http://localhost:3001/"
exit
