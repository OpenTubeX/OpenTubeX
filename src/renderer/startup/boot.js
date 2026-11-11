// Inlined before the deferred renderer bundle, so the first paint needs no Vue
// initialization, locale fetch, or separate image request.
(() => {
  let appearance = window.ftElectron?.startupAppearance
  let cached
  try {
    const stored = JSON.parse(localStorage.getItem('opentubex-startup-appearance'))
    const mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    cached = stored && { ...stored[mode], hideSplash: stored.hideSplash }
  } catch {
    // Storage can be unavailable or corrupt; keep the default splash.
  }
  // Electron's main process reads the background from the saved settings.
  // Mobile has only the renderer's cache.
  if (!window.ftElectron) {
    appearance = cached
    // Android keeps the progress indicator still until settings have been saved once.
    if (!cached) document.getElementById('startup-splash')?.setAttribute('data-first-launch', '')
  }
  const root = document.documentElement
  if (appearance?.background) {
    root.style.setProperty('--startup-background', appearance.background)
    root.style.setProperty('--startup-foreground', appearance.dark ? '#eeeeee' : '#212121')
  }
  if (cached?.primary) root.style.setProperty('--startup-primary', cached.primary)
  if (appearance?.hideSplash === true) {
    document.getElementById('startup-splash')?.remove()
    document.getElementById('app')?.removeAttribute('inert')
  }
  // Electron's ready-to-show can wait for deferred scripts. Announce the
  // splash's own frame so the native window need not wait for the main bundle.
  requestAnimationFrame(() => window.ftElectron?.startupSplashReady())
})()
