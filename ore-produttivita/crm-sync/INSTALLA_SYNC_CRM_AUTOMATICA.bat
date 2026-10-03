@echo off
setlocal
title Colligo - Installa sincronizzazione CRM automatica

set "BASE=%LOCALAPPDATA%\ColligoOreProduttivita\company-agent"
if not exist "%BASE%" mkdir "%BASE%"

echo.
echo Colligo Ore & Produttivita
echo Configurazione sincronizzazione CRM automatica
echo.

where py >nul 2>nul
if errorlevel 1 (
  echo [ERRORE] Python non trovato.
  echo Installa Python 3 e rilancia questo file.
  pause
  exit /b 1
)

echo Scarico i componenti aggiornati...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue';" ^
  "Invoke-WebRequest 'https://raw.githubusercontent.com/leo12testa-jpg/SafetyChecklist/main/ore-produttivita/crm-sync/crm_company_agent.py' -OutFile '%BASE%\crm_company_agent.py';" ^
  "Invoke-WebRequest 'https://raw.githubusercontent.com/leo12testa-jpg/SafetyChecklist/main/ore-produttivita/crm-sync/RUN_COMPANY_SYNC.vbs' -OutFile '%BASE%\RUN_COMPANY_SYNC.vbs';" ^
  "Invoke-WebRequest 'https://raw.githubusercontent.com/leo12testa-jpg/SafetyChecklist/main/ore-produttivita/crm-sync/SETUP_SYNC_BACKGROUND.bat' -OutFile '%BASE%\SETUP_SYNC_BACKGROUND.bat'"
if errorlevel 1 (
  echo.
  echo [ERRORE] Download non riuscito.
  echo Verifica la connessione Internet e riprova.
  pause
  exit /b 1
)

rem Rimuove il vecchio protocollo personale: la web app non apre piu il CRM.
reg delete "HKCU\Software\Classes\colligoore" /f >nul 2>nul

echo.
echo Avvio la configurazione una tantum.
echo Il CRM puo comparire solo per stabilire la sessione iniziale.
call "%BASE%\SETUP_SYNC_BACKGROUND.bat"
if errorlevel 1 exit /b %errorlevel%

echo.
echo Configurazione terminata.
echo Da ora la sincronizzazione viene eseguita in background.
pause
