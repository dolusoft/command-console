import { selectorRule } from './selector-rule.mjs'

const message =
  'Listen on the console elements only, never on window or document (C-52).'

// README: Keyboard, DOM and styling (D-07, C-52).
export default {
  meta: { name: 'fences' },
  rules: {
    'no-global-listeners': selectorRule(
      'Keys are listened to on the console elements only (C-52).',
      [
        {
          selector:
            "CallExpression[callee.property.name='addEventListener'][callee.object.name=/^(window|document|globalThis|self)$/]",
          message
        },
        {
          selector:
            "CallExpression[callee.property.name='addEventListener'][callee.object.property.name=/^(window|document|ownerDocument|defaultView)$/]",
          message
        }
      ]
    )
  }
}
