/** Count background video readbacks and hidden control-layout work during a swipe. */
export async function trackMiniPlayerWork(page) {
  await page.evaluate(() => {
    const drawImage = CanvasRenderingContext2D.prototype.drawImage
    const cloneNode = Element.prototype.cloneNode
    window.__miniPlayerWork = { ambientDraws: 0, controlClones: 0 }
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.matches('.ambientCanvas') && args[0] instanceof HTMLVideoElement) {
        window.__miniPlayerWork.ambientDraws++
      }
      return drawImage.apply(this, args)
    }
    Element.prototype.cloneNode = function (...args) {
      if (this.matches('.shaka-controls-button-panel')) window.__miniPlayerWork.controlClones++
      return cloneNode.apply(this, args)
    }
    window.__restoreMiniPlayerWork = () => {
      CanvasRenderingContext2D.prototype.drawImage = drawImage
      Element.prototype.cloneNode = cloneNode
      delete window.__restoreMiniPlayerWork
    }
  })
}

export async function resetMiniPlayerWork(page) {
  await page.evaluate(() => {
    window.__miniPlayerWork = { ambientDraws: 0, controlClones: 0 }
  })
}

export async function stopTrackingMiniPlayerWork(page) {
  return page.evaluate(() => {
    const result = window.__miniPlayerWork
    window.__restoreMiniPlayerWork?.()
    delete window.__miniPlayerWork
    return result
  })
}
