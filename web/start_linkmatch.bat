@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.13 or newer, then run this launcher again.
  pause
  exit /b 1
)
if not exist "node_modules\vinext\dist\cli.js" (
  echo Installing dependencies for the first run...
  call npm.cmd ci
  if errorlevel 1 (
    echo Installation failed. Check the error above and your internet connection.
    pause
    exit /b 1
  )
)
echo Starting LinkMatch. Open http://localhost:3000 when ready.
echo Keep this window open. Use Stop app or Ctrl+C to stop.
call npm.cmd run local
pause
