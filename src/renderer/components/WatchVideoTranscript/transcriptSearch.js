function normalizeSearchText(text) {
  return text.trim().replaceAll(/\s+/g, ' ').toLocaleLowerCase()
}

export function filterTranscriptSegments(segments, query) {
  const normalizedQuery = normalizeSearchText(query)
  if (normalizedQuery === '') {
    return segments
  }

  const ranges = []
  let transcript = ''

  for (const [index, segment] of segments.entries()) {
    if (index > 0) {
      transcript += ' '
    }

    const start = transcript.length
    transcript += normalizeSearchText(segment.text)
    ranges.push({ start, end: transcript.length })
  }

  const matches = []
  let matchStart = transcript.indexOf(normalizedQuery)

  while (matchStart !== -1) {
    matches.push({ start: matchStart, end: matchStart + normalizedQuery.length })
    matchStart = transcript.indexOf(normalizedQuery, matchStart + 1)
  }

  let matchIndex = 0
  return segments.filter((_, index) => {
    const range = ranges[index]

    while (matches[matchIndex]?.end <= range.start) {
      matchIndex++
    }

    const match = matches[matchIndex]
    return match !== undefined && match.start < range.end && match.end > range.start
  })
}
