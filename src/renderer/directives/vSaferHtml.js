import DOMPurify from 'dompurify'

const USE_NATIVE_SANITIZER = process.env.IS_ELECTRON || ('Sanitizer' in window && typeof HTMLElement.prototype.setHTML === 'function')

let sanitizer
let lenientSanitizer
/** @type {import('dompurify').Config | undefined} */
let domPurifyStrictConfig

/** @type {import('vue').FunctionDirective<HTMLElement, string, 'lenient'>} */
export const vSaferHtml = (element, { value, oldValue, modifiers }) => {
  if (oldValue === null || value !== oldValue) {
    if (modifiers.lenient) {
      if (USE_NATIVE_SANITIZER) {
        if (lenientSanitizer === undefined) {
          lenientSanitizer = new Sanitizer({
            comments: false,
            elements: [
              'blockquote', 'br', 'code', 'del', 'details', 'em',
              'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'kbd',
              'p', 'pre', 's', 'strong', 'summary',
              'table', 'tbody', 'td', 'th', 'thead', 'tr',
              'ul',
              {
                name: 'a',
                attributes: ['href', 'title']
              },
              {
                name: 'img',
                attributes: ['alt', 'height', 'loading', 'src', 'title', 'width']
              },
              {
                name: 'li',
                attributes: ['value']
              },
              {
                name: 'ol',
                attributes: ['start']
              }
            ]
          })
        }

        element.setHTML(value, { sanitizer: lenientSanitizer })
      } else {
        element.innerHTML = DOMPurify.sanitize(value, { RETURN_TRUSTED_TYPE: false })
      }
    } else if (USE_NATIVE_SANITIZER) {
      // Use a much stricter sanitzer configuration, should be used in most places
      if (sanitizer === undefined) {
        sanitizer = new Sanitizer({
          comments: false,
          elements: [
            'br',
            'b',
            'i',
            's',
            {
              name: 'a',
              attributes: ['data-time', 'dir', 'href', 'lang', 'tabindex']
            },
            // live chat emojis (see parseLocalTextRuns)
            {
              name: 'img',
              attributes: ['alt', 'height', 'loading', 'src', 'style', 'title', 'width']
            }
          ]
        })
      }

      element.setHTML(value, { sanitizer })
    } else {
      if (domPurifyStrictConfig === undefined) {
        domPurifyStrictConfig = {
          ALLOWED_TAGS: ['br', 'b', 'i', 's', 'a', 'img'],
          ALLOWED_ATTR: ['alt', 'data-time', 'dir', 'height', 'href', 'lang', 'loading', 'src', 'style', 'tabindex', 'title', 'width']
        }
      }

      element.innerHTML = DOMPurify.sanitize(value, domPurifyStrictConfig)
    }
  }
}
