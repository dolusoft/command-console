import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { RuleTester } from 'oxlint/plugins-dev'
import { describe, it } from 'vitest'

// The local oxlint rules other than the layers (lint-fences.spec.ts):
// `fences/no-global-listeners` (C-52) and the three Vue script checks of
// oxlint-plugins/vue-script.mjs. Each runs through oxlint's RuleTester.

type Rule = Parameters<RuleTester['run']>[1]
type Plugin = { default: { rules: Record<string, Rule> } }

const root = join(import.meta.dirname, '..', '..')
const load = async (name: string) =>
  (
    (await import(
      pathToFileURL(join(root, 'oxlint-plugins', name)).href
    )) as Plugin
  ).default.rules

const fences = await load('fences.mjs')
const vueScript = await load('vue-script.mjs')

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: 'ts' } }
})

describe('fences/no-global-listeners', () => {
  it('refuses listeners on window and document, directly or through an element', () => {
    tester.run('no-global-listeners', fences['no-global-listeners'], {
      valid: [
        `input.addEventListener('keydown', () => {})`,
        `void document.activeElement`,
        `el.parentElement.addEventListener('click', () => {})`
      ],
      invalid: [
        `window.addEventListener('keydown', () => {})`,
        `document.addEventListener('keydown', () => {})`,
        `globalThis.addEventListener('resize', () => {})`,
        `self.addEventListener('message', () => {})`,
        `el.ownerDocument.addEventListener('selectionchange', () => {})`,
        `el.ownerDocument.defaultView.addEventListener('resize', () => {})`
      ].map(code => ({
        code,
        errors: [
          {
            message:
              'Listen on the console elements only, never on window or document (C-52).'
          }
        ]
      }))
    })
  })
})

describe('vue-script/no-ref-as-condition', () => {
  it('refuses a ref, a shallowRef or a computed as a condition, not its value', () => {
    tester.run('no-ref-as-condition', vueScript['no-ref-as-condition'], {
      valid: [
        `const open = ref(false); if (open.value) {}`,
        `const n = computed(() => 1); const x = n.value ? 1 : 2`,
        `const plain = false; if (plain) {}`,
        `const r = ref(0); const x = r ?? 1`
      ],
      invalid: [
        `const open = ref(false); if (open) {}`,
        `const n = computed(() => 1); const x = n ? 1 : 2`,
        `const s = shallowRef(null); const y = !s`,
        `const t = toRef(o, 'a'); const z = t && 1`,
        `const r = ref(0); while (r) {}`
      ].map(code => ({ code, errors: 1 }))
    })
  })
})

describe('vue-script/no-mutating-props', () => {
  it('refuses assignments to props and changes of their nested values', () => {
    tester.run('no-mutating-props', vueScript['no-mutating-props'], {
      valid: [
        `const props = defineProps<{ items: string[] }>(); const copy = [...props.items]; copy.push('x')`,
        `const props = defineProps<{ a: number }>(); const local = { a: props.a }; local.a = 2`,
        `const other = { items: [] as string[] }; other.items.push('x')`,
        `const props = defineProps<{ items: string[] }>(); props.items.map(item => item)`
      ],
      invalid: [
        `const props = defineProps<{ items: string[] }>(); props.items.push('x')`,
        `const props = defineProps<{ deep: { a: number } }>(); props.deep.a = 2`,
        `const props = withDefaults(defineProps<{ n: number }>(), { n: 1 }); props.n++`,
        `const props = defineProps<{ map: Map<string, number> }>(); props.map.clear()`,
        `const props = defineProps<{ o: Record<string, number> }>(); delete props.o.k`,
        `export default defineComponent({ setup(props) { props.list.sort() } })`
      ].map(code => ({ code, errors: 1 }))
    })
  })
})

describe('vue-script/valid-default-prop', () => {
  it('requires a factory for object and array defaults and a matching literal type', () => {
    tester.run('valid-default-prop', vueScript['valid-default-prop'], {
      valid: [
        `defineProps({ items: { type: Array, default: () => [] } })`,
        `defineProps({ label: { type: String, default: 'x' } })`,
        `defineProps({ size: { type: [String, Number], default: 2 } })`,
        `withDefaults(defineProps<{ items?: string[] }>(), { items: () => [] })`,
        `defineComponent({ props: { o: { type: Object, default: () => ({}) } } })`
      ],
      invalid: [
        `defineProps({ items: { type: Array, default: [] } })`,
        `defineProps({ label: { type: String, default: 1 } })`,
        `defineProps({ flag: { type: Boolean, default: 'yes' } })`,
        `withDefaults(defineProps<{ o?: object }>(), { o: {} })`,
        `defineComponent({ props: { o: { type: Object, default: {} } } })`
      ].map(code => ({ code, errors: 1 }))
    })
  })
})
