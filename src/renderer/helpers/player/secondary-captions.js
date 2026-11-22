/**
 * @typedef {{ startTime: number, endTime: number, payload: string, lineBreak?: boolean, nestedCues?: SecondaryCaptionCue[] }} SecondaryCaptionCue
 */

/**
 * @param {SecondaryCaptionCue} cue
 * @param {number} time
 */
function isCueActive(cue, time) {
  return cue.startTime <= time && time < cue.endTime
}

/**
 * Flattens a parsed caption cue, including styled nested cues, into plain text.
 * Nested cues with their own timing (karaoke-style word timestamps) only count while they are active.
 * @param {SecondaryCaptionCue} cue
 * @param {number} time
 * @returns {string}
 */
export function getCueText(cue, time) {
  if (cue.lineBreak) {
    return '\n'
  }

  return cue.payload + (cue.nestedCues ?? [])
    .filter(nestedCue => isCueActive(nestedCue, time))
    .map(nestedCue => getCueText(nestedCue, time))
    .join('')
}

/**
 * Returns the text of every cue showing at the given time, one cue per line.
 * @param {SecondaryCaptionCue[]} cues
 * @param {number} time
 * @returns {string}
 */
export function getActiveCueText(cues, time) {
  return cues
    .filter(cue => isCueActive(cue, time))
    .map(cue => getCueText(cue, time).trim())
    .filter(text => text !== '')
    .join('\n')
}
