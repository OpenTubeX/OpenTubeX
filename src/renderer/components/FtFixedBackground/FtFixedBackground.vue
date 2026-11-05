<template>
  <div class="fixedBackgroundLayer" />
</template>

<style scoped>
/* Chromium repaints a background with a fixed attachment on every scroll frame
   unless it is a single layer without rounded corners or shadows, and never
   composites one on low-DPI screens to keep subpixel text. Themes whose
   layered fields would repaint the feed on every frame paint them here: in a
   fixed layer the compositor keeps in place, clipped to the parent's corners.
   The parent keeps declaring its background image, which this inherits, with
   a zero background-size so it does not paint the image itself. It must be
   positioned and a stacking context. */
.fixedBackgroundLayer {
  display: var(--fixed-background-display, none);
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  clip-path: border-box;
  pointer-events: none;
  background-image: inherit;
  background-size: 0 0;
}

.fixedBackgroundLayer::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image: inherit;
}
</style>
