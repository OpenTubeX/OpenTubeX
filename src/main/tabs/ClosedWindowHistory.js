export class ClosedWindowHistory {
  sessions = []
  pendingRestore = Promise.resolve()

  remember(session) {
    if (session.tabs.length === 0) return
    const snapshot = structuredClone(session)
    // Closing a window removes its cached images from disk.
    for (const tab of snapshot.tabs) {
      delete tab.previewFileName
      delete tab.previewCapturedAt
      delete tab.avatarFileName
    }
    this.sessions.push(snapshot)
    if (this.sessions.length > 10) this.sessions.shift()
  }

  restore(createWindow) {
    const restored = this.pendingRestore.then(async () => {
      const session = this.sessions.at(-1)
      if (!session) return
      await createWindow(session)
      // Keep failed entries in place even if another window closes while the
      // restore is running. Successful restores consume only their own entry.
      const index = this.sessions.indexOf(session)
      if (index !== -1) this.sessions.splice(index, 1)
    })
    this.pendingRestore = restored.catch(() => {})
    return restored
  }
}
