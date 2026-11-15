# Shaka player customizations

## Overflow-menu controls

Custom overflow-menu controls must hide while a submenu is open: override `checkAvailability()` and toggle `shaka-hidden` from `isSubMenuOpened`, which `shaka.ui.Element` updates on `submenuopen` / `submenuclose`.

## Upgrading shaka-player

When `shaka-player` changes version, including through an upstream merge, diff the old and new `ui/` sources and check our customizations against them. A passing E2E suite missed the 5.3 regressions. Check:

- icon constants by how Shaka's own buttons use them, not by name (5.3 swapped the meaning of `LOOP` and `UNLOOP`);
- the signatures of methods our subclasses override, passing new arguments through to `super` (5.3 added `onChangeStart(fromTouchEvent)`);
- our CSS overrides against Shaka's new rules, including pseudo-elements (5.3 moved the submenu chevron to `::after`);
- how often Shaka dispatches the events we react to, and where it moves focus (5.3 sends `submenuclose` on every seek bar input and focuses the player container);
- that every hunk of `patches/shaka-player@<version>.patch` is ported to both the `ui/` source and the compiled `dist/shaka-player.ui-es2021.js` the app runs.
