import { runCooperatively, runSynchronously } from './cooperativeTask.js'

const DAY = 24 * 60 * 60 * 1000
const STOPWORDS = new Set(`
  a about above after again against all an and any are as at be because been
  before being below between both but by can could did do does doing down during
  each few for from further
  had has have having he her here hers herself him himself his how i if in into
  is it its itself just many me more most much must my myself no nor not of off on once only or
  other our ours ourselves out over own same she should so some such than that
  the their theirs them themselves then there these they this those through to
  too under until up very was we were what when where which while who whom why
  will with would you your yours yourself yourselves don doesn didn isn aren
  won wouldn couldn shouldn video videos official new watch part episode
  aber alle allem allen aller alles als also am an ander andere anderen anderer
  anderes auch auf aus bei bin bis bist da damit dann das dass dein deine dem
  den denn der des dich die dies diese diesem diesen dieser dieses dir doch
  dort du durch ein eine einem einen einer eines er es etwas für gegen gewesen
  hab habe haben hat hatte hatten hier hin hinter ich ihr ihre ihrem ihren ihrer
  im in ist ja jede jedem jeden jeder jedes jetzt kann kein keine einem man
  mehr mein meine mit muss nach nicht nichts noch nun nur ob oder ohne schon
  sehr sein seine selbst sich sie sind so soll sollte sondern sonst über um und
  uns unser unsere unter viel vom von vor war waren warst was weg weil weiter
  welche welchem welchen welcher welches wenn werde werden wie wieder wir wird
  wirst wo wollen wollte wurde wurden zu zum zur zwar zwischen neu neue folge
`.trim().split(/\s+/u))

function number(value) {
  return (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value))
    ? Math.max(0, Number(value))
    : 0
}
function id(value) { return typeof value === 'string' && value !== 'N/A' ? value.trim() : '' }
function valid(video) { return video && typeof video === 'object' && id(video.videoId) && (video.type === undefined || video.type === 'video') }
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })

export function recommendationTokens(text) {
  if (typeof text !== 'string') return []
  return [...segmenter.segment(text.slice(0, 2000).normalize('NFKC').toLowerCase())]
    .filter(part => part.isWordLike)
    .map(part => part.segment)
    .filter(word => /\p{L}/u.test(word) && word.length <= 40 &&
      (word.length >= 3 || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(word)) && !STOPWORDS.has(word))
}

export function recommendationFeatures(video) {
  const features = new Map()
  function add(text, weight, phrases = false) {
    const tokens = recommendationTokens(text).slice(0, 80)
    for (const token of new Set(tokens)) features.set(token, (features.get(token) ?? 0) + weight)
    if (phrases) {
      for (let i = 1; i < tokens.length; i++) {
        const phrase = `${tokens[i - 1]} ${tokens[i]}`
        features.set(phrase, (features.get(phrase) ?? 0) + weight * 1.3)
      }
    }
  }
  add(video?.title, 1, true)
  add(video?.description, 0.18)
  if (Array.isArray(video?.keywords)) add(video.keywords.join(' '), 1.4)
  return features
}

function normalize(vector) {
  let squaredLength = 0
  for (const value of vector.values()) squaredLength += value * value
  const length = Math.sqrt(squaredLength)
  return new Map([...vector].map(([key, value]) => [key, length ? value / length : 0]))
}
function sumInto(target, source, weight) {
  for (const [key, value] of source) target.set(key, (target.get(key) ?? 0) + value * weight)
}
function cosine(a, b) {
  let score = 0
  for (const [key, value] of a) score += value * (b.get(key) ?? 0)
  return Math.min(1, Math.max(0, score))
}
function decay(at, now, days) { return at ? 2 ** (-Math.max(0, now - number(at)) / (days * DAY)) : 0.1 }
function normalizedWeights(weights) {
  let maximum = 0
  for (const value of weights.values()) maximum = Math.max(maximum, value)
  return new Map([...weights].map(([key, value]) => [key, maximum ? value / maximum : 0]))
}
function tie(a, b) { return a < b ? -1 : a > b ? 1 : 0 }
// Mulberry32: a feed's round reproduces its sample when the feed is reranked.
function seededRandom(seed) {
  let state = Math.floor(number(seed)) >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return (((t ^ (t >>> 14)) >>> 0) + 1) / 4294967297
  }
}
// Gumbel noise turns an argmax over log weights into sampling proportional to weight.
function gumbel(random) { return -Math.log(-Math.log(random())) }
function sampleOrder(items, weight, random) {
  return items.map(item => ({ item, key: Math.log(weight(item)) + gumbel(random) }))
    .sort((a, b) => b.key - a.key).map(({ item }) => item)
}

