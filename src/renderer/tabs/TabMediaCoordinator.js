const MEDIA_SESSION_ACTIONS = [
  'play',
  'pause',
  'stop',
  'seekbackward',
  'seekforward',
  'seekto',
  'previoustrack',
  'nexttrack',
  'enterpictureinpicture'
]

const mediaByTabId = new Map()
let presentedTabId = null
let ownerTabId = null
let pictureInPictureTabId = null
let playSequence = 0
let powerSaveBlocked = false

function getEntry(tabId) {
  if (!tabId) {
    return null
  }

  let entry = mediaByTabId.get(tabId)
  if (!entry) {
    entry = {
      playbackState: 'none',
      lastPlayedAt: 0,
      metadata: null,
      actionHandlerSources: new Map()
    }
    mediaByTabId.set(tabId, entry)
  }
  return entry
}

function chooseOwner() {
  if (pictureInPictureTabId && mediaByTabId.has(pictureInPictureTabId)) {
    return pictureInPictureTabId
  }

  const presented = mediaByTabId.get(presentedTabId)
  if (presented?.playbackState === 'playing') {
    return presentedTabId
  }

  let candidateId = null
  let candidateSequence = -1
  for (const [tabId, entry] of mediaByTabId) {
    if (entry.playbackState === 'playing' && entry.lastPlayedAt > candidateSequence) {
      candidateId = tabId
      candidateSequence = entry.lastPlayedAt
    }
  }

  if (candidateId) {
    return candidateId
  }

  if (presented?.metadata) {
    return presentedTabId
  }

  return ownerTabId && mediaByTabId.has(ownerTabId) ? ownerTabId : null
}

function getActionHandlers(entry) {
  const handlers = {}
  for (const sourceHandlers of entry?.actionHandlerSources.values() ?? []) {
    Object.assign(handlers, sourceHandlers)
  }
  return handlers
}

function applyOwner() {
  if (!('mediaSession' in navigator)) {
    return
  }

  ownerTabId = chooseOwner()
  const owner = mediaByTabId.get(ownerTabId)
  const actionHandlers = getActionHandlers(owner)

  navigator.mediaSession.playbackState = owner?.playbackState ?? 'none'
  navigator.mediaSession.metadata = owner?.metadata ?? null

  for (const action of MEDIA_SESSION_ACTIONS) {
    try {
      navigator.mediaSession.setActionHandler(action, actionHandlers[action] ?? null)
    } catch {
      // The action is not supported on this platform.
    }
  }
}

function applyPowerSaveState() {
  if (!process.env.IS_ELECTRON) {
    return
  }

  const shouldBlock = Array.from(mediaByTabId.values())
    .some(entry => entry.playbackState === 'playing')
  if (shouldBlock === powerSaveBlocked) {
    return
  }

  powerSaveBlocked = shouldBlock
  if (shouldBlock) {
    window.ftElectron?.startPowerSaveBlocker?.()
  } else {
    window.ftElectron?.stopPowerSaveBlocker?.()
  }
}

export const tabMediaCoordinator = {
  setPresented(tabId) {
    presentedTabId = tabId
    applyOwner()
  },

  setPictureInPicture(tabId, active) {
    if (active) {
      if (!getEntry(tabId)) {
        return
      }
      pictureInPictureTabId = tabId
    } else if (pictureInPictureTabId === tabId) {
      pictureInPictureTabId = null
    }
    applyOwner()
  },

  setPlaybackState(tabId, playbackState) {
    const entry = getEntry(tabId)
    if (!entry) {
      return
    }

    entry.playbackState = playbackState
    if (playbackState === 'playing') {
      entry.lastPlayedAt = ++playSequence
    }
    applyOwner()
    applyPowerSaveState()
  },

  setMetadata(tabId, metadata) {
    if (!presentedTabId) {
      presentedTabId = tabId
    }
    const entry = getEntry(tabId)
    if (!entry) {
      return
    }

    entry.metadata = metadata
    applyOwner()
  },

  setActionHandlers(tabId, source, actionHandlers) {
    const entry = getEntry(tabId)
    if (!entry) {
      return
    }

    if (actionHandlers == null && source && typeof source === 'object') {
      actionHandlers = source
      source = 'default'
    }

    if (typeof source !== 'string' || source.length === 0) {
      return
    }

    if (actionHandlers && Object.keys(actionHandlers).length > 0) {
      entry.actionHandlerSources.set(source, actionHandlers)
    } else {
      entry.actionHandlerSources.delete(source)
    }
    applyOwner()
  },

  unregister(tabId) {
    mediaByTabId.delete(tabId)
    if (pictureInPictureTabId === tabId) {
      pictureInPictureTabId = null
    }
    if (ownerTabId === tabId) {
      ownerTabId = null
    }
    if (presentedTabId === tabId) {
      presentedTabId = null
    }
    applyOwner()
    applyPowerSaveState()
  }
}

export default tabMediaCoordinator
