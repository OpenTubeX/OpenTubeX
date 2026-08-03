const DEFAULT_PAID_PROMOTION_DURATION_MS = 10000

/**
 * Reads YouTube's paid-content disclosure from a raw player response.
 *
 * @param {object} playerResponse
 * @returns {number | null} the overlay duration, or null when there is no disclosure
 */
export function getPaidPromotionDurationMs(playerResponse) {
  const legacyOverlay = playerResponse.paidContentOverlay?.paidContentOverlayRenderer
  const currentOverlay = playerResponse.playerOverlayLayerRenderers
    ?.flatMap(layer => layer.playerOverlayLayerRenderer?.featurePlayerOverlayRenderers ?? [])
    .map(feature => feature.featurePlayerOverlayRenderer?.content?.elementRenderer
      ?.compatibilityOptions?.paidContentOverlayElementRendererOptions)
    .find(Boolean)
  const overlay = legacyOverlay ?? currentOverlay
  if (!overlay) {
    return null
  }

  const durationMs = Number(overlay.durationMs)
  return Number.isFinite(durationMs) && durationMs > 0
    ? durationMs
    : DEFAULT_PAID_PROMOTION_DURATION_MS
}
