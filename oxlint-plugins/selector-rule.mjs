// Turns a list of ESQuery selectors into an oxlint JS plugin rule. oxlint
// matches selector keys of the visitor itself, so no ESLint code is needed.
export const selectorRule = (description, entries) => ({
  meta: { type: 'problem', docs: { description }, schema: [] },
  create(context) {
    const visitor = {}
    for (const { selector, message } of entries) {
      const previous = visitor[selector]
      visitor[selector] = node => {
        previous?.(node)
        context.report({ node, message })
      }
    }
    return visitor
  }
})
