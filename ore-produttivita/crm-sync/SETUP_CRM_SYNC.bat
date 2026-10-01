@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python non trovato. Installa Python 3 e riprova.
  pause
  exit /b 1
)
py -m pip install --upgrade playwright
py -m playwright install chromium
echo.
echo Installazione completata.
pause
