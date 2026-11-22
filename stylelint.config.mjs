import logicalSpec from 'stylelint-use-logical-spec'
import a11y from '@double-great/stylelint-a11y'
import highPerformanceAnimation from 'stylelint-high-performance-animation'
import noLayoutAnimation from './_scripts/stylelintNoLayoutAnimation.mjs'

/** @type {import('stylelint').Config} */
export default {
  plugins: [logicalSpec, ...a11y, highPerformanceAnimation, noLayoutAnimation],
  extends: ['stylelint-config-standard', 'stylelint-config-sass-guidelines'],
  languageOptions: {
    syntax: {
      properties: {
        // @csstools/css-syntax-patches-for-csstree still spells these keywords
        // `anchor-valid` and `anchor-visible`; the spec and Chromium use `anchors-`.
        'position-visibility': 'always | [ anchors-valid || anchors-visible || no-overflow ]'
      }
    }
  },
  overrides: [
    {
      files: '**/*.scss',
      customSyntax: 'postcss-scss',
      rules: {
        'at-rule-prelude-no-invalid': [
          true,
          { ignoreAtRules: ['mixin'] }
        ],
        'max-nesting-depth': null,
        'selector-max-compound-selectors': null
      }
    },
    {
      files: '**/*.css',
      rules: { }
    },
    {
      files: '**/*.vue',
      customSyntax: 'postcss-html',
      rules: {
        // Vue compiles v-bind() in <style> blocks to a custom property.
        'declaration-property-value-no-unknown': [
          true,
          { ignoreProperties: { '/.+/': '/^v-bind\\(/' } }
        ],
        'value-keyword-case': ['lower', { ignoreFunctions: ['v-bind'] }]
      }
    }
  ],
  rules: {
    'selector-no-qualifying-type': [
      true,
      {
        ignore: ['attribute']
      }
    ],
    'selector-class-pattern': null,
    'selector-id-pattern': null,
    'selector-pseudo-class-no-unknown': [
      true,
      {
        ignorePseudoClasses: ['deep', 'global']
      }
    ],
    // Vue's scoped CSS drops everything after a leading :global(...), so `:global(.a) .b` styles `.a`.
    'selector-disallowed-list': [
      [/:global\((?:[^()]|\([^()]*\))*\)\s*[^\s,]/],
      { splitList: true, message: 'Write `.a .b` instead of `:global(.a) .b`; Vue drops the selector after :global(...)' }
    ],
    // Chromium 119, the WebView our Android 8 tests use, can crash the renderer on these.
    'declaration-property-value-disallowed-list': [
      { '/.*/': [/\bfrom\s+color-mix\(/] },
      { message: 'Mix relative colors instead of taking a relative color of a color-mix(); Chromium 119 can crash on it' }
    ],
    'a11y/no-outline-none': true,
    // Sizes and positions animate on the main thread, which lays out and renders
    // the page on every frame. Animate transform, opacity, clip-path or filter
    // instead, or explain why the layout itself has to move.
    'plugin/no-low-performance-animation-properties': [true, {
      ignore: 'paint-properties',
      ignoreProperties: ['display', 'visibility', 'content-visibility', 'overlay']
    }],
    // Logical shorthands, flex and grid tracks, and transitions in variables,
    // which the rule above misses.
    'opentubex/no-layout-animation-properties': [true, {
      ignoreProperties: ['display', 'visibility', 'content-visibility', 'overlay']
    }],
    'liberty/use-logical-spec': ['always']
  }
}
