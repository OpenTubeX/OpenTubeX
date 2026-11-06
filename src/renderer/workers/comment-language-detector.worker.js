import { eld } from 'eld/extrasmall'

import { detectCommentTranslationAvailability } from '../helpers/comment-language-detection.js'

globalThis.addEventListener('message', ({ data }) => {
  const { id, text, targetLanguage, ignoredLanguages } = data

  try {
    globalThis.postMessage({
      id,
      available: detectCommentTranslationAvailability(
        eld,
        text,
        targetLanguage,
        ignoredLanguages
      )
    })
  } catch (error) {
    globalThis.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error)
    })
  }
})
