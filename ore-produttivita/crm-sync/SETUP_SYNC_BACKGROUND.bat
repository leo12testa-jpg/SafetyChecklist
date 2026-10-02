@echo off
setlocal
title Colligo - Configura sincronizzazione CRM automatica
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRORE] Python non trovato.
  echo Installa Python 3 e rilancia questo file.
  echo.
  pause
  exit /b 1
)

echo.
echo Installo i componenti necessari...
py -m pip install --upgrade playwright keyring
if errorlevel 1 goto :errore

echo.
echo Prima configurazione account amministratore e sessione CRM.
echo Il CRM potra comparire SOLO durante questa configurazione iniziale.
py crm_company_agent.py --setup
if errorlevel 1 goto :errore

echo.
echo Registro la sincronizzazione automatica ogni 5 minuti...
schtasks /Create /TN "Colligo Ore CRM Background" /SC MINUTE /MO 5 /TR "wscript.exe "%~dp0RUN_COMPANY_SYNC.vbs"" /F >nul
if errorlevel 1 goto :errore

echo.
echo Avvio una prima sincronizzazione invisibile...
start "" /min wscript.exe "%~dp0RUN_COMPANY_SYNC.vbs"

echo.
echo Configurazione completata.
echo Da ora telefono e PC leggono i dati dal backend senza aprire il CRM.
echo.
pause
exit /b 0

:errore
echo.
echo [ERRORE] Configurazione non completata.
echo Controlla il messaggio sopra e riprova.
echo.
pause
exit /b 1
