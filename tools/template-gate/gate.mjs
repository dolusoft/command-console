// The template gate: checks that read a Vue SFC `<template>` (and, for unused
// imports, the template together with the script), which oxlint cannot do.
// One `@vue/compiler-sfc` parse per file, one walk of the template AST.
//
// Gates (decisions O2 and O4 of the oxlint migration):
//   no-v-html            v-html is refused: output is structured blocks (S-08, ADR 0005)
//   require-v-for-key    an element repeated with v-for has a :key
//   no-v-if-with-v-for   v-if and v-for on the same element
//   valid-v-model        v-model on a form element or a component, bound to an assignable value
//   no-unused-imports    an import neither the script nor the template refers to
//
// A finding is silenced for one element by a comment right before it:
//   <!-- template-gate-disable-next-line no-v-html: <reason> -->
// The reason is required.

import { parseExpression, parse as parseScript } from '@babel/parser'
import { ElementTypes, NodeTypes } from '@vue/compiler-dom'
import { parse as parseSfc } from '@vue/compiler-sfc'

export const GATES = [
  'no-v-html',
  'require-v-for-key',
  'no-v-if-with-v-for',
  'valid-v-model',
  'no-unused-imports'
]

/** A file the gate cannot read: the CLI exits with 2. */
export class GateError extends Error {}

const DISABLE = /^\s*template-gate-disable-next-line\s+([\w-]+)\s*:\s*\S/

const FORM_ELEMENTS = new Set(['input', 'select', 'textarea'])

/** The modifiers v-model knows on a native form element. */
const NATIVE_MODEL_MODIFIERS = new Set(['lazy', 'number', 'trim'])

const directive = (element, name) =>
  element.props.find(
    prop => prop.type === NodeTypes.DIRECTIVE && prop.name === name
  )

// A static `key="row"` gives every repeated element the same key, so only a
// bound `:key` counts.
const hasKey = element =>
  element.props.some(
    prop =>
      prop.type === NodeTypes.DIRECTIVE &&
      prop.name === 'bind' &&
      prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
      prop.arg.content === 'key'
  )

const staticAttribute = (element, name) =>
  element.props.find(
    prop => prop.type === NodeTypes.ATTRIBUTE && prop.name === name
  )?.value?.content

// ---------------------------------------------------------------------------
// References. An import counts as used only where a name really refers to it:
// not a property name (`row.Child`, `{ Child: 1 }`), not text in a string
// (`{{ 'Child' }}`), and not a local binding of the same name (a parameter,
// a declaration in a nested scope, a v-for alias or a slot prop).

const FUNCTIONS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod'
])

/** The names a binding pattern declares: `{ a, b: [c], ...d }`. */
const patternNames = (node, out = []) => {
  if (!node) {
    return out
  }
  switch (node.type) {
    case 'Identifier':
      out.push(node.name)
      break
    case 'ObjectPattern':
      for (const property of node.properties) {
        patternNames(
          property.type === 'RestElement' ? property.argument : property.value,
          out
        )
      }
      break
    case 'ArrayPattern':
      node.elements.forEach(element => patternNames(element, out))
      break
    case 'AssignmentPattern':
      patternNames(node.left, out)
      break
    case 'RestElement':
      patternNames(node.argument, out)
      break
    case 'TSParameterProperty':
      patternNames(node.parameter, out)
      break
  }
  return out
}

/** The names a statement list declares in its own scope. */
const declaredIn = statements => {
  const names = []
  for (const statement of statements) {
    const declaration =
      statement.type === 'ExportNamedDeclaration' && statement.declaration
        ? statement.declaration
        : statement
    if (declaration.type === 'VariableDeclaration') {
      declaration.declarations.forEach(item => patternNames(item.id, names))
    } else if (
      (declaration.type === 'FunctionDeclaration' ||
        declaration.type === 'ClassDeclaration') &&
      declaration.id
    ) {
      names.push(declaration.id.name)
    }
  }
  return names
}

