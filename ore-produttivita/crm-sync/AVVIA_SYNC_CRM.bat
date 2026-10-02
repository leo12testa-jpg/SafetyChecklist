@echo off
setlocal
title Colligo - Sincronizza la mia Agenda CRM
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRORE] Python non trovato sul PC.
  echo Installa Python 3 e poi rilancia questo file.
  echo.
  pause
  exit /b 1
)

py -c "import playwright" >nul 2>nul
if errorlevel 1 (
  echo.
  echo Prima configurazione: installo Playwright...
  py -m pip install playwright
  if errorlevel 1 goto :errore
)

echo.
echo Avvio sincronizzazione della TUA agenda CRM...
echo.
py crm_agenda_sync.py
goto :fine

:errore
echo.
echo [ERRORE] Configurazione non riuscita.
echo.

:fine
echo.
pause
