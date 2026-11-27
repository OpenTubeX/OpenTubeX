/**
 * The --fixed-background-inset that moves the fixed field layers inside an
 * element onto the viewport while the element contains them, as an element
 * with a transform or a transform hint does (see FtFixedBackground). It is
 * measured from the element's box without its translation.
 * @param {HTMLElement} element
 */
export function getFixedBackgroundInset(element) {
  const { clientWidth: viewportWidth, clientHeight: viewportHeight } = document.documentElement
  const rect = element.getBoundingClientRect()
  const { m41: translateX, m42: translateY } = new DOMMatrixReadOnly(getComputedStyle(element).transform)
  const left = rect.left - translateX + element.clientLeft
  const top = rect.top - translateY + element.clientTop
  return [
    -top,
    left + element.clientWidth - viewportWidth,
    top + element.clientHeight - viewportHeight,
    -left
  ].map(value => `${value}px`).join(' ')
}

/**
 * The styles that keep the card fields of themes that paint them (see
 * FtFixedBackground) on the viewport while a transform hint makes the element
 * contain them, or none when the theme paints none. They go on the fields and
 * their parents only, so the rest of the element is not restyled. Scrolling
 * the element moves the fields with it until it loses the hint.
 * @param {HTMLElement} element
 * @returns {{ element: HTMLElement, name: string, value: string }[]}
 */
export function getFixedBackgroundContainment(element) {
  const layers = [...element.querySelectorAll('.fixedBackgroundLayer')]
  if (layers.length === 0 || getComputedStyle(element).getPropertyValue('--fixed-background-display').trim() !== 'block') return []
  const inset = getFixedBackgroundInset(element)
  // Without border-area the parent paints the field with a fixed attachment,
  // which a transform hint also makes scroll with it. Show the layer instead,
  // and make the parent a stacking context, which paints the layer above its
  // own background and below its content. Pages render dropdowns outside, so
  // that traps none.
  const borderArea = CSS.supports('background-clip', 'border-area')
  return layers.flatMap(layer => [
    { element: layer, name: '--fixed-background-inset', value: inset },
    ...borderArea || !(layer.parentElement instanceof HTMLElement)
      ? []
      : [
          { element: layer, name: 'display', value: 'var(--fixed-background-display, none)' },
          { element: layer.parentElement, name: 'isolation', value: 'isolate' },
          { element: layer.parentElement, name: '--fixed-background-host-attachment', value: 'scroll' }
        ]
  ])
}

/**
 * Places the window's field (body::before), which pages let show through, on
 * a box at this viewport position, so the box matches what it covers.
 * @param {number} left
 * @param {number} top
 */
export function getWindowFieldPlacement(left, top) {
  const { clientWidth, clientHeight } = document.documentElement
  return { size: `${clientWidth}px ${clientHeight}px`, position: `${-left}px ${-top}px` }
}
