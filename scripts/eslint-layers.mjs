// A local ESLint plugin for the layering of the three packages (ADR 0001,
// ADR 0002, PRINCIPLES P11, P14). `layers/boundaries` checks every module
// specifier of a file in packages/*/src: imports, `export ... from`
// re-exports, dynamic `import()`, `import('x')` types, `require()` and
// `import x = require()`, which must name a literal. `import.meta.glob` (and
// any `import.meta` call) is refused. Bare specifiers match exactly.
//
//   protocol  packages/command-protocol/src       imports no package
//   core      packages/command-console-core/src   the protocol only
//     store/                                     store/ only
//     shared/                                    shared/ and store/
//     core/                                      core/, shared/ and store/; never features/ or helpers/
//     features/<a>/                              features/<a>/, shared/ and store/; never features/<b>/
//     helpers/, the entry files (src/*.ts)       anything in core
//   vue       packages/command-console/src        the protocol, the core and vue
//
// Type-only imports (`import type`, `export type`, and imports whose every
// specifier is `type`) from core/ are allowed in shared/ and features/: a
// feature implements the internal feature interface and reads the console's
// types, which erase at build and couple no runtime code (ADR 0002
// keeps features off the core feature folders at runtime). A `type` import
// of another feature is still refused.
import { dirname, posix, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** Bare specifiers each package may import, exactly. */
const allowedSpecifiers = {
  'command-protocol': [],
  'command-console-core': ['@dolusoft/command-protocol'],
  'command-console': [
    '@dolusoft/command-protocol',
    '@dolusoft/command-console-core',
    'vue'
  ]
}

/** The parts of the core each part may reach by a relative import. */
const reach = {
  store: ['store'],
  shared: ['shared', 'store'],
  core: ['core', 'shared', 'store'],
  feature: ['shared', 'store'],
  helpers: null,
  entry: null
}

/** The parts that may import core/ for types only. */
const typesFromCore = new Set(['shared', 'feature'])

const toPosix = path => path.split(sep).join(posix.sep)

/**
 * Where a file sits: its package, its path under src/ (`rest`) and its part.
 * In command-console-core the part is `store`, `shared`, `core`, `helpers`,
 * `feature:<name>` or `entry`; elsewhere `all`. `null` outside
 * packages/*\/src.
 */
export const layerOf = file => {
  const path = toPosix(relative(root, resolve(file)))
  const match = /^packages\/([^/]+)\/src\/(.+)$/.exec(path)
  if (!match) {
    return null
  }
  const [, pkg, rest] = match
  if (pkg !== 'command-console-core') {
    return { pkg, rest, part: 'all' }
  }
  const feature = /^features\/([^/]+)(\/|$)/.exec(rest)
  if (feature) {
    return { pkg, rest, part: `feature:${feature[1]}` }
  }
  const folder = /^(store|shared|core|helpers)(\/|$)/.exec(rest)
  return { pkg, rest, part: folder ? folder[1] : 'entry' }
}

const isBare = specifier =>
  !specifier.startsWith('.') && !specifier.startsWith('/')

const kindOf = part => (part.startsWith('feature:') ? 'feature' : part)

/**
 * Why `specifier` may not be imported from `file`, or `null`. `typeOnly`
 * says the import brings types only.
 */
export const violation = (file, specifier, typeOnly = false) => {
  const from = layerOf(file)
  if (!from) {
    return null
  }
  if (isBare(specifier)) {
    const allowed = allowedSpecifiers[from.pkg]
    if ((allowed ?? []).includes(specifier)) {
      return null
    }
    return `${from.pkg} may import ${allowed?.length ? allowed.join(' and ') : 'no package'}, not "${specifier}"`
  }
  const target = layerOf(resolve(dirname(file), specifier))
  if (!target || target.pkg !== from.pkg) {
    return `"${specifier}" leaves packages/${from.pkg}/src: import another package by its name`
  }
  if (from.part === 'all') {
    return null
  }
  const kind = kindOf(from.part)
  const allowed = reach[kind]
  if (allowed === null) {
    return null
  }
  if (from.part === target.part) {
    return null
  }
  if (allowed.includes(target.part)) {
    return null
  }
  if (typeOnly && target.part === 'core' && typesFromCore.has(kind)) {
    return null
  }
  if (target.part.startsWith('feature:')) {
    if (kind === 'feature') {
      return `the ${from.part.slice('feature:'.length)} feature may not import "${specifier}": features talk through shared/ only (P14)`
    }
    return `${from.part}/ may not import "${specifier}": the core never depends on an optional feature (ADR 0002)`
  }
  const name =
    kind === 'feature' ? `the ${from.part.slice(8)} feature` : `${from.part}/`
  const types = typesFromCore.has(kind) ? ' (core/ for types only)' : ''
  return `${name} may not import "${specifier}": it reaches ${allowed.map(part => `${part}/`).join(', ')}${types} and itself`
}

/** Whether an import or export declaration brings types only. */
const isTypeOnly = node => {
  if (node.importKind === 'type' || node.exportKind === 'type') {
    return true
  }
  const specifiers = node.specifiers ?? []
  return (
    specifiers.length > 0 &&
    specifiers.every(
      item => item.importKind === 'type' || item.exportKind === 'type'
    )
  )
}

const boundaries = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keeps the layers pointing one way: protocol → core → vue, and inside the core features → shared/ → store/.'
    },
    schema: [],
    messages: {
      layer: '{{reason}} (P14).',
      dynamic:
        'A dynamic import() or require() must name a literal module, so the layering can be checked.',
      glob: 'import.meta.glob and the other import.meta calls name no module, so the layering cannot be checked: import each module by name.'
    }
  },
  create(context) {
    const file = context.filename
    if (!layerOf(file)) {
      return {}
    }
    const check = (node, source, typeOnly = false) => {
      if (!source) {
        return
      }
      if (source.type !== 'Literal' || typeof source.value !== 'string') {
        context.report({ node, messageId: 'dynamic' })
        return
      }
      const reason = violation(file, source.value, typeOnly)
      if (reason) {
        context.report({ node, messageId: 'layer', data: { reason } })
      }
    }
    const isImportMeta = node =>
      node?.type === 'MetaProperty' &&
      node.meta.name === 'import' &&
      node.property.name === 'meta'
    return {
      // `require('x')` is an import too, in any form.
      CallExpression: node => {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require'
        ) {
          check(node, node.arguments[0] ?? { type: 'Missing' })
        } else if (
          node.callee.type === 'MemberExpression' &&
          isImportMeta(node.callee.object)
        ) {
          // import.meta.glob(...) names no module: nothing can be checked.
          context.report({ node, messageId: 'glob' })
        }
      },
      // `import x = require('x')`
      TSImportEqualsDeclaration: node => {
        if (node.moduleReference.type === 'TSExternalModuleReference') {
          check(
            node,
            node.moduleReference.expression,
            node.importKind === 'type'
          )
        }
      },
      ImportDeclaration: node => check(node, node.source, isTypeOnly(node)),
      ExportNamedDeclaration: node =>
        check(node, node.source, isTypeOnly(node)),
      ExportAllDeclaration: node => check(node, node.source, isTypeOnly(node)),
      ImportExpression: node => check(node, node.source),
      // `import('x').T` names a type.
      TSImportType: node =>
        check(node, node.source ?? node.argument?.literal, true)
    }
  }
}

export default { rules: { boundaries } }
