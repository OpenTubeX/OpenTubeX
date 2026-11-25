/**
 * Checks whether a number looks like it was rounded for display by YouTube,
 * e.g. 14000 (14K) or 3500000 (3.5M), by verifying that it matches the precision
 * that YouTube's compact numbers have: at most one decimal place for the leading
 * digit and no decimal places from the second digit onwards.
 * @param {number} number
 * @returns {boolean}
 */
export function isRoundedNumber(number) {
  if (!Number.isFinite(number) || number < 1000) {
    return false
  }

  // 1000 for thousands, 1000000 for millions and so on
  const magnitude = 10 ** (3 * Math.floor(Math.log10(number) / 3))

  // e.g. 3500000 is allowed to be 3.5M, but 12300000 must be 12M, so it isn't a rounded number
  const step = number / magnitude < 10 ? magnitude / 10 : magnitude

  return number % step === 0
}
