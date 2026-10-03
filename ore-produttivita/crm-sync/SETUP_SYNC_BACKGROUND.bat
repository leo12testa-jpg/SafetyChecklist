@echo off
setlocal EnableExtensions
title Colligo - Configura sincronizzazione CRM automatica
cd /d "%~dp0"

call :trova_python
if not defined PY (
  echo.
  echo [ERRORE] Python non trovato.
  echo.
  pause
  exit /b 1
)

echo.
echo Installo i componenti necessari...
%PY% -m pip install --disable-pip-version-check --upgrade playwright keyring
if errorlevel 1 goto :errore

echo.
echo Verifico Microsoft Edge...
set "EDGE_OK="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE_OK=1"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE_OK=1"
if not defined EDGE_OK (
  echo [ERRORE] Microsoft Edge non trovato su questo PC.
  goto :errore
)

echo.
echo Prima configurazione account amministratore e sessione CRM.
echo Edge potra comparire SOLO durante questa configurazione iniziale.
%PY% crm_company_agent.py --setup
if errorlevel 1 goto :errore

echo.
echo Registro la sincronizzazione automatica ogni 5 minuti...
set "SYNC_VBS=%~dp0RUN_COMPANY_SYNC.vbs"

rem Prima prova con ScheduledTasks. Se Windows la blocca, fallback a schtasks.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$task='Colligo Ore CRM Background';" ^
  "$vbs=$env:SYNC_VBS;" ^
  "$action=New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"');" ^
  "$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5);" ^
  "$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 4);" ^
  "Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Description 'Colligo Ore - sincronizzazione CRM invisibile' -Force | Out-Null"
if errorlevel 1 (
  echo Metodo ScheduledTasks non disponibile. Provo il fallback...
  schtasks /Create /TN "Colligo Ore CRM Background" /SC MINUTE /MO 5 /TR "wscript.exe "%SYNC_VBS%"" /F >nul
  if errorlevel 1 goto :errore
)

schtasks /Query /TN "Colligo Ore CRM Background" >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRORE] L'attivita pianificata non risulta registrata.
  goto :errore
)

set "STATUS_FILE=%LOCALAPPDATA%\ColligoOreProduttivita\company-agent-status.json"
if exist "%STATUS_FILE%" del /q "%STATUS_FILE%" >nul 2>nul

echo.
echo Avvio la prima sincronizzazione invisibile...
wscript.exe "%SYNC_VBS%"

echo.
echo Attendo il primo stato dell'agente...
for /L %%I in (1,1,60) do (
  if exist "%STATUS_FILE%" goto :stato_trovato
  timeout /t 1 /nobreak >nul
)

echo.
echo [ATTENZIONE] Il task e registrato ma il primo stato non e ancora disponibile.
echo Apro la diagnostica...
call "%~dp0DIAGNOSI_SYNC_CRM.bat"
goto :fine

:stato_trovato
echo.
echo Primo stato agente:
type "%STATUS_FILE%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=Get-Content -Raw '%STATUS_FILE%' | ConvertFrom-Json;" ^
  "if($s.state -in @('error','login_required')){ exit 2 } else { exit 0 }"
if errorlevel 1 (
  echo.
  echo [ERRORE] Il primo ciclo dell'agente non e riuscito.
  call "%~dp0DIAGNOSI_SYNC_CRM.bat"
  goto :errore
)

:fine
echo.
echo Configurazione completata.
echo Da ora l'agente viene eseguito automaticamente ogni 5 minuti.
echo.
pause
exit /b 0

:errore
echo.
echo [ERRORE] Configurazione non completata.
echo La diagnostica si trova in:
echo %~dp0DIAGNOSI_SYNC_CRM.bat
echo.
pause
exit /b 1

:trova_python
set "PY="
where py >nul 2>nul && set "PY=py"
if defined PY exit /b 0
where python >nul 2>nul && set "PY=python"
exit /b 0
