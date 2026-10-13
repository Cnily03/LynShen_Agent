; Installer hooks for Tauri's NSIS template (bundle > windows > nsis > installerHooks).
;
; The product was called "LynShen" up to 0.5.x. The template derives the install
; directory, the uninstall registry key, the shortcuts and the autostart value
; from the product name, so an installer with a new name knows nothing of that
; install and would set up a second app beside it. These hooks move the LynShen
; install over: they remove it (never its data), and carry over where it was
; installed, which shortcuts it had and whether it started at login.
; Background and evidence: docs/rename-aogiri-notes.md.
;
; Everything here is a macro: the template includes this file before it defines
; PRODUCTNAME, MAINBINARYNAME and the rest, and only a macro reads them late
; enough (when the template inserts the hook).

!define LEGACY_NAME "LynShen"
!define LEGACY_EXE "LynShen.exe"
!define LEGACY_PUBLISHER "LynShen Innovations INC."
!define LEGACY_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\LynShen"
!define LEGACY_PRODUCTKEY "Software\LynShen Innovations INC.\LynShen"
!define RENAME_RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define RENAME_RUNAPPROVEDKEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
!define RENAME_UNINSTROOT "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
!define RENAME_TASKBARPINS "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
; The argument the app's login item starts it with (src-tauri/src/autostart.rs).
!define RENAME_AUTOSTART_ARG "--autostart"

Var LegacyDir         ; where LynShen is installed; "" when it is not
Var LegacyStartLnk    ; 1: it had a Start-menu shortcut
Var LegacyDesktopLnk  ; 1: it had a desktop shortcut

; With no directory page (silent, or passive as the updater runs it) and no
; install location of this product's own yet, follow the LynShen location when
; the user had chosen one: "<dir>\LynShen" becomes "<dir>\<product>", any
; other directory is reused as it is.
!macro RENAME_ADOPT_LOCATION
  ReadRegStr $R8 SHCTX "${MANUPRODUCTKEY}" ""
  ${If} $R8 == ""
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
  ${AndIf} $LegacyDir != "$LOCALAPPDATA\${LEGACY_NAME}"
    StrCpy $R9 0
    ${If} ${Silent}
      StrCpy $R9 1
    ${EndIf}
    ${If} $PassiveMode = 1
      StrCpy $R9 1
    ${EndIf}
    ${If} $R9 = 1
      ${GetFileName} "$LegacyDir" $R8
      ${If} $R8 == "${LEGACY_NAME}"
        ${GetParent} "$LegacyDir" $R8
        StrCpy $R8 "$R8\${PRODUCTNAME}"
      ${Else}
        StrCpy $R8 "$LegacyDir"
      ${EndIf}
      ; Only a directory this user can write to; otherwise stay with the default.
      ClearErrors
      CreateDirectory "$R8"
      FileOpen $R7 "$R8\.install-write-test" w
      ${IfNot} ${Errors}
        FileClose $R7
        Delete "$R8\.install-write-test"
        SetOutPath "$R8"
        RMDir "$INSTDIR" ; the default directory the template has just made; goes only when empty
        StrCpy $INSTDIR "$R8"
      ${Else}
        RMDir "$R8"
      ${EndIf}
      ClearErrors
    ${EndIf}
  ${EndIf}
!macroend

; Removes the LynShen install made by its NSIS installer. Its own uninstaller
; does it, in update mode: that deletes the files it installed, its uninstall
; entry and its lynshen:// registration, and leaves shortcuts, the autostart
; value and all user data alone (those are handled below, or kept).
!macro RENAME_REMOVE_NSIS_INSTALL
  ${If} ${FileExists} "$LegacyDir\uninstall.exe"
    DetailPrint "Removing ${LEGACY_NAME} from $LegacyDir"
    ; _?= runs the uninstaller in place, so ExecWait waits for it. A silent
    ; uninstaller closes the app if it is still running.
    ExecWait '"$LegacyDir\uninstall.exe" /S /UPDATE _?=$LegacyDir' $R8
    DetailPrint "${LEGACY_NAME} uninstaller returned $R8"
    Delete "$LegacyDir\uninstall.exe"
  ${EndIf}
  Delete "$LegacyDir\${LEGACY_EXE}"
  ${IfNot} ${FileExists} "$LegacyDir\${LEGACY_EXE}"
    ; Gone for good: drop its registration, so "Apps & features" lists one app.
    DeleteRegKey SHCTX "${LEGACY_UNINSTKEY}"
    DeleteRegKey SHCTX "${LEGACY_PRODUCTKEY}"
    ${If} $LegacyDir != $INSTDIR
      RMDir "$LegacyDir" ; only when empty: files the user put there stay
    ${EndIf}
  ${Else}
    ; Its executable could not be removed (still running and not closable).
    ; Its registration stays, so the next install tries again.
    DetailPrint "${LEGACY_NAME} is still in $LegacyDir"
  ${EndIf}
!macroend