export function recommendationSubscriptionIds(subscriptions) {
  return (Array.isArray(subscriptions) ? subscriptions : [])
    .map(channel => typeof channel === 'string' ? channel : channel?.id)
    .filter(channel => typeof channel === 'string' && channel.length > 0)
}

/** Select only the learning budget; history is already sorted by recency. */
export function getRecommendationLearningEntries(videos, isVisible, limit = 1000) {
  const recent = []
  for (const video of videos) {
    if (!valid(video) || !isVisible(video)) continue
    recent.push(video)
    if (recent.length >= limit) break
  }
  return recent
}

/**
 * Learn reversible long-term, current-session, negative and channel interests.
 * Saved videos and positive feedback contribute even before the first watch.
 * Actual playback observations replace seekable resume positions when available.
 */
function * buildRecommendationProfileSteps(history, {
  now = Date.now(), records = [], favorites = [], saved = [], subscriptions = [], round = 0,
} = {}) {
  const entries = []
  const seenVideoIds = new Set()
  for (const video of (Array.isArray(history) ? history : [])) {
    if (valid(video)) entries.push(video)
    const videoId = id(video?.videoId)
    if (videoId) seenVideoIds.add(videoId)
    yield
  }
  const evidence = new Map()
  for (const record of (Array.isArray(records) ? records : [])) {
    if (valid(record)) evidence.set(record.videoId, record)
    yield
  }
  const blockedChannels = new Set()
  const rejectedIds = new Set()
  for (const record of evidence.values()) {
    if (record.feedback === 'blockChannel' && record.authorId) blockedChannels.add(record.authorId)
    if (['dismiss', 'blockChannel'].includes(record.feedback)) rejectedIds.add(record.videoId)
    yield
  }
  const sources = new Map()
  for (const record of entries.toSorted((a, b) => number(b.timeWatched) - number(a.timeWatched)).slice(0, 1000)) {
    yield
    if (sources.has(record.videoId)) continue
    const learned = evidence.get(record.videoId)
    const actual = learned?.lastWatchSeconds
    const duration = number(record.lengthSeconds)
    const progress = actual ?? number(record.watchProgress)
    const completion = actual == null && record.isWatched === true ? 1 : duration ? Math.min(1, progress / duration) : 0
    const engagement = completion * 0.7 + Math.min(1, progress / 600) * 0.3
    const weight = Math.max(0.04, engagement) * (record.isShort ? 0.45 : 1)
    sources.set(record.videoId, { video: { ...record, ...learned }, weight, at: number(learned?.watchedAt ?? record.timeWatched), strong: completion >= 0.7 || (completion >= 0.35 && progress >= 180) })
  }
  for (const [videos, weight] of [[saved, 0.8], [favorites, 1.5]]) {
    let count = 0
    for (const video of (Array.isArray(videos) ? videos : [])) {
      yield
      if (!valid(video)) continue
      const existing = sources.get(video.videoId)
      // Old saves fade like history, but a floor keeps them a lasting interest.
      sources.set(video.videoId, { video: { ...video, ...evidence.get(video.videoId) }, weight: Math.max(weight, existing?.weight ?? 0), at: Math.max(number(existing?.at), number(video.timeAdded)), floor: 0.25, strong: true })
      if (++count >= 500) break
    }
  }
  for (const record of evidence.values()) {
    yield
    if (record.feedback === 'positive') {
      const existing = sources.get(record.videoId)
      sources.set(record.videoId, { video: { ...existing?.video, ...record }, weight: Math.max(1.8, existing?.weight ?? 0), at: Math.max(number(existing?.at), number(record.feedbackAt)), floor: existing?.floor, strong: true })
    }
  }
  const usable = [...sources.values()].filter(source => !rejectedIds.has(source.video.videoId) && !blockedChannels.has(source.video.authorId))
  const documents = []
  for (const source of usable) {
    documents.push(recommendationFeatures(source.video))
    yield
  }
  const frequency = new Map()
  for (const features of documents) {
    for (const term of features.keys()) frequency.set(term, (frequency.get(term) ?? 0) + 1)
    yield
  }
  const idf = new Map([...frequency].map(([term, count]) => [term, 1 + Math.log(1 + documents.length / count)]))
  const vectorForFeatures = features => normalize(new Map([...features].map(([term, value]) => [term, value * (idf.get(term) ?? 1)])))
  const vectorFor = video => vectorForFeatures(recommendationFeatures(video))
  const longTerm = new Map()
  const session = new Map()
  const negative = new Map()
  let negativeStrength = 0
  const channelWeights = new Map()
  for (const [index, source] of usable.entries()) {
    const vector = vectorForFeatures(documents[index])
    const weight = source.weight * Math.max(source.floor ?? 0, decay(source.at, now, 60))
    source.vector = vector
    source.score = weight
    sumInto(longTerm, vector, weight)
    sumInto(session, vector, source.weight * decay(source.at, now, 0.5))
    const channel = id(source.video.authorId)
    if (channel) channelWeights.set(channel, (channelWeights.get(channel) ?? 0) + source.weight * Math.max(source.floor ?? 0, decay(source.at, now, 30)))
    yield
  }
  for (const record of evidence.values()) {
    yield
    if (['dismiss', 'blockChannel'].includes(record.feedback)) {
      const weight = decay(record.feedbackAt, now, 60)
      sumInto(negative, vectorFor(record), weight)
      negativeStrength += weight
    }
    // A short, actually played recommendation is weak negative evidence after
    // the session has ended. Clicks that failed to play do not count as skips.
    if (record.clickedAt && record.lastWatchSeconds > 0 && record.lastWatchSeconds < Math.min(30, number(record.lengthSeconds) * 0.15) &&
      record.watchedAt < now - 60_000 && record.feedback !== 'positive') {
      const weight = 0.25 * decay(record.watchedAt, now, 7)
      sumInto(negative, vectorFor(record), weight)
      negativeStrength += weight
    }
  }
  const interests = normalize(longTerm)
  // Each round samples the whole learning budget in proportion to its weight,
  // so recent interests lead without a top-N window repeating the same seeds.
  const random = seededRandom(round)
  const topicCandidates = sampleOrder(usable.toSorted((a, b) => tie(a.video.videoId, b.video.videoId)), source => source.score, random)
  // MMR seed selection covers different interests before repeating one topic.
  const seeds = []
  const seedPool = topicCandidates.filter(source => source.strong)
    .map(source => ({ source, key: Math.log(source.score) + gumbel(random) }))
  while (seeds.length < 4 && seedPool.length) {
    let bestIndex = 0
    let bestScore = -Infinity
    for (let i = 0; i < seedPool.length; i++) {
      const { source, key } = seedPool[i]
      const similarity = Math.max(0, ...seeds.map(seed => cosine(seed.vector, source.vector)))
      const channelCount = seeds.filter(seed => seed.video.authorId === source.video.authorId).length
      const score = key + Math.log((1 - similarity * 0.8) / (1 + channelCount * 2))
      if (score > bestScore) { bestScore = score; bestIndex = i }
    }
    seeds.push(seedPool.splice(bestIndex, 1)[0].source)
  }
  // Related videos already cover the seeds, so searches prefer other interests.
  const coveredBySeed = source => seeds.some(seed => cosine(seed.vector, source.vector) > 0.8)
  const queryPool = [...topicCandidates.slice(0, 30).filter(source => !coveredBySeed(source)), ...seeds]
  const queries = []
  const queryTokens = new Set()
  const queryVectors = []
  const specificity = term => idf.get(term) ?? 1
  for (const source of queryPool) {
    // The sampled source carries the interest; its rarest adjacent words make a
    // specific search. Words shared by many titles, such as a series name, are
    // common. Channel-name words would only find more of what the channel
    // requests already fetch, so they are a last resort for topic-named channels.
    const author = new Set(recommendationTokens(source.video.author))
    const tokens = [...new Set(recommendationTokens(source.video.title))]
    const pair = tokens.slice(1).map((token, i) => [tokens[i], token])
      .map(pair => ({ pair, authorWords: pair.filter(token => author.has(token)).length, score: specificity(pair[0]) + specificity(pair[1]) }))
      .sort((a, b) => a.authorWords - b.authorWords || b.score - a.score)[0]?.pair
    // A title whose best words were already searched repeats that topic; its
    // weaker words would make a generic search.
    if (!pair || pair.some(token => queryTokens.has(token)) || queryVectors.some(vector => cosine(vector, source.vector) > 0.8)) continue
    queries.push(pair.join(' ')); queryVectors.push(source.vector)
    for (const token of pair) queryTokens.add(token)
    if (queries.length === 3) break
  }
  const channels = sampleOrder([...channelWeights].sort((a, b) => tie(a[0], b[0])), ([, weight]) => weight, random)
    .slice(0, 3).map(([channel]) => channel)
  return {
    channels,
    queries,
    // Engagement, not recency, sets graph weight: an old favorite's related videos still count.
    seeds: seeds.map(source => ({ videoId: source.video.videoId, title: source.video.title, authorId: source.video.authorId, weight: Math.min(1, source.weight) })),
    // Candidates fetched for an earlier round's seeds keep their graph evidence.
    graphSources: new Map(usable.map(source => [source.video.videoId, { title: source.video.title, weight: Math.min(1, source.weight) }])),
    channelWeights: normalizedWeights(channelWeights),
    seenVideoIds,
    interests,
    idf,
    session: normalize(session),
    negative: new Map([...normalize(negative)].map(([term, weight]) => [term, weight * Math.min(1, negativeStrength)])),
    evidence,
    rejectedIds,
    blockedChannels,
    subscriptions: new Set(recommendationSubscriptionIds(subscriptions)),
    vectorFor,
    hasInterests: usable.length > 0,
    now,
  }
}

