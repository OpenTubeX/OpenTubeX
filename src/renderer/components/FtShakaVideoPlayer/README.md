# Shaka player customizations

## Overflow-menu controls

Custom overflow-menu controls must hide while a submenu is open: override `checkAvailability()` and toggle `shaka-hidden` from `isSubMenuOpened`, which `shaka.ui.Element` updates on `submenuopen` / `submenuclose`.

## Controls visibility

Shaka keeps state that depends on `isOpaque()` in sync only through `showingui` and `hidingui`, which it dispatches only when the `shown` or `casting` attribute changes. Its range inputs (seek and volume bars) stay disabled after the controls were not opaque until the next `showingui`. When our code changes opacity any other way, such as `ui.setEnabled()` or setting or removing `shown` directly, dispatch the matching event once `isOpaque()` has changed. Test such changes from a paused player too: its controls stay shown throughout, so no transition announces them.

## Upgrading shaka-player

When `shaka-player` changes version, including through an upstream merge, diff the old and new `ui/` sources and check our customizations against them. A passing E2E suite missed the 5.3 regressions. Check:

- icon constants by how Shaka's own buttons use them, not by name (5.3 swapped the meaning of `LOOP` and `UNLOOP`);
- the signatures of methods our subclasses override, passing new arguments through to `super` (5.3 added `onChangeStart(fromTouchEvent)`);
- our CSS overrides against Shaka's new rules, including pseudo-elements (5.3 moved the submenu chevron to `::after`);
- how often Shaka dispatches the events we react to, and where it moves focus (5.3 sends `submenuclose` on every seek bar input and focuses the player container);
- which state Shaka now updates only on transitions or events, and whether our code changes that state without them (see Controls visibility);
- that every hunk of `patches/shaka-player@<version>.patch` is ported to both the `ui/` source and the compiled `dist/shaka-player.ui-es2021.js` the app runs.
