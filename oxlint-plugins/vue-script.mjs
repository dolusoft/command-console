// Three script checks for Vue code that neither oxlint's built-in rules nor
// the type check (`vue-tsc`) cover (decisions O5 and N3 of the oxlint
// migration). They read the script only, never the template, so they run on
// `.vue` and `.ts` files alike.
//
//   no-ref-as-condition    a ref used as a condition is always truthy
//   no-mutating-props      props are read-only, nested values included
//   valid-default-prop     an object or array default must be a factory,
//                          and a default must match the prop type
//
// Every name is resolved through the scope manager, never matched by text: a
// parameter or a nested binding that shadows a ref, a prop or a Vue function
// is a different variable and is left alone.

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

/**
 * The scope resolver of one file. `binding(identifier)` is the identifier
 * that declares the variable a name refers to (a declarator id, a parameter,
 * an import's local name), or `null` for a name nothing declares (a global,
 * an auto-import, a compiler macro such as `defineProps`).
 */
const resolver = context => {
  const vueImports = new Map()
  const binding = node => {
    for (
      let scope = context.sourceCode.getScope(node);
      scope;
      scope = scope.upper
    ) {
      const variable = scope.set.get(node.name)
      if (variable) {
        return variable.defs[0]?.name ?? variable.identifiers[0] ?? null
      }
    }
    return null
  }
  /** The Vue export a name refers to: its import, or a free global name. */
  const vueName = node => {
    if (node?.type !== 'Identifier') {
      return null
    }
    const declared = binding(node)
    return declared ? (vueImports.get(declared) ?? null) : node.name
  }
  /** The Vue function a call calls: `ref()`, `makeRef()`, `Vue.ref()`. */
  const vueCallee = call => {
    if (call?.type !== 'CallExpression') {
      return null
    }
    const callee = call.callee
    if (callee.type === 'Identifier') {
      return vueName(callee)
    }
    if (
      callee.type === 'MemberExpression' &&
      !callee.computed &&
      callee.object.type === 'Identifier' &&
      callee.property.type === 'Identifier'
    ) {
      const declared = binding(callee.object)
      return declared && vueImports.get(declared) === '*'
        ? callee.property.name
        : null
    }
    return null
  }
  const ImportDeclaration = node => {
    if (node.source.value !== 'vue') {
      return
    }
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportNamespaceSpecifier') {
        vueImports.set(specifier.local, '*')
      } else if (specifier.type === 'ImportSpecifier') {
        vueImports.set(
          specifier.local,
          specifier.imported.name ?? specifier.imported.value
        )
      }
    }
  }
  return { binding, vueCallee, ImportDeclaration }
}

/** `defineProps(...)` or `withDefaults(defineProps(...), ...)`. */
const isDefineProps = (node, vueCallee) =>
  vueCallee(node) === 'defineProps' ||
  (vueCallee(node) === 'withDefaults' &&
    vueCallee(node.arguments[0]) === 'defineProps')

