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
  // Bottom controls span the viewport; a wide phone layout can have a vertical sidebar.
  // innerWidth rounds to integer CSS pixels, unlike the rendered bounds.
  const bottom = navigation?.width >= width - 1 && navigation.top >= top
    ? Math.min(window.innerHeight, navigation.top)
    : window.innerHeight
  return { width, top, bottom, height: bottom - top }
}
