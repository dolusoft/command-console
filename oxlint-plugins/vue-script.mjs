// Three script checks for Vue code that neither oxlint's built-in rules nor
// the type check (`vue-tsc`) cover (decisions O5 and N3 of the oxlint
// migration). They read the script only, never the template, so they run on
// `.vue` and `.ts` files alike.
//
//   no-ref-as-condition    a ref used as a condition is always truthy
//   no-mutating-props      props are read-only, nested values included
//   valid-default-prop     an object or array default must be a factory,
//                          and a literal default must match the prop type

const REF_FACTORIES = new Set([
  'ref',
  'shallowRef',
  'computed',
  'toRef',
  'customRef'
])

const MUTATING_METHODS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
  'set',
  'add',
  'delete',
  'clear'
])

const calleeName = node =>
  node?.type === 'CallExpression' && node.callee.type === 'Identifier'
    ? node.callee.name
    : null

/** `defineProps(...)` or `withDefaults(defineProps(...), ...)`. */
const isDefineProps = node =>
  calleeName(node) === 'defineProps' ||
  (calleeName(node) === 'withDefaults' &&
    calleeName(node.arguments[0]) === 'defineProps')

/** The names a destructuring pattern binds: `{ a, b: c, d = 1, ...e }`. */
const patternNames = (node, out = []) => {
  if (!node) {
    return out
  }
  if (node.type === 'Identifier') {
    out.push(node.name)
  } else if (node.type === 'ObjectPattern') {
    for (const property of node.properties) {
      patternNames(
        property.type === 'RestElement' ? property.argument : property.value,
        out
      )
    }
  } else if (node.type === 'ArrayPattern') {
    node.elements.forEach(element => patternNames(element, out))
  } else if (node.type === 'AssignmentPattern') {
    patternNames(node.left, out)
  } else if (node.type === 'RestElement') {
    patternNames(node.argument, out)
  }
  return out
}

/** The prop name a chain on `this` starts with: `items` for `this.items[0].a`. */
const thisPropOf = node => {
  let current = node
  while (
    current?.type === 'TSNonNullExpression' ||
    current?.type === 'ChainExpression' ||
    (current?.type === 'MemberExpression' &&
      current.object.type !== 'ThisExpression')
  ) {
    current =
      current.type === 'MemberExpression' ? current.object : current.expression
  }
  return current?.type === 'MemberExpression' &&
    !current.computed &&
    current.property.type === 'Identifier'
    ? current.property.name
    : null
}

/** An options object of `defineComponent({ ... })` or `export default { ... }`. */
const isComponentOptions = node =>
  node?.type === 'ObjectExpression' &&
  ((node.parent?.type === 'CallExpression' &&
    calleeName(node.parent) === 'defineComponent') ||
    node.parent?.type === 'ExportDefaultDeclaration')

/** The names of a `props` option: `{ items: Array }` or `['items']`. */
const declaredPropNames = node => {
  if (node?.type === 'ObjectExpression') {
    return node.properties
      .filter(item => item.type === 'Property')
      .map(item => item.key.name ?? item.key.value)
  }
  if (node?.type === 'ArrayExpression') {
    return node.elements
      .filter(item => item?.type === 'Literal')
      .map(item => item.value)
  }
  return []
}

/** The identifier a member chain starts from: `a` for `a.b[c].d`. */
const rootOf = node => {
  let current = node
  while (
    current?.type === 'MemberExpression' ||
    current?.type === 'TSNonNullExpression' ||
    current?.type === 'ChainExpression'
  ) {
    current =
      current.type === 'MemberExpression' ? current.object : current.expression
  }
  return current?.type === 'Identifier' ? current : null
}

