import { PlayerIcons } from '../../../../constants'
import { SponsorBlockControlButton } from './SponsorBlockControlButton'

export class SponsorBlockOpenMenuButton extends SponsorBlockControlButton {
  constructor(events, parent, controls) {
    super(events, parent, controls, {
      className: 'sponsorblock-open-menu-button',
      eventName: 'toggleSponsorBlockSubmissionMenu',
      iconPath: PlayerIcons.SPONSORBLOCK_UPLOAD,
      labelKey: 'Video.Player.SponsorBlock.OpenSubmissionMenu',
      type: 'menu'
    })
  }
}
