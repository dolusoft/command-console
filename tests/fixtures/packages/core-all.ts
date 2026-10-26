// A console with every optional feature (recall, completion, context): what
// an app pays for the engine with all its features. Each feature piece adds
// its feature here and uses one of its methods (P8).
import { createConsole, recallFeature } from '@dolusoft/command-console-core'

const console = createConsole({
  features: { recallFeature },
  commands: [{ name: 'echo', run: request => request.rest }]
})
console.subscribe(state => {
  document.body.textContent = JSON.stringify([state.entries, state.recall])
})
void console.run('echo hello').then(() => console.recallPrevious())
