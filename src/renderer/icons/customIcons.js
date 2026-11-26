// Glyphs for concepts neither icon pack covers, in Iconify's format. They are
// registered as `otx:<name>` and used with the `fac` prefix, for example
// `['fac', 'playlist-add']`. Each paints in one color, so it matches the pack
// icons around it.
export const CUSTOM_ICONS = {
  // DeArrow's logo: three nested circles, the middle one lighter (24x24 grid)
  dearrow: {
    width: 24,
    height: 24,
    body: '<path fill="currentColor" fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20m0 3.1a6.9 6.9 0 1 0 0 13.8a6.9 6.9 0 1 0 0-13.8"/><path fill="currentColor" fill-opacity=".45" fill-rule="evenodd" d="M12 5.1a6.9 6.9 0 1 0 0 13.8a6.9 6.9 0 1 0 0-13.8m0 3.7a3.2 3.2 0 1 0 0 6.4a3.2 3.2 0 1 0 0-6.4"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>'
  },
  // Fluxer brand mark (from Simple Icons, 24x24 grid)
  fluxer: {
    width: 24,
    height: 24,
    body: '<path fill="currentColor" d="M12 0c6.627 0 12 5.373 12 12s-5.373 12-12 12S0 18.627 0 12S5.373 0 12 0M8.79 12.471q-1.092 0-2.078.493q-.975.493-1.586 1.575q-.395.712-.52 1.726c-.078.626.448 1.135 1.079 1.135c.645 0 1.128-.543 1.284-1.17q.133-.531.429-.844q.568-.6 1.435-.6q.58 0 1.061.289q.482.279 1.254.954q1.178 1.038 2.078 1.51q.9.46 1.993.461q1.093 0 2.079-.493q.985-.492 1.596-1.575q.404-.714.522-1.734c.072-.623-.455-1.127-1.083-1.127c-.65 0-1.134.549-1.307 1.176a2.1 2.1 0 0 1-.382.774q-.535.665-1.468.665q-.579 0-1.05-.279q-.46-.29-1.264-.964q-1.19-.996-2.09-1.479a4 4 0 0 0-1.982-.493M8.79 6q-1.092 0-2.078.493q-.975.492-1.586 1.575q-.395.712-.52 1.726c-.078.625.448 1.135 1.079 1.135c.645 0 1.128-.543 1.284-1.17q.133-.533.429-.845q.568-.6 1.435-.6q.58 0 1.061.29q.482.278 1.254.953q1.178 1.04 2.078 1.51q.9.462 1.993.462t2.079-.493q.985-.493 1.596-1.575q.404-.716.522-1.734c.072-.624-.455-1.127-1.083-1.127c-.65 0-1.134.549-1.307 1.175a2.1 2.1 0 0 1-.382.775q-.535.664-1.468.664q-.579 0-1.05-.278q-.46-.29-1.264-.965q-1.19-.996-2.09-1.478A4 4 0 0 0 8.79 6"/>'
  },
  // A row of tabs above a content pane
  'horizontal-tabs': {
    width: 512,
    height: 512,
    body: '<path fill="currentColor" d="M24 64H120A24 24 0 0 1 144 88V136A24 24 0 0 1 120 160H24A24 24 0 0 1 0 136V88A24 24 0 0 1 24 64zM208 64H304A24 24 0 0 1 328 88V136A24 24 0 0 1 304 160H208A24 24 0 0 1 184 136V88A24 24 0 0 1 208 64zM392 64H488A24 24 0 0 1 512 88V136A24 24 0 0 1 488 160H392A24 24 0 0 1 368 136V88A24 24 0 0 1 392 64zM32 208H480A32 32 0 0 1 512 240V416A32 32 0 0 1 480 448H32A32 32 0 0 1 0 416V240A32 32 0 0 1 32 208z"/>'
  },
  // Matrix brand mark (from Simple Icons, 24x24 grid)
  matrix: {
    width: 24,
    height: 24,
    body: '<path fill="currentColor" d="M.632.55v22.9H2.28V24H0V0h2.28v.55zm7.043 7.26v1.157h.033a3.3 3.3 0 0 1 1.117-1.024c.433-.245.936-.365 1.5-.365q.81.002 1.481.314c.448.208.785.582 1.02 1.108q.382-.562 1.034-.992q.651-.43 1.546-.43q.679 0 1.26.167c.388.11.716.286.993.53c.276.245.489.559.646.951q.229.587.23 1.417v5.728h-2.349V11.52q0-.43-.032-.812a1.8 1.8 0 0 0-.18-.66a1.1 1.1 0 0 0-.438-.448q-.292-.165-.785-.166q-.498 0-.803.189a1.4 1.4 0 0 0-.48.499a2 2 0 0 0-.231.696a6 6 0 0 0-.06.785v4.768h-2.35v-4.8q.002-.38-.018-.752a2.1 2.1 0 0 0-.143-.688a1.05 1.05 0 0 0-.415-.503c-.194-.125-.476-.19-.854-.19q-.168 0-.439.074c-.18.051-.36.143-.53.282a1.64 1.64 0 0 0-.439.595q-.18.39-.18 1.02v4.966H5.46V7.81zm15.693 15.64V.55H21.72V0H24v24h-2.28v-.55z"/>'
  },
  // Playlist rows with an add badge, shown while a video is not in any playlist
  'playlist-add': {
    width: 512,
    height: 512,
    body: '<path fill="currentColor" d="M86 85H426A22 22 0 0 1 426 129H86A22 22 0 0 1 86 85zM86 191H426A22 22 0 0 1 426 235H86A22 22 0 0 1 86 191zM86 298H198A22 22 0 0 1 198 342H86A22 22 0 0 1 86 298zM490 373A117 117 0 1 1 256 373A117 117 0 1 1 490 373zM448 373A75 75 0 1 0 298 373A75 75 0 1 0 448 373zM343 353H403A20 20 0 0 1 403 393H343A20 20 0 0 1 343 353zM353 343A20 20 0 0 1 393 343V403A20 20 0 0 1 353 403z"/>'
  },
  // Playlist rows with a check badge, shown once the video is in at least one playlist
  'playlist-check': {
    width: 512,
    height: 512,
    body: '<path fill="currentColor" d="M86 85H426A22 22 0 0 1 426 129H86A22 22 0 0 1 86 85zM86 191H426A22 22 0 0 1 426 235H86A22 22 0 0 1 86 191zM86 298H198A22 22 0 0 1 198 342H86A22 22 0 0 1 86 298zM490 373A117 117 0 1 1 256 373A117 117 0 1 1 490 373zM327.1 358.9L298.9 387.1L357 445.2L451.1 351.1L422.9 322.9L357 388.8z"/>'
  },
  // "off" icons, for AiSList's filtering of AI-generated videos (24x24 grid)
  'robot-slash': {
    width: 24,
    height: 24,
    body: '<mask id="robot-slash-gap"><rect width="24" height="24" fill="#fff"/><path d="M2.5 2.5L21.5 21.5" stroke="#000" stroke-width="5" stroke-linecap="round"/></mask><path fill="currentColor" mask="url(#robot-slash-gap)" d="M5 21q-.425 0-.712-.288T4 20v-4q0-.825.588-1.412T6 14h12q.825 0 1.413.588T20 16v4q0 .425-.288.713T19 21zm4-8q-2.075 0-3.537-1.463T4 8t1.463-3.537T9 3h6q2.075 0 3.538 1.463T20 8t-1.463 3.538T15 13zm-3 6h12v-3H6zm3-8h6q1.25 0 2.125-.875T18 8t-.875-2.125T15 5H9q-1.25 0-2.125.875T6 8t.875 2.125T9 11m.713-2.287Q10 8.425 10 8t-.288-.712T9 7t-.712.288T8 8t.288.713T9 9t.713-.288m6 0Q16 8.426 16 8t-.288-.712T15 7t-.712.288T14 8t.288.713T15 9t.713-.288M12 8"/><path d="M3 3L21 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  },
  // SponsorBlock's logo: a shield with a play triangle (the player's 565x565 grid)
  sponsorblock: {
    width: 565,
    height: 565,
    body: '<path fill="currentColor" fill-rule="evenodd" d="M 284.70508 42.693359 A 479.9 479.9 0 0 0 54.369141 100.41992 A 22.53 22.53 0 0 0 42.669922 120.41992 C 45.069922 290.25992 135.67008 438.63977 270.83008 522.00977 A 22.48 22.48 0 0 0 294.32031 522.00977 C 429.48031 438.63977 520.08047 290.25992 522.48047 120.41992 A 22.53 22.53 0 0 0 510.7793 100.41992 A 479.9 479.9 0 0 0 284.70508 42.693359 z M 220.41016 145.74023 L 411.2793 255.93945 L 220.41016 366.14062 L 220.41016 145.74023 z"/>'
  },
  // A column of stacked tabs beside a content pane
  'vertical-tabs': {
    width: 512,
    height: 512,
    body: '<path fill="currentColor" d="M24 64H120A24 24 0 0 1 144 88V136A24 24 0 0 1 120 160H24A24 24 0 0 1 0 136V88A24 24 0 0 1 24 64zM24 208H120A24 24 0 0 1 144 232V280A24 24 0 0 1 120 304H24A24 24 0 0 1 0 280V232A24 24 0 0 1 24 208zM24 352H120A24 24 0 0 1 144 376V424A24 24 0 0 1 120 448H24A24 24 0 0 1 0 424V376A24 24 0 0 1 24 352zM224 64H480A32 32 0 0 1 512 96V416A32 32 0 0 1 480 448H224A32 32 0 0 1 192 416V96A32 32 0 0 1 224 64z"/>'
  }
}
