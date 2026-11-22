// Regenerates the shape keyframes of FtLoader's Material 3 Expressive loading
// indicator. Each shape is sampled along the same rays from its center, so
// consecutive clip-path polygons have matching points and morph smoothly.
import { readFile, writeFile } from 'node:fs/promises'

const SAMPLES = 120
// Leaves room inside the box for the morph spring to overshoot.
const RADIUS = 46

const cssFile = new URL('../src/renderer/components/FtLoader/FtLoader.css', import.meta.url)

const add = (a, b) => [a[0] + b[0], a[1] + b[1]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const scale = (a, s) => [a[0] * s, a[1] * s]
const length = a => Math.hypot(a[0], a[1])
const unit = a => scale(a, 1 / length(a))

function rotate(points, degrees) {
  const angle = degrees * Math.PI / 180
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
  return points.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos])
}

/** Outlines a polygon whose corners are rounded with the given radii. */
function roundedPolygon(corners) {
  return corners.flatMap(([point, rounding], index) => {
    const previous = corners.at(index - 1)[0]
    const next = corners[(index + 1) % corners.length][0]
    const toPrevious = unit(sub(previous, point))
    const toNext = unit(sub(next, point))
    const halfAngle = Math.acos(Math.min(1, Math.max(-1, toPrevious[0] * toNext[0] + toPrevious[1] * toNext[1]))) / 2
    const cut = Math.min(rounding / Math.tan(halfAngle), length(sub(previous, point)) / 2, length(sub(next, point)) / 2)
    const radius = cut * Math.tan(halfAngle)
    if (radius < 1e-6) {
      return [point]
    }
    const center = add(point, scale(unit(add(toPrevious, toNext)), radius / Math.sin(halfAngle)))
    const start = add(point, scale(toPrevious, cut))
    const end = add(point, scale(toNext, cut))
    const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
    let sweep = Math.atan2(end[1] - center[1], end[0] - center[0]) - startAngle
    sweep -= 2 * Math.PI * Math.round(sweep / (2 * Math.PI))
    return Array.from({ length: 65 }, (_, step) => {
      const angle = startAngle + sweep * step / 64
      return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]
    })
  })
}

function star(points, innerRadius, rounding, innerRounding = rounding) {
  return roundedPolygon(Array.from({ length: points * 2 }, (_, index) => {
    const angle = Math.PI * index / points - Math.PI / 2
    const radius = index % 2 === 0 ? 1 : innerRadius
    return [[radius * Math.cos(angle), radius * Math.sin(angle)], index % 2 === 0 ? rounding : innerRounding]
  }))
}

function regularPolygon(sides, rounding) {
  return roundedPolygon(Array.from({ length: sides }, (_, index) => {
    const angle = 2 * Math.PI * index / sides - Math.PI / 2
    return [[Math.cos(angle), Math.sin(angle)], rounding]
  }))
}

function ellipse(width, height, degrees, straight = 0) {
  return rotate(Array.from({ length: 400 }, (_, index) => {
    const angle = 2 * Math.PI * index / 400
    return [Math.sign(Math.cos(angle)) * straight + width * Math.cos(angle), height * Math.sin(angle)]
  }), degrees)
}

/** Distance from the center to the outline along the given direction. */
function radiusAt(outline, angle) {
  const direction = [Math.cos(angle), Math.sin(angle)]
  let radius = 0
  outline.forEach((point, index) => {
    const edge = sub(outline[(index + 1) % outline.length], point)
    const denominator = direction[0] * edge[1] - direction[1] * edge[0]
    if (Math.abs(denominator) < 1e-12) {
      return
    }
    const distance = (point[0] * edge[1] - point[1] * edge[0]) / denominator
    const position = (point[0] * direction[1] - point[1] * direction[0]) / denominator
    if (distance > 0 && position >= -1e-9 && position <= 1 + 1e-9) {
      radius = Math.max(radius, distance)
    }
  })
  return radius
}

function toPolygon(outline) {
  const angles = Array.from({ length: SAMPLES }, (_, index) => 2 * Math.PI * index / SAMPLES - Math.PI / 2)
  const radii = angles.map(angle => radiusAt(outline, angle))
  const factor = RADIUS / Math.max(...radii)
  const format = value => `${Number(value.toFixed(1))}%`
  const points = angles.map((angle, index) => {
    const radius = radii[index] * factor
    return `${format(50 + radius * Math.cos(angle))} ${format(50 + radius * Math.sin(angle))}`
  })
  return `polygon(${points.join(', ')})`
}

// Material's indeterminate sequence, approximated from its shape library.
const shapes = [
  ['Soft burst', star(10, 0.7, 0.1)],
  ['9-sided cookie', star(9, 0.8, 0.5)],
  ['Pentagon', regularPolygon(5, 0.3)],
  ['Pill', ellipse(0.625, 0.625, -45, 0.375)],
  ['Sunny', star(8, 0.8, 0.15)],
  ['4-sided cookie', star(4, 0.62, 0.45, 0.3)],
  ['Oval', ellipse(1, 0.64, -45)]
]

const keyframes = shapes.map(([name, outline], index) => {
  const offset = index === 0 ? '0%,\n  100%' : `${Number((index * 100 / shapes.length).toFixed(3))}%`
  return `  /* ${name} */\n  ${offset} {\n    clip-path: ${toPolygon(outline)};\n  }`
})

const css = await readFile(cssFile, 'utf8')
const start = css.indexOf('@keyframes ft-loader-morph')
if (start === -1) {
  throw new Error('FtLoader.css has no ft-loader-morph keyframes to replace')
}
await writeFile(cssFile, `${css.slice(0, start)}@keyframes ft-loader-morph {\n${keyframes.join('\n\n')}\n}\n`)
