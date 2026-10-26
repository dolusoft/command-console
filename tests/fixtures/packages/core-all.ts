// A console with every optional feature (recall, completion, context): what
// an app pays for the engine with all its features. Each feature piece adds
// its feature here and uses one of its methods (P8).
import {
  completionFeature,
  createConsole,
  recallFeature
} from '@dolusoft/command-console-core'

const console = createConsole({
  features: { recallFeature, completionFeature },
  commands: [
    {
      name: 'echo',
      run: request => request.rest,
      complete: request =>
        ['hello', 'help'].filter(word => word !== request.prefix)
    }
  ]
})
console.subscribe(state => {
  document.body.textContent = JSON.stringify([
    state.entries,
    state.recall,
    state.completion
  ])
})
console.setInput('echo he')
console.complete()
void console.run('echo hello').then(() => console.recallPrevious())