/** The identifiers a destructuring pattern binds: `{ a, b: c, d = 1, ...e }`. */
const patternIdentifiers = (node, out = []) => {
  if (!node) {
    return out
  }
  if (node.type === 'Identifier') {
    out.push(node)
  } else if (node.type === 'ObjectPattern') {
    for (const property of node.properties) {
      patternIdentifiers(
        property.type === 'RestElement' ? property.argument : property.value,
        out
      )
    }
  } else if (node.type === 'ArrayPattern') {
    node.elements.forEach(element => patternIdentifiers(element, out))
  } else if (node.type === 'AssignmentPattern') {
    patternIdentifiers(node.left, out)
  } else if (node.type === 'RestElement') {
    patternIdentifiers(node.argument, out)
  }
  return out
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

/** The first member of a chain on `this`: `this.items` for `this.items[0].a`. */
const thisMemberOf = node => {
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
    current.object.type === 'ThisExpression' &&
    !current.computed &&
    current.property.type === 'Identifier'
    ? current
    : null
}

const propertyName = property =>
  property.key.type === 'Identifier' && !property.computed
    ? property.key.name
    : property.key.type === 'Literal'
      ? String(property.key.value)
      : null

/** An options object of `defineComponent({ ... })` or `export default { ... }`. */
const isComponentOptions = (node, vueCallee) =>
  node?.type === 'ObjectExpression' &&
  ((node.parent?.type === 'CallExpression' &&
    node.parent.arguments[0] === node &&
    vueCallee(node.parent) === 'defineComponent') ||
    node.parent?.type === 'ExportDefaultDeclaration')

/** The names of the `props` option of an options object. */
const optionPropNames = options => {
  const props = options.properties.find(
    item => item.type === 'Property' && propertyName(item) === 'props'
  )?.value
  if (props?.type === 'ObjectExpression') {
    return props.properties
      .filter(item => item.type === 'Property')
      .map(propertyName)
  }
  if (props?.type === 'ArrayExpression') {
    return props.elements
      .filter(item => item?.type === 'Literal')
      .map(item => item.value)
  }
  return []
}

const FUNCTIONS = new Set(['FunctionExpression', 'FunctionDeclaration'])

/**
 * The component options object `this` belongs to: the nearest options
 * object around it, unless a plain `function` in between rebinds `this`
 * (a method of a nested option object, `methods: { add() {} }`, does not).
 */
const thisOwner = (node, vueCallee) => {
  for (let current = node.parent; current; current = current.parent) {
    if (isComponentOptions(current, vueCallee)) {
      return current
    }
    if (
      FUNCTIONS.has(current.type) &&
      !(current.parent?.type === 'Property' && current.parent.value === current)
    ) {
      return null
    }
  }
  return null
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
    const scope = resolver(context)
    // The declaring identifiers of the refs.
    const refs = new Set()
    const check = node => {
      if (node?.type === 'Identifier' && refs.has(scope.binding(node))) {
        context.report({
          node,
          messageId: 'condition',
          data: { name: node.name }
        })
      }
    }
    return {
      ImportDeclaration: scope.ImportDeclaration,
      VariableDeclarator(node) {
        if (
          node.id.type === 'Identifier' &&
          REF_FACTORIES.has(scope.vueCallee(node.init))
        ) {
          refs.add(node.id)
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
    const scope = resolver(context)
    const source = context.sourceCode
    // Declaring identifiers: `objects` of the props objects (`props` of
    // `const props = defineProps()` or `setup(props)`), `values` of the props
    // taken out by destructuring (`const { items } = defineProps()`).
    const objects = new Set()
    const values = new Set()
    const bind = pattern => {
      if (pattern?.type === 'Identifier') {
        objects.add(pattern)
      } else if (pattern?.type === 'ObjectPattern') {
        patternIdentifiers(pattern).forEach(id => values.add(id))
      }
    }
    const mutation = (node, target) =>
      context.report({
        node,
        messageId: 'mutation',
        data: { path: source.getText(target) }
      })
    /** Reports a change of `target`; `deep` when a method changes its value. */
    const report = (node, target, deep = false) => {
      const root = rootOf(target)
      if (root) {
        const declared = scope.binding(root)
        if (
          (objects.has(declared) && target !== root) ||
          (values.has(declared) && (target !== root || deep))
        ) {
          mutation(node, target)
        }
        return
      }
      const member = thisMemberOf(target)
      if (member) {
        const owner = thisOwner(member, scope.vueCallee)
        if (
          owner &&
          optionPropNames(owner).includes(member.property.name) &&
          (target !== member.object || deep)
        ) {
          mutation(node, target)
        }
      }
    }
    return {
      ImportDeclaration: scope.ImportDeclaration,
      VariableDeclarator(node) {
        if (isDefineProps(node.init, scope.vueCallee)) {
          bind(node.id)
        }
      },
      // `setup(props) {}` and `setup: (props) => {}` of a component.
      Property(node) {
        const fn = node.value
        if (
          propertyName(node) === 'setup' &&
          (fn.type === 'FunctionExpression' ||
            fn.type === 'ArrowFunctionExpression') &&
          isComponentOptions(node.parent, scope.vueCallee)
        ) {
          bind(fn.params[0])
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
          // `props.items.push(x)`, `items.push(x)`, `this.items.push(x)`.
          report(node, callee.object, true)
        }
      }
    }
  }
}

/** What a constructor in a prop `type` accepts as a default value. */
const KIND_OF_TYPE = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Object: 'object',
  Array: 'array'
}

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

/** The kind of a value: a literal, an object or an array; `null` when unknown. */
const valueKind = node => {
  if (node?.type === 'ObjectExpression') {
    return 'object'
  }
  if (node?.type === 'ArrayExpression') {
    return 'array'
  }
  if (node?.type === 'Literal' && node.value !== null && !node.regex) {
    return typeof node.value
  }
  if (node?.type === 'TemplateLiteral') {
    return 'string'
  }
  return null
}

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
        'An object or array prop default must be a factory function, and a default must match the prop type.'
    },
    schema: [],
    messages: {
      factory:
        'The default of "{{name}}" is shared by every instance: return it from a function.',
      type: 'The default of "{{name}}" is a {{kind}}, but the prop type is {{types}}.'
    }
  },
  create(context) {
    const scope = resolver(context)
    const checkRuntime = object => {
      for (const prop of object.properties) {
        if (
          prop.type !== 'Property' ||
          prop.value.type !== 'ObjectExpression'
        ) {
          continue
        }
        const name = propertyName(prop)
        const field = key =>
          prop.value.properties.find(
            item => item.type === 'Property' && propertyName(item) === key
          )?.value
        const value = field('default')
        if (!value) {
          continue
        }
        if (isFactoryless(value)) {
          context.report({ node: value, messageId: 'factory', data: { name } })
          continue
        }
        // A literal default, or the value a factory returns (`() => ({})`).
        // A type outside the table (`Function`, a class) accepts anything.
        const types = typeNames(field('type'))
        const kind = valueKind(factoryResult(value) ?? value)
        const expected = types.map(type => KIND_OF_TYPE[type])
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
      ImportDeclaration: scope.ImportDeclaration,
      CallExpression(node) {
        const name = scope.vueCallee(node)
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
                data: { name: propertyName(prop) }
              })
            }
          }
        }
      },
      // `defineComponent({ props: { ... } })` and `export default { props }`.
      Property(node) {
        if (
          propertyName(node) === 'props' &&
          node.value.type === 'ObjectExpression' &&
          isComponentOptions(node.parent, scope.vueCallee)
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
