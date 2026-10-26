// The completion feature (README: Completion, Keyboard): one describe per rule.
import { describe, expect, it, vi } from 'vitest'

import {
  completionFeature,
  createConsole,
  type CommandDefinition,
  type CompletionRequest,
  type CompletionResult,
  type ConsoleOptions
} from '@dolusoft/command-console-core'
import type { ContextFrame } from '@dolusoft/command-protocol'

import { command, deepFreeze, deferred, enter, key } from './helpers'
import type { ConsoleFeature } from '../src/core/console/console.types'
import { provideContext } from '../src/shared'
import { completionLeakPaths } from './support/completion-leak-paths'
import {
  runLeakPath,
  type LeakConsole,
  type LeakOptions
} from './support/leak-matrix'

/** The leak matrix's console, with the completion feature. */
const createLeakConsole = (options: LeakOptions) =>
  createConsole({
    ...options,
    features: { completionFeature }
  }) as unknown as LeakConsole

const tab = key('Tab')
const shiftTab = key('Tab', { shiftKey: true })
const up = key('ArrowUp')
const down = key('ArrowDown')
const escape = key('Escape')

const files = ['alpha.txt', 'alpine.md', 'beta.txt']

const make = (
  commands: CommandDefinition[] = [
    command('show', () => 'shown', { aliases: ['sh'] }),
    command('shutdown'),
    command('secret', undefined, { hidden: true }),
    command('cat', undefined, {
      complete: request => (request.index === 0 ? files : [])
    })
  ],
  extra: Partial<
    ConsoleOptions<{ completionFeature: typeof completionFeature }>
  > = {}
) =>
  createConsole({
    commands,
    features: { completionFeature },
    ...extra
  })

type Made = ReturnType<typeof make>

/** Types `value` with the caret at `|` (or at the end). */
const type = (console: Made, value: string) => {
  const caret = value.indexOf('|')
  if (caret === -1) {
    console.editInput(value, value.length)
  } else {
    console.editInput(value.replace('|', ''), caret)
  }
}

/** The input with the caret shown as `|`. */
const shown = (console: Made) => {
  const { value, caret } = console.getState().input
  return `${value.slice(0, caret)}|${value.slice(caret)}`
}

/** A console whose `cat` completes from `result`; records the requests. */
const provider = (
  result: CompletionResult | (() => CompletionResult),
  extra: Partial<CommandDefinition> = {}
) => {
  const requests: CompletionRequest[] = []
  const console = make([
    command('cat', undefined, {
      complete: request => {
        requests.push(request)
        return typeof result === 'function' ? result() : result
      },
      ...extra
    })
  ])
  return { console, requests }
}

describe('C-37 Name completion', () => {
  it('Tab on the first token completes visible names and aliases', () => {
    const console = make()
    type(console, 'shu')
    expect(console.handleKey(tab)).toBe(true)
    expect(shown(console)).toBe('shutdown |')
    expect(console.getState().completion).toBeNull()

    type(console, 's')
    console.handleKey(tab)
    // show, sh, shutdown; `secret` is hidden.
    expect(console.getState().completion).toMatchObject({
      status: 'open',
      candidates: ['show', 'sh', 'shutdown'],
      active: -1,
      original: 's'
    })
    expect(shown(console)).toBe('sh|')
  })

  it('matches case-insensitively and writes the case of the candidate', () => {
    const console = make()
    type(console, 'SHU')
    console.handleKey(tab)
    expect(shown(console)).toBe('shutdown |')
  })

  it('completes the first token with the caret inside the line', () => {
    const console = make()
    type(console, 'shu| now')
    console.handleKey(tab)
    expect(shown(console)).toBe('shutdown| now')
  })

  it('a whitespace-only line completes an empty name at the caret', () => {
    const console = make()
    type(console, ' ')
    console.handleKey(tab)
    expect(console.getState().completion?.candidates).toEqual([
      'show',
      'sh',
      'shutdown',
      'cat'
    ])
  })
})

