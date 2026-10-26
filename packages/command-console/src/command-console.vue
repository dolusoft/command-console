<script setup lang="ts">
// <CommandConsole> (spec §7.2): the composable's console drawn as the DOM of
// spec §7.3. The component holds no console state (P15): it renders the
// snapshot and forwards DOM events to core actions. What it keeps is
// DOM-bound: element refs, the "stuck to bottom" flag, the last value it
// emitted per controlled slice and the caret it last reported.
import {
  computed,
  onMounted,
  toRef,
  useId,
  useTemplateRef,
  watch,
  type FunctionalComponent
} from 'vue'

import {
  consoleFeatures,
  contextFeature,
  recallFeature,
  type OptionalFeatures,
  type Updater
} from '@dolusoft/command-console-core'
import type { ConsoleEntry, ContextFrame } from '@dolusoft/command-protocol'

import type {
  ConsoleEmits,
  ConsoleProps,
  ConsoleSlots,
  ConsoleSubmit
} from './contract'
import { clickFocusesInput } from './dom/focus'
import { keyInputOf } from './dom/keys'
import { useStickToBottom } from './dom/scroll'
import { resolveLabels } from './labels'
import { renderCompletions, optionId } from './parts/completions-view'
import { renderEntry, renderPrompt } from './parts/entry-view'
import { useCommandConsole } from './use-command-console'

defineOptions({ name: 'CommandConsole' })

const props = withDefaults(defineProps<ConsoleProps>(), {
  prompt: undefined,
  initialState: undefined,
  createId: undefined,
  maxEntries: undefined,
  beforeRun: undefined,
  onError: undefined,
  formatError: undefined,
  isSensitive: undefined,
  recallLimit: undefined,
  shouldRecord: undefined,
  labels: undefined,
  autofocus: false,
  entries: undefined,
  recall: undefined,
  context: undefined
})

const emit = defineEmits<ConsoleEmits>()

const slots = defineSlots<ConsoleSlots>()

// The component always uses every optional feature (spec §7.2).
// TODO(features): add `completionFeature` once it is on `main`.
const features = consoleFeatures({
  recallFeature,
  contextFeature
}) as unknown as OptionalFeatures

// --- v-model (spec §3.4, C-61) ----------------------------------------------
// An updater is resolved against the value this component last emitted for
// the slice, else the prop: a second action in the same tick builds on the
// first one's value, not on a prop the parent has not re-rendered yet. A new
// prop value clears it.
type Slice = 'entries' | 'recall' | 'context'
interface SliceValues {
  entries: ConsoleEntry[]
  recall: string[]
  context: ContextFrame[]
}
const lastEmitted: Partial<SliceValues> = {}
for (const slice of ['entries', 'recall', 'context'] as const) {
  watch(
    () => props[slice],
    () => {
      delete lastEmitted[slice]
    },
    { flush: 'sync' }
  )
}
const report =
  <K extends Slice>(slice: K, send: (value: SliceValues[K]) => void) =>
  (updater: Updater<SliceValues[K]>) => {
    const base = (lastEmitted[slice] ?? props[slice] ?? []) as SliceValues[K]
    const value = typeof updater === 'function' ? updater(base) : updater
    lastEmitted[slice] = value
    send(value)
  }

/** The slices bound with `v-model`; the others are the console's. */
const controlled = () => {
  const state: Partial<SliceValues> = {}
  if (props.entries !== undefined) {
    state.entries = props.entries
  }
  if (props.recall !== undefined) {
    state.recall = props.recall
  }
  if (props.context !== undefined) {
    state.context = props.context
  }
  return state
}

const { console, state } = useCommandConsole({
  features,
  commands: () => props.commands,
  prompt: () => props.prompt,
  state: controlled,
  maxEntries: () => props.maxEntries,
  recallLimit: () => props.recallLimit,
  initialState: props.initialState,
  createId: toRef(props, 'createId'),
  beforeRun: toRef(props, 'beforeRun'),
  onError: toRef(props, 'onError'),
  formatError: toRef(props, 'formatError'),
  isSensitive: toRef(props, 'isSensitive'),
  shouldRecord: toRef(props, 'shouldRecord'),
  onEntriesChange: report('entries', value => emit('update:entries', value)),
  onRecallChange: report('recall', value => emit('update:recall', value)),
  onContextChange: report('context', value => emit('update:context', value)),
  onClose: () => emit('close')
})

// --- What the template draws ------------------------------------------------

const labels = computed(() => resolveLabels(props.labels))
const listId = useId()

const running = computed(() => state.value.running)
const session = computed(() => {
  const completion = state.value.completion
  return completion?.status === 'open' ? completion : null
})
const activeId = computed(() =>
  session.value && session.value.active >= 0
    ? optionId(listId, session.value.active)
    : undefined
)
/** The prompt of the live line: the top context frame's, or the root's. */
const prompt = computed(() => {
  void state.value.context
  void props.prompt
  return console.getPrompt()
})
/**
 * The recalled line, for the status element (spec §6.3): a screen reader
 * does not announce a scripted value change in a focused field.
 */
const recalled = computed(() => {
  const { recall, recallCursor } = state.value
  return recallCursor !== null ? (recall[recallCursor] ?? '') : ''
})

const entriesView: FunctionalComponent = () =>
  state.value.entries.map(entry => renderEntry(entry, labels.value, slots))
const completionsView: FunctionalComponent = () =>
  session.value
    ? renderCompletions(session.value, listId, labels.value.completions, slots)
    : null
const promptView: FunctionalComponent = () => renderPrompt(prompt.value, slots)

// --- Elements ---------------------------------------------------------------

