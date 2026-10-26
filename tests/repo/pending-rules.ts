/**
 * The rules that have no test yet (P12, CONTRIBUTING.md "Rule traceability").
 *
 * `tests/repo/contract-traceability.spec.ts` requires a runnable test for
 * every rule that is neither withdrawn nor listed here, and fails when a rule
 * listed here already has one: the list only shrinks. A pull request that adds
 * the first test of a rule removes the rule from this list in the same change.
 * 1.0 is released with this list empty.
 */
export const pendingRules: readonly string[] = []
