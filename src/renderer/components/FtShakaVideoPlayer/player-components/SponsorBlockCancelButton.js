import { PlayerIcons } from '../../../../constants'
import { SponsorBlockControlButton } from './SponsorBlockControlButton'

export class SponsorBlockCancelButton extends SponsorBlockControlButton {
  constructor(events, parent, controls) {
    super(events, parent, controls, {
      className: 'sponsorblock-cancel-button',
      eventName: 'cancelSponsorBlockSegment',
      iconPath: PlayerIcons.SPONSORBLOCK_CANCEL,
      labelKey: 'Video.Player.SponsorBlock.CancelCurrentSegment',
      type: 'cancel'
    })
  }
}
