import { execFile } from 'child_process'
import { readdir, readFile } from 'fs/promises'
import { promisify } from 'util'
import dbus from 'dbus-native'

const execFileAsync = promisify(execFile)

const RTKIT = {
  destination: 'org.freedesktop.RealtimeKit1',
  path: '/org/freedesktop/RealtimeKit1',
  interface: 'org.freedesktop.RealtimeKit1',
}

// Thread names as Linux truncates them to 15 characters
const REALTIME_THREADS = {
  // Renders the media element's or Web Audio's output in the renderer
  renderer: ['AudioOutputDevi'],
  // libpulse's mainloop, which writes the audio service's output streams
  audioService: ['threaded-ml'],
}
// Demuxes and decodes the media. It runs too long for realtime scheduling.
const HIGH_PRIORITY_THREADS = ['Media']

// Chromium uses these values when RLIMIT_RTPRIO lets it raise the threads itself
const REALTIME_PRIORITY = 8
const NICE_LEVEL = -10
const RESCAN_INTERVAL = 5_000
// RealtimeKit refuses temporarily, such as after a burst of requests, so a
// failed thread is retried a few times, at most once per rescan interval
const MAX_ATTEMPTS = 3
// A lower inherited CPU time limit could stop an audio thread right away
const MIN_REALTIME_TIME_LIMIT = 50_000

/**
 * Sets the process's realtime CPU time limit to RealtimeKit's maximum, which
 * RealtimeKit requires. An unprivileged process can't raise its hard limit, so
 * a lower inherited hard limit stays, and the soft limit is raised to it.
 * @param {number} pid
 * @param {number} maximum in microseconds
 * @returns {Promise<boolean>} whether its threads can safely run in realtime
 */
async function limitRealtimeTime(pid, maximum) {
  const { stdout } = await execFileAsync('prlimit', ['--pid', String(pid), '--rttime', '--raw', '--noheadings', '--output=SOFT,HARD'])
  const [softLimit, hardLimit] = stdout.trim().split(/\s+/).map(limit => limit === 'unlimited' ? Infinity : Number(limit))
  // RealtimeKit's maximum is configurable, and the soft limit may be raised up to the hard one
  const limit = Math.min(hardLimit, maximum)
  if (limit < MIN_REALTIME_TIME_LIMIT) return false
  if (softLimit !== limit || hardLimit !== limit) {
    await execFileAsync('prlimit', ['--pid', String(pid), `--rttime=${limit}:${limit}`])
  }
  return true
}

/**
 * @typedef {{
 *   call: (member: string, signature: string, body: unknown[]) => Promise<unknown>,
 *   getProperty: (name: string) => Promise<number>,
 *   close: () => void
 * }} RealtimeKitClient
 */

/** @returns {RealtimeKitClient} */
function connectRealtimeKit() {
  // Throws synchronously without a system bus
  const bus = dbus.systemBus()
  bus.connection.on('error', () => {})
  /**
   * @param {object} message
   * @returns {Promise<unknown>}
   */
  const invoke = message => new Promise((resolve, reject) => {
    bus.invoke({ ...RTKIT, ...message }, (error, result) => {
      if (error) reject(new Error(Array.isArray(error) ? error.join(' ') : String(error)))
      else resolve(result)
    })
  })
  return {
    call: (member, signature, body) => invoke({ member, signature, body }),
    async getProperty(name) {
      const value = await invoke({
        interface: 'org.freedesktop.DBus.Properties',
        member: 'Get',
        signature: 'ss',
        body: [RTKIT.interface, name],
      })
      // dbus-native returns variants as [signature, [value]]
      const number = Number(Array.isArray(value) ? value[1]?.[0] : value)
      if (!Number.isFinite(number)) throw new TypeError(`RealtimeKit returned no ${name}`)
      return number
    },
    close: () => bus.connection.end(),
  }
}

/**
 * @param {number} pid
 * @returns {Promise<Map<number, string>>} thread names by thread ID
 */
async function readThreads(pid) {
  const threads = new Map()
  for (const tid of await readdir(`/proc/${pid}/task`)) {
    try {
      threads.set(Number(tid), (await readFile(`/proc/${pid}/task/${tid}/comm`, 'utf8')).trim())
    } catch {
      // The thread exited
    }
  }
  return threads
}

/**
 * Raises the priority of the threads that deliver audio to the sound server,
 * so audio keeps playing without dropouts while other apps load the CPU.
 *
 * Every app runs in its own cgroup, which shares the CPU equally with the
 * others under load, and nice values only rank threads within one app. Only
 * realtime scheduling lets these short, periodic threads run on time.
 * Chromium raises them itself only when RLIMIT_RTPRIO allows it, which desktop
 * sessions usually don't, so ask RealtimeKit like PipeWire and Firefox do.
 *
 * @param {{
 *   getAudioServicePids: () => number[],
 *   connect?: () => RealtimeKitClient,
 *   limitRealtimeTime?: (pid: number, maximum: number) => Promise<boolean>,
 *   readThreads?: (pid: number) => Promise<Map<number, string>>
 * }} options
 */
