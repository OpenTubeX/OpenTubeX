export function createSponsorBlockMuteController({ getMuted, setMuted }) {
  const sources = new Set()
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

    if (active) {
      sources.add(source)
    } else {
      sources.delete(source)
    }

    const isActive = sources.size > 0
    if (!wasActive && isActive) {
      mutedBeforeSponsorBlock = getMuted()
      overridden = false
      applyMuted(true)
    } else if (wasActive && !isActive) {
      if (!overridden) {
        applyMuted(mutedBeforeSponsorBlock)
      }
      overridden = false
    }
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

  function enforceMuted() {
    if (sources.size === 0) {
      return
    }

    overridden = false
    applyMuted(true)
  }

  function reset() {
    const wasActive = sources.size > 0
    sources.clear()
    if (wasActive && !overridden) {
      applyMuted(mutedBeforeSponsorBlock)
    }
    overridden = false
  }

  return {
    enforceMuted,
    handleVolumeChange,
    reset,
    setSourceActive,
  }
}
