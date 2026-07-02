@echo off
rem Stops and removes any leftover "TallyAgent-<hash>" Windows Service from
rem the old node-windows based installer. Best-effort: requires admin rights,
rem silently does nothing if not elevated or if sc.exe reports an error.
for /f "tokens=2 delims=: " %%S in ('sc query state^= all ^| findstr /B /C:"SERVICE_NAME: TallyAgent-"') do (
  sc stop "%%S" >nul 2>nul
  sc delete "%%S" >nul 2>nul
)
exit /b 0
