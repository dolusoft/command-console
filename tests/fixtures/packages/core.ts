// A console with the core features only (`createConsole({ commands })`,
// C-01). While the package is empty the fixture keeps every export through
// the namespace; the core piece replaces it with a plain console (P8).
import * as core from '@dolusoft/command-console-core'

document.body.textContent = JSON.stringify(Object.keys(core))
