const MAX_TIMER_DELAY = 2_147_483_647

export class LiveReminderManager {
  constructor({
    notify,
    onChange,
    datastore,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout
  }) {
    this.notify = notify
    this.onChange = onChange
    this.now = now
    this.datastore = datastore
    this.setTimer = setTimer
    this.clearTimerCallback = clearTimer
    this.reminders = new Map()
    this.timers = new Map()
    this.pendingOperation = Promise.resolve()
  }

  initialize() {
    return this.enqueue(async () => {
      const reminders = await this.datastore.findAsync({})

      for (const reminder of reminders) {
        if (
          typeof reminder.videoId !== 'string' ||
          !Number.isFinite(reminder.startTimestamp) ||
          reminder.startTimestamp <= this.now()
        ) {
          await this.datastore.removeAsync({ _id: reminder._id })
        } else {
          this.reminders.set(reminder.videoId, reminder)
          this.armTimer(reminder)
        }
      }
    })
  }

  async get(videoId) {
    await this.pendingOperation
    return this.reminders.get(videoId) ?? null
  }

  async list() {
    await this.pendingOperation
    return [...this.reminders.values()].sort((a, b) => a.startTimestamp - b.startTimestamp)
  }

  schedule(reminder) {
    return this.enqueue(async () => {
      if (reminder.startTimestamp <= this.now()) {
        return false
      }

      const record = { ...reminder, _id: reminder.videoId }
      await this.datastore.updateAsync(
        { _id: record._id },
        record,
        { upsert: true }
      )
      this.reminders.set(record.videoId, record)
      this.armTimer(record)
      this.onChange(record.videoId, true)
      return true
    })
  }

  cancel(videoId) {
    return this.enqueue(async () => {
      await this.datastore.removeAsync({ _id: videoId })
      this.clearTimer(videoId)
      const removed = this.reminders.delete(videoId)
      if (removed) {
        this.onChange(videoId, false)
      }
      return removed
    })
  }

  enqueue(operation) {
    const result = this.pendingOperation.then(operation)
    this.pendingOperation = result.catch(() => {})
    return result
  }

  armTimer(reminder) {
    this.clearTimer(reminder.videoId)
    const delay = Math.max(0, Math.min(reminder.startTimestamp - this.now(), MAX_TIMER_DELAY))

    this.timers.set(reminder.videoId, this.setTimer(() => {
      this.timers.delete(reminder.videoId)
      if (reminder.startTimestamp > this.now()) {
        this.armTimer(reminder)
      } else {
        this.fire(reminder.videoId)
      }
    }, delay))
  }

  clearTimer(videoId) {
    const timer = this.timers.get(videoId)
    if (timer !== undefined) {
      this.clearTimerCallback(timer)
      this.timers.delete(videoId)
    }
  }

  fire(videoId) {
    this.enqueue(async () => {
      const reminder = this.reminders.get(videoId)
      if (!reminder || reminder.startTimestamp > this.now()) {
        if (reminder) this.armTimer(reminder)
        return
      }

      await this.datastore.removeAsync({ _id: reminder._id })
      this.reminders.delete(videoId)
      this.onChange(videoId, false)
      this.notify(reminder)
    }).catch(error => {
      console.error('Failed to show live stream reminder', error)
    })
  }
}
