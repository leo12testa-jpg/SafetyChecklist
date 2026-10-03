@echo off
setlocal EnableExtensions
title Colligo - Installa sincronizzazione CRM automatica

set "BASE=%LOCALAPPDATA%\ColligoOreProduttivita\company-agent"
if not exist "%BASE%" mkdir "%BASE%"

echo.
echo ==========================================================
echo   COLLiGO ORE - SINCRONIZZAZIONE CRM AUTOMATICA
echo ==========================================================
echo.
echo Questa procedura va eseguita UNA SOLA VOLTA sul PC aziendale
echo che fara da agente CRM.
echo.

call :trova_python
if defined PY goto :python_ok

echo Python non trovato. Provo a installarlo automaticamente...
where winget >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRORE] Python non e installato e winget non e disponibile.
  echo Installa Python 3 dal Microsoft Store o da python.org e rilancia.
  pause
  exit /b 1
)

winget install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo.
  echo [ERRORE] Installazione automatica di Python non riuscita.
  pause
  exit /b 1
)

rem Aggiorna PATH del processo dopo winget.
set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"
call :trova_python
if not defined PY (
  echo.
  echo [ERRORE] Python risulta installato ma non e ancora disponibile.
  echo Chiudi questa finestra, riaprila e rilancia lo stesso file.
  pause
  exit /b 1
)

:python_ok
echo Python OK: %PY%
echo.
echo Scarico i componenti aggiornati...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';" ^
  "$base=$env:BASE;" ^
  "Invoke-WebRequest 'https://raw.githubusercontent.com/leo12testa-jpg/SafetyChecklist/main/ore-produttivita/crm-sync/crm_company_agent.py' -OutFile (Join-Path $base 'crm_company_agent.py');" ^
  "Invoke-WebRequest 'https://raw.githubusercontent.com/leo12testa-jpg/SafetyChecklist/main/ore-produttivita/crm-sync/RUN_COMPANY_SYNC.vbs' -OutFile (Join-Path $base 'RUN_COMPANY_SYNC.vbs');" ^
  "Invoke-WebRequest 'https://raw.githubusercontent.com/leo12testa-jpg/SafetyChecklist/main/ore-produttivita/crm-sync/SETUP_SYNC_BACKGROUND.bat' -OutFile (Join-Path $base 'SETUP_SYNC_BACKGROUND.bat');" ^
  "Invoke-WebRequest 'https://raw.githubusercontent.com/leo12testa-jpg/SafetyChecklist/main/ore-produttivita/crm-sync/DIAGNOSI_SYNC_CRM.bat' -OutFile (Join-Path $base 'DIAGNOSI_SYNC_CRM.bat')"
if errorlevel 1 (
  echo.
  echo [ERRORE] Download dei componenti non riuscito.
  echo Verifica la connessione Internet e riprova.
  pause
  exit /b 1
)

rem Il vecchio protocollo personale non deve piu aprire il CRM dalla web app.
reg delete "HKCU\Software\Classes\colligoore" /f >nul 2>nul

echo.
echo Avvio la configurazione una tantum.
echo Edge puo comparire SOLO adesso, per stabilire la sessione CRM iniziale.
echo.
call "%BASE%\SETUP_SYNC_BACKGROUND.bat"
if errorlevel 1 exit /b %errorlevel%

echo.
echo ==========================================================
echo   CONFIGURAZIONE COMPLETATA
echo ==========================================================
echo Da ora la sincronizzazione gira in background.
echo Telefono e altri PC non devono aprire il CRM.
echo.
pause
exit /b 0

:trova_python
set "PY="
where py >nul 2>nul && set "PY=py"
if defined PY exit /b 0
where python >nul 2>nul && set "PY=python"
exit /b 0
