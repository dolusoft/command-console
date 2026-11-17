// The template gate: checks that read a Vue SFC `<template>` (and, for unused
// imports, the template together with the script), which oxlint cannot do.
// One `@vue/compiler-sfc` parse per file, one walk of the template AST.
//
// Gates (decisions O2 and O4 of the oxlint migration):
//   no-v-html            v-html is refused: output is structured blocks (S-08, ADR 0005)
//   require-v-for-key    an element repeated with v-for has a :key
//   no-v-if-with-v-for   v-if and v-for on the same element
//   valid-v-model        v-model on a form element or a component, bound to an assignable value
//   no-unused-imports    an import of a .vue file used neither by the script nor the template
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

const directive = (element, name) =>
  element.props.find(
    prop => prop.type === NodeTypes.DIRECTIVE && prop.name === name
  )

const hasKey = element =>
  element.props.some(
    prop =>
      (prop.type === NodeTypes.ATTRIBUTE && prop.name === 'key') ||
      (prop.type === NodeTypes.DIRECTIVE &&
        prop.name === 'bind' &&
        prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
        prop.arg.content === 'key')
  )

const staticAttribute = (element, name) =>
  element.props.find(
    prop => prop.type === NodeTypes.ATTRIBUTE && prop.name === name
  )?.value?.content

const IDENTIFIER = /[A-Za-z_$][\w$]*/g

/** Every identifier-like word of an expression (a superset of its references). */
const wordsOf = text => text.match(IDENTIFIER) ?? []

/** `v-for="(item, index) in list"`: the alias names. */
const aliasesOf = forDirective => {
  const source = forDirective.exp?.content ?? ''
  const match = /^\s*([\s\S]*?)\s+(?:in|of)\s+[\s\S]*$/.exec(source)
  return match ? wordsOf(match[1]) : []
}

const pascal = tag =>
  tag.replace(/(^|-)([a-z0-9])/g, (_, __, char) => char.toUpperCase())

const camel = name =>
  name.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase())

/** Checks the left side of a v-model: `null` when assignable. */
const modelTargetProblem = (expression, aliases) => {
  let node
  try {
    node = parseExpression(expression, { plugins: ['typescript'] })
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

/** The local names a script imports, with the location of each import. */
const importsOf = (block, file) => {
  if (!block) {
    return { imports: [], words: new Set() }
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
  const words = new Set()
  const walk = node => {
    if (
      !node ||
      typeof node.type !== 'string' ||
      node.type === 'ImportDeclaration'
    ) {
      return
    }
    if (node.type === 'Identifier') {
      words.add(node.name)
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') {
        continue
      }
      if (Array.isArray(value)) {
        value.forEach(walk)
      } else if (value && typeof value === 'object') {
        walk(value)
      }
    }
  }
  walk(ast.program)
  return { imports, words }
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

  const templateWords = new Set()
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
      wordsOf(node.content.content).forEach(word => templateWords.add(word))
      return findings.length
    }
    if (node.type !== NodeTypes.ELEMENT) {
      return findings.length
    }
    const element = node
    templateWords.add(element.tag)
    templateWords.add(pascal(element.tag))
    for (const prop of element.props) {
      if (prop.type !== NodeTypes.DIRECTIVE) {
        continue
      }
      templateWords.add(`v${pascal(prop.name)}`)
      templateWords.add(camel(`v-${prop.name}`))
      if (prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION) {
        wordsOf(prop.exp.content).forEach(word => templateWords.add(word))
      }
      if (
        prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
        !prop.arg.isStatic
      ) {
        wordsOf(prop.arg.content).forEach(word => templateWords.add(word))
      }
    }

    const forDirective = directive(element, 'for')
    const inner = forDirective
      ? new Set([...aliases, ...aliasesOf(forDirective)])
      : aliases

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
      } else if (
        !isComponent &&
        element.tag === 'input' &&
        staticAttribute(element, 'type') === 'file'
      ) {
        problem =
          'v-model cannot bind <input type="file">: read the change event'
      } else if (!expression) {
        problem = 'v-model needs a value'
      } else {
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
    const used = new Set([...script.words, ...setup.words, ...templateWords])
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
