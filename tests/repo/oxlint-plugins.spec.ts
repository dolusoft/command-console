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
        `const r = ref(0); const x = r ?? 1`,
        `import { ref as makeRef } from 'vue'; const r = makeRef(false); if (r.value) {}`,
        `import { makeRef } from './other'; const r = makeRef(false); if (r) {}`,
        // A parameter or a nested binding of the same name is not the ref.
        `const open = ref(false); function f(open: boolean) { if (open) {} }`,
        `const open = ref(false); const g = () => { const open = true; return open ? 1 : 2 }`,
        // A parameter that shadows the factory, its alias or the namespace.
        `import { ref as makeRef } from 'vue'; function f(makeRef: () => boolean) { const r = makeRef(); if (r) {} }`,
        `function f(ref: () => boolean) { const r = ref(); if (r) {} }`,
        `import * as Vue from 'vue'; function f(Vue: { ref: () => boolean }) { const r = Vue.ref(); if (r) {} }`,
        `import { ref } from './not-vue'; const r = ref(); if (r) {}`
      ],
      invalid: [
        `const open = ref(false); if (open) {}`,
        `const n = computed(() => 1); const x = n ? 1 : 2`,
        `const s = shallowRef(null); const y = !s`,
        `const t = toRef(o, 'a'); const z = t && 1`,
        `const r = ref(0); while (r) {}`,
        // Through an alias or a namespace import of 'vue'.
        `import { ref as makeRef } from 'vue'; const r = makeRef(false); if (r) {}`,
        `import { computed as derive } from 'vue'; const c = derive(() => 1); const x = c ? 1 : 2`,
        `import * as Vue from 'vue'; const r = Vue.ref(false); if (r) {}`,
        `const open = ref(false); function f(other: boolean) { if (open) {} }`
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
        `const props = defineProps<{ items: string[] }>(); props.items.map(item => item)`,
        `const { items } = defineProps<{ items: string[] }>(); const copy = [...items]; copy.push('x')`,
        `const { items } = defineProps<{ items: string[] }>(); items.map(item => item)`,
        `export default { props: { items: Array }, data: () => ({ local: [] }), methods: { add() { this.local.push(1); this.items.map(i => i) } } }`,
        // A parameter or a nested binding that shadows a prop.
        `const { items } = defineProps<{ items: string[] }>(); function f(items: string[]) { items.push('x') }`,
        `const props = defineProps<{ a: { b: number } }>(); const g = (props: { a: { b: number } }) => { props.a.b = 1 }`,
        `const { items } = defineProps<{ items: string[] }>(); { const items: string[] = []; items.push('x') }`,
        `function setupLike(defineProps: () => { a: { b: number } }) { const props = defineProps(); props.a.b = 1 }`,
        // \`this\` of another object, or of a plain function inside a method.
        `export default { props: { items: Array } }; const store = { items: [], add() { this.items.push(1) } }`,
        `export default { props: ['items'], methods: { add() { [1].forEach(function () { this.items.push(1) }) } } }`,
        `const other = { props: { items: Array }, methods: { add() { this.items.push(1) } } }`
      ],
      invalid: [
        `const props = defineProps<{ items: string[] }>(); props.items.push('x')`,
        `const props = defineProps<{ deep: { a: number } }>(); props.deep.a = 2`,
        `const props = withDefaults(defineProps<{ n: number }>(), { n: 1 }); props.n++`,
        `const props = defineProps<{ map: Map<string, number> }>(); props.map.clear()`,
        `const props = defineProps<{ o: Record<string, number> }>(); delete props.o.k`,
        `export default defineComponent({ setup(props) { props.list.sort() } })`,
        // Destructured props: the nested values still belong to the parent.
        `const { items } = defineProps<{ items: string[] }>(); items.push('x')`,
        `const { items: list } = defineProps<{ items: string[] }>(); list.sort()`,
        `const { deep } = defineProps<{ deep: { a: number } }>(); deep.a = 2`,
        `const { o = {} } = defineProps<{ o?: Record<string, number> }>(); delete o.k`,
        `const { n, ...rest } = defineProps<{ n: number; m: { a: number } }>(); rest.m.a++`,
        `export default defineComponent({ setup({ list }) { list.reverse() } })`,
        // Options API: a prop read through `this`.
        `export default { props: { items: Array }, methods: { add() { this.items.push(1) } } }`,
        `export default { methods: { add() { this.items.push(1) } }, props: ['items'] }`,
        `export default defineComponent({ props: { n: Number }, methods: { inc() { this.n++ } } })`,
        `export default { props: { deep: Object }, methods: { set() { this.deep.a = 1 } } }`,
        `export default { props: ['items'], methods: { add() { [1].forEach(() => this.items.push(1)) } } }`,
        `const { items } = defineProps<{ items: string[] }>(); function f(other: string[]) { items.push('x') }`
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
        `defineComponent({ props: { o: { type: Object, default: () => ({}) } } })`,
        `export default { props: { items: { type: Array, default: () => [] } } }`,
        `const other = { props: { items: { type: Array, default: [] } } }`,
        `defineProps({ o: { type: [Object, Array], default: () => [] } })`,
        `defineProps({ fn: { type: Function, default: () => 1 } })`,
        // A shadowing local function is not the Vue macro or helper.
        `function f(defineProps: (o: object) => void) { defineProps({ items: { type: Array, default: [] } }) }`,
        `import { defineComponent } from './local'; defineComponent({ props: { o: { type: Object, default: {} } } })`
      ],
      invalid: [
        `defineProps({ items: { type: Array, default: [] } })`,
        `defineProps({ label: { type: String, default: 1 } })`,
        `defineProps({ flag: { type: Boolean, default: 'yes' } })`,
        `withDefaults(defineProps<{ o?: object }>(), { o: {} })`,
        `defineComponent({ props: { o: { type: Object, default: {} } } })`,
        `export default { props: { items: { type: Array, default: [] } } }`,
        `export default { props: { label: { type: String, default: 1 } } }`,
        // A factory must return the declared type.
        `defineProps({ items: { type: Array, default: () => ({}) } })`,
        `defineProps({ o: { type: Object, default: () => [] } })`,
        `defineProps({ o: { type: Object, default() { return 'x' } } })`,
        // A literal default that is not an object or an array.
        `defineProps({ items: { type: Array, default: 1 } })`,
        `defineProps({ o: { type: Object, default: 'x' } })`,
        `import { defineComponent as dc } from 'vue'; dc({ props: { o: { type: Object, default: {} } } })`
      ].map(code => ({ code, errors: 1 }))
    })
  })
})
