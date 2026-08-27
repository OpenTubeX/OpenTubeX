<template>
  <div class="sliderGrid">
    <slot />
  </div>
</template>

<style scoped>
.sliderGrid {
  --slider-gap: 24px;

  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--slider-gap);
}

.sliderGrid :deep(.pure-material-slider) {
  box-sizing: border-box;
  flex: 1 1 180px;
  max-inline-size: 380px;
  inline-size: auto;

  /* The gap already spaces them out, and their own margin would count towards
     how many fit in a row. */
  margin-inline: 0;
}

/* Up to four sliders fill a row evenly, but a fifth would sit alone on the next
   one while the others are squeezed together. Sizing them as thirds of the row
   splits them into rows of at most three, all the same width, with more room
   for each label. */
.sliderGrid:has(:nth-child(5)) :deep(.pure-material-slider) {
  --slider-size: clamp(
    180px,
    calc((100% - 2 * var(--slider-gap)) / 3),
    380px
  );

  flex-basis: var(--slider-size);
  max-inline-size: var(--slider-size);
}
</style>
