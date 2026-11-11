/**
 * The DOM contract (P6): the classes, attributes and ids `<CommandConsole>`
 * renders. They are the only hooks a skin may select, and every element the
 * library renders carries only the hooks listed here, each on the element it
 * is listed for (C-45). Slot content is the consumer's and is not covered.
 * `CONTRACT.md` is generated from this file and the browser tests compare
 * the rendered DOM with it.
 *
 * There is no inline style to list: the library writes none (P5, C-46). The
 * only style-related write is `scrollTop` on the log (C-58).
 */

export interface ClassEntry {
  name: string
  /** CSS selector an element carrying the class must match. */
  on: string
  description: string
}

export interface AttributeEntry {
  name: string
  /** CSS selector an element carrying the attribute must match. */
  on: string
  description: string
}

export const domClasses: ClassEntry[] = [
  {
    name: 'cc-console',
    on: 'div',
    description:
      'Root element. It sets no size and no `overflow`: the consumer’s CSS gives it its size (P13).'
  },
  {
    name: 'cc-log',
    on: '.cc-console > div',
    description:
      'The scrollback, a named `role="log"`. Make it scroll in your CSS (`overflow-y: auto` and a height); the console only writes its `scrollTop` to keep the newest output in view (C-58).'
  },
  {
    name: 'cc-entries',
    on: '.cc-log > div',
    description:
      'The list of entries inside the log, observed for size changes to keep the log at the bottom (C-58).'
  },
  {
    name: 'cc-entry',
    on: '.cc-entries > div',
    description:
      'One entry: an ended input line or the output of a command (`data-kind`).'
  },
  {
    name: 'cc-actor',
    on: '.cc-entry > span',
    description:
      'Before the prompt of a line from the assistant, an external agent or the CLI: `labels.actors[actor]` (C-85, C-102).'
  },
  {
    name: 'cc-prompt',
    on: 'span',
    description:
      'The prompt, in an input entry and before the live input. The `prompt` slot renders inside it (C-67).'
  },
  {
    name: 'cc-line',
    on: '.cc-entry > span',
    description:
      'The text of an ended input line, or `labels.redacted` when the line was sensitive (C-30).'
  },
  {
    name: 'cc-cancelled',
    on: '.cc-entry > span',
    description:
      'After a line ended with Ctrl+C: `labels.cancelledMarker` (C-15).'
  },
  {
    name: 'cc-block',
    on: '.cc-entry > *',
    description:
      'One output block (`data-type`): `pre` for text, JSON and custom blocks, `table` for a table, `ul` for a list, `div` for a message. A `block-<type>` slot replaces its content (C-67).'
  },
  {
    name: 'cc-status',
    on: '.cc-console > div',
    description:
      'A `role="status"` element: `labels.busy` (or the `busy` slot) while a command runs, the recalled line after a recall, else empty (C-44, C-48).'
  },
  {
    name: 'cc-completions',
    on: '.cc-console > ul',
    description:
      'The completion candidates, a named `role="listbox"`, rendered only while a completion session is open (C-41).'
  },
  {
    name: 'cc-completion',
    on: '.cc-completions > li',
    description:
      'One candidate, a `role="option"`. The `completion` slot renders inside it (C-67).'
  },
  {
    name: 'cc-remote',
    on: '.cc-console > div',
    description:
      'While a CLI is bound to the console (`state.remote`): its text and the "Disconnect" button (C-102).'
  },
  {
    name: 'cc-remote-text',
    on: '.cc-remote > span',
    description:
      '`labels.remote.connected` and when the binding was approved (C-102).'
  },
  {
    name: 'cc-remote-level',
    on: '.cc-remote > span',
    description:
      'The binding’s level from `state.remote.level`: `labels.remote.levelAskServer` or `levelNeverAsk` (C-119).'
  },
  {
    name: 'cc-remote-detach',
    on: '.cc-remote > button',
    description:
      '`labels.remote.detach`; emits `detach-remote`, the consumer ends the binding (C-102).'
  },
  {
    name: 'cc-attach',
    on: '.cc-console > div',
    description:
      'The CLI row while `attachable` is set and no CLI is bound: the level choice, the button and the line (C-119).'
  },
  {
    name: 'cc-attach-levels',
    on: '.cc-attach > fieldset',
    description: 'The level choice: two radio buttons (C-119).'
  },
  {
    name: 'cc-attach-legend',
    on: '.cc-attach-levels > legend',
    description: '`labels.remote.levelLegend` (C-119).'
  },
  {
    name: 'cc-attach-level',
    on: '.cc-attach-levels > label',
    description:
      'One level: its radio button and `labels.remote.levelAskServer` or `levelNeverAsk` (C-119).'
  },
  {
    name: 'cc-attach-radio',
    on: '.cc-attach-level > input',
    description:
      'The radio button of a level; `never-ask` is chosen at first and each time the row shows again (C-119).'
  },
  {
    name: 'cc-attach-hint',
    on: '.cc-attach-level > span',
    description:
      'Next to `never-ask`: `labels.remote.neverAskWarning`, part of its label (C-119).'
  },
  {
    name: 'cc-attach-start',
    on: '.cc-attach > button',
    description:
      '`labels.remote.attach`, or `attachAgain` while a line is shown; emits `attach-remote` with the level chosen (C-119).'
  },
  {
    name: 'cc-attach-code',
    on: '.cc-attach > div',
    description:
      'A named `role="group"` while the `attachCode` prop is set: the line, its copy button, the warning and the time left (C-119).'
  },
  {
    name: 'cc-attach-line',
    on: '.cc-attach-code > code',
    description: '`labels.remote.attachLine(code)` (C-119).'
  },
  {
    name: 'cc-attach-copy',
    on: '.cc-attach-code > button',
    description:
      '`labels.remote.copy`, then `copied`; copies the line, or selects it where the clipboard cannot be reached (C-119).'
  },
  {
    name: 'cc-attach-warning',
    on: '.cc-attach-code > span',
    description: '`labels.remote.attachWarning` (C-119).'
  },
  {
    name: 'cc-attach-expires',
    on: '.cc-attach-code > span',
    description:
      '`labels.remote.expiresIn(seconds)`, counted down each second, then `labels.remote.expired` (C-119).'
  },
  {
    name: 'cc-approval',
    on: '.cc-console > div',
    description:
      'A named `role="alertdialog"` while a change from the CLI waits for the user (C-103).'
  },
  {
    name: 'cc-approval-source',
    on: '.cc-approval > span',
    description:
      '`labels.remote.fromCli` and when the binding was approved; never a computer name (C-103).'
  },
  {
    name: 'cc-approval-preview',
    on: '.cc-approval > span',
    description: 'The plan’s preview, else its canonical line (C-103).'
  },
  {
    name: 'cc-approval-targets',
    on: '.cc-approval > span',
    description: 'The plan’s target ids, when it has any (C-103).'
  },
  {
    name: 'cc-approve',
    on: '.cc-approval > button',
    description:
      '`labels.remote.approve`; calls `approve()`, which refuses in the window’s first second (C-99, C-103).'
  },
  {
    name: 'cc-reject',
    on: '.cc-approval > button',
    description: '`labels.remote.reject`; calls `reject()` (C-103).'
  },
  {
    name: 'cc-pairing',
    on: '.cc-console > div',
    description:
      'A named `role="alertdialog"` while the `pairing` prop is set: "connect this tab to the CLI?" (C-104).'
  },
  {
    name: 'cc-pairing-text',
    on: '.cc-pairing > span',
    description:
      'The question and the server’s facts of the grant: when it was created and its environment (C-104).'
  },
  {
    name: 'cc-pair-accept',
    on: '.cc-pairing > button',
    description: '`labels.remote.pairAccept`; emits `pair` with `true` (C-104).'
  },
  {
    name: 'cc-pair-decline',
    on: '.cc-pairing > button',
    description:
      '`labels.remote.pairDecline`; emits `pair` with `false` (C-104).'
  },
  {
    name: 'cc-input-line',
    on: '.cc-console > div',
    description:
      'The live line: its prompt and the input. Never a `<form>` (C-69).'
  },
  {
    name: 'cc-input',
    on: 'input',
    description:
      'The text input, a named and described combobox. It is replaced by a new element after a sensitive line, on `reset()` and after a programmatic clear (C-54).'
  }
]

