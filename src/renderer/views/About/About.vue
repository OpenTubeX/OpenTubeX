<template>
  <div>
    <FtCard class="card">
      <h2>
        <FontAwesomeIcon
          :icon="['fas', 'info-circle']"
          class="headingIcon"
        />
        {{ $t("About.About") }}
      </h2>
      <section class="brand">
        <FtLogoFull class="logo" />
        <div class="version">
          {{ versionNumber }} {{ $t("About.Beta") }}
        </div>
      </section>
      <section class="about-chunks">
        <figure
          v-for="chunk in chunks"
          :key="chunk.title"
          class="chunk"
        >
          <FontAwesomeIcon
            class="icon"
            :icon="chunk.icon"
          />
          <h3 class="title">
            {{ chunk.title }}
          </h3>
          <div
            class="content"
            v-html="chunk.content"
          />
        </figure>
      </section>
    </FtCard>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed } from 'vue'
import { useI18n } from '../../composables/use-i18n-polyfill'

import FtCard from '../../components/ft-card/ft-card.vue'
import FtLogoFull from '../../components/FtLogoFull/FtLogoFull.vue'

import packageDetails from '../../../../package.json'

const { t } = useI18n()

const versionNumber = `v${packageDetails.version}`

const chunks = computed(() => [
  {
    icon: ['fab', 'github'],
    title: t('About.Source code'),
    content: `<a href="https://github.com/OpenTubeX/OpenTubeX" lang="en" dir="ltr">GitHub: OpenTubeX/OpenTubeX</a><br>${t('About.Licensed under the')} <a href="https://www.gnu.org/licenses/agpl-3.0.en.html">${t('About.AGPLv3')}</a>`
  },
  {
    icon: ['fas', 'file-download'],
    title: t('About.Downloads / Changelog'),
    content: `<a href="https://github.com/OpenTubeX/OpenTubeX/releases">${t('About.GitHub releases')}</a>`
  },
  {
    icon: ['fas', 'question-circle'],
    title: t('About.Help'),
    content: `<a href="https://github.com/OpenTubeX/OpenTubeX/discussions/">${t('About.Discussions')}</a>`
  },
  {
    icon: ['fas', 'exclamation-circle'],
    title: t('About.Report a problem'),
    content: `<a href="https://github.com/OpenTubeX/OpenTubeX/issues">${t('About.GitHub issues')}</a><br>${t('About.Please check for duplicates before posting')}`
  },
  {
    icon: ['fas', 'globe'],
    title: t('About.Website'),
    content: '<a href="https://opentubex.github.io/">https://opentubex.github.io/</a>'
  },
])
</script>

<style scoped src="./About.css" />
