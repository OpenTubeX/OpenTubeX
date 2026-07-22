export function getTranscriptPreScrollTop(scrollTop, targetTop, maxDistance) {
  if (Math.abs(targetTop - scrollTop) <= maxDistance) {
    return scrollTop
  }

  return targetTop - Math.sign(targetTop - scrollTop) * maxDistance
}
