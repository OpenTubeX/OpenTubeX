import { PlayerIcons } from '../../../../constants'
import { SponsorBlockControlButton } from './SponsorBlockControlButton'

export class SponsorBlockClearButton extends SponsorBlockControlButton {
  constructor(events, parent, controls) {
    super(events, parent, controls, {
      className: 'sponsorblock-clear-button',
      eventName: 'clearSponsorBlockSegments',
      iconPath: PlayerIcons.SPONSORBLOCK_DELETE,
      labelKey: 'Video.Player.SponsorBlock.ClearSegments',
      type: 'clear'
    })
  }
}
