/**
 * Declares the custom properties that a package's lazily loaded CSS puts on
 * `:root` on its own container instead. New inherited properties on the root
 * restyle every element of the document when the CSS loads, such as the page
 * that the first Watch page of a session opens from.
 *
 * Only use it for CSS whose rules read the properties inside that container.
 * @this {import('@rspack/core').LoaderContext<{ selector: string }>}
 * @param {string} source
 */
module.exports = function (source) {
  const { selector } = this.getOptions()
  const scoped = source.replaceAll(/:root\s*{/g, `${selector} {`)
  if (scoped.includes(':root')) {
    throw new Error(`${this.resourcePath} uses :root in a way scope-root-variables-loader.js does not handle`)
  }
  return scoped
}