describe('C-38 Argument completion', () => {
  it("asks the command's complete with args, prefix, index and context", () => {
    const { console, requests } = provider(['one', 'two'])
    type(console, 'cat a "b c" o|')
    console.handleKey(tab)
    expect(requests).toEqual([
      { command: 'cat', args: ['a', 'b c'], prefix: 'o', index: 2, context: [] }
    ])
    expect(shown(console)).toBe('cat a "b c" one |')
  })

  it('an alias resolves to the canonical name; an empty token at the caret', () => {
    const requests: CompletionRequest[] = []
    const console = make([
      command('cat', undefined, {
        aliases: ['type'],
        complete: request => {
          requests.push(request)
          return ['x']
        }
      })
    ])
    type(console, 'type |')
    console.handleKey(tab)
    type(console, 'type a | b')
    console.handleKey(tab)
    expect(requests.map(r => [r.command, r.index, r.prefix, r.args])).toEqual([
      ['cat', 0, '', []],
      ['cat', 1, '', ['a']]
    ])
    // Not the last token: no space.
    expect(shown(console)).toBe('type a x| b')
  })

  it('no complete, an unknown command or a throwing provider give no candidates', () => {
    const throwing = provider(() => {
      throw new Error('provider')
    })
    type(throwing.console, 'cat x')
    expect(throwing.console.handleKey(tab)).toBe(true)
    expect(throwing.console.getState().completion).toMatchObject({
      status: 'none'
    })

    const console = make([command('cat')])
    for (const line of ['cat x', 'dog x']) {
      type(console, line)
      console.handleKey(tab)
      expect(console.getState().completion).toMatchObject({
        status: 'none',
        candidates: []
      })
      expect(console.getState().input.value).toBe(line)
    }
  })

  it('filters, deduplicates and keeps the provider order; ignores a bad result', () => {
    const { console } = provider(['Beta', 'bar', 'beta', 'bar', '', 'x'])
    type(console, 'cat b')
    console.handleKey(tab)
    expect(console.getState().completion?.candidates).toEqual([
      'Beta',
      'bar',
      'beta'
    ])
    const bad = provider(42 as unknown as CompletionResult)
    type(bad.console, 'cat b')
    bad.console.handleKey(tab)
    expect(bad.console.getState().completion?.status).toBe('none')
  })

  it('never mutates the provider result or frozen options', () => {
    const result = deepFreeze({ candidates: ['b', 'a2', 'a1'], final: true })
    const commands = deepFreeze([
      command('cat', undefined, { complete: () => result })
    ])
    const console = make(commands)
    type(console, 'cat a')
    console.handleKey(tab)
    console.handleKey(tab)
    console.handleKey(enter)
    expect(shown(console)).toBe('cat a2 |')
  })
})

