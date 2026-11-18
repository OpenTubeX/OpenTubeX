import { defineComponent } from 'vue'

import FtFixedBackground from '../FtFixedBackground/FtFixedBackground.vue'

export default defineComponent({
  name: 'FtCard',
  components: {
    FtFixedBackground
  },
  props: {
    // A fixed background follows the viewport only while no transform applies,
    // so cards that open with one keep their image attached to the card instead.
    fixedBackground: {
      type: Boolean,
      default: true
    }
  }
})
