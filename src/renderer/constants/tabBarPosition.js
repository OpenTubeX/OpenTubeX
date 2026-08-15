export const TAB_BAR_POSITIONS = ['top', 'bottom', 'left', 'right']
const TAB_BAR_CYCLE_POSITIONS = ['top', 'left', 'bottom', 'right']

export function normalizeTabBarPosition(value) {
  return TAB_BAR_POSITIONS.includes(value) ? value : 'top'
}

export function isVerticalTabBarPosition(value) {
  return value === 'left' || value === 'right'
}

export function getNextTabBarPosition(value) {
  const currentIndex = TAB_BAR_CYCLE_POSITIONS.indexOf(normalizeTabBarPosition(value))
  return TAB_BAR_CYCLE_POSITIONS[(currentIndex + 1) % TAB_BAR_CYCLE_POSITIONS.length]
}
