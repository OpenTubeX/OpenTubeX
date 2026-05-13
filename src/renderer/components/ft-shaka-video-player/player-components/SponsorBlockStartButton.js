import { PlayerIcons } from '../../../../constants'
import { SponsorBlockControlButton } from './SponsorBlockControlButton'

export class SponsorBlockStartButton extends SponsorBlockControlButton {
  constructor(events, parent, controls) {
    super(events, parent, controls, {
      className: 'sponsorblock-start-button',
      eventName: 'startSponsorBlockSegment',
      iconPath: PlayerIcons.SPONSORBLOCK_START,
      labelKey: 'Video.Player.SponsorBlock.StartSegmentNow',
      type: 'start'
    })
  }
}
