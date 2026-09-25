/**
 * @typedef {object} ManagedToolsCapabilities
 * @property {boolean} supportsManagedTools
 * @property {boolean} requiresManagedYtDlp
 * @property {boolean} supportsManagedFfmpeg
 */

/** @param {{ isElectron: boolean, isCapacitor: boolean }} platform
 *  @returns {ManagedToolsCapabilities}
 */
export function resolveManagedToolsCapabilities({ isElectron, isCapacitor }) {
  return {
    supportsManagedTools: Boolean(isElectron || isCapacitor),
    requiresManagedYtDlp: Boolean(isCapacitor),
    supportsManagedFfmpeg: Boolean(isElectron && !isCapacitor),
  }
}

export const MANAGED_TOOLS_UPDATE_PREVIEW_EVENT = 'opentubex:preview-managed-tools-update'

/**
 * @param {object} dependencies
 * @param {ManagedToolsCapabilities} dependencies.capabilities
 * @param {import('vuex').Store<unknown>} dependencies.store
 * @param {import('vue').ComputedRef<boolean>} dependencies.showProgressStartToast
 * @param {(key: string, values?: Record<string, string>) => string} dependencies.t
 * @param {typeof import('./ytDlp.js').ytDlp} dependencies.ytDlp
 * @param {typeof import('./networkRecovery.js').initializeNetworkRecovery} dependencies.initializeNetworkRecovery
 * @param {typeof import('./api/requestDiagnostics.js').classifyRequestFailure} dependencies.classifyRequestFailure
 * @param {typeof import('./progressBar.js').startProgressBarOperation} dependencies.startProgressBarOperation
 * @param {typeof import('./utils.js').showToast} dependencies.showToast
 */
