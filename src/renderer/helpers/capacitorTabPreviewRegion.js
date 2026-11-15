// Capture and animate the same viewport, excluding the fixed app controls.
export function getCapacitorTabPreviewRegion() {
  const width = window.innerWidth
  let top = 0
  for (const selector of ['.topNav', '.capacitorTabletTabBar']) {
    const rect = document.querySelector(selector)?.getBoundingClientRect()
    if (rect?.width > 0) top = Math.max(top, rect.bottom)
  }
  top = Math.max(0, Math.min(top, window.innerHeight))
  const navigation = document.querySelector('.app.capacitorPhoneLayout > .sideNav')?.getBoundingClientRect()
  // Use the same breakpoint as SideNav.css: safe-area insets can narrow the
  // bottom bar, and innerWidth can round fractional CSS viewport widths.
  const bottom = navigation?.width > 0 && matchMedia('(width <= 680px)').matches && navigation.top >= top
    ? Math.min(window.innerHeight, navigation.top)
    : window.innerHeight
  return { width, top, bottom, height: bottom - top }
}
