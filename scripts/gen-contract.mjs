// Generates CONTRACT.md from the code (P12):
//   - props, events and slots of `<CommandConsole>`, read with
//     vue-component-meta (types, defaults and JSDoc as the TypeScript checker
//     sees them);
//   - the exposed surface, read from the `defineExpose` object literal in the
//     component source and compared with the contract;
//   - events, slots and the exposed surface again from src/contract.ts, where
//     vue-component-meta leaves descriptions out, cross-checked against the
//     component so the two cannot drift apart;
//   - every public type, verbatim from src/contract.ts, and the protocol and
//     core types it exports again;
//   - the functions the Vue package exports besides the component;
//   - the behavior rules (contract/rules.md) and the DOM contract
//     (contract/dom.ts).
//
// Until the Vue package has its component (packages/command-console/src/
// command-console.vue) and its contract (src/contract.ts), the component
// part says so and the rest is generated as usual.
//
//   node scripts/gen-contract.mjs           write CONTRACT.md
//   node scripts/gen-contract.mjs --check   fail when it is stale
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const at = (...parts) => join(root, ...parts)
const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const vueSrc = (...parts) => at('packages', 'command-console', 'src', ...parts)

// Node strips the types of this data file on import (Node 22.18+).
const { domAttributes, domClasses } = await import(
  pathToFileURL(at('contract', 'dom.ts')).href
)

const sourceOf = path =>
  ts.createSourceFile(path, read(path), ts.ScriptTarget.ES2022, true)

const docOf = node => {
  const doc = node.jsDoc?.at(-1)
  return doc?.comment ? (ts.getTextOfJSDocComment(doc.comment) ?? '') : ''
}

const nameOf = member => {
  if (member.name) {
    return ts.isStringLiteral(member.name)
      ? member.name.text
      : member.name.getText()
  }
  // Index signature: `[key: `block-${string}`]`.
  const key = member.parameters?.[0]?.type
  return key
    ? key.getText().replace(/^`|`$/g, '').replace('${string}', '<name>')
    : '?'
}

const isDeclaredType = statement =>
  ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

const cell = text =>
  String(text ?? '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
const code = text => (text ? `\`${String(text).replace(/`/g, "'")}\`` : '')

