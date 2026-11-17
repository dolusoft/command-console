import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The template gate (tools/template-gate): the checks oxlint cannot make on a
// Vue `<template>`, and its CLI (exit 0 clean, 1 findings, 2 unreadable).

type Finding = {
  file: string
  line: number
  column: number
  gate: string
  message: string
}
type Gate = {
  checkSfc: (file: string, source: string, gates?: string[]) => Finding[]
  GATES: string[]
}

const root = join(import.meta.dirname, '..', '..')
const gateDir = join(root, 'tools', 'template-gate')
const { checkSfc, GATES } = (await import(
  pathToFileURL(join(gateDir, 'gate.mjs')).href
)) as Gate

/** `gate@line:column` of each finding in a template. */
const check = (template: string, script = '') =>
  checkSfc('x.vue', `${script}<template>\n${template}\n</template>\n`).map(
    finding => `${finding.gate}@${finding.line}:${finding.column}`
  )

describe('template gate', () => {
  it('refuses v-html (S-08) unless an element carries a reasoned exemption', () => {
    expect(check(`<div v-html="html"></div>`)).toEqual(['no-v-html@2:6'])
    expect(
      check(
        `<!-- template-gate-disable-next-line no-v-html: trusted markup -->\n<div v-html="html"></div>`
      )
    ).toEqual([])
    // Without a reason the comment silences nothing and is reported.
    expect(
      check(
        `<!-- template-gate-disable-next-line no-v-html -->\n<div v-html="html"></div>`
      )
    ).toEqual(['disable-directive@2:1', 'no-v-html@3:6'])
    // An unknown gate, or an exemption with nothing to silence, is reported.
    expect(
      check(
        `<!-- template-gate-disable-next-line no-such-gate: reason -->\n<div></div>`
      )
    ).toEqual(['disable-directive@2:1'])
    expect(
      check(
        `<!-- template-gate-disable-next-line no-v-html: stale -->\n<div v-text="a"></div>`
      )
    ).toEqual(['disable-directive@2:1'])
    expect(
      check(
        `<div></div>\n<!-- template-gate-disable-next-line no-v-html: last -->`
      )
    ).toEqual(['disable-directive@3:1'])
    // A gate that is not selected: its exemption is not judged.
    expect(
      checkSfc(
        'x.vue',
        `<template><!-- template-gate-disable-next-line no-v-html: x --><div></div></template>`,
        ['require-v-for-key']
      )
    ).toEqual([])
    // An ordinary comment is not a directive.
    expect(check(`<!-- a note -->\n<div></div>`)).toEqual([])
    // The exemption covers the next element only, not a sibling on its line.
    expect(
      check(
        `<!-- template-gate-disable-next-line no-v-html: trusted markup -->\n<b v-html="a"></b><i v-html="b"></i>`
      )
    ).toEqual(['no-v-html@3:22'])
    expect(check(`<div v-text="text"></div>`)).toEqual([])
  })

  it('requires a key on every element repeated with v-for', () => {
    expect(check(`<ul><li v-for="i in list">{{ i }}</li></ul>`)).toEqual([
      'require-v-for-key@2:5'
    ])
    expect(
      check(`<ul><li v-for="i in list" :key="i">{{ i }}</li></ul>`)
    ).toEqual([])
    expect(
      check(`<template v-for="i in list" :key="i"><b>{{ i }}</b></template>`)
    ).toEqual([])
    expect(
      check(`<template v-for="i in list"><b :key="i">{{ i }}</b></template>`)
    ).toEqual([])
    expect(
      check(`<template v-for="i in list"><b>{{ i }}</b></template>`)
    ).toEqual(['require-v-for-key@2:1'])
    // A static key is the same on every element: it does not count.
    expect(
      check(`<ul><li v-for="i in list" key="static">{{ i }}</li></ul>`)
    ).toEqual(['require-v-for-key@2:5'])
  })

  it('refuses v-if and v-for on one element', () => {
    expect(
      check(`<li v-for="i in list" v-if="show" :key="i">{{ i }}</li>`)
    ).toEqual(['no-v-if-with-v-for@2:23'])
    expect(
      check(
        `<template v-if="show"><li v-for="i in list" :key="i">{{ i }}</li></template>`
      )
    ).toEqual([])
  })

  it('accepts v-model only on a form element or a component, bound to an assignable value', () => {
    expect(check(`<input v-model="text" />`)).toEqual([])
    expect(check(`<MyField v-model="form.name" />`)).toEqual([])
    expect(check(`<textarea v-model="state!.text"></textarea>`)).toEqual([])
    expect(check(`<span v-model="text"></span>`)).toEqual(['valid-v-model@2:7'])
    expect(check(`<input v-model="text + 1" />`)).toEqual(['valid-v-model@2:8'])
    expect(check(`<input v-model="a?.b" />`)).toEqual(['valid-v-model@2:8'])
    expect(check(`<input v-model />`)).toEqual(['valid-v-model@2:8'])
    expect(check(`<input type="file" v-model="file" />`)).toEqual([
      'valid-v-model@2:20'
    ])
    expect(
      check(
        `<div v-for="item in list" :key="item"><input v-model="item" /></div>`
      )
    ).toEqual(['valid-v-model@2:46'])
    expect(
      check(
        `<div v-for="item in list" :key="item.id"><input v-model="item.name" /></div>`
      )
    ).toEqual([])
    // A native element takes no argument and only lazy, number and trim.
    expect(check(`<input v-model:foo="value" />`)).toEqual([
      'valid-v-model@2:8'
    ])
    expect(check(`<select v-model.capitalize="value"></select>`)).toEqual([
      'valid-v-model@2:9'
    ])
    expect(check(`<input v-model.lazy.trim.number="value" />`)).toEqual([])
    expect(check(`<MyField v-model:title.capitalize="value" />`)).toEqual([])
  })

  it('reports an import the script and the template never use', () => {
    const script = `<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Item } from './item'
import Child from './Child.vue'
import { vFocus } from './focus'
import { format } from './format'
const list = ref<Item[]>([])
</script>
`
    expect(
      check(`<Child v-focus :items="list">{{ format(list) }}</Child>`, script)
    ).toEqual(['no-unused-imports@2:15'])
    expect(
      check(`<child-view></child-view>`, script.replace('Child', 'ChildView'))
    ).toEqual([
      'no-unused-imports@2:15',
      'no-unused-imports@5:10',
      'no-unused-imports@6:10'
    ])
  })

  it('counts only real references, not strings, property names or shadowing locals', () => {
    const script = `<script setup lang="ts">
import Child from './Child.vue'
</script>
`
    const unused = ['no-unused-imports@2:8']
    expect(check(`<p>{{ 'Child' }}</p>`, script)).toEqual(unused)
    expect(check(`<p>{{ row.Child }}</p>`, script)).toEqual(unused)
    expect(check(`<p :title="{ Child: 1 }.Child"></p>`, script)).toEqual(unused)
    expect(
      check(`<p v-for="Child in list" :key="Child">{{ Child }}</p>`, script)
    ).toEqual(unused)
    expect(
      check(`<List v-slot="{ Child }">{{ Child }}</List>`, script)
    ).toEqual(unused)
    expect(check(`<p @click="row.Child = 1"></p>`, script)).toEqual(unused)
    // Still used: a reference in an expression, a handler or a v-for source.
    expect(check(`<p>{{ pick(Child) }}</p>`, script)).toEqual([])
    expect(check(`<p @click="show = true; open(Child)"></p>`, script)).toEqual(
      []
    )
    expect(
      check(`<p v-for="c in Child.items" :key="c">{{ c }}</p>`, script)
    ).toEqual([])
    expect(check(`<component :is="Child" />`, script)).toEqual([])
    // A default or a computed key inside a binding pattern refers too.
    expect(
      check(`<List v-slot="{ label = Child }">{{ label }}</List>`, script)
    ).toEqual([])
    expect(
      check(`<List v-slot="{ [Child]: value }">{{ value }}</List>`, script)
    ).toEqual([])
    expect(
      check(`<p v-for="{ a = Child } in list" :key="a">{{ a }}</p>`, script)
    ).toEqual([])
    expect(
      check(`<List v-slot="{ label = other }">{{ label }}</List>`, script)
    ).toEqual(unused)
    // A slot binding of the import's name declares a local, it does not use it.
    expect(
      check(
        `<List v-slot="{ helper }">{{ helper }}</List>`,
        `<script setup lang="ts">\nimport { helper } from './helper'\n</script>\n`
      )
    ).toEqual(['no-unused-imports@2:10'])
    expect(
      check(
        `<List v-slot="{ item }">{{ helper(item) }}</List>`,
        `<script setup lang="ts">\nimport { helper } from './helper'\n</script>\n`
      )
    ).toEqual([])

    const scriptOnly = (body: string) =>
      check(
        `<p></p>`,
        `<script setup lang="ts">\nimport Child from './Child.vue'\n${body}\n</script>\n`
      )
    expect(scriptOnly(`const row = { Child: 1 }; row.Child`)).toEqual(unused)
    expect(scriptOnly(`const label = 'Child'`)).toEqual(unused)
    expect(scriptOnly(`const f = (Child: number) => Child`)).toEqual(unused)
    expect(
      scriptOnly(`function g() { const Child = 1; return Child }`)
    ).toEqual(unused)
    expect(scriptOnly(`type T = { Child: string }`)).toEqual(unused)
    expect(scriptOnly(`const views = { Child }`)).toEqual([])
    expect(scriptOnly(`const f = () => Child`)).toEqual([])
    expect(scriptOnly(`let v: typeof Child`)).toEqual([])
    expect(
      scriptOnly(`const f = (c: InstanceType<typeof Child>) => c`)
    ).toEqual([])
    expect(scriptOnly(`const views = { [Child.name]: 1 }`)).toEqual([])
  })

  it('runs only the selected gates', () => {
    expect(GATES).toHaveLength(5)
    expect(
      checkSfc('x.vue', `<template><div v-html="h"></div></template>`, [
        'require-v-for-key'
      ])
    ).toEqual([])
  })

  it('throws on an SFC that does not parse', () => {
    expect(() =>
      checkSfc('x.vue', `<template>\n  <div>\n</template>\n`)
    ).toThrow(/does not parse/)
    expect(() =>
      checkSfc('x.vue', `<script setup lang="ts">\nconst = 1\n</script>\n`)
    ).toThrow(/does not parse/)
  })
})

