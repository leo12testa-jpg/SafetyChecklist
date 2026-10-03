@echo off
setlocal EnableExtensions
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
set "SYNC_VBS=%~dp0RUN_COMPANY_SYNC.vbs"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$task='Colligo Ore CRM Background';" ^
  "$vbs=$env:SYNC_VBS;" ^
  "$action=New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"');" ^
  "$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5);" ^
  "$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable;" ^
  "Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Description 'Colligo Ore - sincronizzazione CRM invisibile' -Force | Out-Null"
if errorlevel 1 goto :errore

schtasks /Query /TN "Colligo Ore CRM Background" >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRORE] L'attivita pianificata non risulta registrata.
  goto :errore
)

set "STATUS_FILE=%LOCALAPPDATA%\ColligoOreProduttivita\company-agent-status.json"
if exist "%STATUS_FILE%" del /q "%STATUS_FILE%" >nul 2>nul

echo.
echo Avvio una prima sincronizzazione invisibile...
wscript.exe "%SYNC_VBS%"

echo.
echo Attendo il primo stato dell'agente...
for /L %%I in (1,1,30) do (
  if exist "%STATUS_FILE%" goto :stato_trovato
  timeout /t 1 /nobreak >nul
)

echo.
echo [ATTENZIONE] Attivita pianificata creata, ma nessuno stato agente e ancora disponibile.
echo Controlla la Dashboard tra qualche minuto.
goto :fine

:stato_trovato
echo.
echo Primo stato agente disponibile:
type "%STATUS_FILE%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=Get-Content -Raw '%STATUS_FILE%' | ConvertFrom-Json;" ^
  "if($s.state -in @('error','login_required')){ exit 2 } else { exit 0 }"
if errorlevel 1 (
  echo.
  echo [ERRORE] Il primo avvio dell'agente non e riuscito.
  goto :errore
)

:fine
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
