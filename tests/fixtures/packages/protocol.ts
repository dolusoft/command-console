// A consumer of the protocol only (a server that answers with console
// responses, a tool that tokenizes lines, a transport that carries
// envelopes): it uses every runtime export (P8).
import {
  checkInputSchema,
  type CommandResponse,
  dataMaxBytes,
  type Envelope,
  envelopeBytes,
  envelopeMaxBytes,
  formatCommandLine,
  type InputSchema,
  inputLimits,
  isJsonValue,
  parseEnvelope,
  parseOptions,
  quoteArgument,
  tokenize,
  validateInput
} from '@dolusoft/command-protocol'

const schema: InputSchema = {
  type: 'object',
  properties: {
    ip: { type: 'string', maxLength: inputLimits.maxTextLength },
    limit: { type: 'integer', minimum: 1, default: 100 }
  },
  required: ['ip']
}
checkInputSchema(schema)

const line = document.body.dataset.line ?? ''
const result = tokenize(line)
const options = parseOptions(
  result.tokens.slice(1).map(t => t.value),
  schema
)
const args = options.ok ? options.value : { ip: '' }
const envelope: Envelope = {
  v: 1,
  id: '1',
  kind: 'request',
  actor: 'user',
  from: { tab: 't' },
  target: { tab: 't' },
  command: 'search',
  args
}
const echo = parseEnvelope(JSON.parse(JSON.stringify(envelope)))
const response: CommandResponse = {
  output: [
    { type: 'list', items: result.tokens.map(t => quoteArgument(t.value)) },
    {
      type: 'text',
      text: validateInput(schema, args).ok
        ? formatCommandLine('search', args, schema)
        : ''
    }
  ],
  tone:
    result.ok && echo.ok && envelopeBytes(envelope) <= envelopeMaxBytes
      ? 'default'
      : 'error',
  ...(JSON.stringify(args).length <= dataMaxBytes ? { data: args } : {})
}

document.body.textContent = isJsonValue(response)
  ? JSON.stringify(response)
  : ''