const noRefAsCondition = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A ref, a shallowRef or a computed used as a condition is always truthy: read `.value`.'
    },
    schema: [],
    messages: {
      condition:
        '"{{name}}" is a ref and always truthy as a condition: read "{{name}}.value".'
    }
  },
  create(context) {
    const refs = new Set()
    // Local names of the ref factories: bare (auto-imported or global), and
    // every binding imported from 'vue', aliases (`ref as makeRef`) included.
    const factories = new Set(REF_FACTORIES)
    const namespaces = new Set()
    const isFactory = call => {
      if (call?.type !== 'CallExpression') {
        return false
      }
      const callee = call.callee
      if (callee.type === 'Identifier') {
        return factories.has(callee.name)
      }
      return (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.object.type === 'Identifier' &&
        namespaces.has(callee.object.name) &&
        callee.property.type === 'Identifier' &&
        REF_FACTORIES.has(callee.property.name)
      )
    }
    // The declaration a name resolves to, through the scope chain: a
    // parameter or a nested binding of the same name shadows the ref.
    const declarationOf = node => {
      for (
        let scope = context.sourceCode.getScope(node);
        scope;
        scope = scope.upper
      ) {
        const variable = scope.set.get(node.name)
        if (variable) {
          return variable.defs[0]?.node ?? null
        }
      }
      return null
    }
    const check = node => {
      if (node?.type === 'Identifier' && refs.has(declarationOf(node))) {
        context.report({
          node,
          messageId: 'condition',
          data: { name: node.name }
        })
      }
    }
    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'vue') {
          return
        }
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') {
            namespaces.add(specifier.local.name)
          } else if (
            specifier.type === 'ImportSpecifier' &&
            REF_FACTORIES.has(
              specifier.imported.name ?? specifier.imported.value
            )
          ) {
            factories.add(specifier.local.name)
          }
        }
      },
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' && isFactory(node.init)) {
          refs.add(node)
        }
      },
      'IfStatement:exit': node => check(node.test),
      'WhileStatement:exit': node => check(node.test),
      'DoWhileStatement:exit': node => check(node.test),
      'ForStatement:exit': node => check(node.test),
      'ConditionalExpression:exit': node => check(node.test),
      'UnaryExpression:exit': node => {
        if (node.operator === '!') {
          check(node.argument)
        }
      },
      'LogicalExpression:exit': node => {
        if (node.operator !== '??') {
          check(node.left)
        }
      }
    }
  }
}

const noMutatingProps = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Props belong to the parent: do not assign to them or change their nested values.'
    },
    schema: [],
    messages: {
      mutation:
        'Do not change the prop "{{path}}": props belong to the parent; emit an event or copy the value.'
    }
  },
  create(context) {
    // `props` holds the props objects; `values` the props taken out of one by
    // destructuring (`const { items } = defineProps(...)`), whose nested
    // values belong to the parent all the same.
    const props = new Set()
    const values = new Set()
    const source = context.sourceCode
    const bind = pattern => {
      if (pattern?.type === 'Identifier') {
        props.add(pattern.name)
      } else if (pattern?.type === 'ObjectPattern') {
        for (const name of patternNames(pattern)) {
          values.add(name)
        }
      }
    }
    // Options API: the props an options object declares, read as
    // `this.items`. A `methods` block may come before `props`, so the
    // `this.` candidates are judged at the end of the file.
    const optionProps = new Set()
    const thisCandidates = []
    const report = (node, target) => {
      const root = rootOf(target)
      if (
        root &&
        (props.has(root.name) || values.has(root.name)) &&
        target !== root
      ) {
        context.report({
          node,
          messageId: 'mutation',
          data: { path: source.getText(target) }
        })
        return
      }
      const name = thisPropOf(target)
      if (name) {
        thisCandidates.push({ node, target, name })
      }
    }
    return {
      'Program:exit'() {
        for (const { node, target, name } of thisCandidates) {
          if (optionProps.has(name)) {
            context.report({
              node,
              messageId: 'mutation',
              data: { path: source.getText(target) }
            })
          }
        }
      },
      VariableDeclarator(node) {
        if (isDefineProps(node.init)) {
          bind(node.id)
        }
      },
      // `defineComponent({ setup(props) {} })` and `setup: (props) => {}`.
      Property(node) {
        const key = node.key.type === 'Identifier' ? node.key.name : null
        const fn = node.value
        if (
          key === 'setup' &&
          (fn.type === 'FunctionExpression' ||
            fn.type === 'ArrowFunctionExpression')
        ) {
          bind(fn.params[0])
        }
        if (key === 'props' && isComponentOptions(node.parent)) {
          for (const name of declaredPropNames(fn)) {
            optionProps.add(name)
          }
        }
      },
      'AssignmentExpression:exit': node => report(node, node.left),
      'UpdateExpression:exit': node => report(node, node.argument),
      'UnaryExpression:exit': node => {
        if (node.operator === 'delete') {
          report(node, node.argument)
        }
      },
      'CallExpression:exit': node => {
        const callee = node.callee
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          MUTATING_METHODS.has(callee.property.name)
        ) {
          if (callee.object.type === 'MemberExpression') {
            // `props.items.push(x)` and `this.items.push(x)`.
            if (callee.object.object.type === 'ThisExpression') {
              const name = thisPropOf(callee.object)
              if (name) {
                thisCandidates.push({ node, target: callee.object, name })
              }
            } else {
              report(node, callee.object)
            }
          } else if (
            callee.object.type === 'Identifier' &&
            values.has(callee.object.name)
          ) {
            // `items.push(x)` on a destructured prop changes the parent's array.
            context.report({
              node,
              messageId: 'mutation',
              data: { path: callee.object.name }
            })
          }
        }
      }
    }
  }
}