describe('C-35 Redacted completion', () => {
  const secrets = () => {
    const complete = vi.fn((request: CompletionRequest) => {
      void request
      return ['password', 'path']
    })
    const console = make([
      command('set', undefined, { sensitive: { fromArg: 1 }, complete }),
      command('login', undefined, { sensitive: true, complete })
    ])
    return { console, complete }
  }

  it('positions at or after fromArg call no provider and open no session', () => {
    const { console, complete } = secrets()
    type(console, 'set password hun')
    // Tab is still taken, so focus does not leave a half-typed line.
    expect(console.handleKey(tab)).toBe(true)
    expect(console.complete()).toBe(false)
    expect(console.completeNext()).toBe(false)
    expect(complete).not.toHaveBeenCalled()
    expect(console.getState().completion).toBeNull()
    expect(console.getState().input.value).toBe('set password hun')
  })

  it('safe positions get only the arguments before fromArg', () => {
    const { console, complete } = secrets()
    type(console, 'set pa| hunter2')
    console.handleKey(tab)
    expect(complete).toHaveBeenCalledOnce()
    expect(complete.mock.calls[0][0]).toEqual({
      command: 'set',
      args: [],
      prefix: 'pa',
      index: 0,
      context: []
    })
    expect(JSON.stringify(console.getState().completion)).not.toContain(
      'hunter2'
    )
  })

  it('sensitive: true leaves no safe position', () => {
    const { console, complete } = secrets()
    type(console, 'login a')
    console.handleKey(tab)
    expect(complete).not.toHaveBeenCalled()
    expect(console.getState().completion).toBeNull()
  })

  it('a predicate match, or a throwing predicate, makes every position unsafe', () => {
    for (const isSensitive of [
      (line: string) => line.includes('--token'),
      () => {
        throw new Error('predicate')
      }
    ]) {
      const complete = vi.fn(() => ['x'])
      const console = make([command('cat', undefined, { complete })], {
        isSensitive
      })
      type(console, 'cat --token a')
      console.handleKey(tab)
      type(console, 'ca| --token')
      console.handleKey(tab)
      expect(complete).not.toHaveBeenCalled()
      expect(console.getState().completion).toBeNull()
      expect(console.getState().input.value).toBe('ca --token')
    }
  })

  it('an unknown name that names a sensitive command case-insensitively is unsafe', () => {
    const { console } = secrets()
    type(console, 'SET password hun')
    console.handleKey(tab)
    expect(console.getState().completion).toBeNull()
  })
})

describe('C-36 Leak matrix (completion paths)', () => {
  it.each(completionLeakPaths.map(path => [path.name, path] as const))(
    '%s leaves no trace of the secret',
    async (_name, path) => {
      expect(await runLeakPath(path, createLeakConsole)).toEqual([])
    }
  )
})

describe('C-39 No candidates', () => {
  it('the input does not change; the session closes on the next key', () => {
    const console = make()
    type(console, 'x|yz')
    expect(console.handleKey(tab)).toBe(true)
    expect(shown(console)).toBe('x|yz')
    expect(console.getState().completion).toEqual({
      status: 'none',
      candidates: [],
      final: true,
      active: -1,
      span: { start: 0, end: 3 },
      original: 'xyz'
    })
    // Escape is not handled: the next key closes the session first.
    expect(console.handleKey(escape)).toBe(false)
    expect(console.getState().completion).toBeNull()
  })

  it('a second Tab completes again; closeCompletion closes a none session', () => {
    const console = make()
    type(console, 'xyz')
    console.handleKey(tab)
    expect(console.handleKey(tab)).toBe(true)
    expect(console.getState().completion?.status).toBe('none')
    expect(console.completeNext()).toBe(true)
    expect(console.closeCompletion()).toBe(true)
    expect(console.getState().completion).toBeNull()
    expect(console.closeCompletion()).toBe(false)
  })
})

