// A consumer of the protocol only (a server that answers with console
// responses, a tool that tokenizes lines). While the package is empty the
// fixture keeps every export through the namespace; the protocol piece
// replaces it with real calls (P8).
import * as protocol from '@dolusoft/command-protocol'

document.body.textContent = JSON.stringify(Object.keys(protocol))
