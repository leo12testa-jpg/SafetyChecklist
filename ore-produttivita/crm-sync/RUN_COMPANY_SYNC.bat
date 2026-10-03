@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)

set "LOG=%LOCALAPPDATA%\ColligoOreProduttivita\company-sync.log"
if not exist "%LOCALAPPDATA%\ColligoOreProduttivita" mkdir "%LOCALAPPDATA%\ColligoOreProduttivita" >nul 2>nul

if not defined PY (
  echo [%date% %time%] ERRORE: Python non trovato. >> "%LOG%"
  exit /b 1
)

echo [%date% %time%] Avvio ciclo CRM con %PY%. >> "%LOG%"
%PY% "%~dp0crm_company_agent.py" --run >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
echo [%date% %time%] Fine ciclo CRM - exit code %RC%. >> "%LOG%"
exit /b %RC%
