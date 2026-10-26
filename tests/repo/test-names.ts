import ts from 'typescript'

// Reads the test structure of a spec file as a syntax tree, so a title is the
// first argument of a real `describe(`, `it(` or `test(` call (including
// `.each(...)(` and `.only`), and a `describe` is known by the tests inside it.

interface FoundTest {
  /** The title of the `it`/`test` call itself. */
  name: string
  /** Titles of the `describe` blocks around it, outermost first. */
  groups: string[]
}

export interface FoundSuite {
  /** The titles of every `describe`, empty or not. */
  groups: string[]
  /** Runnable tests: `it`/`test` calls that are not `.skip` or `.todo`. */
  tests: FoundTest[]
}

type Kind = 'describe' | 'it' | 'test'

const KINDS = new Set<string>(['describe', 'it', 'test'])
const NOT_RUN = new Set(['skip', 'todo'])
const RULE_ID = /\bC-\d{2,}\b/g

/** `it`, `it.only`, `it.each(rows)` ... -> the call's kind and modifiers. */
const classify = (
  callee: ts.Expression
): { kind: Kind; modifiers: string[] } | null => {
  const modifiers: string[] = []
  let node: ts.Expression = callee
  for (;;) {
    if (ts.isCallExpression(node)) {
      node = node.expression
    } else if (ts.isPropertyAccessExpression(node)) {
      modifiers.push(node.name.text)
      node = node.expression
    } else {
      break
    }
  }
  return ts.isIdentifier(node) && KINDS.has(node.text)
    ? { kind: node.text as Kind, modifiers }
    : null
}

const titleOf = (call: ts.CallExpression): string | null => {
  const [first] = call.arguments
  if (
    first &&
    (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first))
  ) {
    return ts.isStringLiteralLike(first) ? first.text : first.getText()
  }
  return null
}

export const collectSuite = (source: string, fileName = 'x.spec.ts') => {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    true
  )
  const suite: FoundSuite = { groups: [], tests: [] }

  const visit = (node: ts.Node, groups: string[]) => {
    if (ts.isCallExpression(node)) {
      const found = classify(node.expression)
      const title = found ? titleOf(node) : null
      if (found && title !== null) {
        if (found.kind === 'describe') {
          suite.groups.push(title)
          node.forEachChild(child => visit(child, [...groups, title]))
          return
        }
        if (!found.modifiers.some(modifier => NOT_RUN.has(modifier))) {
          suite.tests.push({ name: title, groups })
        }
      }
    }
    node.forEachChild(child => visit(child, groups))
  }
  visit(file, [])
  return suite
}

/**
 * Every rule ID that a runnable test stands under: in its own title or in the
 * title of a `describe` around it. An empty `describe('C-01 ...')` gives none.
 */
export const coveredIds = (suite: FoundSuite): Set<string> => {
  const ids = new Set<string>()
  for (const test of suite.tests) {
    for (const title of [...test.groups, test.name]) {
      for (const match of title.matchAll(RULE_ID)) {
        ids.add(match[0])
      }
    }
  }
  return ids
}

/** Every rule ID named anywhere in a title, tests and groups alike. */
export const namedIds = (suite: FoundSuite): string[] =>
  [...suite.groups, ...suite.tests.map(test => test.name)].flatMap(title =>
    [...title.matchAll(RULE_ID)].map(match => match[0])
  )

export interface Rule {
  id: string
  title: string
  /** A withdrawn rule keeps its number, needs no test and may not be named. */
  withdrawn: boolean
}

/** The `### C-nn Title` headings of contract/rules.md. */
export const rulesOf = (text: string): Rule[] =>
  [...text.matchAll(/^### (C-\d+) (.+)$/gm)].map(match => ({
    id: match[1],
    title: match[2].trim(),
    withdrawn: match[2].trim() === '(withdrawn)'
  }))
