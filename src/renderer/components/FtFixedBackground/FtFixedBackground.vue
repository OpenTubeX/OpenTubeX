<template>
  <div class="fixedBackgroundLayer" />
</template>

<style scoped>
/* Chromium repaints a background with a fixed attachment on every scroll frame
   unless it is a single layer without rounded corners or shadows, and never
   composites one on low-DPI screens to keep subpixel text. Themes whose
   layered fields would repaint the feed on every frame paint them here: in a
   fixed layer the compositor keeps in place, clipped to the parent's corners.
   The parent keeps declaring its background, which this inherits, and clips
   it to --fixed-background-host-clip so it does not paint it itself. The
   layer sits below the parent's content without making the parent a stacking
   context, which would trap the parent's dropdowns, so the parent only needs
   to be positioned. */
.fixedBackgroundLayer {
  display: var(--fixed-background-display, none);
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  clip-path: border-box;
  pointer-events: none;
  background-color: inherit;
  background-image: inherit;
  background-clip: border-area;
}

.fixedBackgroundLayer::before {
  content: '';
  position: fixed;
  inset: 0;
  background-color: inherit;
  background-image: inherit;
}
</style>
