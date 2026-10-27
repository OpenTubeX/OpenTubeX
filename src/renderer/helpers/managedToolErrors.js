const MESSAGE_KEYS = {
  MANAGED_TOOL_REMOVED: 'Settings.External Software Settings.Managed Tool Errors.Removed',
  MANAGED_TOOL_UNUSABLE: 'Settings.External Software Settings.Managed Tool Errors.Unusable',
  MANAGED_TOOL_RELEASE_NOT_FOUND: 'Settings.External Software Settings.Managed Tool Errors.Release Not Found',
  MANAGED_TOOL_VERIFICATION_FAILED: 'Settings.External Software Settings.Managed Tool Errors.Verification Failed',
  MANAGED_TOOL_DOWNGRADE: 'Settings.External Software Settings.Managed Tool Errors.Downgrade',
  MANAGED_TOOL_INVALID_ARCHIVE: 'Settings.External Software Settings.Managed Tool Errors.Invalid Archive',
  MANAGED_TOOL_ROLLBACK_FAILED: 'Settings.External Software Settings.Managed Tool Errors.Rollback Failed',
}

/**
 * Translates known managed yt-dlp/FFmpeg download failures and keeps other
 * errors, such as network or file system failures, as reported.
 * @param {{ error?: string, errorCode?: string } | null | undefined} result
 * @param {(key: string) => string} translate
 * @returns {string}
 */
export function managedToolErrorMessage(result, translate) {
  const key = MESSAGE_KEYS[result?.errorCode]
  return key === undefined ? result?.error ?? '' : translate(key)
}
