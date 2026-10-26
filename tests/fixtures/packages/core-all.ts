// A console with every optional feature (recall, completion, context): what
// an app pays for the engine with all of them (P8). Each feature, when it
// lands, adds itself to `features` and uses one of its methods.
import {
  completionFeature,
  consoleFeatures,
  createConsole
} from '@dolusoft/command-console-core'

const features = consoleFeatures({ completionFeature })

const console = createConsole({
  features,
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
  document.body.textContent = JSON.stringify([state.entries, state.completion])
})
console.setInput('echo he')
console.complete()
void console.run('echo hello')
