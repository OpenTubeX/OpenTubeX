import assert from 'node:assert/strict'
import test from 'node:test'

import { getPaidPromotionDurationMs } from '../../src/renderer/helpers/player/paidPromotion.js'

test('reads the paid-promotion duration from YouTube player metadata', () => {
  const response = {
    videoDetails: { videoId: 'E6O3dOjQX3c' },
    playerOverlayLayerRenderers: [{
      playerOverlayLayerRenderer: {
        featurePlayerOverlayRenderers: [{
          featurePlayerOverlayRenderer: {
            content: {
              elementRenderer: {
                compatibilityOptions: {
                  paidContentOverlayElementRendererOptions: {
                    durationMs: '10000'
                  }
                }
              }
            }
          }
        }]
      }
    }]
  }

  assert.equal(getPaidPromotionDurationMs(response), 10000)
})

test('falls back to ten seconds when YouTube omits the duration', () => {
  assert.equal(getPaidPromotionDurationMs({
    paidContentOverlay: { paidContentOverlayRenderer: {} }
  }), 10000)
})

test('does not mark videos without the paid-content overlay', () => {
  assert.equal(getPaidPromotionDurationMs({}), null)
})