/** The names a node binds for its own subtree, or `null`. */
const scopeOf = node => {
  if (FUNCTIONS.has(node.type)) {
    const names = node.params.flatMap(param => patternNames(param))
    if (node.type === 'FunctionExpression' && node.id) {
      names.push(node.id.name)
    }
    return names
  }
  switch (node.type) {
    case 'BlockStatement':
    case 'StaticBlock':
      return declaredIn(node.body)
    case 'SwitchStatement':
      return declaredIn(node.cases.flatMap(item => item.consequent))
    case 'CatchClause':
      return patternNames(node.param)
    case 'ForStatement':
      return node.init?.type === 'VariableDeclaration'
        ? declaredIn([node.init])
        : null
    case 'ForInStatement':
    case 'ForOfStatement':
      return node.left.type === 'VariableDeclaration'
        ? declaredIn([node.left])
        : null
    case 'ClassExpression':
      return node.id ? [node.id.name] : null
    default:
      return null
  }
}

const NAME_KEYS = new Set([
  'ObjectProperty',
  'ObjectMethod',
  'ClassProperty',
  'ClassAccessorProperty',
  'ClassMethod',
  'ClassPrivateProperty',
  'TSPropertySignature',
  'TSMethodSignature'
])

/** Whether an identifier, by its position, is a name and not a reference. */
const isName = (parent, key) =>
  ((parent.type === 'MemberExpression' ||
    parent.type === 'OptionalMemberExpression') &&
    key === 'property' &&
    !parent.computed) ||
  (NAME_KEYS.has(parent.type) && key === 'key' && !parent.computed) ||
  (parent.type === 'TSQualifiedName' && key === 'right') ||
  (parent.type === 'TSEnumMember' && key === 'id') ||
  key === 'label' ||
  parent.type === 'MetaProperty'

const SKIPPED_FIELDS = new Set([
  'loc',
  'start',
  'end',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments'
])

/**
 * Adds to `out` the names `node` refers to that no local binding shadows.
 * `locals` holds the names bound around `node` (v-for aliases, slot props).
 */
const collectReferences = (node, out, locals = new Set()) => {
  const walk = (current, parent, key, scope) => {
    if (
      !current ||
      typeof current.type !== 'string' ||
      current.type === 'ImportDeclaration'
    ) {
      return
    }
    if (current.type === 'Identifier') {
      if (!(parent && isName(parent, key)) && !scope.has(current.name)) {
        out.add(current.name)
      }
      // `const x: Props` and `(u: Updater<T>) =>`: the annotation refers.
      walk(current.typeAnnotation, current, 'typeAnnotation', scope)
      return
    }
    const own = scopeOf(current)
    const inner = own?.length ? new Set([...scope, ...own]) : scope
    for (const [field, value] of Object.entries(current)) {
      if (SKIPPED_FIELDS.has(field)) {
        continue
      }
      if (Array.isArray(value)) {
        value.forEach(item => walk(item, current, field, inner))
      } else if (value && typeof value === 'object') {
        walk(value, current, field, inner)
      }
    }
  }
  walk(node, null, null, locals)
  return out
}

const TS = { plugins: ['typescript'] }

/** A template expression as an AST; `null` when it does not parse. */
const parseTemplateExpression = (text, statements = false) => {
  try {
    return parseExpression(text, TS)
  } catch {
    if (!statements) {
      return null
    }
  }
  try {
    // A v-on handler may be statements: `count++; save()`.
    return parseScript(text, TS).program
  } catch {
    return null
  }
}

/** The names a parameter list binds: `{ item }` of a slot, `item, i` of a v-for. */
const paramNames = text => {
  const ast = parseTemplateExpression(`(${text}) => 0`)
  return ast?.type === 'ArrowFunctionExpression'
    ? ast.params.flatMap(param => patternNames(param))
    : []
}

/** `v-for="(item, index) in list"`: the alias names. */
const aliasesOf = forDirective => {
  const result = forDirective.forParseResult
  if (result) {
    return [result.value, result.key, result.index]
      .filter(Boolean)
      .flatMap(item => paramNames(item.content))
  }
  const source = forDirective.exp?.content ?? ''
  const match = /^\s*\(?([\s\S]*?)\)?\s+(?:in|of)\s+[\s\S]*$/.exec(source)
  return match ? paramNames(match[1]) : []
}

const IDENTIFIER = /[A-Za-z_$][\w$]*/g

/**
 * The references of a template expression. An expression that does not
 * parse (the SFC compiler and the type check refuse it anyway) falls back to
 * its identifier-like words, so it never reports a used import as unused.
 */
const templateReferences = (text, out, locals, statements = false) => {
  const ast = parseTemplateExpression(text, statements)
  if (ast) {
    collectReferences(ast, out, locals)
  } else {
    for (const word of text.match(IDENTIFIER) ?? []) {
      if (!locals.has(word)) {
        out.add(word)
      }
    }
  }
}

