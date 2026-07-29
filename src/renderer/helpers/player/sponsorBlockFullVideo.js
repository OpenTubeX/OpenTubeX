export const SPONSORBLOCK_FULL_VIDEO_CATEGORIES = Object.freeze([
  'sponsor',
  'selfpromo',
  'exclusive_access'
])

const SPONSORBLOCK_FULL_VIDEO_CATEGORY_PRIORITY = Object.freeze([
  'sponsor',
  'exclusive_access',
  'selfpromo'
])

export function isSponsorBlockFullVideoCategory(category) {
  return SPONSORBLOCK_FULL_VIDEO_CATEGORIES.includes(category)
}

export function resolveSponsorBlockActionType(category, actionType) {
  if (category === 'poi_highlight') {
    return 'poi'
  }

  if (category === 'exclusive_access' || (actionType === 'full' && isSponsorBlockFullVideoCategory(category))) {
    return 'full'
  }

  if (actionType === 'mute') {
    return 'mute'
  }

  return 'skip'
}

export function getSponsorBlockSubmissionSegmentTimes(segment) {
  if (segment.actionType === 'full') {
    return [0, 0]
  }

  return segment.actionType === 'poi'
    ? [segment.startTime, segment.startTime]
    : [segment.startTime, segment.endTime]
}

export function selectSponsorBlockFullVideoLabel(segments) {
  for (const category of SPONSORBLOCK_FULL_VIDEO_CATEGORY_PRIORITY) {
    const segment = segments.find(candidate => {
      return candidate.category === category &&
        (candidate.actionType == null || candidate.actionType === 'full')
    })

    if (segment) {
      return segment
    }
  }

  return null
}
