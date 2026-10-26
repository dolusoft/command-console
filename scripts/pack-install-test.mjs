// `pnpm pack-install` (C-49): installs the three packed tarballs into a new
// Vite app outside the workspace, the way npm does, with no alias and no
// `optimizeDeps` entry, then typechecks and builds that app. Catches what the
// workspace hides: a `workspace:*` range left in a manifest, a file missing
// from `files` (each installed package must hold README.md and LICENSE.md),
// a type that only resolves through the workspace `paths`, a stale README
// version.
//
//   node scripts/pack-install-test.mjs   (after `pnpm build`)
//
// The app goes to a new directory under PACK_INSTALL_DIR, else the system
// temporary directory, and is removed afterwards unless PACK_INSTALL_KEEP=1.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const rootManifest = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8')
)
const tools = {
  ...rootManifest.dependencies,
  ...rootManifest.devDependencies
}

const fail = message => {
  console.error(`[pack-install] ${message}`)
  process.exit(1)
}

const run = (command, args, cwd) => {
  console.log(`[pack-install] ${command} ${args.join(' ')}`)
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    // pnpm is a .cmd on Windows.
    shell: process.platform === 'win32'
  })
}

const base = process.env.PACK_INSTALL_DIR ?? tmpdir()
mkdirSync(base, { recursive: true })
const work = mkdtempSync(join(base, 'command-console-pack-'))
const tarballs = join(work, 'tarballs')
const app = join(work, 'app')
mkdirSync(tarballs)
mkdirSync(join(app, 'src'), { recursive: true })

try {
  // 1. Pack: pnpm turns `workspace:*` into the version.
  const packed = {}
  for (const dir of [
    'command-protocol',
    'command-console-core',
    'command-console'
  ]) {
    const before = new Set(readdirSync(tarballs))
    run(
      'pnpm',
      ['pack', '--pack-destination', tarballs],
      join(root, 'packages', dir)
    )
    const file = readdirSync(tarballs).find(name => !before.has(name))
    if (!file) {
      fail(`packages/${dir} produced no tarball`)
    }
    const manifest = JSON.parse(
      readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8')
    )
    packed[manifest.name] = { file, version: manifest.version }
  }

  // 2. Once released, the README installs the Vue package by name at the
  // packed version. While the version is the unreleased 0.0.0 the README
  // has no install line yet.
  const vue = packed['@dolusoft/command-console']
  if (vue.version !== '0.0.0') {
    const readme = readFileSync(join(root, 'README.md'), 'utf8')
    const installs = [
      ...readme.matchAll(/^pnpm add @dolusoft\/command-console@(\S+)$/gm)
    ]
    if (installs.length !== 1 || installs[0][1] !== vue.version) {
      fail(`README.md must install @dolusoft/command-console@${vue.version}`)
    }
  }

  // 3. Simulate registry resolution with local tarball overrides: the Vue
  // package's `@dolusoft/*` dependencies resolve to their tarballs too.
  const names = Object.keys(packed)
  const tarball = name => `file:../tarballs/${packed[name].file}`
  writeFileSync(
    join(app, 'pnpm-workspace.yaml'),
    [
      'overrides:',
      ...names.map(name => `  '${name}': ${tarball(name)}`),
      ''
    ].join('\n')
  )
  writeFileSync(
    join(app, 'package.json'),
    `${JSON.stringify(
      {
        name: 'pack-install-app',
        private: true,
        type: 'module',
        // The app imports the protocol and the core by name too (pnpm gives
        // no access to undeclared dependencies).
        dependencies: {
          ...Object.fromEntries(names.map(name => [name, tarball(name)])),
          vue: tools.vue
        },
        devDependencies: {
          '@vitejs/plugin-vue': tools['@vitejs/plugin-vue'],
          typescript: tools.typescript,
          vite: tools.vite,
          'vue-tsc': tools['vue-tsc']
        }
      },
      null,
      2
    )}\n`
  )
  writeFileSync(
    join(app, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: []
        },
        include: ['src/**/*.ts', 'src/**/*.vue']
      },
      null,
      2
    )}\n`
  )
  // No alias and no optimizeDeps: a consumer needs neither (C-49).
  writeFileSync(
    join(app, 'vite.config.ts'),
    [
      "import vue from '@vitejs/plugin-vue'",
      "import { defineConfig } from 'vite'",
      '',
      'export default defineConfig({ plugins: [vue()] })',
      ''
    ].join('\n')
  )
  writeFileSync(
    join(app, 'index.html'),
    '<div id="app"></div><script type="module" src="/src/main.ts"></script>\n'
  )
  writeFileSync(
    join(app, 'src', 'env.d.ts'),
    [
      "declare module '*.vue' {",
      "  import type { DefineComponent } from 'vue'",
      '  const component: DefineComponent',
      '  export default component',
      '}',
      ''
    ].join('\n')
  )
  // The three packages by name, from a component and from plain TypeScript.
  // The pieces that fill the packages replace the namespaces with real use
  // (the component, the composable, a console with all features).
  writeFileSync(
    join(app, 'src', 'App.vue'),
    `<script setup lang="ts">
import * as vuePackage from '@dolusoft/command-console'

const names = Object.keys(vuePackage)
</script>

<template>
  <div>{{ names.length }}</div>
</template>
`
  )
  writeFileSync(
    join(app, 'src', 'main.ts'),
    `import { createApp, h } from 'vue'

import * as core from '@dolusoft/command-console-core'
import * as protocol from '@dolusoft/command-protocol'

import App from './App.vue'

const count: number = Object.keys(core).length + Object.keys(protocol).length

createApp({ render: () => h('div', [h(App), String(count)]) }).mount('#app')
`
  )

  // 4. Install, check the installed files, typecheck, build.
  run('pnpm', ['install', '--prefer-offline'], app)
  for (const name of names) {
    for (const file of ['package.json', 'README.md', 'LICENSE.md']) {
      if (!existsSync(join(app, 'node_modules', name, file))) {
        fail(`${packed[name].file} has no ${file}`)
      }
    }
  }
  run('pnpm', ['exec', 'vue-tsc', '--noEmit'], app)
  run('pnpm', ['exec', 'vite', 'build'], app)
  console.log(
    `[pack-install] ok: ${Object.values(packed)
      .map(entry => entry.file)
      .join(', ')} installed, typechecked and built outside the workspace`
  )
} finally {
  if (process.env.PACK_INSTALL_KEEP === '1') {
    console.log(`[pack-install] kept ${work}`)
  } else {
    rmSync(work, { recursive: true, force: true })
  }
}
