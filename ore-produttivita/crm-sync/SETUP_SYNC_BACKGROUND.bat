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
%PY% -m pip install --disable-pip-version-check -r "%~dp0requirements.txt"
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

powershell -NoProfile -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$task='Colligo Ore CRM Background';" ^
  "$vbs=$env:SYNC_VBS;" ^
  "$action=New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"');" ^
  "$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5);" ^
  "$logon=New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name);" ^
  "$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10);" ^
  "Register-ScheduledTask -TaskName $task -Action $action -Trigger @($trigger,$logon) -Settings $settings -Description 'Colligo Ore - lettura CRM a ogni accesso Windows e ogni 5 minuti' -Force | Out-Null"
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
set "LOG_FILE=%LOCALAPPDATA%\ColligoOreProduttivita\company-sync.log"
if exist "%STATUS_FILE%" del /q "%STATUS_FILE%" >nul 2>nul

echo.
echo Test immediato della sessione salvata in modalita invisibile...
%PY% crm_company_agent.py --run >> "%LOG_FILE%" 2>&1
set "FIRST_RC=%ERRORLEVEL%"

if "%FIRST_RC%"=="0" goto :prima_ok

echo.
echo [ERRORE] Il primo ciclo invisibile non e riuscito. Exit code: %FIRST_RC%
if exist "%STATUS_FILE%" (
  echo.
  echo Stato agente:
  type "%STATUS_FILE%"
)
call "%~dp0DIAGNOSI_SYNC_CRM.bat"
goto :errore

:prima_ok
echo.
echo Primo ciclo: tutte le risorse attive lette. Recupero in anteprima, nessuna importazione.
if exist "%STATUS_FILE%" type "%STATUS_FILE%"

echo.
echo Avvio anche il task registrato...
schtasks /Run /TN "Colligo Ore CRM Background" >nul 2>nul

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
