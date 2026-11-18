import highPerformanceAnimation from 'stylelint-high-performance-animation'
import noLayoutAnimation from './_scripts/stylelintNoLayoutAnimation.mjs'
import { animationPerformanceRules } from './stylelint.config.mjs'

// The `<style>` blocks of Vue components only get the animation performance
// rules. The rest of stylelint.config.mjs has never applied to them.
/** @type {import('stylelint').Config} */
export default {
  customSyntax: 'postcss-html',
  plugins: [highPerformanceAnimation, noLayoutAnimation],
  rules: animationPerformanceRules
}