; A LynShen installed from the MSI package is a different product to Windows
; Installer. The template removes a same-name MSI before installing; this does
; the same for the old name. (An MSI install normally updates with the MSI,
; which replaces it through the upgrade code; this is for the setup.exe run by
; hand over an MSI install.)
!macro RENAME_REMOVE_MSI_INSTALL
  StrCpy $R6 0
  ${Do}
    EnumRegKey $R7 HKLM "${RENAME_UNINSTROOT}" $R6
    ${If} $R7 == ""
      ${ExitDo}
    ${EndIf}
    IntOp $R6 $R6 + 1
    ReadRegStr $R8 HKLM "${RENAME_UNINSTROOT}\$R7" "DisplayName"
    ReadRegStr $R9 HKLM "${RENAME_UNINSTROOT}\$R7" "Publisher"
    ${If} "$R8$R9" == "${LEGACY_NAME}${LEGACY_PUBLISHER}"
      ReadRegStr $R8 HKLM "${RENAME_UNINSTROOT}\$R7" "UninstallString"
      ${StrCase} $R9 $R8 "L"
      ${StrLoc} $R8 $R9 "msiexec" ">"
      ${If} $R8 != ""
        DetailPrint "Removing the ${LEGACY_NAME} MSI package $R7"
        ${If} ${Silent}
          ExecWait 'MsiExec.exe /X$R7 /quiet /norestart' $R8
        ${Else}
          ExecWait 'MsiExec.exe /X$R7 /passive /norestart' $R8
        ${EndIf}
        DetailPrint "MsiExec returned $R8"
        ${ExitDo}
      ${EndIf}
    ${EndIf}
  ${Loop}
!macroend

; Shortcuts the LynShen install had become shortcuts to this product. In update
; mode the template creates none, so they are made here.
!macro RENAME_MOVE_SHORTCUTS
  ${If} $LegacyStartLnk = 1
    Delete "$SMPROGRAMS\${LEGACY_NAME}.lnk"
    ${IfNot} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}
  ${If} $LegacyDesktopLnk = 1
    Delete "$DESKTOP\${LEGACY_NAME}.lnk"
    ${IfNot} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk"
      CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}
  ; A taskbar pin is a .lnk of its own, and Explorer finds it by file name:
  ; it keeps its name and gets the new target, so the pin goes on working.
  !insertmacro IsShortcutTarget "$APPDATA\${RENAME_TASKBARPINS}\${LEGACY_NAME}.lnk" "$LegacyDir\${LEGACY_EXE}"
  Pop $R8
  ${If} $R8 = 1
    !insertmacro SetShortcutTarget "$APPDATA\${RENAME_TASKBARPINS}\${LEGACY_NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  ${EndIf}
!macroend

; "Start at login" is a value in the Run key named after the product, holding
; the path of the executable (tauri-plugin-autostart). The LynShen value moves
; to this product's name and path. A value the user turned off in Task Manager
; (StartupApproved\Run: 12 bytes, the first one odd) is not carried over: the
; app then shows the setting as off, which is what it showed before.
!macro RENAME_MOVE_AUTOSTART
  ReadRegStr $R8 HKCU "${RENAME_RUNKEY}" "${LEGACY_NAME}"
  ${If} $R8 != ""
    StrCpy $R9 0 ; 1: turned off in Task Manager
    System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w "${RENAME_RUNAPPROVEDKEY}", i 0, i 0x20119, *p .R7) i .R6'
    ${If} $R6 = 0
      System::Alloc 64
      Pop $R5
      System::Call 'advapi32::RegQueryValueExW(p R7, w "${LEGACY_NAME}", p 0, p 0, p R5, *i 64) i .R6'
      ${If} $R6 = 0
        System::Call '*$R5(&i1 .R4)'
        IntOp $R4 $R4 & 1
        ${If} $R4 = 1
          StrCpy $R9 1
        ${EndIf}
      ${EndIf}
      System::Free $R5
      System::Call 'advapi32::RegCloseKey(p R7)'
    ${EndIf}
    DeleteRegValue HKCU "${RENAME_RUNKEY}" "${LEGACY_NAME}"
    DeleteRegValue HKCU "${RENAME_RUNAPPROVEDKEY}" "${LEGACY_NAME}"
    ${If} $R9 = 0
      ReadRegStr $R8 HKCU "${RENAME_RUNKEY}" "${PRODUCTNAME}"
      ${If} $R8 == ""
        WriteRegStr HKCU "${RENAME_RUNKEY}" "${PRODUCTNAME}" '"$INSTDIR\${MAINBINARYNAME}.exe" ${RENAME_AUTOSTART_ARG}'
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  StrCpy $LegacyStartLnk 0
  StrCpy $LegacyDesktopLnk 0
  ReadRegStr $LegacyDir SHCTX "${LEGACY_PRODUCTKEY}" ""
  ; no trailing backslash, so the path compares and splits cleanly
  StrCpy $R8 $LegacyDir 1 -1
  ${If} $R8 == "\"
    StrCpy $LegacyDir $LegacyDir -1
  ${EndIf}
  ${If} $LegacyDir != ""
    !insertmacro RENAME_ADOPT_LOCATION
    ; Which shortcuts are the old install's own (they point at its executable).
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${LEGACY_NAME}.lnk" "$LegacyDir\${LEGACY_EXE}"
    Pop $LegacyStartLnk
    !insertmacro IsShortcutTarget "$DESKTOP\${LEGACY_NAME}.lnk" "$LegacyDir\${LEGACY_EXE}"
    Pop $LegacyDesktopLnk
    !insertmacro RENAME_REMOVE_NSIS_INSTALL
  ${EndIf}
  !insertmacro RENAME_REMOVE_MSI_INSTALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $LegacyDir != ""
    !insertmacro RENAME_MOVE_SHORTCUTS
  ${EndIf}
  !insertmacro RENAME_MOVE_AUTOSTART
!macroend