describe('C-40 One candidate', () => {
  it('writes the candidate into the span, adds a space when last, moves the caret', () => {
    const { console } = provider(['alpha'])
    type(console, 'cat al')
    console.handleKey(tab)
    expect(shown(console)).toBe('cat alpha |')
  })

  it('no space with final: false or when the token is not the last', () => {
    const { console } = provider({ candidates: ['dir/'], final: false })
    type(console, 'cat d')
    console.handleKey(tab)
    expect(shown(console)).toBe('cat dir/|')

    const last = provider(['alpha'])
    type(last.console, 'cat al| more')
    last.console.handleKey(tab)
    expect(shown(last.console)).toBe('cat alpha| more')
  })

  it('steps over a whitespace already after the last token', () => {
    const { console } = provider(['alpha'])
    type(console, 'cat al|  ')
    console.handleKey(tab)
    // One of the two spaces is stepped over, none is added.
    expect(shown(console)).toBe('cat alpha | ')
  })

  it('a bare token that needs quotes opens and closes a quote', () => {
    const plain = provider(['my file'])
    type(plain.console, 'cat my')
    plain.console.handleKey(tab)
    expect(shown(plain.console)).toBe("cat 'my file' |")

    const apostrophe = provider(["it's here"])
    type(apostrophe.console, 'cat it')
    apostrophe.console.handleKey(tab)
    expect(shown(apostrophe.console)).toBe('cat "it\'s here" |')
  })

  it('a quoted token keeps its quote character and escapes for it', () => {
    const double = provider(['say "hi" \\o/'])
    type(double.console, 'cat "say')
    double.console.handleKey(tab)
    expect(shown(double.console)).toBe('cat "say \\"hi\\" \\\\o/" |')

    const single = provider(['a b'])
    type(single.console, "cat 'a")
    single.console.handleKey(tab)
    expect(shown(single.console)).toBe("cat 'a b' |")

    // A ' cannot be inside '…': the token switches to "…".
    const switched = provider(["a'b"])
    type(switched.console, "cat 'a")
    switched.console.handleKey(tab)
    expect(shown(switched.console)).toBe('cat "a\'b" |')
  })
})

describe('C-41 Several candidates', () => {
  it('writes the longest common prefix without closing a quote and opens the list', () => {
    const console = make()
    type(console, 'cat al')
    console.handleKey(tab)
    expect(shown(console)).toBe('cat alp|')
    expect(console.getState().completion).toEqual({
      status: 'open',
      candidates: ['alpha.txt', 'alpine.md'],
      final: true,
      active: -1,
      span: { start: 4, end: 7 },
      original: 'al'
    })

    const quoted = provider(['my file.txt', 'my file.md'])
    type(quoted.console, 'cat my')
    quoted.console.handleKey(tab)
    expect(shown(quoted.console)).toBe("cat 'my file.|")
  })

  it('a common prefix no longer than the typed one writes nothing', () => {
    const { console } = provider(['Alpha', 'alps'])
    type(console, 'cat alp')
    console.handleKey(tab)
    expect(shown(console)).toBe('cat alp|')
    expect(console.getState().completion?.status).toBe('open')
  })

  it('Tab/ArrowDown and Shift+Tab/ArrowUp select with wrap; text outside the span is kept', () => {
    const console = make()
    type(console, 'cat al| tail')
    console.handleKey(tab)
    expect(shown(console)).toBe('cat alp| tail')
    expect(console.handleKey(tab)).toBe(true)
    expect(shown(console)).toBe('cat alpha.txt| tail')
    expect(console.handleKey(down)).toBe(true)
    expect(shown(console)).toBe('cat alpine.md| tail')
    expect(console.handleKey(tab)).toBe(true)
    expect(shown(console)).toBe('cat alpha.txt| tail')
    expect(console.handleKey(shiftTab)).toBe(true)
    expect(shown(console)).toBe('cat alpine.md| tail')
    expect(console.handleKey(up)).toBe(true)
    expect(shown(console)).toBe('cat alpha.txt| tail')
    expect(console.getState().completion).toMatchObject({
      active: 0,
      span: { start: 4, end: 13 }
    })
  })

  it('Shift+Tab or ArrowUp first selects the last candidate', () => {
    const console = make()
    type(console, 'cat al')
    console.handleKey(tab)
    console.handleKey(up)
    expect(shown(console)).toBe('cat alpine.md|')
  })

  it('a selection writes the candidate with its quote closed', () => {
    const { console } = provider(['my file.txt', 'my file.md'])
    type(console, 'cat my')
    console.handleKey(tab)
    console.handleKey(tab)
    expect(shown(console)).toBe("cat 'my file.txt'|")
  })

  it('Enter on a selection accepts it as C-40 does and submits nothing', () => {
    const run = vi.fn()
    const console = make([command('cat', run, { complete: () => files })])
    type(console, 'cat al')
    console.handleKey(tab)
    console.handleKey(tab)
    expect(console.handleKey(enter)).toBe(true)
    expect(shown(console)).toBe('cat alpha.txt |')
    expect(console.getState().completion).toBeNull()
    expect(console.getState().entries).toEqual([])
    expect(run).not.toHaveBeenCalled()
  })

  it('Enter with a final: false selection adds no space; not last adds none', () => {
    const { console } = provider({ candidates: ['ab/', 'ac/'], final: false })
    type(console, 'cat a')
    console.handleKey(tab)
    console.handleKey(tab)
    console.handleKey(enter)
    expect(shown(console)).toBe('cat ab/|')

    const middle = make()
    type(middle, 'cat al| x')
    middle.handleKey(tab)
    middle.handleKey(tab)
    middle.handleKey(enter)
    expect(shown(middle)).toBe('cat alpha.txt| x')
  })

  it('Enter with nothing selected submits', () => {
    const run = vi.fn(() => 'ok')
    const console = make([command('cat', run, { complete: () => files })])
    type(console, 'cat al')
    console.handleKey(tab)
    expect(console.acceptCompletion()).toBe(false)
    expect(console.handleKey(enter)).toBe(true)
    expect(run).toHaveBeenCalledOnce()
    expect(console.getState().completion).toBeNull()
  })

  it('Escape restores the original token and closes the session', () => {
    const console = make()
    type(console, 'cat al| tail')
    console.handleKey(tab)
    console.handleKey(tab)
    expect(console.handleKey(escape)).toBe(true)
    expect(shown(console)).toBe('cat al| tail')
    expect(console.getState().completion).toBeNull()
    expect(console.handleKey(escape)).toBe(false)
  })

  it('the methods do what the keys do', () => {
    const console = make()
    type(console, 'cat al')
    expect(console.completePrevious()).toBe(false)
    expect(console.complete()).toBe(true)
    expect(console.completeNext()).toBe(true)
    expect(console.completeNext()).toBe(true)
    expect(console.completePrevious()).toBe(true)
    expect(shown(console)).toBe('cat alpha.txt|')
    expect(console.acceptCompletion()).toBe(true)
    expect(shown(console)).toBe('cat alpha.txt |')
    // The next argument has no candidates (`cat` completes index 0 only).
    expect(console.complete()).toBe(true)
    expect(console.getState().completion?.status).toBe('none')
    expect(console.closeCompletion()).toBe(true)
    expect(shown(console)).toBe('cat alpha.txt |')
  })

  it('the candidate list is never an entry', () => {
    const console = make()
    type(console, 's')
    console.handleKey(tab)
    console.handleKey(tab)
    expect(console.getState().entries).toEqual([])
  })
})

