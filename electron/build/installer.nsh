; electron-builder NSIS customization.
;
; Replaces the old installer.iss's custom Agent-Key wizard page (the app now
; collects the key itself via a first-run screen — see src/main/firstRun.js)
; and adds a one-time migration step that removes any pre-existing
; "TallyAgent-<hash>" Windows Service left over from the old node-windows
; based installer, so it doesn't keep double-syncing alongside this app.
;
; NOTE: stopping/deleting a Windows Service requires admin rights. This app
; installs per-user (see package.json's "build.nsis.perMachine": false) to
; keep auto-update elevation-free, so this step is best-effort — if the
; installer isn't running elevated, migrate-service.bat silently no-ops and
; the fallback migration in src/main/index.js (same limitation) also skips.
; This is a known gap — see plan's "existing installed-service migration"
; risk — flag to the user/support team if a machine ends up double-syncing
; after upgrading from the old service-based install.

!macro customInstall
  DetailPrint "Checking for a previous Timber TallyAgent Windows Service..."
  File "/oname=$PLUGINSDIR\migrate-service.bat" "${BUILD_RESOURCES_DIR}\migrate-service.bat"
  ExecWait '"$SYSDIR\cmd.exe" /c "$PLUGINSDIR\migrate-service.bat"'
!macroend
