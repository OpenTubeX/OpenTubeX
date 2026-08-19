// YouTube returns this list with player caption metadata. Keep a bundled copy
// so the setting is useful before the first video has been opened; player
// responses add any languages YouTube introduces later in the session.
const YOUTUBE_CAPTION_LANGUAGES = Object.freeze([
  ['ab', 'Abkhazian'],
  ['aa', 'Afar'],
  ['af', 'Afrikaans'],
  ['ak', 'Akan'],
  ['sq', 'Albanian'],
  ['am', 'Amharic'],
  ['ar', 'Arabic'],
  ['hy', 'Armenian'],
  ['as', 'Assamese'],
  ['ay', 'Aymara'],
  ['az', 'Azerbaijani'],
  ['bn', 'Bangla'],
  ['ba', 'Bashkir'],
  ['eu', 'Basque'],
  ['be', 'Belarusian'],
  ['bho', 'Bhojpuri'],
  ['bs', 'Bosnian'],
  ['br', 'Breton'],
  ['bg', 'Bulgarian'],
  ['my', 'Burmese'],
  ['ca', 'Catalan'],
  ['ceb', 'Cebuano'],
  ['zh-Hans', 'Chinese (Simplified)'],
  ['zh-Hant', 'Chinese (Traditional)'],
  ['co', 'Corsican'],
  ['hr', 'Croatian'],
  ['cs', 'Czech'],
  ['da', 'Danish'],
  ['dv', 'Divehi'],
  ['nl', 'Dutch'],
  ['dz', 'Dzongkha'],
  ['en', 'English'],
  ['eo', 'Esperanto'],
  ['et', 'Estonian'],
  ['ee', 'Ewe'],
  ['fo', 'Faroese'],
  ['fj', 'Fijian'],
  ['fil', 'Filipino'],
  ['fi', 'Finnish'],
  ['fr', 'French'],
  ['gaa', 'Ga'],
  ['gl', 'Galician'],
  ['lg', 'Ganda'],
  ['ka', 'Georgian'],
  ['de', 'German'],
  ['el', 'Greek'],
  ['gn', 'Guarani'],
  ['gu', 'Gujarati'],
  ['ht', 'Haitian Creole'],
  ['ha', 'Hausa'],
  ['haw', 'Hawaiian'],
  ['he', 'Hebrew'],
  ['hi', 'Hindi'],
  ['hmn', 'Hmong'],
  ['hu', 'Hungarian'],
  ['is', 'Icelandic'],
  ['ig', 'Igbo'],
  ['id', 'Indonesian'],
  ['iu', 'Inuktitut'],
  ['ga', 'Irish'],
  ['it', 'Italian'],
  ['ja', 'Japanese'],
  ['jv', 'Javanese'],
  ['kl', 'Kalaallisut'],
  ['kn', 'Kannada'],
  ['kk', 'Kazakh'],
  ['kha', 'Khasi'],
  ['km', 'Khmer'],
  ['rw', 'Kinyarwanda'],
  ['ko', 'Korean'],
  ['kri', 'Krio'],
  ['ku', 'Kurdish'],
  ['ky', 'Kyrgyz'],
  ['lo', 'Lao'],
  ['la', 'Latin'],
  ['lv', 'Latvian'],
  ['ln', 'Lingala'],
  ['lt', 'Lithuanian'],
  ['lua', 'Luba-Lulua'],
  ['luo', 'Luo'],
  ['lb', 'Luxembourgish'],
  ['mk', 'Macedonian'],
  ['mg', 'Malagasy'],
  ['ms', 'Malay'],
  ['ml', 'Malayalam'],
  ['mt', 'Maltese'],
  ['gv', 'Manx'],
  ['mi', 'Māori'],
  ['mr', 'Marathi'],
  ['mn', 'Mongolian'],
  ['mfe', 'Morisyen'],
  ['ne', 'Nepali'],
  ['new', 'Newari'],
  ['nso', 'Northern Sotho'],
  ['no', 'Norwegian'],
  ['ny', 'Nyanja'],
  ['oc', 'Occitan'],
  ['or', 'Odia'],
  ['om', 'Oromo'],
  ['os', 'Ossetic'],
  ['pam', 'Pampanga'],
  ['ps', 'Pashto'],
  ['fa', 'Persian'],
  ['pl', 'Polish'],
  ['pt', 'Portuguese'],
  ['pt-PT', 'Portuguese (Portugal)'],
  ['pa', 'Punjabi'],
  ['qu', 'Quechua'],
  ['ro', 'Romanian'],
  ['rn', 'Rundi'],
  ['ru', 'Russian'],
  ['sm', 'Samoan'],
  ['sg', 'Sango'],
  ['sa', 'Sanskrit'],
  ['gd', 'Scottish Gaelic'],
  ['sr', 'Serbian'],
  ['crs', 'Seselwa Creole French'],
  ['sn', 'Shona'],
  ['sd', 'Sindhi'],
  ['si', 'Sinhala'],
  ['sk', 'Slovak'],
  ['sl', 'Slovenian'],
  ['so', 'Somali'],
  ['st', 'Southern Sotho'],
  ['es', 'Spanish'],
  ['su', 'Sundanese'],
  ['sw', 'Swahili'],
  ['ss', 'Swati'],
  ['sv', 'Swedish'],
  ['tg', 'Tajik'],
  ['ta', 'Tamil'],
  ['tt', 'Tatar'],
  ['te', 'Telugu'],
  ['th', 'Thai'],
  ['bo', 'Tibetan'],
  ['ti', 'Tigrinya'],
  ['to', 'Tongan'],
  ['ts', 'Tsonga'],
  ['tn', 'Tswana'],
  ['tum', 'Tumbuka'],
  ['tr', 'Turkish'],
  ['tk', 'Turkmen'],
  ['uk', 'Ukrainian'],
  ['ur', 'Urdu'],
  ['ug', 'Uyghur'],
  ['uz', 'Uzbek'],
  ['ve', 'Venda'],
  ['vi', 'Vietnamese'],
  ['war', 'Waray'],
  ['cy', 'Welsh'],
  ['fy', 'Western Frisian'],
  ['wo', 'Wolof'],
  ['xh', 'Xhosa'],
  ['yi', 'Yiddish'],
  ['yo', 'Yoruba'],
  ['zu', 'Zulu'],
])

