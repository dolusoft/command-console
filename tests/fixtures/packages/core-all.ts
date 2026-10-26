// A console with every optional feature (recall, completion, context): what
// an app pays for the engine with all its features (P8). Each feature piece
// adds its feature here and raises the budget.
import { contextFeature, createConsole } from '@dolusoft/command-console-core'

const console = createConsole({
  features: { contextFeature },
  commands: [
    { name: 'echo', run: request => request.rest },
    {
      name: 'db',
      run: () => ({
        effects: [{ type: 'push-context', frame: { id: 'db', prompt: 'db>' } }]
      })
    },
    { name: 'end', run: () => ({ effects: [{ type: 'pop-context' }] }) }
  ]
})
console.subscribe(state => {
  document.body.textContent = JSON.stringify([state.entries, state.context])
})
void console.run('db').then(() => console.run('echo hello'))
console.resetContext()
