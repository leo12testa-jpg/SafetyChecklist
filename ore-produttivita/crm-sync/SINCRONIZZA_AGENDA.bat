@echo off
setlocal
cd /d "%~dp0"
py crm_agenda_sync.py
echo.
pause