describe('C-43 Completion closes', () => {
  it('an edit the session did not make closes it and keeps the text', () => {
    const console = make()
    type(console, 'cat al')
    console.handleKey(tab)
    console.handleKey(tab)
    type(console, 'cat alpha.txtx')
    expect(console.getState().completion).toBeNull()
    expect(shown(console)).toBe('cat alpha.txtx|')
  })

  it('a caret move closes it; setInput closes it', () => {
    const console = make()
    type(console, 'cat al')
    console.handleKey(tab)
    console.editInput('cat alp', 2)
    expect(console.getState().completion).toBeNull()
    expect(console.getState().input.value).toBe('cat alp')

    console.editInput('cat al', 6)
    console.handleKey(tab)
    console.setInput('other')
    expect(console.getState().completion).toBeNull()
  })

  it("the session's own writes do not close it; reporting them back changes nothing", () => {
    const console = make()
    type(console, 'cat al')
    console.handleKey(tab)
    console.handleKey(tab)
    const { value, caret } = console.getState().input
    console.editInput(value, caret)
    expect(console.getState().completion?.active).toBe(0)
  })

  it('tolerant tokens complete inside an open quote, keeping its quote character', () => {
    const single = provider(['my file.txt', 'my file.md'])
    type(single.console, "cat 'my f")
    single.console.handleKey(tab)
    expect(shown(single.console)).toBe("cat 'my file.|")
    single.console.handleKey(tab)
    expect(shown(single.console)).toBe("cat 'my file.txt'|")

    const double = provider(['my file'])
    type(double.console, 'cat "my')
    double.console.handleKey(tab)
    expect(shown(double.console)).toBe('cat "my file" |')
  })

  it('every end of the line drops the session', async () => {
    const console = make()
    type(console, 'cat al')
    console.handleKey(tab)
    console.cancel()
    expect(console.getState().completion).toBeNull()

    type(console, 'cat al')
    console.handleKey(tab)
    await console.run('show')
    expect(console.getState().completion).toBeNull()

    type(console, 'cat al')
    console.handleKey(tab)
    console.reset()
    expect(console.getState().completion).toBeNull()
  })
})

