export function shouldCloseSwipedTab({ distance, elapsed, width }) {
  const absoluteDistance = Math.abs(distance)
  const velocity = absoluteDistance / Math.max(elapsed, 1)

  return absoluteDistance >= Math.min(width * 0.35, 120) ||
    (absoluteDistance >= 32 && velocity >= 0.55)
}