export function createManagedExternalSoftwareController({
  capabilities, store, ytDlp, t, showProgressStartToast,
  initializeNetworkRecovery, classifyRequestFailure,
  startProgressBarOperation, showToast,
}) {
  /**
   * Falls back to OpenTubeX-managed external software when the configured system
   * executables are unavailable. Selected managed executables are updated when
   * automatic updates are enabled or the user accepts an available update.
   * @param {('yt-dlp' | 'ffmpeg')[] | null} requestedUpdates
   */
  async function initializeManagedExternalSoftware(requestedUpdates = null) {
    if (!capabilities.supportsManagedTools) {
      return
    }

    const recovery = initializeNetworkRecovery()
    // Native tool downloads do not pass through the renderer fetch wrapper.
    // Wait before displaying download progress or checking for updates.
    await recovery.run('managed-tools', async () => {})

    const info = await ytDlp.ytDlpGetInfo()
    if (info === null) {
      return
    }

    /** @type {('yt-dlp' | 'ffmpeg' | 'ffprobe')[]} */
    const missingBinaries = []
    /** @type {('yt-dlp' | 'ffmpeg')[]} */
    const binariesToUpdate = []

    if (!info.ytDlp.available) {
      missingBinaries.push('yt-dlp')
    }
    if (!info.ffmpeg.available) {
      missingBinaries.push('ffmpeg')
    }
    if (!info.ffprobe.available) {
      missingBinaries.push('ffprobe')
    }

    const updateMode = store.getters.getExternalSoftwareUpdateMode
    const automaticUpdates = updateMode === 'automatic'
    let missingManagedBinaries = missingBinaries
    if (!automaticUpdates && missingBinaries.length > 0) {
      const managedInfo = await ytDlp.ytDlpGetInfo({
        ytDlpSource: 'managed',
        ytDlpPath: '',
        ffmpegSource: 'managed',
        ffmpegPath: ''
      })
      if (managedInfo !== null) {
        missingManagedBinaries = missingBinaries.filter(binary => {
          if (binary === 'yt-dlp') {
            return !managedInfo.ytDlp.available
          }
          return binary === 'ffmpeg' ? !managedInfo.ffmpeg.available : !managedInfo.ffprobe.available
        })
      }
    }

    if (missingManagedBinaries.includes('yt-dlp') ||
      ((capabilities.requiresManagedYtDlp || store.getters.getYtDlpSource === 'managed') &&
        (automaticUpdates || requestedUpdates?.includes('yt-dlp')))) {
      binariesToUpdate.push('yt-dlp')
    }
    if (missingManagedBinaries.includes('ffmpeg') || missingManagedBinaries.includes('ffprobe') ||
      (capabilities.supportsManagedFfmpeg && store.getters.getYtDlpFfmpegSource === 'managed' &&
        (automaticUpdates || requestedUpdates?.includes('ffmpeg')))) {
      binariesToUpdate.push('ffmpeg')
    }

    const settingUpdates = []
    if (missingBinaries.includes('yt-dlp') && store.getters.getYtDlpSource !== 'managed') {
      settingUpdates.push(store.dispatch('updateYtDlpSource', 'managed'))
    }
    if ((missingBinaries.includes('ffmpeg') || missingBinaries.includes('ffprobe')) &&
      store.getters.getYtDlpFfmpegSource !== 'managed') {
      settingUpdates.push(store.dispatch('updateYtDlpFfmpegSource', 'managed'))
    }
    await Promise.all(settingUpdates)

    if (binariesToUpdate.length === 0) {
      if (updateMode === 'ask' && requestedUpdates === null) {
        await notifyAboutManagedExternalSoftwareUpdates([])
      }
      return
    }

    await recovery.run('managed-tools', async () => {})

    let downloadStarted = missingManagedBinaries.length > 0
    let toolProgressPercentage = 0
    let progressOperation = null

    function showToolProgress(message) {
      const progress = {
        icon: ['fas', 'download'],
        message,
        percentage: toolProgressPercentage,
      }
      if (progressOperation === null) {
        progressOperation = startProgressBarOperation(store, progress)
      } else {
        progressOperation.update(progress)
      }
    }

    if (downloadStarted) {
      const tools = binariesToUpdate.join(' and ')
      const message = t('Settings.Download Settings.Managed Tools Download Started Template', { tools })
      if (showProgressStartToast.value) {
        showToast({ message, icon: ['fas', 'download'] })
      }
      showToolProgress(message)
    }

    const progressByBinary = Object.fromEntries(
      binariesToUpdate.map(binary => [binary, 0])
    )
    const removeProgressListener = ytDlp.addYtDlpBinaryDownloadProgressListener(({ binary, percent, inProgress }) => {
      if (!binariesToUpdate.includes(binary) || !inProgress || percent === null) {
        return
      }

      if (!downloadStarted) {
        downloadStarted = true
        const tools = binariesToUpdate.join(' and ')
        const message = t('Settings.Download Settings.Managed Tools Update Started Template', { tools })
        if (showProgressStartToast.value) {
          showToast({ message, icon: ['fas', 'download'] })
        }
        showToolProgress(message)
      }

      progressByBinary[binary] = Math.max(progressByBinary[binary] ?? 0, percent)
      const percentages = Object.values(progressByBinary)
      const combinedPercentage = percentages.reduce((sum, value) => sum + value, 0) / percentages.length
      toolProgressPercentage = Math.max(toolProgressPercentage, combinedPercentage)
      progressOperation.update({ percentage: toolProgressPercentage })
    })

    try {
      const results = await Promise.all(binariesToUpdate.map(async binary => {
        try {
          const result = await recovery.run('managed-tools', async () => {
            const result = await ytDlp.ytDlpDownloadBinary(binary)
            if (result === null || 'error' in result) {
              throw new Error(result?.error ?? '')
            }
            return result
          }, {
            isNetworkError: async error => {
              const failure = classifyRequestFailure(error)
              return failure === 'network' || (failure === 'api' && !await recovery.checkConnection())
            },
          })
          return { binary, result }
        } catch (error) {
          return { binary, result: { error: String(error) } }
        }
      }))
      const failures = results.filter(({ result }) => result === null || 'error' in result)
      const updatedBinaries = results
        .filter(({ result }) => result !== null && 'version' in result && result.updated)
        .map(({ binary }) => binary)

      if (failures.length === 0 && updatedBinaries.length > 0) {
        toolProgressPercentage = 100
        progressOperation?.update({ percentage: toolProgressPercentage })
        const updatedTools = updatedBinaries.join(' and ')
        showToast({
          message: missingManagedBinaries.length > 0
            ? t('Settings.Download Settings.Managed Tools Download Finished Template', { tools: updatedTools })
            : t('Settings.Download Settings.Managed Tools Update Finished Template', { tools: updatedTools }),
          icon: ['fas', 'check'],
        })
      } else {
        if (failures.length > 0) {
          const errors = failures.map(({ binary, result }) => `${binary}: ${result?.error ?? ''}`).join('; ')
          showToast({
            message: t('Settings.Download Settings.Managed Tools Download Error Template', { errors }),
            icon: ['fas', 'circle-exclamation'],
          })
        }
      }
    } finally {
      removeProgressListener()
      progressOperation?.finish()
    }

    if (updateMode === 'ask' && requestedUpdates === null) {
      await notifyAboutManagedExternalSoftwareUpdates(missingManagedBinaries)
    }
  }

  /**
   * Checks installed managed tools and offers an explicit update action.
   * @param {('yt-dlp' | 'ffmpeg' | 'ffprobe')[]} binariesInstalledThisRun
   */
  async function notifyAboutManagedExternalSoftwareUpdates(binariesInstalledThisRun) {
    await initializeNetworkRecovery().run('managed-tools', async () => {})
    const candidates = []
    if ((capabilities.requiresManagedYtDlp || store.getters.getYtDlpSource === 'managed') && !binariesInstalledThisRun.includes('yt-dlp')) {
      candidates.push('yt-dlp')
    }
    if (capabilities.supportsManagedFfmpeg && store.getters.getYtDlpFfmpegSource === 'managed' &&
      !binariesInstalledThisRun.includes('ffmpeg') && !binariesInstalledThisRun.includes('ffprobe')) {
      candidates.push('ffmpeg')
    }

    const checks = await Promise.all(candidates.map(async binary => {
      const result = await ytDlp.ytDlpCheckBinaryUpdate(binary)
      if (result !== null && 'error' in result) {
        console.warn(`Checking for a managed ${binary} update failed`, result.error)
      }
      return result?.available === true ? binary : null
    }))
    const availableUpdates = checks.filter(binary => binary !== null)
    if (availableUpdates.length === 0) {
      return
    }

    showManagedExternalSoftwareUpdatePrompt(availableUpdates)
  }

  /**
   * @param {('yt-dlp' | 'ffmpeg')[]} availableUpdates
   */
  function showManagedExternalSoftwareUpdatePrompt(availableUpdates) {
    showToast({
      message: t('Settings.Download Settings.Managed Tools Update Available Template', {
        tools: availableUpdates.join(' and ')
      }),
      time: Infinity,
      icon: ['fas', 'download'],
      buttons: [
        { label: t('Cancel') },
        {
          label: t('Settings.Download Settings.Update Managed Tools'),
          primary: true,
          action: () => {
            initializeManagedExternalSoftware(availableUpdates)
              .catch(error => console.error('Failed to update managed external software', error))
          }
        }
      ]
    })
  }

  /**
   * Allows the real actionable update prompt to be previewed from DevTools.
   * @param {Event} event
   */
  function previewManagedExternalSoftwareUpdatePrompt(event) {
    const detail = event instanceof CustomEvent ? event.detail : null
    const availableUpdates = Array.isArray(detail)
      ? detail.filter(binary => binary === 'yt-dlp' || binary === 'ffmpeg')
      : []
    showManagedExternalSoftwareUpdatePrompt(availableUpdates.length > 0 ? [...new Set(availableUpdates)] : ['yt-dlp'])
  }

  return {
    initializeManagedExternalSoftware,
    previewManagedExternalSoftwareUpdatePrompt,
  }
}
