export const TOAST_POSITION_VALUES = [
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'top-left',
  'top-center',
  'top-right'
]

/**
 * @param {string} position
 * @returns {'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-center' | 'top-right'}
 */
export function normalizeToastPosition(position) {
  return TOAST_POSITION_VALUES.includes(position) ? position : 'bottom-left'
}
