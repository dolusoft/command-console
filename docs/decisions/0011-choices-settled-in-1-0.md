# 0011 Choices settled while 1.0 was built

Status: Accepted (2026-10-26)

## Context

1.0 was built from a specification in several pull requests, and the specification was deleted when 1.0 was finished: the README, the package READMEs, `contract/rules.md` and these records took over its content. Where the code had to differ from the specification, or the specification left a case open, the pull request listed the choice. This record keeps the choices that change what a consumer sees, with their reasons, so they are not lost with the specification. Each one is also described where it applies (README, package README or rule).

## Decision

The Vue package:

- **Changes are events, not callback props.** `<CommandConsole>` has no `onEntriesChange`, `onRecallChange`, `onContextChange` or `onClose` prop; it emits `update:entries`, `update:recall`, `update:context` and `close`. A callback prop next to `v-model` would be a second channel for the same change.
- **`labels` is `ConsoleLabelsInput`**: every label optional and `messages` merged one level deep, instead of a generic deep partial. A message is a string or a function of its parameters.
- **A block slot renders inside `div.cc-block[data-type]`**, not inside the element of the block's type (`pre`, `table`, `ul`): the slot's content may be any element, and the hook element must stay. A `custom` block without a slot shows the whole block as JSON.
- **The exposed `state` is unwrapped.** A template ref unwraps refs in what a component exposes, so a consumer reads `ConsoleState`, not a `ShallowRef`; reading it in a computed or a template still tracks it.
- **`submit` is emitted for Enter and the exposed `run` only**, the two ways the component submits a line. A direct `console.submit()` bypasses the component and emits nothing.
- **The input's value is written to the element as a DOM property, never bound.** Vue 3.5 mirrors a bound `value` (even with `.prop`) into the `value` attribute, which would put the typed line into the DOM (C-36, C-45). The component writes `element.value` itself, and clears the value of an element that is about to be replaced.
- **In the composable a function option is the function or a ref to it, never a getter**: a bare function cannot be told apart from a getter, and options such as `beforeRun` are functions.

The core:

- **Features and `shared/` may import `core/` with `import type`.** The instance and state types a feature implements against live in `core/`, and types erase at build, so no runtime coupling follows. ADR 0002 states this in its consequences; it is repeated here because the specification forbade any import.
- **`onError(error, info)` takes `info: null` for a callback's error** (a change handler, `onClose`, a subscriber, a disposer, `shouldRecord`). Without `onError` such an error is rethrown asynchronously; a command's error without `onError` stays silent and becomes a `command-failed` entry.
- **A method called from a callback or a subscriber is an action of its own**, after the commit; only calls made while an action is open join it.
- **A defined `state[slice]` in `setOptions` counts as delivered**, even when it is the same array; the last report stops being the base.
- **Run ids come from `createId`**, the same counter as entry ids. A duplicate id from `createId` throws from the method that caused it.
- **`setInput` and `editInput` do nothing while a command runs**, since the input is read-only then.
- **`reset()` returns each slice to `initialState`, else empty**, a controlled slice included.
- **Recall.** At the oldest line ArrowUp (and ArrowDown when nothing is browsed) returns `false`, so the browser moves the caret. Only a write that changes the value ends browsing; a caret move does not. Going from a sensitive input to recall clears the input programmatically first, so the element that held the secret is replaced. A throwing `shouldRecord` does not record the line and reports the error. `recallLimit`: `NaN` is the default, a negative value is 0, a fraction is rounded down, `Infinity` keeps all.
- **Context.** `popContext(count)` rounds down; below 1 or `NaN` does nothing; `Infinity` returns to the root. Frames are stored as given and not checked as JSON.
- **Completion.** The completed token is the one whose span holds the caret (its end included), else an empty token at the caret, and `prefix` is the token's whole value, because the candidate replaces the whole span. A line the `isSensitive` predicate marks, and an unknown first token that names a sensitive command in another case, complete nothing, the name included: a session would carry the token's raw text. In a `'…'` token a candidate with `'` switches the token to `"…"`. No space is added when one already follows the token. Tab on a non-empty input is always handled; `closeCompletion()` also closes a session with no candidates.

## Consequences

- The README and the package READMEs describe the code as it is; the rules were reworded where they differed (C-40, C-49).
- A later change to one of these choices is a behavior change: a rule, a test and, where a choice here is reversed, a new record.

## Trade-off

The choices are spread over the documents where a reader looks for them, and gathered here only once. A reader who wants the reason for one of them reads this record; one who wants the behavior reads the README.
