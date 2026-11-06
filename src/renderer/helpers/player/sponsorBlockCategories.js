import { resolveSponsorBlockActionType } from './sponsorBlockFullVideo.js'

export const SPONSORBLOCK_SUBMISSION_CATEGORIES = Object.freeze([
  'sponsor',
  'selfpromo',
  'interaction',
  'intro',
  'outro',
  'preview',
  'hook',
  'music_offtopic',
  'filler',
  'poi_highlight',
  'exclusive_access'
])

export function getSponsorBlockCategoryVoteOptions(actionType) {
  // SponsorBlock does not accept category votes for full-video labels.
  if (actionType === 'full') return []

  return SPONSORBLOCK_SUBMISSION_CATEGORIES.filter(category => {
    return (category !== 'music_offtopic' || actionType === 'skip') &&
      resolveSponsorBlockActionType(category, actionType) === actionType
  })
}
