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
              'br', 'code', 'del', 'em',
              'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'kbd',
              'p', 'pre', 's', 'strong', 'summary',
              'table', 'tbody', 'td', 'th', 'thead', 'tr',
              'ul',
              {
                name: 'a',
                attributes: ['href', 'title']
              },
              {
                name: 'blockquote',
                attributes: ['data-alert']
              },
              {
                name: 'details',
                attributes: ['open']
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

        // Chromium doesn't set up the internal disclosure widget for details elements
        // that setHTML creates, so their summary stays invisible and they can't be
        // expanded. Recreating the elements makes them behave as expected.
        for (const details of element.querySelectorAll('details')) {
          const replacement = document.createElement('details')
          replacement.toggleAttribute('open', details.hasAttribute('open'))
          replacement.append(...details.childNodes)
          details.replaceWith(replacement)
        }
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
