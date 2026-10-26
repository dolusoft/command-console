// A consumer that renders `<CommandConsole>`, importing the package by name
// through its `exports` map. While the package is empty the fixture keeps
// every export through the namespace; the Vue piece replaces it with the
// component (P8). Built by `pnpm measure:consumer-size`; never part of the
// package.
import { createApp, h } from 'vue'

import * as vuePackage from '@dolusoft/command-console'

createApp({
  render: () =>
    h('div', JSON.stringify(['component', ...Object.keys(vuePackage)]))
}).mount('#app')