const LITERAL_TYPES = { String: 'string', Number: 'number', Boolean: 'boolean' }

/** The constructor names of a prop `type`: `String`, `[String, Number]`. */
const typeNames = node => {
  if (node?.type === 'Identifier') {
    return [node.name]
  }
  if (node?.type === 'ArrayExpression') {
    return node.elements.flatMap(element => typeNames(element))
  }
  return []
}

const isFactoryless = node =>
  node?.type === 'ObjectExpression' || node?.type === 'ArrayExpression'

const literalKind = node => {
  if (node?.type === 'Literal' && node.value !== null) {
    return typeof node.value
  }
  if (node?.type === 'TemplateLiteral') {
    return 'string'
  }
  return null
}

const VALUE_TYPES = { ...LITERAL_TYPES, Object: 'object', Array: 'array' }

/** The kind of a value a factory returns: a literal, an object or an array. */
const valueKind = node =>
  node?.type === 'ObjectExpression'
    ? 'object'
    : node?.type === 'ArrayExpression'
      ? 'array'
      : literalKind(node)

/** What a default factory returns, when it is one plain expression. */
const factoryResult = node => {
  if (
    node?.type !== 'ArrowFunctionExpression' &&
    node?.type !== 'FunctionExpression'
  ) {
    return null
  }
  if (node.body.type !== 'BlockStatement') {
    return node.body
  }
  const statement = node.body.body.at(-1)
  return node.body.body.length === 1 && statement.type === 'ReturnStatement'
    ? statement.argument
    : null
}

const validDefaultProp = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'An object or array prop default must be a factory function, and a literal default must match the prop type.'
    },
    schema: [],
    messages: {
      factory:
        'The default of "{{name}}" is shared by every instance: return it from a function.',
      type: 'The default of "{{name}}" is a {{kind}}, but the prop type is {{types}}.'
    }
  },
  create(context) {
    const checkRuntime = object => {
      for (const prop of object.properties) {
        if (
          prop.type !== 'Property' ||
          prop.value.type !== 'ObjectExpression'
        ) {
          continue
        }
        const name = prop.key.name ?? prop.key.value
        const field = key =>
          prop.value.properties.find(
            item => item.type === 'Property' && item.key.name === key
          )?.value
        const value = field('default')
        if (!value) {
          continue
        }
        const types = typeNames(field('type'))
        if (isFactoryless(value)) {
          context.report({ node: value, messageId: 'factory', data: { name } })
          continue
        }
        // A literal default, or the value a factory returns (`() => ({})`).
        const returned = factoryResult(value)
        const kind = returned ? valueKind(returned) : literalKind(value)
        const known = returned ? VALUE_TYPES : LITERAL_TYPES
        const expected = types.map(type => known[type])
        if (
          kind &&
          types.length > 0 &&
          expected.every(Boolean) &&
          !expected.includes(kind)
        ) {
          context.report({
            node: value,
            messageId: 'type',
            data: { name, kind, types: types.join(' or ') }
          })
        }
      }
    }
    return {
      CallExpression(node) {
        const name = calleeName(node)
        if (
          name === 'defineProps' &&
          node.arguments[0]?.type === 'ObjectExpression'
        ) {
          checkRuntime(node.arguments[0])
        } else if (
          name === 'withDefaults' &&
          node.arguments[1]?.type === 'ObjectExpression'
        ) {
          for (const prop of node.arguments[1].properties) {
            if (prop.type === 'Property' && isFactoryless(prop.value)) {
              context.report({
                node: prop.value,
                messageId: 'factory',
                data: { name: prop.key.name ?? prop.key.value }
              })
            }
          }
        }
      },
      // `defineComponent({ props: { ... } })` and a component options object
      // exported as is: `export default { props: { ... } }`.
      Property(node) {
        const options = node.parent
        const owner = options?.parent
        if (
          node.key.type === 'Identifier' &&
          node.key.name === 'props' &&
          node.value.type === 'ObjectExpression' &&
          options?.type === 'ObjectExpression' &&
          ((owner?.type === 'CallExpression' &&
            calleeName(owner) === 'defineComponent') ||
            owner?.type === 'ExportDefaultDeclaration')
        ) {
          checkRuntime(node.value)
        }
      }
    }
  }
}

export default {
  meta: { name: 'vue-script' },
  rules: {
    'no-ref-as-condition': noRefAsCondition,
    'no-mutating-props': noMutatingProps,
    'valid-default-prop': validDefaultProp
  }
}
