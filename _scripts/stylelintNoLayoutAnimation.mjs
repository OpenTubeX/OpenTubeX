// Covers what stylelint-high-performance-animation misses: logical shorthands
// such as `inset`, `gap`, `padding-inline` and `margin-block`, flex and grid
// tracks, and transition lists kept in custom properties, which its rule does
// not read at all. Like that rule, it ignores paint-only properties.
import stylelint from 'stylelint'

const ruleName = 'opentubex/no-layout-animation-properties'

const messages = stylelint.utils.ruleMessages(ruleName, {
  rejected: (type, property) =>
    `Unexpected layout property (${property}) in ${type}. Animate transform, opacity, clip-path or filter instead, or explain why the layout itself has to move.`
})

/** Layout properties that stylelint-high-performance-animation also reports. */
const UPSTREAM_LAYOUT_PROPERTIES = [
  'position', 'top', 'bottom', 'left', 'right',
  'inset-block-start', 'inset-block-end', 'inset-inline-start', 'inset-inline-end',
  'width', 'height', 'inline-size', 'block-size',
  'min-width', 'max-width', 'min-height', 'max-height',
  'min-inline-size', 'max-inline-size', 'min-block-size', 'max-block-size',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'padding-block-start', 'padding-block-end', 'padding-inline-start', 'padding-inline-end',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'margin-block-start', 'margin-block-end', 'margin-inline-start', 'margin-inline-end',
  'display', 'border', 'border-width', 'border-spacing', 'border-collapse',
  'font', 'font-size', 'font-family', 'font-weight', 'font-style', 'line-height',
  'float', 'clear', 'overflow', 'overflow-x', 'overflow-y', 'overflow-block', 'overflow-inline',
  'vertical-align', 'white-space', 'list-style', 'list-style-type', 'zoom', 'content',
  'box-sizing', 'text-shadow', 'text-align', 'text-indent', 'text-transform', 'text-overflow',
  'word-wrap', 'letter-spacing', 'appearance', 'direction'
]

/** Layout properties that stylelint-high-performance-animation does not know. */
const EXTRA_LAYOUT_PROPERTIES = new Set([
  'inset', 'inset-block', 'inset-inline',
  'padding-block', 'padding-inline', 'margin-block', 'margin-inline',
  'gap', 'row-gap', 'column-gap', 'grid-gap', 'grid-row-gap', 'grid-column-gap',
  'grid', 'grid-template', 'grid-template-columns', 'grid-template-rows', 'grid-template-areas',
  'grid-auto-columns', 'grid-auto-rows', 'grid-area', 'grid-row', 'grid-column',
  'flex', 'flex-basis', 'flex-grow', 'flex-shrink', 'order', 'aspect-ratio',
  'border-block', 'border-inline', 'border-block-width', 'border-inline-width',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-block-start', 'border-block-end', 'border-inline-start', 'border-inline-end',
  'border-block-start-width', 'border-block-end-width', 'border-inline-start-width', 'border-inline-end-width',
  'columns', 'column-count', 'column-width', 'word-spacing', 'tab-size',
  'font-stretch', 'font-width', 'font-variation-settings',
  'contain-intrinsic-size', 'contain-intrinsic-inline-size', 'contain-intrinsic-block-size',
  'contain-intrinsic-width', 'contain-intrinsic-height',
  'shape-outside', 'shape-margin'
])

const ALL_LAYOUT_PROPERTIES = new Set([...UPSTREAM_LAYOUT_PROPERTIES, ...EXTRA_LAYOUT_PROPERTIES])

// Keywords of the transition shorthand that are not property names.
const TRANSITION_KEYWORDS = new Set([
  'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end',
  'normal', 'allow-discrete', 'none', 'initial', 'inherit', 'unset', 'revert', 'revert-layer'
])

/**
 * Splits a value at top-level separators, keeping each part's offset.
 * @param {string} value
 * @param {RegExp} separator a single-character test
 * @returns {{ text: string, index: number }[]}
 */
function split(value, separator) {
  const parts = []
  let depth = 0
  let start = 0
  for (let index = 0; index <= value.length; index++) {
    const character = value[index]
    if (character === '(') depth++
    else if (character === ')') depth--
    else if (index === value.length || (depth === 0 && separator.test(character))) {
      const text = value.slice(start, index)
      const trimmed = text.trimStart()
      if (trimmed) parts.push({ text: trimmed.trimEnd(), index: start + text.length - trimmed.length })
      start = index + 1
    }
  }
  return parts
}

/**
 * The property names a `transition` or `transition-property` value animates.
 * @param {string} value
 * @param {boolean} shorthand
 */
function transitionedProperties(value, shorthand) {
  return split(value, /,/).flatMap(transition => {
    const words = shorthand ? split(transition.text, /\s/) : [{ text: transition.text, index: 0 }]
    const property = words.find(({ text }) => /^-?[a-z][\w-]*$/i.test(text) && !TRANSITION_KEYWORDS.has(text.toLowerCase()))
    return property ? [{ name: property.text.toLowerCase().replace(/^-\w+-/, ''), index: transition.index + property.index }] : []
  })
}

/** @type {import('stylelint').Rule} */
const rule = (primary, secondary) => (root, result) => {
  const valid = stylelint.utils.validateOptions(result, ruleName,
    { actual: primary, possible: [true] },
    { actual: secondary, possible: { ignoreProperties: [value => typeof value === 'string'] }, optional: true })
  if (!valid) return
  const ignored = new Set(secondary?.ignoreProperties ?? [])

  /**
   * @param {import('postcss').Declaration} decl
   * @param {string} type
   * @param {Set<string>} properties
   * @param {boolean} shorthand
   */
  function check(decl, type, properties, shorthand) {
    const valueIndex = decl.prop.length + (decl.raws.between ?? ':').length
    for (const { name, index } of transitionedProperties(decl.value, shorthand)) {
      if (!properties.has(name) || ignored.has(name)) continue
      stylelint.utils.report({
        ruleName,
        result,
        node: decl,
        message: messages.rejected(type, name),
        index: valueIndex + index,
        endIndex: valueIndex + index + name.length
      })
    }
  }

  root.walkDecls(decl => {
    const property = decl.prop.toLowerCase()
    if (property.startsWith('--')) {
      // The upstream rule never sees transitions declared through a variable.
      if (property.includes('transition')) check(decl, 'a transition variable', ALL_LAYOUT_PROPERTIES, true)
      return
    }
    if (decl.parent?.type === 'rule' && decl.parent.parent?.type === 'atrule' && /keyframes$/i.test(decl.parent.parent.name)) {
      const name = property.replace(/^-\w+-/, '')
      if (EXTRA_LAYOUT_PROPERTIES.has(name) && !ignored.has(name)) {
        stylelint.utils.report({ ruleName, result, node: decl, message: messages.rejected('an animation', name), word: decl.prop })
      }
      return
    }
    if (property === 'transition') check(decl, 'a transition', EXTRA_LAYOUT_PROPERTIES, true)
    else if (property === 'transition-property') check(decl, 'a transition', EXTRA_LAYOUT_PROPERTIES, false)
  })
}

rule.ruleName = ruleName
rule.messages = messages

export default stylelint.createPlugin(ruleName, rule)