describe('template gate CLI', () => {
  let dir = ''
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [join(gateDir, 'cli.mjs'), ...args], {
      cwd: dir,
      encoding: 'utf8'
    })

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'template-gate-'))
    mkdirSync(join(dir, 'dist'))
    writeFileSync(
      join(dir, 'Clean.vue'),
      `<template><p>{{ a }}</p></template>\n`
    )
    writeFileSync(
      join(dir, 'Html.vue'),
      `<template><p v-html="a"></p></template>\n`
    )
    writeFileSync(join(dir, 'Broken.vue'), `<template><p></template>\n`)
    writeFileSync(
      join(dir, 'dist', 'Built.vue'),
      `<template><p v-html="a"></p></template>\n`
    )
    writeFileSync(join(dir, 'script.ts'), `export const a = 1\n`)
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 0 on clean files and skips files that are not .vue, as a staged list holds', () => {
    const result = run('Clean.vue', 'script.ts')
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('prints file:line:col gate-id message and exits 1 on a finding', () => {
    const result = run('Clean.vue', 'Html.vue')
    expect(result.status).toBe(1)
    expect(result.stdout).toBe(
      'Html.vue:1:14 no-v-html v-html is refused: all text is escaped, output is structured blocks (S-08).\n'
    )
  })

  it('prints JSON on request', () => {
    const result = run('--format', 'json', 'Html.vue')
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual({
      files: 1,
      findings: [
        expect.objectContaining({
          file: 'Html.vue',
          gate: 'no-v-html',
          line: 1
        })
      ]
    })
  })

  it('keeps an ignored folder ignored, even when named', () => {
    expect(run('dist').status).toBe(0)
    expect(run(join('dist', 'Built.vue')).status).toBe(0)
  })

  it('exits 2 on an SFC that does not parse, an unknown gate or a missing file', () => {
    const broken = run('Broken.vue')
    expect(broken.status).toBe(2)
    expect(broken.stderr).toMatch(/Broken\.vue:1:11: the SFC does not parse/)
    expect(run('--gates', 'no-such-gate', 'Clean.vue').status).toBe(2)
    expect(run('Missing.vue').status).toBe(2)
  })

  it('exits 2, not 1, on a config with a missing or malformed field', () => {
    const configs = {
      'no-paths.json': { gates: ['no-v-html'] },
      'bad-paths.json': { paths: 'packages' },
      'bad-gates.json': { paths: ['.'], gates: 'no-v-html' },
      'bad-ignore.json': { paths: ['.'], ignoreSegments: [1] },
      'not-object.json': ['packages']
    }
    for (const [name, config] of Object.entries(configs)) {
      writeFileSync(join(dir, name), JSON.stringify(config))
      const result = run('--config', name)
      expect(result.status, name).toBe(2)
      expect(result.stderr, name).toMatch(/^template-gate: the config /)
    }
  })

  it('passes on the repository with its own configuration', () => {
    const result = spawnSync(process.execPath, [join(gateDir, 'cli.mjs')], {
      cwd: root,
      encoding: 'utf8'
    })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('scans the whole repository by default, as ESLint did with **/*.vue, ignored folders aside', () => {
    // A folder no list names (`examples/`) is checked; `node_modules`
    // and `dist` stay ignored.
    const probes = {
      examples: join(root, 'examples-gate-probe'),
      ignored: join(root, 'node_modules', '.gate-probe'),
      built: join(root, 'packages', 'command-console', 'dist-probe', 'dist')
    }
    const html = `<template><p v-html="a"></p></template>\n`
    try {
      for (const folder of Object.values(probes)) {
        mkdirSync(folder, { recursive: true })
        writeFileSync(join(folder, 'Probe.vue'), html)
      }
      const result = spawnSync(
        process.execPath,
        [join(gateDir, 'cli.mjs'), '--format', 'json'],
        { cwd: root, encoding: 'utf8' }
      )
      expect(result.status).toBe(1)
      const files = (
        JSON.parse(result.stdout) as { findings: Finding[] }
      ).findings.map(finding => finding.file)
      expect(files).toEqual(['examples-gate-probe/Probe.vue'])
    } finally {
      rmSync(probes.examples, { recursive: true, force: true })
      rmSync(probes.ignored, { recursive: true, force: true })
      rmSync(join(root, 'packages', 'command-console', 'dist-probe'), {
        recursive: true,
        force: true
      })
    }
  })

  it('declares every package it imports in the root package.json', () => {
    // A clean install (`pnpm install --frozen-lockfile`) links only direct
    // dependencies at the root, so the gate must not rely on hoisting.
    const manifest = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8')
    ) as { devDependencies: Record<string, string> }
    const source = readFileSync(join(gateDir, 'gate.mjs'), 'utf8')
    const packages = [...source.matchAll(/from '([^'.][^']*)'/g)].map(
      match => match[1]
    )
    expect(packages.length).toBeGreaterThan(0)
    for (const name of packages) {
      expect(Object.keys(manifest.devDependencies), name).toContain(name)
    }
  })
})
