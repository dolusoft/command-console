// Fails when a commit message credits an AI tool as a co-author. GitHub turns
// every `Co-authored-by:` trailer into an entry in the repository's
// contributor list; the owner does not want Claude or Codex listed there, so a
// pull request that carries such a trailer cannot be merged.
//
// Only trailers whose address is an AI vendor's noreply address count; a
// person credited as a co-author passes.
//
// The messages come from a file given as the argument, or from standard input
// (the workflow pipes `git log --format=%B base..head`).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const banned =
  /^[ \t]*co-authored-by:.*noreply@(anthropic\.com|openai\.com)/gimu

/** The offending trailer lines in `messages`, trimmed. */
export const aiCoAuthors = messages =>
  [...(messages ?? '').matchAll(banned)].map(match => match[0].trim())

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  const messages = readFileSync(file ?? 0, 'utf8')
  const found = aiCoAuthors(messages)
  if (found.length > 0) {
    console.error(
      `[check-commit-trailers] remove the AI co-author trailers from the commit messages:\n${found
        .map(line => `  ${line}`)
        .join('\n')}`
    )
    process.exit(1)
  }
  console.log('[check-commit-trailers] no AI co-author trailers')
}
