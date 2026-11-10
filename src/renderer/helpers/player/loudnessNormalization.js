/**
 * YouTube reports how many decibels a video is louder than its playback
 * target. Like YouTube's player, this only turns loud videos down, because
 * raising quiet ones would clip without a limiter.
 *
 * @param {number | null | undefined} loudnessDb
 * @returns {number}
 */
export function getLoudnessNormalizationGain(loudnessDb) {
  return Number.isFinite(loudnessDb) && loudnessDb > 0 ? 10 ** (-loudnessDb / 20) : 1
}
