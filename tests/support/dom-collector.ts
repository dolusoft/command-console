// The DOM contract collector (C-45, C-46): walks what `<CommandConsole>`
// rendered, from `.cc-console`, and compares it with `contract/dom.ts`. Slot
// content is the consumer's: the specs mark it with `data-test-slot`, and the
// collector stops there (the library element around it is still checked).
import { expect } from 'vitest'

import { domAttributes, domClasses } from '../../contract/dom'

/** The marker the specs put on slot content. */
export const slotMarker = 'data-test-slot'

/** Every element the library rendered, slot content left out. */
export const renderedElements = (): Element[] =>
  [...document.querySelectorAll('.cc-console, .cc-console *')].filter(
    element => !element.closest(`[${slotMarker}]`)
  )

const knownClass = new Map(domClasses.map(entry => [entry.name, entry]))
const attributeEntries = (name: string) =>
  domAttributes.filter(entry => entry.name === name)

/**
 * Plain HTML attributes the markup needs that are not hooks: `aria-*` that
 * the contract does not list are reported as unknown too.
 */
const plainAttributes = new Set<string>(['class'])

export const createCollector = () => {
  const classes = new Set<string>()
  const attributes = new Map<string, Element[]>()
  const styled: string[] = []
  const unknownClasses: string[] = []
  const unmatchedClasses: string[] = []
  const unknownAttributes: string[] = []
  const unmatchedAttributes: string[] = []

  const collect = () => {
    for (const element of renderedElements()) {
      const tag = element.tagName.toLowerCase()
      for (const name of element.classList) {
        const entry = knownClass.get(name)
        if (!entry) {
          unknownClasses.push(`${tag}.${name}`)
          continue
        }
        classes.add(name)
        if (!element.matches(entry.on)) {
          unmatchedClasses.push(`.${name} is on ${tag}, not ${entry.on}`)
        }
      }
      for (const attribute of element.getAttributeNames()) {
        if (attribute === 'style') {
          styled.push(tag)
          continue
        }
        if (plainAttributes.has(attribute)) {
          continue
        }
        const entries = attributeEntries(attribute)
        if (entries.length === 0) {
          unknownAttributes.push(`${tag}[${attribute}]`)
          continue
        }
        const list = attributes.get(attribute) ?? []
        list.push(element)
        attributes.set(attribute, list)
        if (!entries.some(entry => element.matches(entry.on))) {
          unmatchedAttributes.push(`${tag}[${attribute}]`)
        }
      }
    }
  }

  /** C-45: nothing outside the contract, each hook where it is listed. */
  const expectNothingOutsideContract = () => {
    expect(unknownClasses).toEqual([])
    expect(unmatchedClasses).toEqual([])
    expect(unknownAttributes).toEqual([])
    expect(unmatchedAttributes).toEqual([])
  }

  /** C-46: no `style` attribute on any element the library rendered. */
  const expectNoStyle = () => {
    expect(styled).toEqual([])
  }

  /**
   * Every class and attribute of the contract was rendered by some state,
   * each placement of an attribute listed more than once included; `skip`
   * names the entries a spec cannot reach.
   */
  const expectEntriesRendered = (skip: readonly string[] = []) => {
    expect(
      domClasses
        .map(entry => entry.name)
        .filter(name => !skip.includes(name) && !classes.has(name))
    ).toEqual([])
    const missing: string[] = []
    for (const entry of domAttributes) {
      if (skip.includes(entry.name)) {
        continue
      }
      for (const selector of entry.on.split(',').map(part => part.trim())) {
        // A placement on a skipped class is skipped with it.
        if (skip.some(name => selector.includes(`.${name}`))) {
          continue
        }
        const elements = attributes.get(entry.name) ?? []
        if (!elements.some(element => element.matches(selector))) {
          missing.push(`${entry.name} on ${selector}`)
        }
      }
    }
    expect(missing).toEqual([])
  }

  return {
    collect,
    expectNothingOutsideContract,
    expectNoStyle,
    expectEntriesRendered
  }
}
