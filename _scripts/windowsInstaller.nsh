!ifndef BUILD_UNINSTALLER
  Var preserveDesktopShortcut
!endif

!include "Win\COM.nsh"

# Check the current target, since a user can replace a previously created link.
!macro CheckDesktopShortcut link target result
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  StrCpy ${result} "false"
  StrCpy $R0 0
  !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} R0 ""
  ${if} $R0 P<> 0
    StrCpy $R1 0
    ${IUnknown::QueryInterface} $R0 '("${IID_IPersistFile}",.R1)'
    ${if} $R1 P<> 0
      ${IPersistFile::Load} $R1 '("${link}",0).R2'
      ${if} $R2 == 0
        ${IShellLink::GetPath} $R0 '(.R3,${NSIS_MAX_STRLEN},0,0).R2'
        ${if} $R2 == 0
        ${andIf} $R3 == "${target}"
          StrCpy ${result} "true"
        ${endif}
      ${endif}
      ${IUnknown::Release} $R1 ""
    ${endif}
    ${IUnknown::Release} $R0 ""
  ${endif}
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    !include "${BUILD_RESOURCES_DIR}\installer-translations.nsh"

    # Record the selected install scope before the old uninstaller removes links.
    Function RememberDesktopShortcut
      StrCpy $preserveDesktopShortcut "false"
      ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
      ReadRegStr $1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ShortcutName
      ${if} $1 == ""
        StrCpy $1 "${PRODUCT_FILENAME}"
      ${endif}
      ${if} $0 != ""
      ${andIf} ${FileExists} "$0\${APP_EXECUTABLE_FILENAME}"
      ${andIf} ${FileExists} "$DESKTOP\$1.lnk"
        !insertmacro CheckDesktopShortcut "$DESKTOP\$1.lnk" "$0\${APP_EXECUTABLE_FILENAME}" $preserveDesktopShortcut
      ${endif}
    FunctionEnd

    Function CreateDesktopShortcut
      ${ifNot} ${isNoDesktopShortcut}
      ${andIfNot} ${FileExists} "$newDesktopLink"
        ClearErrors
        CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        ${ifNot} ${Errors}
          WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
          System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
        ${endif}
      ${endif}
    FunctionEnd
  !endif
!macroend

!macro customInit
  # Silent updates do not visit the directory/installation pages.
  Call RememberDesktopShortcut
!macroend

!macro customPageAfterChangeDir
  # Keep electron-builder's directory sanitization, then capture the final scope.
  !define /redef MUI_PAGE_CUSTOMFUNCTION_PRE OpenTubeXInstFilesPre
  Function OpenTubeXInstFilesPre
    Call instFilesPre
    Call RememberDesktopShortcut
  FunctionEnd
!macroend

!macro customInstall
  ${if} $preserveDesktopShortcut == "true"
    Call CreateDesktopShortcut
  ${endif}
!macroend

!macro customUnInstall
  ${ifNot} ${isKeepShortcuts}
    !insertmacro CheckDesktopShortcut "$oldDesktopLink" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" $0
    ${if} $0 == "true"
      WinShell::UninstShortcut "$oldDesktopLink"
      Delete "$oldDesktopLink"
    ${endif}
  ${endif}
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "$(opentubexCreateDesktopShortcut)"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW OpenTubeXFinishPageShow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE OpenTubeXFinishPageLeave

  # Preserve electron-builder's existing launch-after-install behavior.
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION StartApp
  !endif
  !insertmacro MUI_PAGE_FINISH

  Function OpenTubeXFinishPageShow
    ${if} ${RebootFlag}
      Return
    ${endif}
    ${if} $preserveDesktopShortcut == "true"
    ${andIf} ${FileExists} "$newDesktopLink"
      SendMessage $mui.FinishPage.ShowReadme ${BM_SETCHECK} ${BST_CHECKED} 0
    ${endif}
  FunctionEnd

  Function OpenTubeXFinishPageLeave
    ${if} ${RebootFlag}
      Return
    ${endif}
    SendMessage $mui.FinishPage.ShowReadme ${BM_GETCHECK} 0 0 $0
    ${if} $0 == ${BST_UNCHECKED}
    ${andIf} $preserveDesktopShortcut == "true"
    ${andIf} ${FileExists} "$newDesktopLink"
      !insertmacro CheckDesktopShortcut "$newDesktopLink" "$appExe" $0
      ${if} $0 == "true"
        WinShell::UninstShortcut "$newDesktopLink"
        Delete "$newDesktopLink"
        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
      ${endif}
    ${endif}
  FunctionEnd
!macroend
