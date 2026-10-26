// A consumer that draws its own markup from `useCommandConsole()`, importing
// the package by name through its `exports` map. While the package is empty
// the fixture keeps every export through the namespace; the Vue piece
// replaces it with a real use of the composable (P8). Built by
// `pnpm measure:consumer-size`; never part of the package.
import { createApp, h } from 'vue'

import * as vuePackage from '@dolusoft/command-console'

createApp({
  render: () => h('div', JSON.stringify(Object.keys(vuePackage)))
}).mount('#app')
