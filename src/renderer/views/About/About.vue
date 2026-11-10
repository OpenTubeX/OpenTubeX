<template>
  <div class="about">
    <section class="brand">
      <FtLogoFull class="logo" />
      <div class="version">
        {{ versionNumber }} {{ $t("About.Beta") }}
      </div>
      <div
        v-if="commitId"
        class="commit"
      >
        {{ commitLabel }}
        <a
          :href="commitUrl"
          :title="buildCommit"
        >{{ commitId }}</a>
      </div>
      <dl
        v-if="runtimeVersions"
        class="runtimeVersions"
      >
        <div
          v-for="runtime in runtimeVersions"
          :key="runtime.name"
          class="runtimeVersion"
        >
          <dt>{{ runtime.name }}</dt>
          <dd>{{ runtime.version }}</dd>
        </div>
      </dl>
    </section>
    <section class="about-chunks">
      <figure
        v-for="chunk in chunks"
        :key="chunk.title"
        class="chunk"
      >
        <FtIcon
          class="icon"
          :icon="chunk.icon"
        />
        <h3 class="title">
          {{ chunk.title }}
        </h3>
        <div class="content">
          <div
            v-for="(line, index) in chunk.lines"
            :key="index"
            class="links"
          >
            <span
              v-for="item in line"
              :key="item.href"
              class="linkItem"
            >
              <a
                :href="item.href"
                :lang="item.lang"
                class="link"
              >
                <FtIcon
                  :icon="item.icon"
                  class="linkIcon"
                />{{ item.label }}</a>
              <span
                v-if="item.license"
                class="license"
              >
                <a :href="item.license.href">{{ item.license.label }}</a>
              </span>
            </span>
          </div>
          <div
            v-if="chunk.note"
            class="note"
          >
            {{ chunk.note }}
          </div>
        </div>
      </figure>
    </section>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtLogoFull from '../../components/FtLogoFull/FtLogoFull.vue'
import { getNightlyCommit } from '../../helpers/versionDisplay.js'

import packageDetails from '../../../../package.json'

const { t } = useI18n()

const versionNumber = `v${packageDetails.version}`
const buildCommit = process.env.BUILD_COMMIT
const commitId = getNightlyCommit(packageDetails.version, buildCommit)
const commitLabel = `${t('About.Commit')}:`
const commitUrl = `https://github.com/OpenTubeX/OpenTubeX/commit/${buildCommit}`
const runtimeVersions = process.env.IS_ELECTRON
  ? [
      { name: 'Electron', version: window.ftElectron.runtimeVersions.electron },
      { name: 'Chromium', version: window.ftElectron.runtimeVersions.chromium },
      { name: 'Node.js', version: window.ftElectron.runtimeVersions.node },
      { name: 'V8', version: window.ftElectron.runtimeVersions.v8 }
    ]
  : null

const chunks = computed(() => [
  {
    icon: ['fas', 'cube'],
    title: t('About.Project'),
    lines: [
      [
        { icon: ['fas', 'globe'], label: t('About.Website'), href: 'https://opentubex.org/' },
        { icon: ['fas', 'file-download'], label: t('About.Downloads'), href: 'https://opentubex.org/downloads/' },
        { icon: ['fas', 'file-lines'], label: t('About.Changelog'), href: 'https://opentubex.org/changelog/' },
      ],
      [{ icon: ['fab', 'github'], label: t('About.GitHub releases'), href: 'https://github.com/OpenTubeX/OpenTubeX/releases' }],
    ],
  },
  {
    icon: ['fas', 'question-circle'],
    title: t('About.Help'),
    lines: [
      [
        { icon: ['fas', 'book-open'], label: t('About.Documentation'), href: 'https://opentubex.org/docs/' },
        { icon: ['fas', 'comment'], label: t('About.Discussions'), href: 'https://github.com/OpenTubeX/OpenTubeX/discussions/' },
      ],
      [{ icon: ['fas', 'exclamation-circle'], label: t('About.Report a problem'), href: 'https://github.com/OpenTubeX/OpenTubeX/issues' }],
    ],
    note: t('About.Please check for duplicates before posting'),
  },
  {
    icon: ['fas', 'users'],
    title: t('About.Community'),
    lines: [
      [
        { icon: ['fac', 'fluxer'], label: 'Fluxer', href: 'https://fluxer.opentubex.org', lang: 'en' },
        { icon: ['fac', 'matrix'], label: t('About.Matrix'), href: 'https://matrix.opentubex.org' },
      ],
    ],
  },
  {
    icon: ['fas', 'puzzle-piece'],
    title: t('About.Contribute'),
    lines: [
      [
        {
          icon: ['fab', 'github'],
          label: t('About.Source code'),
          href: 'https://github.com/OpenTubeX/OpenTubeX',
          license: { label: t('About.AGPLv3'), href: 'https://www.gnu.org/licenses/agpl-3.0.en.html' },
        },
      ],
      [
        { icon: ['fas', 'language'], label: t('About.Translate'), href: 'https://weblate.opentubex.org/engage/opentubex/' },
        { icon: ['fas', 'heart'], label: t('About.Donate'), href: 'https://opentubex.org/donate/' },
      ],
    ],
  },
])
</script>

<style scoped src="./About.css" />
