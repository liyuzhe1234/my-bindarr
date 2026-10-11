@echo off
setlocal
set "BINDARR_DIR=%~dp0app"

powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 goto open_site

start "Bindarr Server" /min /D "%BINDARR_DIR%" "%BINDARR_DIR%\bindarr-server.exe"
timeout /t 4 /nobreak >nul

:open_site
where node >nul 2>nul
if %errorlevel%==0 node "%BINDARR_DIR%\app\backend\scripts\repair-pokemon-cn-supertypes.js" >nul 2>nul
start "" "http://localhost:3001/"
endlocal
