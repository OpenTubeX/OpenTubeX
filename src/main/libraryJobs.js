/** Release pinned snapshots/stages when their renderer disappears or stops reading. */
export class LibraryJobs {
  constructor(cancel, timeout = 30 * 60 * 1000) { this.cancel = cancel; this.timeout = timeout; this.jobs = new Map(); this.owners = new WeakSet() }

  track(owner, method, id) {
    const prefix = method.replace(/Start$/, '')
    this.jobs.set(id, { owner, prefix, timer: null })
    if (!this.owners.has(owner)) {
      this.owners.add(owner)
      const release = () => { for (const [id, job] of this.jobs) if (job.owner === owner) this.release(id) }
      owner.once('destroyed', release)
      owner.on('render-process-gone', release)
    }
    this.access(owner, method, id)
    if (owner.isDestroyed?.()) this.release(id)
  }

  access(owner, method, id) {
    const job = this.jobs.get(id)
    if (!job && method.endsWith('Cancel')) return false
    if (!job || job.owner !== owner || !method.startsWith(job.prefix)) throw new Error('The library operation does not belong to this window')
    clearTimeout(job.timer)
    job.timer = setTimeout(() => this.release(id), this.timeout)
    job.timer.unref?.()
    return true
  }

  complete(id) {
    const job = this.jobs.get(id)
    if (job) clearTimeout(job.timer)
    this.jobs.delete(id)
  }

  release(id) {
    const job = this.jobs.get(id)
    if (!job) return
    this.complete(id)
    this.cancel(job.prefix + 'Cancel', { id }).catch(console.error)
  }
}
