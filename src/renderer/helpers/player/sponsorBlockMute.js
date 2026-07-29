export function createSponsorBlockMuteController({ getMuted, setMuted }) {
  const sources = new Set()
  const suppressedSources = new Set()
  let mutedBeforeSponsorBlock = false
  let overridden = false
  let pendingMutedValue = null

  function applyMuted(muted) {
    if (getMuted() === muted) {
      return
    }

    pendingMutedValue = muted
    setMuted(muted)
  }

  function setSourceActive(source, active) {
    const wasActive = sources.size > 0
    const wasMutedBySponsorBlock = shouldMute()

    if (active) {
      sources.add(source)
    } else {
      sources.delete(source)
      suppressedSources.delete(source)
    }

    const isActive = sources.size > 0
    if (!wasActive && isActive) {
      mutedBeforeSponsorBlock = getMuted()
      overridden = false
      applyMuted(shouldMute())
    } else if (wasActive && !isActive) {
      if (!overridden) {
        applyMuted(mutedBeforeSponsorBlock)
      }
      overridden = false
    } else if (isActive && wasMutedBySponsorBlock !== shouldMute() && !overridden) {
      applyMuted(shouldMute())
    }
  }

  function shouldMute() {
    return [...sources].some(source => !suppressedSources.has(source))
  }

  function handleVolumeChange() {
    if (pendingMutedValue !== null && getMuted() === pendingMutedValue) {
      pendingMutedValue = null
      return true
    }

    if (sources.size > 0) {
      overridden = true
    }
    return false
  }

  function setSourceSuppressed(source, suppressed) {
    if (!sources.has(source)) {
      suppressedSources.delete(source)
      return
    }

    if (suppressed) {
      suppressedSources.add(source)
    } else {
      suppressedSources.delete(source)
    }

    overridden = false
    applyMuted(shouldMute())
  }

  function reset() {
    const wasActive = sources.size > 0
    sources.clear()
    suppressedSources.clear()
    if (wasActive && !overridden) {
      applyMuted(mutedBeforeSponsorBlock)
    }
    overridden = false
  }

  return {
    handleVolumeChange,
    reset,
    setSourceActive,
    setSourceSuppressed,
  }
}