export const domAttributes: AttributeEntry[] = [
  {
    name: 'data-busy',
    on: '.cc-console',
    description: 'Present while a command runs (C-44).'
  },
  {
    name: 'data-context-depth',
    on: '.cc-console',
    description:
      'The number of context frames, `0` at the root (C-66). A skin may change the look of a nested context with it.'
  },
  {
    name: 'role',
    on: '.cc-log, .cc-status, .cc-completions, .cc-completion, .cc-input, .cc-approval, .cc-pairing, .cc-attach-code',
    description:
      '`log` on the log, `status` on the status element, `listbox` on the list, `option` on a candidate, `combobox` on the input (C-48), `alertdialog` on the approval window and the pairing question (C-103, C-104), `group` on the line of the CLI row (C-119).'
  },
  {
    name: 'aria-label',
    on: '.cc-log, .cc-completions, .cc-input, .cc-approval, .cc-pairing, .cc-attach-code',
    description:
      'From `labels.log`, `labels.completions`, `labels.input`, `labels.remote.approval`, `labels.remote.pairing` and `labels.remote.attachCode` (C-47).'
  },
  {
    name: 'data-expired',
    on: '.cc-attach-code',
    description:
      'Present once the line’s `expiresAt` has passed, for the skin to mark it (C-119).'
  },
  {
    name: 'name',
    on: '.cc-attach-radio',
    description:
      'From Vue’s `useId()`: the group of the two level buttons, unique per console (C-119).'
  },
  {
    name: 'value',
    on: '.cc-attach-radio',
    description: '`ask-server` or `never-ask` (C-119).'
  },
  {
    name: 'checked',
    on: '.cc-attach-radio',
    description: 'On the level chosen (C-119).'
  },
  {
    name: 'data-kind',
    on: '.cc-entry',
    description:
      '`input` for an ended line, `output` for what a command returned.'
  },
  {
    name: 'data-tone',
    on: '.cc-entry',
    description:
      'The tone of an output entry as the command gave it (for example an error), for the skin to colour.'
  },
  {
    name: 'data-status',
    on: '.cc-entry',
    description:
      'How an input line ended (for example `cancelled` or `failed`), for the skin to mark it.'
  },
  {
    name: 'data-redacted',
    on: '.cc-entry',
    description:
      'Present on the input entry of a sensitive line, whose text is not kept (C-30).'
  },
  {
    name: 'data-actor',
    on: '.cc-entry',
    description:
      '`assistant`, `external-agent` or `cli` on the input entry of a line from one of them; absent for the user’s own lines (C-85, C-102).'
  },
  {
    name: 'aria-live',
    on: '.cc-entry',
    description:
      '`off` on a quiet entry, which the log does not announce (C-48).'
  },
  {
    name: 'data-type',
    on: '.cc-block',
    description:
      'The block type: `text`, `json`, `table`, `list`, `message` or `custom`.'
  },
  {
    name: 'scope',
    on: '.cc-block th',
    description: '`col` on each header cell of a table block.'
  },
  {
    name: 'id',
    on: '.cc-completions, .cc-completion',
    description:
      'From Vue’s `useId()`: the list id, and `<list id>-<n>` per candidate, unique per console (C-08).'
  },
  {
    name: 'aria-selected',
    on: '.cc-completion',
    description: '`true` on the selected candidate, `false` on the others.'
  },
  {
    name: 'type',
    on: '.cc-input, .cc-remote-detach, .cc-approve, .cc-reject, .cc-pair-accept, .cc-pair-decline, .cc-attach-start, .cc-attach-copy, .cc-attach-radio',
    description:
      '`text` on the input, `button` on a button, `radio` on a level (C-119).'
  },
  {
    name: 'aria-autocomplete',
    on: '.cc-input',
    description: '`list`.'
  },
  {
    name: 'aria-expanded',
    on: '.cc-input',
    description: '`true` while the completion list is open, else `false`.'
  },
  {
    name: 'aria-controls',
    on: '.cc-input',
    description: 'The list id, only while the list is open (C-48).'
  },
  {
    name: 'aria-activedescendant',
    on: '.cc-input',
    description:
      'The id of the selected candidate, only while one is selected (C-48).'
  },
  {
    name: 'aria-description',
    on: '.cc-input',
    description:
      'From `labels.inputDescription`: how Enter and Tab behave, including that Tab on an empty line leaves the console (C-59).'
  },
  {
    name: 'autocomplete',
    on: '.cc-input',
    description: '`off` (C-69).'
  },
  {
    name: 'autocorrect',
    on: '.cc-input',
    description: '`off` (C-69).'
  },
  {
    name: 'autocapitalize',
    on: '.cc-input',
    description: '`off` (C-69).'
  },
  {
    name: 'spellcheck',
    on: '.cc-input',
    description: '`false` (C-69).'
  },
  {
    name: 'readonly',
    on: '.cc-input',
    description: 'Present while a command runs (C-16, C-44).'
  }
]
