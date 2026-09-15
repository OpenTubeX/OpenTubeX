export class ClosedWindowHistory {
  sessions = []

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

  async restore(createWindow) {
    const session = this.sessions.pop()
    if (!session) return
    try {
      await createWindow(session)
    } catch (error) {
      this.sessions.push(session)
      throw error
    }
  }
}
