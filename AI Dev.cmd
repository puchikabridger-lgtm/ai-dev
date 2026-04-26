@echo off
setlocal
set "APP_DIR=%~dp0desktop"
set "ELECTRON=%APP_DIR%\node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON%" (
  echo Electron is not installed. Run npm install in "%APP_DIR%".
  pause
  exit /b 1
)

if "%~1"=="" (
  start "" "%ELECTRON%" "%APP_DIR%"
) else (
  start "" "%ELECTRON%" "%APP_DIR%" --project "%~1"
)