/** Rank by personalized relevance, graph evidence, confidence and feed novelty. */
function * scoreRecommendationCandidateSteps(candidates, profile, { exploration = 0.2, now = Date.now() } = {}) {
  const scored = new Map()
  for (const video of (Array.isArray(candidates) ? candidates : [])) {
    yield
    if (!valid(video) || profile.seenVideoIds.has(video.videoId) || profile.rejectedIds.has(video.videoId) || profile.blockedChannels.has(video.authorId)) continue
    const vector = profile.vectorFor(video)
    const affinity = cosine(profile.interests, vector)
    const sessionAffinity = cosine(profile.session, vector)
    const negativeAffinity = cosine(profile.negative, vector)
    const channelAffinity = profile.channelWeights.get(id(video.authorId)) ?? 0
    const sources = video.recommendationSources ?? []
    const related = sources.filter(source => source.type === 'related' && profile.graphSources.has(source.id))
    const graphAffinity = Math.min(1, related.reduce((total, source) => total + profile.graphSources.get(source.id).weight * 0.6, 0))
    const subscribed = profile.subscriptions.has(video.authorId)
    // Graph evidence may admit a video with entirely different title vocabulary.
    const relevance = affinity * 0.48 + sessionAffinity * 0.17 + channelAffinity * 0.18 + graphAffinity * 0.32 + (subscribed ? 0.06 : 0)
    if (relevance <= 0 || (!profile.hasInterests && !subscribed)) continue
    const record = profile.evidence.get(video.videoId)
    const impressions = record?.impressions ?? []
    const lastSeen = impressions.at(-1) ?? 0
    const ignored = impressions.filter(at => at > now - 14 * DAY && at > (record?.clickedAt ?? 0)).length
    const recentExposure = lastSeen > now - 30 * 60_000 ? 0.25 : 1
    const repetition = recentExposure / (1 + ignored * 0.45)
    const uncertainty = 1 / Math.sqrt(1 + impressions.length + channelAffinity * 6)
    const novelty = Math.max(0, Math.min(0.5, exploration)) * uncertainty * (graphAffinity > 0 || affinity > 0.08 ? 0.3 : 0)
    const freshness = 0.85 + 0.15 * decay(video.published, now, 30)
    const negativePenalty = Math.max(0.04, 1 - negativeAffinity * 1.3)
    const score = (relevance + novelty) * freshness * repetition * negativePenalty
    const reason = related.length
      ? { type: 'related', text: profile.graphSources.get(related[0].id).title }
      : channelAffinity > affinity
        ? { type: 'channel', text: video.author ?? '' }
        : subscribed && !profile.hasInterests
          ? { type: 'subscription', text: video.author ?? '' }
          : { type: 'topic', text: topicReason(vector, profile.interests, profile.idf) }
    const item = { video, score, affinity, graphAffinity, novelty, vector, reason, discovery: channelAffinity === 0 && !subscribed }
    if (!scored.has(video.videoId) || score > scored.get(video.videoId).score) scored.set(video.videoId, item)
  }
  return [...scored.values()].sort((a, b) => b.score - a.score || tie(a.video.videoId, b.video.videoId))
}

