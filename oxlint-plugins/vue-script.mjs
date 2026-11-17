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
    const check = node => {
      if (node?.type === 'Identifier' && refs.has(node.name)) {
        context.report({
          node,
          messageId: 'condition',
          data: { name: node.name }
        })
      }
    }
    return {
      VariableDeclarator(node) {
        if (
          node.id.type === 'Identifier' &&
          REF_FACTORIES.has(calleeName(node.init))
        ) {
          refs.add(node.id.name)
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
    const props = new Set()
    const source = context.sourceCode
    const report = (node, target) => {
      const root = rootOf(target)
      if (root && props.has(root.name) && target !== root) {
        context.report({
          node,
          messageId: 'mutation',
          data: { path: source.getText(target) }
        })
      }
    }
    return {
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' && isDefineProps(node.init)) {
          props.add(node.id.name)
        }
      },
      // `defineComponent({ setup(props) {} })` and `setup: (props) => {}`.
      Property(node) {
        const key = node.key.type === 'Identifier' ? node.key.name : null
        const fn = node.value
        if (
          key === 'setup' &&
          (fn.type === 'FunctionExpression' ||
            fn.type === 'ArrowFunctionExpression') &&
          fn.params[0]?.type === 'Identifier'
        ) {
          props.add(fn.params[0].name)
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
          MUTATING_METHODS.has(callee.property.name) &&
          callee.object.type === 'MemberExpression'
        ) {
          report(node, callee.object)
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
        const kind = literalKind(value)
        const expected = types.map(type => LITERAL_TYPES[type])
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
      // `defineComponent({ props: { ... } })` and plain options objects.
      Property(node) {
        if (
          node.key.type === 'Identifier' &&
          node.key.name === 'props' &&
          node.value.type === 'ObjectExpression' &&
          node.parent?.type === 'ObjectExpression' &&
          node.parent.parent?.type === 'CallExpression' &&
          calleeName(node.parent.parent) === 'defineComponent'
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
