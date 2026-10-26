// Commands and mounting helpers shared by the Vue specs (unit and browser).
import type {
  CommandDefinition,
  ConsoleExpose,
  OutputBlock
} from '@dolusoft/command-console'

/** A promise with its resolve and reject at hand. */
export interface Deferred<T = unknown> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

export const deferred = <T = unknown>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** One block of every type. */
export const everyBlock: OutputBlock[] = [
  { type: 'text', text: 'plain text' },
  { type: 'json', value: { a: 1, b: [true, null] } },
  {
    type: 'table',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'size', label: 'Size' }
    ],
    rows: [
      { name: 'a', size: 1 },
      { name: 'b', size: null }
    ]
  },
  { type: 'list', items: ['one', 'two'] },
  { type: 'message', code: 'interrupted' },
  { type: 'custom', kind: 'chart', data: { points: [1, 2] } }
]

/**
 * The commands of the Vue specs:
 *
 * - `echo …`: its arguments as text;
 * - `blocks`: one block of every type;
 * - `quiet`: a quiet output;
 * - `fail`: throws;
 * - `login` (sensitive), `set` (`fromArg: 1`);
 * - `slow`: pending until the test settles `slow.current`;
 * - `exit`: the `close` effect;
 * - `many n`: `n` lines of text.
 */
export const makeCommands = () => {
  const slow: { current: Deferred | null } = { current: null }
  const commands: CommandDefinition[] = [
    { name: 'echo', run: request => request.args.join(' ') },
    { name: 'blocks', run: () => everyBlock },
    { name: 'quiet', run: () => ({ output: 'long', quiet: true }) },
    {
      name: 'fail',
      run: () => {
        throw new Error('boom')
      }
    },
    { name: 'login', sensitive: true, run: () => 'welcome' },
    { name: 'set', sensitive: { fromArg: 1 }, run: () => 'saved' },
    {
      name: 'slow',
      sensitive: true,
      run: () => {
        slow.current = deferred()
        return slow.current.promise as Promise<string>
      }
    },
    { name: 'exit', run: () => ({ effects: [{ type: 'close' }] }) },
    {
      name: 'many',
      run: request =>
        Array.from({ length: Number(request.args[0] ?? 1) }, (_, i) => ({
          type: 'text' as const,
          text: `line ${i}`
        }))
    }
  ]
  return { commands, slow }
}

/** The component's exposed API, as a template ref sees it. */
export type Exposed = ConsoleExpose

/** Waits for promises and Vue's scheduler to settle. */
export const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}
