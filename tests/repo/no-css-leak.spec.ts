import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

// The marks of the CSS leak scan (P5). The scan of every package's dist/
// and tarball is scripts/check-css-leak.mjs (`pnpm check:no-css-leak`),
// which CI runs after `pnpm build`; this spec checks the marks on sample
// text and needs no build.

const script = join(
  import.meta.dirname,
  '..',
  '..',
  'scripts',
  'check-css-leak.mjs'
)
const { leaksIn } = (await import(pathToFileURL(script).href)) as {
  leaksIn: (text: string) => string[]
}

describe('CSS leak scan (P5)', () => {
  it.each([
    ['@keyframes fade { from { color: red } }', ['@keyframes']],
    ['document.head.append("<style>a{}</style>")', ['<style']],
    ['sheet.insertRule("a{}")', ['insertRule']],
    ['document.adoptedStyleSheets = [s]', ['adoptedStyleSheets']],
    ['const sheet = new CSSStyleSheet()', ['CSSStyleSheet']],
    ['el.animate([{ opacity: 0 }], 300)', ['.animate(']],
    ['log.scrollTop = log.scrollHeight', []],
    ['const stylesheet = "keyframes"; animated(x)', []]
  ])('reads %s as %j', (text, found) => {
    expect(leaksIn(text)).toEqual(found)
  })
})
