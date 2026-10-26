// A console with the core features only (`createConsole({ commands })`,
// C-01): what an app pays for the engine, the four core features and the
// protocol's tokenizer.
import { createConsole } from '@dolusoft/command-console-core'

const console = createConsole({
  commands: [{ name: 'echo', run: request => request.rest }]
})
console.subscribe(state => {
  document.body.textContent = JSON.stringify(state.entries)
})
void console.run('echo hello')