const table = (headers, rows) =>
  [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`)
  ].join('\n')

// ---------------------------------------------------------------------------
// The component part
// ---------------------------------------------------------------------------

const componentPath = vueSrc('command-console.vue')
const contractPath = vueSrc('contract.ts')

/** Every `.ts` file under `dir`, specs left out. */
const sourceFiles = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return sourceFiles(path)
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : []
  })

const componentSections = async () => {
  const contractFile = sourceOf(contractPath)
  const contractText = read(contractPath)

  const declaration = name => {
    const found = contractFile.statements.find(
      statement => isDeclaredType(statement) && statement.name.text === name
    )
    if (!found) {
      throw new Error(`contract.ts has no declaration named ${name}`)
    }
    return found
  }

  const membersOf = name => {
    const node = declaration(name)
    const members = ts.isInterfaceDeclaration(node)
      ? node.members
      : node.type.members
    return members.map(member => {
      let type
      if (ts.isMethodSignature(member)) {
        const parameters = member.parameters.map(p => p.getText()).join(', ')
        type = `(${parameters}) => ${member.type?.getText() ?? 'void'}`
      } else if (ts.isIndexSignatureDeclaration(member)) {
        type = member.type.getText()
      } else {
        type = member.type?.getText() ?? ''
      }
      return {
        name: nameOf(member),
        type: type.replace(/\s+/g, ' ').replace(/ \| undefined$/, ''),
        description: docOf(member)
      }
    })
  }

  // The protocol and core types contract.ts exports again, found in the
  // package that declares them.
  const reexportsOf = (module, packageDir) => {
    const names = contractFile.statements
      .filter(
        statement =>
          ts.isExportDeclaration(statement) &&
          statement.moduleSpecifier?.text === module &&
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause)
      )
      .flatMap(statement =>
        statement.exportClause.elements.map(
          element => (element.propertyName ?? element.name).text
        )
      )
    if (names.length === 0) {
      return []
    }
    const declared = sourceFiles(at('packages', packageDir, 'src')).flatMap(
      path =>
        sourceOf(path)
          .statements.filter(
            statement =>
              isDeclaredType(statement) && names.includes(statement.name.text)
          )
          .map(statement => ({ statement, path }))
    )
    for (const name of names) {
      if (!declared.some(entry => entry.statement.name.text === name)) {
        throw new Error(
          `contract.ts exports ${name} from ${module}, which packages/${packageDir}/src does not declare`
        )
      }
    }
    return declared
  }
  const reexported = [
    ...reexportsOf('@dolusoft/command-protocol', 'command-protocol'),
    ...reexportsOf('@dolusoft/command-console-core', 'command-console-core')
  ]

  const { createChecker } = await import('vue-component-meta')
  const { parse: parseSfc } = await import('vue/compiler-sfc')
  const checker = createChecker(at('tsconfig.json'), {
    forceUseTs: true,
    schema: { ignore: [] }
  })
  const meta = checker.getComponentMeta(componentPath)

  const props = meta.props
    .filter(prop => !prop.global)
    .map(prop => ({
      name: prop.name,
      type: prop.type.replace(/ \| undefined$/, ''),
      required: prop.required,
      default: prop.default,
      description: prop.description
    }))
  const emits = membersOf('ConsoleEmits')
  const slots = membersOf('ConsoleSlots')
  const exposed = membersOf('ConsoleExpose')

  // The component and the contract file must describe the same surface.
  const sameSet = (what, fromComponent, fromContract) => {
    const a = [...fromComponent].sort().join(', ')
    const b = [...fromContract].sort().join(', ')
    if (a !== b) {
      throw new Error(
        `${what} differ between the component and src/contract.ts:\n  component: ${a}\n  contract:  ${b}`
      )
    }
  }
  sameSet(
    'Events',
    meta.events.map(event => event.name),
    emits.map(event => event.name)
  )
  sameSet(
    'Slots',
    meta.slots.map(slot => slot.name),
    // Index-signature slots are not in the meta.
    slots.filter(slot => !slot.name.endsWith('<name>')).map(slot => slot.name)
  )
  sameSet(
    'Props',
    props.map(prop => prop.name),
    membersOf('ConsoleProps').map(prop => prop.name)
  )

  // The exposed surface is read from the component source: the keys of the
  // object literal handed to `defineExpose` (directly or through a
  // variable). The types alone would not catch a key added by a cast.
  const exposedKeys = (() => {
    const { descriptor } = parseSfc(read(componentPath))
    const setup = descriptor.scriptSetup
    if (!setup) {
      throw new Error(`${componentPath} has no <script setup>`)
    }
    const file = ts.createSourceFile(
      'setup.ts',
      setup.content,
      ts.ScriptTarget.ES2022,
      true
    )
    const calls = []
    const declared = new Map()
    const visit = node => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'defineExpose'
      ) {
        calls.push(node)
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        declared.set(node.name.text, node.initializer)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    if (calls.length !== 1) {
      throw new Error(
        `${componentPath} must call defineExpose exactly once, found ${calls.length}`
      )
    }
    let [argument] = calls[0].arguments
    if (argument && ts.isIdentifier(argument)) {
      argument = declared.get(argument.text)
    }
    while (
      argument &&
      (ts.isAsExpression(argument) || ts.isSatisfiesExpression(argument))
    ) {
      argument = argument.expression
    }
    if (!argument || !ts.isObjectLiteralExpression(argument)) {
      throw new Error(
        `${componentPath}: defineExpose must receive an object literal`
      )
    }
    return argument.properties.map(property => {
      if (!property.name) {
        throw new Error(
          `${componentPath}: defineExpose has a spread or an unnamed member`
        )
      }
      return property.name.getText()
    })
  })()
  sameSet(
    'Exposed keys',
    exposedKeys,
    exposed.map(item => item.name)
  )

  const functions = functionsOf(vueSrc('index.ts'))

  return [
    '## Component',
    '### Props',
    table(
      ['Name', 'Type', 'Required', 'Default', 'Description'],
      props.map(prop => [
        code(prop.name),
        code(prop.type),
        prop.required ? 'yes' : '',
        code(prop.default),
        prop.description
      ])
    ),
    '### Events',
    table(
      ['Name', 'Arguments', 'Description'],
      emits.map(event => [
        code(event.name),
        code(event.type),
        event.description
      ])
    ),
    '### Slots',
    table(
      ['Name', 'Props', 'Description'],
      slots.map(slot => [
        code(slot.name),
        code(
          slot.type
            .replace(/^\(props: (.*)\) => unknown$/, '$1')
            .replace(/^\(\) => unknown$/, 'none')
        ),
        slot.description
      ])
    ),
    '### Exposed',
    table(
      ['Name', 'Signature', 'Description'],
      exposed.map(item => [code(item.name), code(item.type), item.description])
    ),
    '### Functions',
    'Exported from the package entry point next to the component.',
    table(
      ['Name', 'Signature', 'Description'],
      functions.map(item => [
        code(item.name),
        code(item.type),
        item.description
      ])
    ),
    '## Types',
    'Exported from the package entry point (`packages/command-console/src/contract.ts`).',
    '```ts\n' + contractText.trim() + '\n```',
    ...(reexported.length > 0
      ? [
          '`contract.ts` exports the types below again; they are declared by the protocol or the core.',
          '```ts\n' +
            reexported
              .map(
                ({ statement, path }) =>
                  `// ${relative(root, path).replaceAll('\\', '/')}\n${statement.getFullText().trim()}`
              )
              .join('\n\n') +
            '\n```'
        ]
      : [])
  ]
}

