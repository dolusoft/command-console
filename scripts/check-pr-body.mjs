// Fails when a pull request body lacks the lines the template asks for:
// `İlkeler:` (the principles a change touches, or "yok") and `Katman:` (the
// layers it touches). HTML comments and fenced code blocks are ignored, so the
// unfilled template fails and a label that only appears inside a code fence
// does not count.
//
// This only catches an unfilled template. It is not a quality gate: a line
// with any non-space text passes, and a human review decides whether the
// content is right.
//
// The body comes from the PR_BODY environment variable (the workflow passes
// `github.event.pull_request.body`) or from a file given as the argument.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const required = ['İlkeler', 'Katman']

/** The required labels that have no value in `body`. */
export const missingLines = body => {
  const text = (body ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Fenced blocks (``` or ~~~), including an unclosed one to the end.
    .replace(
      /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[`~]*[ \t]*$|(?![\s\S]))/gm,
      ''
    )
  return required.filter(
    label => !new RegExp(`^\\s*${label}:[ \\t]*\\S`, 'mu').test(text)
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  const body = file ? readFileSync(file, 'utf8') : process.env.PR_BODY
  const missing = missingLines(body)
  if (missing.length > 0) {
    console.error(
      `[check-pr-body] the pull request body needs ${missing
        .map(label => `a "${label}:" line`)
        .join(' and ')} (see .github/pull_request_template.md)`
    )
    process.exit(1)
  }
  console.log('[check-pr-body] İlkeler and Katman lines are present')
}
