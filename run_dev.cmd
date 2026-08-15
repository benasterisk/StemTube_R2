@echo off
REM Local dev launcher. Port/host overridable (default 5011 / 0.0.0.0).
REM Usage: run_dev.cmd            -> http  on 5011
REM        run_dev.cmd 5012       -> http  on 5012 (e.g. when a VM NATs 5011)
REM        run_dev.cmd 5013 ssl   -> HTTPS on 5013 (self-signed; needed for phones
REM                                  on the LAN: AudioWorklet requires a secure
REM                                  context, http://<lan-ip> is not one)
setlocal
cd /d "%~dp0"
if not "%~1"=="" set STEMTUBE_PORT=%~1
if /i "%~2"=="ssl" set STEMTUBE_SSL=1
venv\Scripts\python.exe -X utf8 app.py
