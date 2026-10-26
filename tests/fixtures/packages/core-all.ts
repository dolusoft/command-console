// A console with every optional feature (recall, completion, context): what
// an app pays for the engine with all its features (P8). Each feature piece
// adds its feature here, uses one of its methods and raises the budget.
import {
  completionFeature,
  contextFeature,
  createConsole,
  recallFeature
} from '@dolusoft/command-console-core'

const console = createConsole({
  features: { completionFeature, contextFeature, recallFeature },
  commands: [
    {
      name: 'echo',
      run: request => request.rest,
      complete: request =>
        ['hello', 'help'].filter(word => word !== request.prefix)
    },
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
  document.body.textContent = JSON.stringify([
    state.entries,
    state.context,
    state.recall,
    state.completion
  ])
})
console.setInput('echo he')
console.complete()
void console
  .run('db')
  .then(() => console.run('echo hello'))
  .then(() => console.recallPrevious())
console.resetContext()
