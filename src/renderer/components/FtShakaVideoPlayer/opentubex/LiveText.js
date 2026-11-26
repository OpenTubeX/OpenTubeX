/**
 * Renders frequently changing text in its own render, so a ticking value,
 * like a countdown, doesn't render the whole player template again.
 * Pass a getter that reads the value: `:text="() => label"`.
 */
export default {
  name: 'LiveText',
  props: {
    text: { type: Function, required: true }
  },
  setup: props => () => props.text()
}