export function createRealtimeAudio({
  getAudioServicePids,
  connect = connectRealtimeKit,
  limitRealtimeTime: limitProcessRealtimeTime = limitRealtimeTime,
  readThreads: listThreads = readThreads,
}) {
  /** @type {Promise<{ client: RealtimeKitClient, priority: number, niceLevel: number, rtTime: number } | null> | null} */
  let realtimeKit = null
  let unavailable = false
  /** @type {Map<number, Set<number>>} thread IDs by process ID */
  const raised = new Map()
  /** @type {Map<number, Promise<boolean>>} whether each process's threads can run in realtime */
  const realtimeAllowed = new Map()
  /** @type {Map<number, Map<number, { attempts: number, retryAt: number }>>} failed attempts by thread ID, by process ID */
  const failures = new Map()
  /** @type {Map<number, number>} audible web contents by renderer process ID */
  const audibleRenderers = new Map()
  /** @type {ReturnType<typeof setInterval> | null} */
  let rescanTimer = null
  /** @type {Promise<void> | null} */
  let scanning = null
  let scanAgain = false
  let warned = false

  function getRealtimeKit() {
    realtimeKit ??= (async () => {
      let client = null
      try {
        client = connect()
        const [maxPriority, minNiceLevel, rtTime] = await Promise.all([
          client.getProperty('MaxRealtimePriority'),
          client.getProperty('MinNiceLevel'),
          client.getProperty('RTTimeUSecMax'),
        ])
        return {
          client,
          priority: Math.min(REALTIME_PRIORITY, maxPriority),
          niceLevel: Math.max(NICE_LEVEL, minNiceLevel),
          rtTime,
        }
      } catch (error) {
        client?.close()
        unavailable = true
        console.warn('RealtimeKit is unavailable, so audio threads keep their normal priority', error)
        return null
      }
    })()
    return realtimeKit
  }

  /**
   * @param {number} pid
   * @param {string[]} realtimeNames
   * @param {string[]} highPriorityNames
   */
  async function raiseThreads(pid, realtimeNames, highPriorityNames) {
    const kit = await getRealtimeKit()
    if (!kit) return

    let threads
    try {
      threads = await listThreads(pid)
    } catch {
      // The process exited
      raised.delete(pid)
      realtimeAllowed.delete(pid)
      failures.delete(pid)
      return
    }

    // Forget exited threads, whose IDs the kernel can reuse
    const raisedThreads = new Set([...raised.get(pid) ?? []].filter(tid => threads.has(tid)))
    raised.set(pid, raisedThreads)
    const failedThreads = new Map([...failures.get(pid) ?? []].filter(([tid]) => threads.has(tid)))
    failures.set(pid, failedThreads)
    for (const [tid, name] of threads) {
      const failure = failedThreads.get(tid)
      // Audio state changes scan again right away, which must not use up the retries
      if (raisedThreads.has(tid) || (failure && (failure.attempts >= MAX_ATTEMPTS || Date.now() < failure.retryAt))) continue
      const realtime = realtimeNames.includes(name)
      if (!realtime && !highPriorityNames.includes(name)) continue
      try {
        if (realtime) {
          // RealtimeKit requires a CPU time limit, which stops a realtime thread that never yields
          let allowed = realtimeAllowed.get(pid)
          if (!allowed) {
            allowed = limitProcessRealtimeTime(pid, kit.rtTime)
            realtimeAllowed.set(pid, allowed)
            // A failed limit is checked again on the next attempt
            allowed.catch(() => realtimeAllowed.delete(pid))
          }
          if (!await allowed) {
            failedThreads.set(tid, { attempts: MAX_ATTEMPTS, retryAt: Infinity })
            if (!warned) console.warn(`Audio thread ${name} stays at normal priority, because its process has a low realtime CPU time limit`)
            warned = true
            continue
          }
          await kit.client.call('MakeThreadRealtimeWithPID', 'ttu', [pid, tid, kit.priority])
        } else {
          await kit.client.call('MakeThreadHighPriorityWithPID', 'tti', [pid, tid, kit.niceLevel])
        }
        raisedThreads.add(tid)
      } catch (error) {
        failedThreads.set(tid, { attempts: (failure?.attempts ?? 0) + 1, retryAt: Date.now() + RESCAN_INTERVAL })
        // RealtimeKit refuses apps outside an active session for every thread
        if (!warned) console.warn(`Unable to raise the priority of audio thread ${name}`, error)
        warned = true
      }
    }
  }

  function scan() {
    // A slow scan must not overlap the next one, which would raise threads twice.
    // A renderer that became audible meanwhile is scanned right after it.
    if (scanning) {
      scanAgain = true
      return scanning
    }
    scanning = Promise.all([
      ...[...audibleRenderers.keys()].map(pid => raiseThreads(pid, REALTIME_THREADS.renderer, HIGH_PRIORITY_THREADS)),
      ...getAudioServicePids().map(pid => raiseThreads(pid, REALTIME_THREADS.audioService, [])),
    ]).then(() => {
      if (unavailable) stop()
    }).finally(() => {
      scanning = null
      if (scanAgain && rescanTimer) {
        scanAgain = false
        scan()
      }
    })
    return scanning
  }

  function stop() {
    if (rescanTimer) clearInterval(rescanTimer)
    rescanTimer = null
  }

  return {
    /**
     * Raises the audio threads while a renderer plays audio. Playback can
     * create new threads, such as for the next video, so they are rescanned.
     * Call it once when a web contents becomes audible and once when it stops.
     * @param {number} pid the renderer's process ID
     * @param {boolean} audible
     * @returns {Promise<void>} settles when the threads have been raised
     */
    setAudible(pid, audible) {
      if (unavailable || !pid) return Promise.resolve()
      // Web contents can share a renderer process
      const count = (audibleRenderers.get(pid) ?? 0) + (audible ? 1 : -1)
      if (count > 0) audibleRenderers.set(pid, count)
      else audibleRenderers.delete(pid)

      if (audibleRenderers.size === 0) {
        stop()
        return Promise.resolve()
      }
      rescanTimer ??= setInterval(scan, RESCAN_INTERVAL)
      rescanTimer.unref?.()
      return scan()
    },
  }
}
