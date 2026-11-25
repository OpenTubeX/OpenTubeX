// Keep the interpolated selection short, so that the surrounding translated text
// (e.g. the trailing "in a New Tab") stays readable instead of being cut off
const SELECTION_LABEL_MAX_LENGTH = 30

// Counting grapheme clusters rather than UTF-16 code units, so that the cut
// never lands inside an emoji or a combining character sequence. Created on
// first use: loading its segmentation data takes several milliseconds, which
// would otherwise be spent before the app is ready.
/** @type {Intl.Segmenter | undefined} */
let selectionLabelSegmenter

/**
 * @param {string} text
 */
export function truncateSelectionForLabel(text) {
  selectionLabelSegmenter ??= new Intl.Segmenter()
  const graphemes = []
  for (const { segment } of selectionLabelSegmenter.segment(text)) {
    if (graphemes.length === SELECTION_LABEL_MAX_LENGTH) {
      return `${graphemes.join('').trimEnd()}…`
    }
    graphemes.push(segment)
  }

  return text
}