const pascal = tag =>
  tag.replace(/(^|-)([a-z0-9])/g, (_, __, char) => char.toUpperCase())

const camel = name =>
  name.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase())

/** Checks the left side of a v-model: `null` when assignable. */
const modelTargetProblem = (expression, aliases) => {
  let node
  try {
    node = parseExpression(expression, TS)
  } catch {
    return `"${expression}" is not an expression`
  }
  while (
    node.type === 'TSNonNullExpression' ||
    node.type === 'TSAsExpression'
  ) {
    node = node.expression
  }
  if (node.type === 'Identifier') {
    return aliases.has(node.name)
      ? `"${node.name}" is a v-for alias: bind a property of it instead`
      : null
  }
  if (
    node.type === 'MemberExpression' ||
    node.type === 'OptionalMemberExpression'
  ) {
    return node.optional || node.type === 'OptionalMemberExpression'
      ? `"${expression}" uses optional chaining and cannot be assigned`
      : null
  }
  return `"${expression}" cannot be assigned`
}

/** The problem of a v-model on a native form element, other than its value. */
const nativeModelProblem = (element, model) => {
  if (model.arg) {
    const arg =
      model.arg.type === NodeTypes.SIMPLE_EXPRESSION ? model.arg.content : '…'
    return `v-model on <${element.tag}> takes no argument, got "${arg}"`
  }
  const modifiers = (model.modifiers ?? []).map(item =>
    typeof item === 'string' ? item : item.content
  )
  const unknown = modifiers.filter(item => !NATIVE_MODEL_MODIFIERS.has(item))
  if (unknown.length > 0) {
    return `v-model on <${element.tag}> knows the modifiers lazy, number and trim, not "${unknown.join('", "')}"`
  }
  if (element.tag === 'input' && staticAttribute(element, 'type') === 'file') {
    return 'v-model cannot bind <input type="file">: read the change event'
  }
  return null
}

/** The local names a script imports, with the location of each import. */
const importsOf = (block, file) => {
  if (!block) {
    return { imports: [], references: new Set() }
  }
  let ast
  try {
    ast = parseScript(block.content, {
      sourceType: 'module',
      plugins: block.lang === 'ts' || block.lang === 'tsx' ? ['typescript'] : []
    })
  } catch (error) {
    throw new GateError(
      `${file}: the <script> block does not parse: ${error.message}`
    )
  }
  const imports = []
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration') {
      continue
    }
    for (const specifier of statement.specifiers) {
      imports.push({
        name: specifier.local.name,
        line: block.loc.start.line + specifier.local.loc.start.line - 1,
        column:
          specifier.local.loc.start.line === 1
            ? block.loc.start.column + specifier.local.loc.start.column
            : specifier.local.loc.start.column + 1
      })
    }
  }
  return { imports, references: collectReferences(ast.program, new Set()) }
}

/**
 * Checks one SFC. Returns the findings `{ file, line, column, gate, message }`;
 * throws `GateError` when the file does not parse.
 */
