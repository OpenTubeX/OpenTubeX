// @ts-check

/** Remaining time at which a limit warns before it is reached. */
export const LIMIT_WARNING_SECONDS = 5 * 60
/** Time the "15 more minutes" answer adds to a reached limit. */
export const LIMIT_EXTENSION_SECONDS = 15 * 60
export const BEDTIME_SNOOZE_MS = 10 * 60_000
/** Playback that has not reported time for this long is considered stopped. */
export const PLAYBACK_ACTIVE_MS = 20_000
/** A pause this long counts as a break and restarts the break reminder interval. */
export const BREAK_RESET_GAP_MS = 10 * 60_000

export const DAILY_LIMIT_MINUTES = [0, 15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480]
export const SHORTS_LIMIT_MINUTES = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120]
export const BREAK_INTERVAL_MINUTES = [0, 15, 30, 45, 60, 90, 120, 180]

/**
 * @param {number} time
 */
export function localDateKey(time) {
  const date = new Date(time)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

/**
 * @param {string} value time of day as `HH:MM`
 * @returns {number | null} minutes since midnight
 */
export function parseTimeOfDay(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? '')
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}

/**
 * Whether a time of day falls in `[start, end)`. Windows may cross midnight;
 * equal start and end times describe no window.
 * @param {number} minuteOfDay
 * @param {number | null | undefined} start
 * @param {number | null | undefined} end
 */
export function isWithinDailyWindow(minuteOfDay, start, end) {
  if (start == null || end == null || start === end) return false
  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end
}

/**
 * @param {Date} date
 */
export function minuteOfDay(date) {
  return date.getHours() * 60 + date.getMinutes()
}

/**
 * Identifies the night a bedtime window belongs to: the date it started, so a
 * window crossing midnight is one night.
 * @param {Date} date
 * @param {number} start
 */
export function bedtimeNightKey(date, start) {
  const night = new Date(date)
  if (minuteOfDay(date) < start) night.setDate(night.getDate() - 1)
  return localDateKey(night.getTime())
}

/**
 * @param {number} usedSeconds
 * @param {number} limitMinutes 0 turns the limit off
 * @param {number} extraSeconds time added after the limit was reached
 * @param {boolean} ignored whether the limit is ignored for the rest of the day
 * @returns {'off' | 'ok' | 'warning' | 'reached'}
 */
export function dailyLimitStatus(usedSeconds, limitMinutes, extraSeconds, ignored) {
  if (!(limitMinutes > 0) || ignored) return 'off'
  const remaining = limitMinutes * 60 + extraSeconds - usedSeconds
  if (remaining <= 0) return 'reached'
  return remaining <= LIMIT_WARNING_SECONDS && limitMinutes * 60 > LIMIT_WARNING_SECONDS ? 'warning' : 'ok'
}

/**
 * Formats whole minutes with the Stats duration strings.
 * @param {(key: string, values: Record<string, number>) => string} t
 * @param {number} totalMinutes
 */
export function formatWholeMinutes(t, totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) return t('Stats.Minutes', { minutes })
  if (minutes === 0) return t('Stats.Hours', { hours })
  return t('Stats.Hours and minutes', { hours, minutes })
}
