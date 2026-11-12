/**
 * Marks how Shaka lays out the cues in each caption wrapper, which only its
 * inline styles tell, for `captions.css`. Matching inline styles in `:has()`
 * makes Chromium check every `:has()` on the page again whenever any inline
 * style changes, such as several times on every pointer move over the seek bar.
 *
 * - `ft-cue-structured`: the cues are flex containers (e.g. TTML)
 * - `ft-cue-inline`: the cues are inline, such as one span per word
 *
 * Shaka styles a cue before adding it, so the marks are in place before the
 * captions render.
 *
 * @param {HTMLElement} videoContainer the element Shaka adds its caption container to
 * @returns {() => void} cleanup
 */
export function setupCaptionCueLayout(videoContainer) {
  /** @type {Element | null} */
  let textContainer = null
  const observer = new MutationObserver(update)

  function update() {
    // Shaka creates a new caption container for each video it loads
    const current = videoContainer.querySelector(':scope > .shaka-text-container')
    if (current !== textContainer) {
      textContainer = current
      observer.disconnect()
      observer.observe(videoContainer, { childList: true })
      if (textContainer) observer.observe(textContainer, { childList: true, subtree: true })
    }
    if (!textContainer) return
    for (const wrapper of textContainer.getElementsByClassName('shaka-text-wrapper')) {
      const displays = Array.from(wrapper.children, child => child instanceof HTMLElement ? child.style.display : '')
      wrapper.classList.toggle('ft-cue-structured', displays.includes('flex'))
      wrapper.classList.toggle('ft-cue-inline', displays.includes('inline'))
    }
  }

  observer.observe(videoContainer, { childList: true })
  update()
  return () => observer.disconnect()
}
