import { PlayerIcons } from '../../../../constants'
import { SponsorBlockControlButton } from './SponsorBlockControlButton'

export class SponsorBlockEndButton extends SponsorBlockControlButton {
  constructor(events, parent, controls) {
    super(events, parent, controls, {
      className: 'sponsorblock-end-button',
      eventName: 'endSponsorBlockSegment',
      iconPath: PlayerIcons.SPONSORBLOCK_STOP,
      labelKey: 'Video.Player.SponsorBlock.SetSegmentEndNow',
      type: 'end'
    })
  }
}
