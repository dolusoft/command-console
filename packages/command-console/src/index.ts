// @dolusoft/command-console: a headless command console for Vue 3.
// `useCommandConsole` is the console without markup; `CommandConsole` draws
// it as the DOM of `contract/dom.ts`. No CSS (P5).
import CommandConsole from './command-console.vue'

export { CommandConsole }
export default CommandConsole

export { useCommandConsole } from './use-command-console'

export type * from './contract'
