/**
 * Decide whether a renderer update represents newly started or resumed
 * playback rather than another publication of the current Media Session state.
 * @param {string} playbackState
 * @param {boolean} playbackStarted
 * @returns {boolean}
 */
export function shouldAdvanceDockMediaSequence(playbackState, playbackStarted) {
  return playbackState === 'playing' && playbackStarted === true
}

/**
 * Own the media session selected for the Dock and tray controls across windows.
 * @param {{ onChange: () => void, now?: () => number, sendAction: (manager: object, action: string) => void }} options
 */
export function createDockMediaSessionController({ onChange, now = Date.now, sendAction }) {
  const sessions = new Map()
  const trackedWindowIds = new Set()
  let playSequence = 0

  function getSession() {
    const available = Array.from(sessions.values())
      .filter(({ manager }) => !manager.browserWindow.isDestroyed())
    const playing = available.filter(({ playbackState }) => playbackState === 'playing')

    if (playing.length > 0) {
      return playing.reduce((latest, session) => (
        session.lastPlayedAt > latest.lastPlayedAt ? session : latest
      ))
    }

    const focused = available.find(({ manager, hasMetadata }) => (
      hasMetadata && manager.browserWindow.isFocused()
    ))
    if (focused) return focused

    return available
      .filter(({ hasMetadata }) => hasMetadata)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
  }

  function requestAction(action) {
    const session = getSession()
    if (session?.actions.has(action)) sendAction(session.manager, action)
  }

  function updateSession(manager, state) {
    const windowId = manager.browserWindow.id
    const previous = sessions.get(windowId)
    const playbackState = ['playing', 'paused', 'none'].includes(state.playbackState)
      ? state.playbackState
      : 'none'
    const shouldAdvanceSequence = shouldAdvanceDockMediaSequence(
      playbackState,
      state.playbackStarted
    )
    sessions.set(windowId, {
      manager,
      playbackState,
      hasMetadata: state.hasMetadata === true,
      actions: new Set(Array.isArray(state.actions) ? state.actions : []),
      lastPlayedAt: shouldAdvanceSequence
        ? ++playSequence
        : previous?.lastPlayedAt ?? 0,
      updatedAt: now()
    })

    if (!trackedWindowIds.has(windowId)) {
      trackedWindowIds.add(windowId)
      manager.browserWindow.on('focus', onChange)
      manager.browserWindow.once('closed', () => {
        sessions.delete(windowId)
        trackedWindowIds.delete(windowId)
        onChange()
      })
    }
    onChange()
  }

  return { getSession, requestAction, updateSession }
}
