/** Sample layout and fitted image sizes while toggling the real metadata dock. */
export async function measureFullscreenDockToggle(watch, open) {
  return watch.evaluate(async (component, open) => {
    const video = document.querySelector('.ftVideoPlayer video')
    const controls = document.querySelector('.ftVideoPlayer .shaka-controls-container')
    const widths = [video.clientWidth]
    const controlWidths = [controls.clientWidth]
    const fittedWidths = []
    let animationKeyframes = []
    const frames = []
    const start = performance.now()
    component.proxy.$refs.player.setFullscreenMetadata(open)
    await new Promise(resolve => {
      const sample = now => {
        widths.push(video.clientWidth)
        controlWidths.push(controls.clientWidth)
        const bounds = video.getBoundingClientRect()
        const animation = video.getAnimations().find(animation => animation.effect.getKeyframes().some(frame => frame.scale != null))
        if (animation) animationKeyframes = animation.effect.getKeyframes()
        fittedWidths.push(video.videoWidth * Math.min(
          bounds.width / video.videoWidth, bounds.height / video.videoHeight
        ))
        frames.push(now - start)
        if (now - start < 450) requestAnimationFrame(sample)
        else resolve()
      }
      requestAnimationFrame(sample)
    })
    await Promise.all(video.getAnimations().map(animation => animation.finished.catch(() => {})))
    return { widths: [...new Set(widths)], controlWidths: [...new Set(controlWidths)], fittedWidths, frames, animationKeyframes }
  }, open)
}