export const checkSfc = (file, source, gates = GATES) => {
  const enabled = new Set(gates)
  const { descriptor, errors } = parseSfc(source, { filename: file })
  if (errors.length > 0) {
    const [first] = errors
    const where = first.loc
      ? `:${first.loc.start.line}:${first.loc.start.column}`
      : ''
    throw new GateError(
      `${file}${where}: the SFC does not parse: ${first.message}`
    )
  }
  const findings = []
  const report = (gate, loc, message) => {
    if (enabled.has(gate)) {
      findings.push({
        file,
        line: loc.start.line,
        column: loc.start.column,
        gate,
        message
      })
    }
  }

  const templateReferenceSet = new Set()
  const template = descriptor.template?.ast

  const visitChildren = (children, aliases) => {
    let disabled = null
    for (const child of children) {
      if (child.type === NodeTypes.COMMENT) {
        const match = DISABLE.exec(child.content)
        if (match) {
          disabled = match[1]
        }
        continue
      }
      if (child.type === NodeTypes.TEXT && !child.content.trim()) {
        continue
      }
      const before = findings.length
      const ownEnd = visit(child, aliases)
      if (disabled) {
        // Only the element's own findings, not those of its children.
        const own = findings
          .slice(before, ownEnd)
          .filter(finding => finding.gate === disabled)
        for (const finding of own) {
          findings.splice(findings.indexOf(finding), 1)
        }
      }
      disabled = null
    }
  }

  const visit = (node, aliases) => {
    if (node.type === NodeTypes.INTERPOLATION) {
      templateReferences(node.content.content, templateReferenceSet, aliases)
      return findings.length
    }
    if (node.type !== NodeTypes.ELEMENT) {
      return findings.length
    }
    const element = node
    if (element.tagType === ElementTypes.COMPONENT) {
      // Vue resolves `<child-view>` to `ChildView`, `childView` or itself.
      templateReferenceSet.add(element.tag)
      templateReferenceSet.add(camel(element.tag))
      templateReferenceSet.add(pascal(element.tag))
    }

    const forDirective = directive(element, 'for')
    const slot = directive(element, 'slot')
    const scoped = [
      ...(forDirective ? aliasesOf(forDirective) : []),
      ...(slot?.exp ? paramNames(slot.exp.content) : [])
    ]
    const inner = scoped.length ? new Set([...aliases, ...scoped]) : aliases

    for (const prop of element.props) {
      if (prop.type !== NodeTypes.DIRECTIVE) {
        continue
      }
      // A custom directive `v-focus` resolves to `vFocus`.
      templateReferenceSet.add(`v${pascal(prop.name)}`)
      if (prop === forDirective) {
        const sourceText = prop.forParseResult?.source?.content
        if (sourceText) {
          templateReferences(sourceText, templateReferenceSet, aliases)
        } else if (prop.exp?.content) {
          templateReferences(prop.exp.content, templateReferenceSet, aliases)
        }
      } else if (
        prop !== slot &&
        prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION
      ) {
        templateReferences(
          prop.exp.content,
          templateReferenceSet,
          inner,
          prop.name === 'on'
        )
      }
      if (
        prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
        !prop.arg.isStatic
      ) {
        templateReferences(prop.arg.content, templateReferenceSet, aliases)
      }
    }

    const html = directive(element, 'html')
    if (html) {
      report(
        'no-v-html',
        html.loc,
        'v-html is refused: all text is escaped, output is structured blocks (S-08).'
      )
    }

    if (forDirective) {
      const isTemplate = element.tagType === ElementTypes.TEMPLATE
      const children = element.children.filter(
        child => child.type === NodeTypes.ELEMENT
      )
      const keyed = isTemplate
        ? hasKey(element) || (children.length > 0 && children.every(hasKey))
        : hasKey(element)
      if (!keyed) {
        report(
          'require-v-for-key',
          element.loc,
          `<${element.tag} v-for> needs a :key.`
        )
      }
      if (directive(element, 'if')) {
        report(
          'no-v-if-with-v-for',
          directive(element, 'if').loc,
          'v-if and v-for on one element: filter the list in a computed, or move v-if to a wrapper.'
        )
      }
    }

    const model = directive(element, 'model')
    if (model) {
      const isComponent = element.tagType === ElementTypes.COMPONENT
      const expression = model.exp?.content?.trim()
      let problem = null
      if (!isComponent && !FORM_ELEMENTS.has(element.tag)) {
        problem = `v-model works on <input>, <select>, <textarea> and components, not on <${element.tag}>`
      } else if (!isComponent) {
        problem = nativeModelProblem(element, model)
      }
      if (!problem && !expression) {
        problem = 'v-model needs a value'
      } else if (!problem) {
        problem = modelTargetProblem(expression, inner)
      }
      if (problem) {
        report('valid-v-model', model.loc, `${problem}.`)
      }
    }

    const ownEnd = findings.length
    visitChildren(element.children, inner)
    return ownEnd
  }

  if (template) {
    visitChildren(template.children, new Set())
  }

  if (enabled.has('no-unused-imports')) {
    const script = importsOf(descriptor.script, file)
    const setup = importsOf(descriptor.scriptSetup, file)
    const used = new Set([
      ...script.references,
      ...setup.references,
      ...templateReferenceSet
    ])
    for (const item of [...script.imports, ...setup.imports]) {
      if (!used.has(item.name)) {
        report(
          'no-unused-imports',
          { start: { line: item.line, column: item.column } },
          `"${item.name}" is imported but never used.`
        )
      }
    }
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column)
  return findings
}