// Name the most specific word that clearly matches the interests. The most
// frequent words in history are generic; a word seen once may be coincidental.
function topicReason(vector, interests, idf) {
  let strongest = 0
  for (const term of vector.keys()) {
    if (!term.includes(' ')) strongest = Math.max(strongest, interests.get(term) ?? 0)
  }
  let topic = ''
  let best = 0
  for (const term of vector.keys()) {
    const interest = interests.get(term) ?? 0
    const specificity = idf.get(term) ?? 0
    if (!term.includes(' ') && interest > 0 && interest >= strongest * 0.1 && specificity > best) { topic = term; best = specificity }
  }
  return topic
}

// Kept items are already shown; they count toward the limit and diversity but are not returned.
function * diversifyRecommendationSteps(scored, { limit = 24, exploration = 0.2, kept = [] } = {}) {
  limit = Math.floor(number(limit))
  const keptIds = new Set(kept.map(item => item.video.videoId))
  const pool = scored.filter(item => !keptIds.has(item.video.videoId))
  const selected = [...kept]
  const channelCounts = new Map()
  for (const item of kept) channelCounts.set(id(item.video.authorId), (channelCounts.get(id(item.video.authorId)) ?? 0) + 1)
  while (selected.length < limit && pool.length) {
    const wantsDiscovery = exploration > 0 && selected.length > 0 && selected.filter(item => item.discovery).length < Math.floor((selected.length + 1) * exploration)
    let bestIndex = -1
    let bestScore = -Infinity
    for (let i = 0; i < pool.length; i++) {
      yield
      const item = pool[i]
      const count = channelCounts.get(id(item.video.authorId)) ?? 0
      if (count >= 3) continue
      const similarity = Math.max(0, ...selected.map(other => cosine(item.vector, other.vector)))
      // Near-duplicate titles compete for a single place, even across channels.
      if (similarity > 0.96 && item.vector.size > 2) continue
      const score = item.score * (1 - 0.45 * similarity) / (1 + count * 0.6) * (wantsDiscovery && item.discovery ? 1.3 : 1)
      if (score > bestScore) { bestScore = score; bestIndex = i }
    }
    if (bestIndex < 0) break
    const item = pool.splice(bestIndex, 1)[0]
    selected.push(item)
    const channel = id(item.video.authorId)
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1)
  }
  return selected.slice(kept.length)
}

