// Inlined before the deferred renderer bundle, so the first paint needs no Vue
// initialization, locale fetch, or separate image request.
(() => {
  let appearance = window.ftElectron?.startupAppearance
  if (!window.ftElectron) {
    try {
      const cached = JSON.parse(localStorage.getItem('opentubex-startup-appearance'))
      const mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      appearance = { ...cached?.[mode], hideSplash: cached?.hideSplash }
    } catch {
      // Storage can be unavailable or corrupt; keep the default splash.
    }
  }
  const root = document.documentElement
  if (appearance?.background) {
    root.style.setProperty('--startup-background', appearance.background)
    root.style.setProperty('--startup-foreground', appearance.dark ? '#eeeeee' : '#212121')
  }
  if (appearance?.hideSplash === true) {
    document.getElementById('startup-splash')?.remove()
    document.getElementById('app')?.removeAttribute('inert')
  }
  // Electron's ready-to-show can wait for deferred scripts. Announce the
  // splash's own frame so the native window need not wait for the main bundle.
  requestAnimationFrame(() => window.ftElectron?.startupSplashReady())
})()
