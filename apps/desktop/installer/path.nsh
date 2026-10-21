Var InstallerPath
Var InstallerError
; Reject reparse points along the selected path before any write or cleanup.
!macro InstallerValidatePathFunction PREFIX
Function ${PREFIX}InstallerValidatePath
    StrCpy $InstallerError "$(INSTALLER_PATH_INVALID)"
    StrLen $0 $InstallerPath
    ${If} $0 < 4
    ${OrIf} $0 > 180
        Return
    ${EndIf}
    StrCpy $0 $InstallerPath 2 1
    ${If} $0 != ":\"
        Return
    ${EndIf}
    StrCpy $0 $InstallerPath 3
    System::Call 'kernel32::GetDriveTypeW(w r0) i.r1'
    ${If} $1 != 3
        Return
    ${EndIf}
    StrCpy $1 3
    ${Do}
        StrCpy $0 $InstallerPath 1 $1
        ${If} $0 == ""
            ${ExitDo}
        ${EndIf}
        ${If} $0 == ':'
        ${OrIf} $0 == '*'
        ${OrIf} $0 == '?'
        ${OrIf} $0 == '"'
        ${OrIf} $0 == '<'
        ${OrIf} $0 == '>'
        ${OrIf} $0 == '|'
        ${OrIf} $0 == '/'
        ${OrIf} $0 == '$\r'
        ${OrIf} $0 == '$\n'
        ${OrIf} $0 == '$\t'
            Return
        ${EndIf}
        IntOp $1 $1 + 1
    ${Loop}
    StrCpy $2 $InstallerPath
    ${Do}
        StrLen $0 $2
        ${If} $0 <= 3
            ${ExitDo}
        ${EndIf}
        ${GetFileName} $2 $3
        StrCpy $0 $3 1 -1
        ${If} $3 == ""
        ${OrIf} $0 == "."
        ${OrIf} $0 == " "
            Return
        ${EndIf}
        ; Windows reserves device names even when they have an extension.
        StrCpy $5 ""
        StrCpy $6 0
        ${Do}
            StrCpy $0 $3 1 $6
            ${If} $0 == ""
            ${OrIf} $0 == "."
                ${ExitDo}
            ${EndIf}
            StrCpy $5 "$5$0"
            IntOp $6 $6 + 1
        ${Loop}
        ${If} $5 == "CON"
        ${OrIf} $5 == "PRN"
        ${OrIf} $5 == "AUX"
        ${OrIf} $5 == "NUL"
            Return
        ${EndIf}
        StrCpy $0 $5 3
        ${If} $0 == "COM"
        ${OrIf} $0 == "LPT"
            StrLen $0 $5
            StrCpy $5 $5 1 3
            ${If} $0 == 4
            ${AndIf} $5 >= 1
            ${AndIf} $5 <= 9
                Return
            ${EndIf}
        ${EndIf}
        System::Call 'kernel32::GetFileAttributesW(w r2) i.r0'
        ${If} $0 != -1
            IntOp $1 $0 & 0x400
            IntOp $0 $0 & 0x10
            ${If} $1 != 0
            ${OrIf} $0 == 0
                Return
            ${EndIf}
        ${EndIf}
        ${If} $2 == $WINDIR
        ${OrIf} $2 == $PROGRAMFILES32
        ${OrIf} $2 == $PROGRAMFILES64
        ${OrIf} $2 == $PROFILE
        ${OrIf} $2 == $LOCALAPPDATA
            ; Ancestors PROFILE and LOCALAPPDATA are allowed; the selected directory itself is not.
            ${If} $2 == $WINDIR
            ${OrIf} $2 == $PROGRAMFILES32
            ${OrIf} $2 == $PROGRAMFILES64
            ${OrIf} $2 == $InstallerPath
                Return
            ${EndIf}
        ${EndIf}
        ${GetParent} $2 $2
    ${Loop}
    System::Call 'kernel32::GetFullPathNameW(w "$InstallerPath", i ${NSIS_MAX_STRLEN}, w .r4, p 0) i.r0'
    ; Repeated trailing separators can normalize to a drive root.
    ${If} $0 < 4
    ${OrIf} $0 >= ${NSIS_MAX_STRLEN}
        Return
    ${EndIf}
    StrCpy $InstallerPath $4
    StrCpy $InstallerError ""
