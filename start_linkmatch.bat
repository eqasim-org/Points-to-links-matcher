@echo off
cd /d "%~dp0web"
echo Starting LinkMatch locally...
echo.
echo When the server is ready, open http://localhost:3000 in your browser.
echo Keep this window open while using LinkMatch.
echo Press Ctrl+C to stop it.
echo.
call start_linkmatch.bat
pause
