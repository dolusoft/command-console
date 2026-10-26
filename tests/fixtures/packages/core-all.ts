// A console with every optional feature (recall, completion, context).
// While the package is empty the fixture keeps every export through the
// namespace; the core piece replaces it with a console built with all
// features (P8).
import * as core from '@dolusoft/command-console-core'

document.body.textContent = JSON.stringify(['all', ...Object.keys(core)])
