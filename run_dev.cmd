@echo off
REM Local dev launcher. Port/host overridable (default 5011 / 0.0.0.0).
REM Usage: run_dev.cmd            -> port 5011
REM        run_dev.cmd 5012       -> port 5012 (e.g. when a VM NATs 5011)
setlocal
cd /d "%~dp0"
if not "%~1"=="" set STEMTUBE_PORT=%~1
venv\Scripts\python.exe -X utf8 app.py