export const YOUTUBE_CAPTION_LANGUAGE_CODES = Object.freeze(
  YOUTUBE_CAPTION_LANGUAGES.map(([code]) => code)
)

export const YOUTUBE_CAPTION_LANGUAGE_FALLBACK_NAMES = Object.freeze(
  Object.fromEntries(YOUTUBE_CAPTION_LANGUAGES)
)

const YOUTUBE_CAPTION_LANGUAGE_CODE_SET = new Set(YOUTUBE_CAPTION_LANGUAGE_CODES)

/**
 * Convert locale values used by the old app-language selector to the codes
 * returned by YouTube's caption translation list.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeYouTubeCaptionLanguageCode(value) {
  if (value === '') return ''
  if (typeof value !== 'string') return ''

  let canonical
  try {
    canonical = Intl.getCanonicalLocales(value)[0]
  } catch {
    return ''
  }

  if (YOUTUBE_CAPTION_LANGUAGE_CODE_SET.has(canonical)) return canonical

  const [language] = canonical.split('-')
  if (language === 'zh') {
    return /-(Hant|TW|HK|MO)(?:-|$)/.test(canonical) ? 'zh-Hant' : 'zh-Hans'
  }
  if (language === 'nb' || language === 'nn') return 'no'
  return YOUTUBE_CAPTION_LANGUAGE_CODE_SET.has(language) ? language : canonical
}

/**
 * Merge language codes from a YouTube player response into the bundled list.
 * @param {Array<string | { language_code?: string }>} languages
 * @returns {string[]}
 */
export function mergeYouTubeCaptionLanguageCodes(languages) {
  const codes = new Set(YOUTUBE_CAPTION_LANGUAGE_CODES)

  for (const language of languages) {
    const code = typeof language === 'string' ? language : language?.language_code
    if (typeof code !== 'string' || code === '') continue

    try {
      codes.add(Intl.getCanonicalLocales(code)[0])
    } catch {
      // Player responses occasionally contain source-only pseudo-locales such
      // as `en-orig`. Those are not valid translation targets.
    }
  }

  return [...codes]
}
