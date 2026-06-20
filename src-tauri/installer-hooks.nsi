; Prime Client - NSIS Installer Hooks
; Writes the installer filename to installer_name.txt.
; The Rust backend parses the referral code from the filename on startup.
; This simplifies the installer and avoids triggering antivirus heuristics.

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $R0

  ; Write the installer filename ($EXEFILE) to installer_name.txt in install directory
  DetailPrint "Saving installer filename: $EXEFILE"
  FileOpen $R0 "$INSTDIR\installer_name.txt" w
  FileWrite $R0 $EXEFILE
  FileClose $R0
  DetailPrint "Installer filename saved to: $INSTDIR\installer_name.txt"

  ; Silent upgrade: auto-restart the client
  IfSilent 0 +2
    ExecShell "" "$INSTDIR\Prime Client.exe"

  Pop $R0
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; No action needed before install
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Clean up installer name file on uninstall
  Delete "$INSTDIR\installer_name.txt"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; No action needed before uninstall
!macroend
