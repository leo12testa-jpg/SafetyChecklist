@echo off
setlocal EnableExtensions
title Colligo - Diagnosi sincronizzazione CRM

set "ROOT=%LOCALAPPDATA%\ColligoOreProduttivita"
set "STATUS=%ROOT%\company-agent-status.json"
set "LOG=%ROOT%\company-sync.log"
set "TASK=Colligo Ore CRM Background"

echo.
echo ==========================================================
echo   DIAGNOSI COLLiGO ORE - CRM BACKGROUND
echo ==========================================================
echo.

echo [1/4] Task pianificato
schtasks /Query /TN "%TASK%" /FO LIST /V 2>nul
if errorlevel 1 (
  echo [KO] Task "%TASK%" non trovato.
) else (
  echo [OK] Task presente.
)

echo.
echo [2/4] Ultimo stato agente
if exist "%STATUS%" (
  type "%STATUS%"
) else (
  echo [KO] Nessun file di stato presente.
)

echo.
echo [3/4] Ultime righe log
if exist "%LOG%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Path '%LOG%' -Tail 30"
) else (
  echo Nessun log presente.
)

echo.
echo [4/4] Processo Python / Edge
tasklist /FI "IMAGENAME eq python.exe"
tasklist /FI "IMAGENAME eq msedge.exe"

echo.
echo ----------------------------------------------------------
echo Se lo stato e "login_required", rilancia:
echo INSTALLA_SYNC_CRM_AUTOMATICA.bat
echo.
echo Se il task manca, rilancia lo stesso installer.
echo ----------------------------------------------------------
echo.
pause