describe('C-53 Key map (completion)', () => {
  it('Tab on an empty input and Shift+Tab or Escape without a session are not handled', () => {
    const console = make()
    expect(console.handleKey(tab)).toBe(false)
    expect(console.complete()).toBe(false)
    type(console, 'cat')
    expect(console.handleKey(shiftTab)).toBe(false)
    expect(console.handleKey(escape)).toBe(false)
    expect(console.handleKey(up)).toBe(false)
    expect(console.handleKey(down)).toBe(false)
    expect(console.handleKey(enter)).toBe(true)
  })

  it('while a command runs Tab does nothing and the methods return false', async () => {
    const pending = deferred<string>()
    const console = make([
      command('wait', () => pending.promise),
      command('cat', undefined, { complete: () => files })
    ])
    type(console, 'cat al')
    console.handleKey(tab)
    const done = console.run('wait')
    expect(console.handleKey(tab)).toBe(false)
    for (const method of [
      'complete',
      'completeNext',
      'completePrevious',
      'acceptCompletion',
      'closeCompletion'
    ] as const) {
      expect(console[method]()).toBe(false)
    }
    expect(console.getState().completion).toBeNull()
    pending.resolve('ok')
    await done
  })

  it('a key with isComposing never reaches the session', () => {
    const console = make()
    type(console, 'xyz')
    console.handleKey(tab)
    expect(console.handleKey(key('Tab', { isComposing: true }))).toBe(false)
    expect(console.getState().completion?.status).toBe('none')
  })

  it('every method is a no-op returning false after dispose', () => {
    const console = make()
    type(console, 'cat al')
    console.dispose()
    expect(console.complete()).toBe(false)
    expect(console.completeNext()).toBe(false)
  })
})

describe('C-38 Argument completion (context)', () => {
  it('the request carries the context snapshot of the context provider', () => {
    const frames: ContextFrame[] = [{ id: 'db', prompt: 'db>' }]
    const context: ConsoleFeature = {
      name: 'context',
      init: console =>
        provideContext(console, {
          snapshot: () => [...frames],
          revision: () => 0
        })
    }
    const requests: CompletionRequest[] = []
    const console = createConsole({
      commands: [
        command('cat', undefined, {
          complete: request => {
            requests.push(request)
            return []
          }
        })
      ],
      features: { completionFeature, contextFeature: context as never }
    })
    console.editInput('cat ', 4)
    console.handleKey(tab)
    expect(requests[0].context).toEqual(frames)
    expect(requests[0].context).not.toBe(frames)
  })
})

describe('C-36 Leak matrix (completion probe)', () => {
  it('a session that held the secret would be found', async () => {
    const findings = await runLeakPath(
      {
        name: 'leaky session',
        drive: ({ console, secret }) => {
          console.editInput(`echo ${secret}`, 5 + secret.length)
          console.handleKey(tab)
        }
      },
      createLeakConsole
    )
    expect(findings.some(f => f.where.includes('completion.original'))).toBe(
      true
    )
  })
})
