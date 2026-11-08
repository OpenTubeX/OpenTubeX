/** Inspect the background below the moving video while the bar is appearing. */
export async function mobileMiniPlayerBackdrop(page) {
  return page.locator('.mobileMiniBarMorphOverlay').evaluate(element => {
    const background = getComputedStyle(element, '::before')
    const probe = document.createElement('div')
    probe.style.backgroundColor = 'var(--card-bg-color)'
    element.append(probe)
    const cardColor = getComputedStyle(probe).backgroundColor
    probe.remove()
    return {
      left: background.left,
      right: background.right,
      color: background.backgroundColor,
      image: background.backgroundImage,
      cardColor,
    }
  })
}

/** Sample the browsing page throughout the minimize animation and scroll handoff. */
export function sampleBrowsingPreviewTops(browsingPage) {
  return browsingPage.evaluate(async element => {
    const tops = []
    const started = performance.now()
    while (performance.now() - started < 700) {
      await new Promise(requestAnimationFrame)
      tops.push(element.getBoundingClientRect().top)
    }
    return tops
  })
}

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