const rootElement = useTemplateRef<HTMLDivElement>('root')
const logElement = useTemplateRef<HTMLDivElement>('log')
const entriesElement = useTemplateRef<HTMLDivElement>('entries')
const inputElement = useTemplateRef<HTMLInputElement>('input')

const scroll = useStickToBottom(logElement, entriesElement)

const focusInput = () => inputElement.value?.focus()

onMounted(() => {
  if (props.autofocus) {
    focusInput()
  }
})

// C-51: a click in the log focuses the input, unless text is selected or
// the click was on something interactive.
const onLogClick = (event: MouseEvent) => {
  if (logElement.value && clickFocusesInput(event.target, logElement.value)) {
    focusInput()
  }
}

// --- The input element (spec §7.4, C-54) ------------------------------------
// The element is keyed by `input.revision`. When it is replaced, the new
// one gets focus only if the old one had it, and the caret goes to the end.
// Its value is written as a DOM property here, never bound in the template:
// Vue mirrors a bound `value` into the `value` attribute, which would put
// the typed line into the DOM.

let hadFocus = false
watch(
  () => state.value.input.revision,
  () => {
    const element = inputElement.value
    hadFocus =
      element !== null && element.ownerDocument.activeElement === element
    // The element about to go may hold a sensitive line (C-36).
    if (element) {
      element.value = ''
    }
  },
  { flush: 'pre' }
)

/** The value and caret this component last reported (a user edit). */
let reported = { value: '', caret: 0 }

/**
 * Writes the console's value into the element. A write by the console
 * (completion, recall) also sets the caret it chose; the user's own edit is
 * left alone, so a selection the user made stays.
 */
const syncElement = (replaced: boolean) => {
  const element = inputElement.value
  if (!element) {
    return
  }
  const { value, caret } = state.value.input
  if (element.value !== value) {
    element.value = value
  }
  if (replaced) {
    if (hadFocus) {
      element.focus()
    }
    hadFocus = false
    element.setSelectionRange(value.length, value.length)
    return
  }
  if (
    element.ownerDocument.activeElement !== element ||
    (value === reported.value && caret === reported.caret)
  ) {
    return
  }
  if (element.selectionStart !== caret || element.selectionEnd !== caret) {
    element.setSelectionRange(caret, caret)
  }
}
onMounted(() => {
  syncElement(false)
})
watch(
  () => state.value.input,
  (next, previous) => {
    syncElement(next.revision !== previous.revision)
  },
  { flush: 'post' }
)

/** Reports the element's value and caret to the console (a user edit). */
const reportEdit = (element: HTMLInputElement) => {
  const caret = element.selectionStart ?? element.value.length
  reported = { value: element.value, caret }
  console.editInput(element.value, caret)
}

const onInput = (event: Event) => {
  reportEdit(event.currentTarget as HTMLInputElement)
}

// A caret move the user made (click, arrow keys, selection).
const onCaret = (event: Event) => {
  const element = event.currentTarget as HTMLInputElement
  const caret = element.selectionStart ?? element.value.length
  if (element.value !== state.value.input.value) {
    return
  }
  if (caret !== state.value.input.caret) {
    reportEdit(element)
  }
}

// --- Submits (C-64) ---------------------------------------------------------

/**
 * Runs `action` and emits `submit` for the input entry it added, if any;
 * keeps the log at the bottom after the user's own submit (C-58).
 */
const submitting = <T,>(action: () => T): T => {
  const before = new Set(state.value.entries.map(entry => entry.id))
  const result = action()
  const added = console
    .getState()
    .entries.find(
      entry =>
        entry.kind === 'input' &&
        entry.status === 'submitted' &&
        !before.has(entry.id)
    )
  if (added) {
    scroll.stick()
    const submit: ConsoleSubmit = {
      inputId: added.id,
      sensitive: added.kind === 'input' && added.redacted
    }
    emit('submit', submit)
  }
  return result
}

const onKeydown = (event: KeyboardEvent) => {
  const element = event.currentTarget as HTMLInputElement
  const key = keyInputOf(event, element, rootElement.value)
  if (!key.isComposing) {
    // The caret may have moved without an event the console saw.
    onCaret(event)
  }
  const handled = submitting(() => console.handleKey(key))
  if (handled) {
    event.preventDefault()
  }
}

// --- Expose ------------------------------------------------------------------

const exposed = {
  focus: () => {
    focusInput()
  },
  run: (line: string) => submitting(() => console.run(line)),
  cancel: () => {
    console.cancel()
  },
  reset: () => {
    console.reset()
  },
  clear: () => {
    console.clearEntries()
  },
  console,
  state
}
defineExpose(exposed)
</script>

<template>
  <div
    ref="root"
    class="cc-console"
    :data-busy="running ? '' : undefined"
    :data-context-depth="state.context.length"
  >
    <div
      ref="log"
      class="cc-log"
      role="log"
      :aria-label="labels.log"
      @click="onLogClick"
      @scroll="scroll.onScroll"
    >
      <div ref="entries" class="cc-entries">
        <component :is="entriesView" />
      </div>
    </div>
    <div class="cc-status" role="status">
      <template v-if="running"
        ><slot name="busy" :running="running">{{ labels.busy }}</slot></template
      ><template v-else>{{ recalled }}</template>
    </div>
    <component :is="completionsView" />
    <div class="cc-input-line">
      <component :is="promptView" />
      <input
        :key="state.input.revision"
        ref="input"
        class="cc-input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="session ? 'true' : 'false'"
        :aria-controls="session ? listId : undefined"
        :aria-activedescendant="activeId"
        :aria-label="labels.input"
        :aria-description="labels.inputDescription"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        :readonly="running !== null"
        @input="onInput"
        @keydown="onKeydown"
        @keyup="onCaret"
        @click="onCaret"
        @selectionchange="onCaret"
      />
    </div>
  </div>
</template>
