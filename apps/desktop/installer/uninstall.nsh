; Electron user data and updater downloads leave with the application; the Harness home is never touched.
!include FileFunc.nsh
!include nsDialogs.nsh
!include LogicLib.nsh
Var UnRemoveSpeechModels
Var UnSpeechCheckbox
Var UnTarget
Var UnHome

; A dedicated option on the uninstall flow. Default is to delete only the local
; SenseVoice model cache, not the wider Harness home, sessions or preferences.
; Silent uninstall uses the same default. Upgrades and /KEEP_APP_DATA preserve it.
UninstPage custom un.SpeechModelsPage un.SpeechModelsPageLeave

Function un.SpeechModelsPage
  StrCpy $UnRemoveSpeechModels 1
  ${If} ${isUpdated}
    Abort
  ${EndIf}
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/KEEP_APP_DATA" $R1
  ${IfNot} ${Errors}
    Abort
  ${EndIf}
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 4u 100% 28u "卸载 DSH-maohao 时，可以一并清理 SenseVoice 离线语音模型。其他 DSH 资料不会删除。$$
Remove the local SenseVoice speech models when uninstalling DSH-maohao. Other DSH data will be preserved."
  Pop $0
  ${NSD_CreateCheckbox} 0 43u 100% 16u "删除离线语音模型（默认） / Remove offline speech models (default)"
  Pop $UnSpeechCheckbox
  ${NSD_Check} $UnSpeechCheckbox
  nsDialogs::Show
FunctionEnd

Function un.SpeechModelsPageLeave
  ${NSD_GetState} $UnSpeechCheckbox $UnRemoveSpeechModels
FunctionEnd

; The helper refuses unsafe roots, the installation and the Harness home, and never descends into reparse points;
; a locked file leaves residue and never fails the uninstall. customCheckAppRunning extracts window-frame.dll first.
Function un.RemoveData
  System::Call '$PLUGINSDIR\window-frame.dll::UninstallRemoveData(w "$UnTarget", w "$INSTDIR", w "$UnHome") ?c'
FunctionEnd

Function un.CleanData
  ${If} ${isUpdated}
    Return
  ${EndIf}
  ; The installer runs an older uninstaller with /KEEP_APP_DATA when replacing it from another directory.
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/KEEP_APP_DATA" $R1
  ${IfNot} ${Errors}
    Return
  ${EndIf}
  ; This is deliberately separate from Electron data cleanup. The PowerShell
  ; helper validates the model path and refuses filesystem reparse points.
  ${If} $UnRemoveSpeechModels != 0
    InitPluginsDir
    File "/oname=$PLUGINSDIR\\remove-maohao-speech-models.ps1" "${INSTALLER_SOURCE_DIR}\\remove-maohao-speech-models.ps1"
    ExecWait '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\\remove-maohao-speech-models.ps1"' $R2
    ${If} $R2 != 0
      DetailPrint "SenseVoice offline model cleanup was not completed; other data remains intact."
    ${EndIf}
  ${EndIf}
  ; Only a DSH_HOME published as a Windows environment variable is visible here.
  ReadEnvStr $UnHome DSH_HOME
  ClearErrors
  StrCpy $UnTarget "$APPDATA\${PRODUCT_FILENAME}"
  Call un.RemoveData
  ; Electron gives the headless SDK agent a separate per-user profile and
  ; single-instance lock. It must not survive a full product uninstall.
  StrCpy $UnTarget "$APPDATA\${PRODUCT_FILENAME}-mouse-agent"
  Call un.RemoveData
  !ifdef APP_PACKAGE_NAME
    ; Electron derives user data from the package name; a scoped name nests it one directory deeper.
    StrCpy $UnTarget "$APPDATA\${APP_PACKAGE_NAME}"
    Call un.RemoveData
    System::Call '$PLUGINSDIR\window-frame.dll::UninstallRemoveEmptyParents(w "$UnTarget", w "$APPDATA") ?c'
  !endif
  StrCpy $UnTarget "$LOCALAPPDATA\${DSH_UPDATER_CACHE_NAME}"
  Call un.RemoveData
FunctionEnd
