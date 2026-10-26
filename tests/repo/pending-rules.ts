/**
 * The rules that have no test yet (P12, CONTRIBUTING.md "Rule traceability").
 *
 * `tests/repo/contract-traceability.spec.ts` requires a runnable test for
 * every rule that is neither withdrawn nor listed here, and fails when a rule
 * listed here already has one: the list only shrinks. A pull request that adds
 * the first test of a rule removes the rule from this list in the same change.
 * 1.0 is released with this list empty.
 */
export const pendingRules: readonly string[] = [
  'C-26',
  'C-35',
  'C-37',
  'C-38',
  'C-39',
  'C-40',
  'C-41',
  'C-43',
  'C-44',
  'C-45',
  'C-46',
  'C-47',
  'C-48',
  'C-51',
  'C-52',
  'C-54',
  'C-58',
  'C-59',
  'C-62',
  'C-64',
  'C-66',
  'C-67',
  'C-68',
  'C-69'
]
