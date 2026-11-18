<template>
  <div
    class="ft-card"
    :class="{ fixedBackground }"
  >
    <slot />
    <FtFixedBackground v-if="fixedBackground" />
  </div>
</template>

<script src="./ft-card.js" />
<style scoped src="./ft-card.css" />