function keptRecommendationItems(videos = [], profile) {
  return videos.map(video => ({
    video,
    vector: profile.vectorFor(video),
    discovery: !profile.channelWeights.get(id(video.authorId)) && !profile.subscriptions.has(video.authorId),
  }))
}

export function buildRecommendationProfile(history, options) {
  return runSynchronously(buildRecommendationProfileSteps(history, options))
}

export function buildRecommendationProfileAsync(history, options, isCancelled) {
  return runCooperatively(buildRecommendationProfileSteps(history, options), isCancelled)
}

export function scoreRecommendationCandidates(candidates, profile, options) {
  return runSynchronously(scoreRecommendationCandidateSteps(candidates, profile, options))
}

export function diversifyRecommendations(scored, options) {
  return runSynchronously(diversifyRecommendationSteps(scored, options))
}

export async function rankRecommendationCandidatesAsync(candidates, profile, options, isCancelled) {
  const scored = await runCooperatively(scoreRecommendationCandidateSteps(candidates, profile, options), isCancelled)
  return scored && runCooperatively(diversifyRecommendationSteps(scored, { ...options, kept: keptRecommendationItems(options?.kept, profile) }), isCancelled)
}

export function rankRecommendations(candidates, history, options = {}) {
  const profile = buildRecommendationProfile(history, options)
  return diversifyRecommendations(scoreRecommendationCandidates(candidates, profile, options), { ...options, kept: keptRecommendationItems(options.kept, profile) })
    .map(item => item.video)
}
