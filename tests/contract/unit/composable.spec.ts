// useCommandConsole (spec §7.1, C-68): reactive options reach `setOptions`,
// every notification reaches `state`, no DOM work, disposal with the scope.
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, shallowRef } from 'vue'

import {
  useCommandConsole,
  type CommandDefinition,
  type ConsoleEntry,
  type UseCommandConsoleReturn
} from '@dolusoft/command-console'

const echo: CommandDefinition = {
  name: 'echo',
  run: request => request.args.join(' ')
}
const ping: CommandDefinition = { name: 'ping', run: () => 'pong' }

const inScope = <T>(fn: () => T) => {
  const scope = effectScope()
  const result = scope.run(fn)!
  return { scope, result }
}

const lines = (entries: ConsoleEntry[]) =>
  entries.map(entry =>
    entry.kind === 'input'
      ? `${entry.prompt} ${entry.text}`
      : entry.blocks
          .map(block => (block.type === 'text' ? block.text : block.type))
          .join()
  )

describe('C-68 composable', () => {
  it('mirrors every notification into state', async () => {
    const { result, scope } = inScope(() =>
      useCommandConsole({ commands: [echo] })
    )
    const { console, state } = result
    expect(state.value).toBe(console.getState())
    console.setInput('echo a')
    expect(state.value.input.value).toBe('echo a')
    await console.submit()
    expect(state.value).toBe(console.getState())
    expect(lines(state.value.entries)).toEqual(['> echo a', 'a'])
    scope.stop()
  })

  it('passes reactive option changes to setOptions', async () => {
    const commands = shallowRef([echo])
    const prompt = ref('$')
    const { result, scope } = inScope(() =>
      useCommandConsole({ commands, prompt: () => prompt.value })
    )
    const { console, state } = result
    const setOptions = vi.spyOn(console, 'setOptions')
    await console.run('ping')
    commands.value = [echo, ping]
    prompt.value = '#'
    await nextTick()
    expect(setOptions).toHaveBeenCalledTimes(1)
    await console.run('ping')
    expect(lines(state.value.entries)).toEqual([
      '$ ping',
      'message',
      '# ping',
      'pong'
    ])
    scope.stop()
  })

  it('takes a function option as is, or from a ref', async () => {
    const calls: string[] = []
    const onError = ref((error: unknown) => {
      calls.push(`first ${String(error)}`)
    })
    const boom: CommandDefinition = {
      name: 'boom',
      run: () => {
        throw new Error('x')
      }
    }
    const { result, scope } = inScope(() =>
      useCommandConsole({
        commands: [boom],
        onError,
        // A bare function is the option, never a getter.
        isSensitive: line => line.includes('secret')
      })
    )
    await result.console.run('boom')
    onError.value = error => {
      calls.push(`second ${String(error)}`)
    }
    await nextTick()
    await result.console.run('boom')
    expect(calls).toEqual(['first Error: x', 'second Error: x'])
    expect(result.console.isSensitive('a secret')).toBe(true)
    scope.stop()
  })

  it('does no DOM work', () => {
    const before = document.body.innerHTML
    const create = vi.spyOn(document, 'createElement')
    const { scope } = inScope(() => useCommandConsole({ commands: [echo] }))
    expect(create).not.toHaveBeenCalled()
    expect(document.body.innerHTML).toBe(before)
    create.mockRestore()
    scope.stop()
  })

  it('disposes the console when its effect scope is disposed', async () => {
    let returned!: UseCommandConsoleReturn
    const { scope } = inScope(() => {
      returned = useCommandConsole({ commands: [echo] })
    })
    const { console, state } = returned
    console.setInput('echo kept')
    expect(state.value.input.value).toBe('echo kept')
    scope.stop()
    // The snapshot is dropped with the console; later calls do nothing.
    expect(state.value.input.value).toBe('')
    expect(await console.run('echo a')).toBe(false)
    expect(state.value.entries).toEqual([])
  })

  it('state is read-only', () => {
    const { result, scope } = inScope(() =>
      useCommandConsole({ commands: [echo] })
    )
    const warn = vi
      .spyOn(globalThis.console, 'warn')
      .mockImplementation(() => undefined)
    ;(result.state as { value: unknown }).value = null
    expect(result.state.value).not.toBeNull()
    warn.mockRestore()
    scope.stop()
  })
})
