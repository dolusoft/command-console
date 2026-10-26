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
    on: '.cc-log, .cc-status, .cc-completions, .cc-completion, .cc-input',
    description:
      '`log` on the log, `status` on the status element, `listbox` on the list, `option` on a candidate, `combobox` on the input (C-48).'
  },
  {
    name: 'aria-label',
    on: '.cc-log, .cc-completions, .cc-input',
    description:
      'From `labels.log`, `labels.completions` and `labels.input` (C-47).'
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
    on: '.cc-input',
    description: '`text`.'
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
