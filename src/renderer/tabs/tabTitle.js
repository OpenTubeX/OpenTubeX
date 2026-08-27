import packageDetails from '@root/package.json'

const PRODUCT_NAME_SUFFIX = ` - ${packageDetails.productName}`

/**
 * Remove the app name appended to document titles when displaying a tab title.
 * @param {string | null | undefined} title
 * @returns {string | null | undefined}
 */
export function formatTabTitle(title) {
  return title?.endsWith(PRODUCT_NAME_SUFFIX)
    ? title.slice(0, -PRODUCT_NAME_SUFFIX.length)
    : title
}