FunctionEnd
!macroend
!insertmacro InstallerValidatePathFunction ""

; The selection is a base directory unless the final segment is already the
; product container or executable directory. Existing installs are not duplicated.
Function InstallerNormalizePath
    ${If} "$(^Name)" != "贸号DSH"
        Return
    ${EndIf}
    StrCpy $0 $InstallerPath
    ${Do}
        StrLen $1 $0
        ${If} $1 <= 3
            ${ExitDo}
        ${EndIf}
        StrCpy $2 $0 1 -1
        ${If} $2 != "\"
            ${ExitDo}
        ${EndIf}
        StrCpy $0 $0 -1
    ${Loop}
    StrLen $1 $0
    ${If} $1 == 3
        ; Example: choosing the D:\ drive root.
        StrCpy $InstallerPath "$0iMaoHao\iMaoHao-DSH"
        Return
    ${EndIf}
    ${GetFileName} $0 $1
    ${If} $1 == "iMaoHao-DSH"
        StrCpy $InstallerPath $0
    ${ElseIf} $1 == "iMaoHao"
        StrCpy $InstallerPath "$0\iMaoHao-DSH"
    ${Else}
        StrCpy $InstallerPath "$0\iMaoHao\iMaoHao-DSH"
    ${EndIf}
FunctionEnd

; A new installation requires an empty directory; updates require the registered executable.
Function InstallerPreflight
    Call InstallerNormalizePath
    Call InstallerValidatePath
    ${If} $InstallerError != ""
        Return
    ${EndIf}
    StrCpy $INSTDIR $InstallerPath
    ; Upgrade ownership must use the SAME uninstall registry key as
    ; customInstall's InstallLocation write. Older branded installers can have
    ; registered in HKCU before the per-machine transition, so accept either
    ; hive only when the exact destination also contains our executable.
    ; This never authorizes arbitrary non-empty folders or a name-only match.
    StrCpy $9 "new"
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        ReadRegStr $0 HKLM "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
        ${If} $0 == $INSTDIR
            StrCpy $9 "upgrade"
        ${Else}
            ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
            ${If} $0 == $INSTDIR
                StrCpy $9 "upgrade"
            ${EndIf}
        ${EndIf}
    ${EndIf}
    ${If} $9 != "upgrade"
        FindFirst $0 $1 "$INSTDIR\*.*"
        ${DoWhile} $1 != ""
            ${If} $1 != "."
            ${AndIf} $1 != ".."
                FindClose $0
                StrCpy $InstallerError "$(INSTALLER_PATH_OWNERSHIP)"
                Return
            ${EndIf}
            FindNext $0 $1
        ${Loop}
        FindClose $0
    ${EndIf}
    StrCpy $2 $INSTDIR
    ${Do}
        System::Call 'kernel32::GetFileAttributesW(w r2) i.r0'
        ${If} $0 != -1
            ${ExitDo}
        ${EndIf}
        ${GetParent} $2 $2
    ${Loop}
    System::Call 'kernel32::GetTempFileNameW(w r2, w "HIL", i 0, w .r3) i.r0'
    ${If} $0 == 0
        StrCpy $InstallerError "$(INSTALLER_PATH_WRITABLE)"
        Return
    ${EndIf}
    System::Call 'kernel32::DeleteFileW(w r3)'
    System::Call 'kernel32::GetDiskFreeSpaceExW(w r2, *l .r0, p 0, p 0) i.r1'
    ${If} $1 == 0
        StrCpy $InstallerError "$(INSTALLER_PATH_WRITABLE)"
        Return
    ${EndIf}
    IntOp $2 ${APP_64_UNPACKED_SIZE} + 65536
    System::Int64Op $2 * 1024
    Pop $2
    System::Int64Op $0 < $2
    Pop $0
    ${If} $0 != 0
        StrCpy $InstallerError "$(INSTALLER_DISK_SPACE)"
    ${EndIf}
FunctionEnd
