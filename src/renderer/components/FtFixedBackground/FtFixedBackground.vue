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
   to be positioned. A transformed ancestor, such as a watch layout area
   during the theater mode animation, contains the fixed layer instead of the
   viewport; it sets --fixed-background-inset to cover the viewport again. */
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

/* The parent can't hide its own background without border-area, and Firefox's
   clip-path doesn't clip the fixed field to the corners, so the parent paints
   it with a fixed attachment, see --fixed-background-host-attachment. */
@supports not (background-clip: border-area) {
  .fixedBackgroundLayer {
    display: none;
  }
}

.fixedBackgroundLayer::before {
  content: '';
  position: fixed;
  inset: var(--fixed-background-inset, 0);
  background-color: inherit;
  background-image: inherit;
}

/* An ancestor that keeps a transform hint, such as an Android page that keeps
   its layer for Back, contains the fixed layer for good, and a fixed
   attachment then scrolls with the parent. So the layer paints the field
   there, also without border-area. The ancestor names view timelines of
   itself, vertical first, in --fixed-background-timelines. Their progress
   moves the layer from the ancestor's corner to the viewport's on the
   compositor, also while the page scrolls. The ranges reach further than
   any page, and their keyframes move the layer by as much as they cover. */
@container style(--fixed-background-timelines) {
  .fixedBackgroundLayer {
    display: var(--fixed-background-display, none);
  }

  /* The field lines up with the viewport, which the timelines measure physically. */
  .fixedBackgroundLayer::before {
    /* stylelint-disable-next-line liberty/use-logical-spec */
    inset: 0 auto auto 0;
    inline-size: 100vw;
    block-size: 100vh;
    animation: fixed-background-follow-y linear both, fixed-background-follow-x linear both;
    animation-timeline: var(--fixed-background-timelines);
    animation-range: exit-crossing -1000000px exit-crossing 1000000px;
  }
}

@keyframes fixed-background-follow-y {
  from { translate: 0 -1000000px; }
  to { translate: 0 1000000px; }
}

@keyframes fixed-background-follow-x {
  from { transform: translateX(-1000000px); }
  to { transform: translateX(1000000px); }
}
</style>

<style>
/* Without border-area the parent still paints its own background. As a
   stacking context it paints the layer above that background, still below
   its content. Pages render dropdowns outside, so nothing is trapped. */
@container style(--fixed-background-timelines) and style(--fixed-background-display: block) {
  :has(> .fixedBackgroundLayer) {
    isolation: isolate;

    --fixed-background-host-attachment: scroll;
  }
}
</style>
