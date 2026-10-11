!macro customHeader
  !ifdef BUILD_UNINSTALLER
    # Remove an opted-in shortcut on uninstall, despite disabling automatic creation.
    !undef DO_NOT_CREATE_DESKTOP_SHORTCUT
  !else
    !include "${BUILD_RESOURCES_DIR}/installer-translations.nsh"
    Var preserveDesktopShortcut

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
        StrCpy $preserveDesktopShortcut "true"
      ${endif}
    FunctionEnd

    Function CreateDesktopShortcut
      ${ifNot} ${isNoDesktopShortcut}
      ${andIfNot} ${FileExists} "$newDesktopLink"
        CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
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
    ${if} ${FileExists} "$newDesktopLink"
      SendMessage $mui.FinishPage.ShowReadme ${BM_SETCHECK} ${BST_CHECKED} 0
    ${endif}
  FunctionEnd

  Function OpenTubeXFinishPageLeave
    ${if} ${RebootFlag}
      Return
    ${endif}
    SendMessage $mui.FinishPage.ShowReadme ${BM_GETCHECK} 0 0 $0
    ${if} $0 == ${BST_UNCHECKED}
    ${andIf} ${FileExists} "$newDesktopLink"
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${endif}
  FunctionEnd
!macroend
