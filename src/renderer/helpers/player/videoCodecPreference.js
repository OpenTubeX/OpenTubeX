// Shaka counts matching entries, so repeat powerEfficient intentionally to give
// hardware decoding two points and smoothness one. This keeps software AV1 from
// tying with hardware VP9 while preserving smoothness as the tie-breaker when
// both codecs use hardware decoding, or neither does.
export const preferredVideoDecodingAttributes = ['powerEfficient', 'powerEfficient', 'smooth']

/**
 * Automatic quality filters by codec prefix (see `chooseAutoVariants`), but Shaka
 * applies these video preferences by exact match. The final codec-free entry
 * preserves automatic HDR selection when
 * a full codec identifier does not exactly match a prefix, or no codec matches.
 * @param {string} preference
 * @returns {{ codec: string, hdrLevel: 'AUTO' }[]}
 */
export function getVideoCodecPreferences(preference) {
  return [...getCodecPrefixes(preference), ''].map(codec => ({ codec, hdrLevel: 'AUTO' }))
}

/**
 * @param {string} preference
 * @returns {string[]}
 */
export function getCodecPrefixes(preference) {
  switch (preference) {
    case 'av1': return ['av01']
    case 'vp9': return ['vp09', 'vp9']
    case 'h264': return ['avc1']
    default: return []
  }
}

const CODEC_ALIASES = { avc3: 'avc1', hev1: 'hvc1', vp9: 'vp09' }

/**
 * @param {string | null | undefined} codecs
 * @returns {string} e.g. `av01` for `av01.0.12M.08`
 */
export function getCodecFamily(codecs) {
  const prefix = (codecs ?? '').split('.', 1)[0].toLowerCase()
  return CODEC_ALIASES[prefix] ?? prefix
}

/** Lower is better, as in Shaka */
const CODEC_EFFICIENCY = { avc1: 1, vp8: 1, vp09: 0.9, hvc1: 0.85, av01: 0.7 }

/**
 * The variants that automatic quality chooses from. Shaka normally removes all
 * other variants from the manifest, which also hides them from the resolution
 * menu, so the player turns that off with `streaming.dontChooseCodecs` and only
 * applies this choice to ABR. Mirrors Shaka's unexported
 * `StreamUtils.chooseCodecsAndFilterManifest`: the first preferred codec that
 * is available, then for each width the variants matching the most preferred
 * decoding attributes, then for each resolution the codec of its lowest
 * bitrate stream.
 * @param {shaka.extern.Variant[]} variants
 * @param {string[]} preferredCodecs
 * @param {string[]} preferredDecodingAttributes
 * @returns {shaka.extern.Variant[]}
 */
export function chooseAutoVariants(variants, preferredCodecs, preferredDecodingAttributes) {
  let candidates = variants
  for (const codec of preferredCodecs) {
    const matching = candidates.filter(variant => variant.video?.codecs.startsWith(codec))
    if (matching.length > 0) {
      candidates = matching
      break
    }
  }

  if (preferredDecodingAttributes.length > 0) {
    const getScore = variant => preferredDecodingAttributes.filter(attribute => variant.decodingInfos[0]?.[attribute]).length
    const bestScores = new Map()
    for (const variant of candidates) {
      const width = variant.video?.width || 0
      bestScores.set(width, Math.max(bestScores.get(width) ?? 0, getScore(variant)))
    }
    candidates = candidates.filter(variant => getScore(variant) === bestScores.get(variant.video?.width || 0))
  }

  const videoStreams = [...new Set(candidates.map(variant => variant.video).filter(Boolean))]
    .sort((a, b) => {
      if (a.bandwidth && b.bandwidth && a.bandwidth !== b.bandwidth) {
        return a.bandwidth - b.bandwidth
      }
      if (a.width !== b.width) {
        return a.width - b.width
      }
      return (CODEC_EFFICIENCY[getCodecFamily(a.codecs)] ?? 1) - (CODEC_EFFICIENCY[getCodecFamily(b.codecs)] ?? 1)
    })

  /** @type {Map<string, string>} */
  const groupCodecs = new Map()
  const chosenStreams = new Set()
  for (const stream of videoStreams) {
    const group = [
      stream.width,
      stream.height,
      Math.round(stream.frameRate || 0),
      stream.hdr,
      stream.fastSwitching,
      stream.dependencyStream?.baseOriginalId,
      [...(stream.roles ?? [])].sort().join('_')
    ].join(';')
    const codec = getCodecFamily(stream.codecs)
    if (!groupCodecs.has(group)) {
      groupCodecs.set(group, codec)
    }
    if (groupCodecs.get(group) === codec) {
      chosenStreams.add(stream)
    }
  }

  return candidates.filter(variant => !variant.video || chosenStreams.has(variant.video))
}

/** Codecs to fall back to once every chosen stream is disabled, cheapest to decode first */
const FALLBACK_CODECS = ['avc1', 'vp09', 'vp9']

/**
 * `chooseAutoVariants` for a playable subset of the manifest. Shaka disables a
 * stream for a while when it drops frames or fails to load, and leaves it out
 * of the playable variants. Choosing from those alone would hand its
 * resolution to another codec, often AV1, the hardest to decode, so the
 * choice is made with the disabled variants and then limited to the playable
 * ones. Automatic quality then drops to another resolution of the same codec,
 * as with Shaka's own codec filtering. Only when every chosen stream is
 * disabled does it fall back to another codec, the cheapest to decode first.
 * @param {shaka.extern.Variant[]} playableVariants
 * @param {Iterable<shaka.extern.Variant>} knownVariants including disabled ones
 * @param {string[]} preferredCodecs
 * @param {string[]} preferredDecodingAttributes
 * @returns {shaka.extern.Variant[]}
 */
export function chooseAutoVariantsWithDisabled(playableVariants, knownVariants, preferredCodecs, preferredDecodingAttributes) {
  const playable = new Set(playableVariants)
  const candidates = [...knownVariants].filter(variant => playable.has(variant) ||
    (variant.disabledUntilTime > 0 && variant.allowedByApplication && variant.allowedByKeySystem))
  const chosenVideoIds = new Set(chooseAutoVariants(candidates, preferredCodecs, preferredDecodingAttributes)
    .map(variant => variant.video?.id))
  const chosen = playableVariants.filter(variant => !variant.video || chosenVideoIds.has(variant.video.id))
  return chosen.some(variant => variant.video)
    ? chosen
    : chooseAutoVariants(playableVariants, [...preferredCodecs, ...FALLBACK_CODECS], preferredDecodingAttributes)
}
