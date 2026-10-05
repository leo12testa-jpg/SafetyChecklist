@echo off
setlocal
title Colligo - Configura sincronizzazione Agenda CRM
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRORE] Python non trovato.
  echo Installa Python 3 e poi rilancia questo file.
  echo.
  pause
  exit /b 1
)

echo.
echo Installo/aggiorno Playwright...
py -m pip install playwright==1.55.0
if errorlevel 1 goto :errore

echo.
echo Registro il pulsante "Sincronizza CRM" per questo utente Windows...
reg add "HKCU\Software\Classes\colligoore" /ve /d "URL:Colligo Ore & Produttivita" /f >nul
reg add "HKCU\Software\Classes\colligoore" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\colligoore\DefaultIcon" /ve /d "%SystemRoot%\System32\SHELL32.dll,44" /f >nul
reg add "HKCU\Software\Classes\colligoore\shell\open\command" /ve /d "\"%~dp0AVVIA_SYNC_CRM.bat\" \"%%1\"" /f >nul
if errorlevel 1 goto :errore

echo.
echo Configurazione completata.
echo Da ora il pulsante "Sincronizza CRM" nell'app puo aprire questo ponte direttamente.
echo.
pause
exit /b 0

:errore
echo.
echo [ERRORE] Configurazione non riuscita.
echo.
pause
exit /b 1
