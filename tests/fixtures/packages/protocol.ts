// A consumer of the protocol only (a server that answers with console
// responses, a tool that tokenizes lines): it uses every runtime export
// (P8).
import {
  type CommandResponse,
  isJsonValue,
  quoteArgument,
  tokenize
} from '@dolusoft/command-protocol'

const line = document.body.dataset.line ?? ''
const result = tokenize(line)
const response: CommandResponse = {
  output: [
    { type: 'list', items: result.tokens.map(t => quoteArgument(t.value)) }
  ],
  tone: result.ok ? 'default' : 'error'
}

document.body.textContent = isJsonValue(response)
  ? JSON.stringify(response)
  : ''