// Functions: the value exports of src/index.ts besides the component
// (`export { name } from './path'`), with signature and JSDoc read from the
// function declaration in the module they come from.
const functionsOf = indexPath => {
  const indexFile = sourceOf(indexPath)
  return indexFile.statements
    .filter(
      statement =>
        ts.isExportDeclaration(statement) &&
        !statement.isTypeOnly &&
        statement.moduleSpecifier &&
        statement.moduleSpecifier.text.startsWith('.') &&
        !statement.moduleSpecifier.text.endsWith('.vue') &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
    )
    .flatMap(statement => {
      const modulePath = join(
        dirname(indexPath),
        `${statement.moduleSpecifier.text.replace(/^\.\//, '').replace(/\.js$/, '')}.ts`
      )
      const file = sourceOf(modulePath)
      // Inline type specifiers (`type X`) are types, not functions.
      const values = statement.exportClause.elements.filter(
        element => !element.isTypeOnly
      )
      return values.map(element => {
        const name = (element.propertyName ?? element.name).text
        const found = file.statements.find(
          node => ts.isFunctionDeclaration(node) && node.name?.text === name
        )
        if (!found) {
          throw new Error(
            `${relative(root, indexPath)} exports ${name}, but ${modulePath} declares no function of that name`
          )
        }
        const parameters = found.parameters
          .map(parameter =>
            parameter.initializer
              ? `${parameter.name.getText()}?: ${parameter.type?.getText() ?? 'unknown'}`
              : parameter.getText()
          )
          .join(', ')
        return {
          name: element.name.text,
          type: `(${parameters}) => ${found.type?.getText() ?? 'void'}`.replace(
            /\s+/g,
            ' '
          ),
          description: docOf(found)
        }
      })
    })
}

const hasComponent = existsSync(componentPath) && existsSync(contractPath)
const component = hasComponent
  ? await componentSections()
  : [
      '## Component',
      '`<CommandConsole>` is not written yet. This part is generated from `packages/command-console/src/command-console.vue` and `packages/command-console/src/contract.ts` once both exist.'
    ]

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const rules = read(at('contract', 'rules.md'))
// The rules start at the first `### C-nn` heading; the text above it is the
// file's own introduction.
const firstRule = rules.search(/^### C-\d+ /m)
if (firstRule < 0) {
  throw new Error('contract/rules.md has no "### C-nn Title" rule')
}
const ruleText = rules.slice(firstRule).trim()

// Every `### ` heading must be a rule: a heading with a typo in its ID would
// otherwise drop out of the rules without an error.
const headings = ruleText.match(/^### .*$/gm) ?? []
const bad = headings.filter(heading => !/^### C-\d{2,} \S/.test(heading))
if (bad.length > 0) {
  throw new Error(
    `contract/rules.md has headings that do not parse as "### C-nn Title": ${bad.join('; ')}`
  )
}

// ---------------------------------------------------------------------------
// CONTRACT.md
// ---------------------------------------------------------------------------

const sections = [
  '# Command Console contract',
  '<!-- Generated by scripts/gen-contract.mjs. Do not edit: change packages/command-console/src/contract.ts, the component, contract/rules.md or contract/dom.ts and run `pnpm contract:gen`. -->',
  'This is the public contract of `@dolusoft/command-console`: the component surface, the types, the behavior rules and the DOM the component renders. A check or a test is tied to each part; see the end of this file. A behavior rule is traced when a test names its ID. That shows every rule has a test, not that the test covers the rule: traceability is not coverage.',
  ...component,
  '## Behavior rules',
  ruleText.replace(/^### /gm, '#### '),
  '## DOM contract',
  'The classes and attributes below are the only hooks a skin can select (P6). The console writes no stylesheet and no inline style (P5); slot content is the consumer’s.',
  '### Classes',
  table(
    ['Class', 'Element', 'Description'],
    domClasses.map(entry => [
      code(entry.name),
      code(entry.on),
      entry.description
    ])
  ),
  '### Attributes',
  table(
    ['Attribute', 'Element', 'Description'],
    domAttributes.map(entry => [
      code(entry.name),
      code(entry.on),
      entry.description
    ])
  ),
  '## How the contract is kept',
  [
    '- `pnpm contract:check` regenerates this file and fails if it differs, so the component, `packages/command-console/src/contract.ts`, the rules and the DOM list cannot change without it.',
    '- `pnpm api:check` compares the built declarations of each package with its `etc/*.api.md` report.',
    '- `pnpm contract:gen` also checks that the props, events, slots and exposed keys of the component equal those of `packages/command-console/src/contract.ts`.',
    '- `tests/repo/contract-traceability.spec.ts` fails when a rule has no test named after it, or a test names an unknown or withdrawn rule. That is traceability, not coverage: it does not say the test proves the rule.',
    '- The browser tests compare the rendered DOM with the DOM contract (C-45).'
  ].join('\n')
]
const text = sections.join('\n\n') + '\n'
const target = at('CONTRACT.md')

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = read(target)
  } catch {
    // A missing file counts as stale.
  }
  if (current !== text) {
    console.error(
      'CONTRACT.md is stale. Run `pnpm contract:gen` and commit it.'
    )
    process.exit(1)
  }
  console.log('CONTRACT.md is up to date')
} else {
  writeFileSync(target, text)
  console.log('wrote CONTRACT.md')
}
