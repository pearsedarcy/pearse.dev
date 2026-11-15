/**
 * Known accessibility violations the scan (a11y.mjs) tolerates until their follow-up lands.
 * Each entry: { rule, selector, issue: '#NNN', reason }.
 *
 * The runner drops a violation node only when its axe rule id equals `rule` and the node is
 * `selector` or inside it (`Element.closest`). It never switches a rule off, and it refuses a
 * selector that covers a whole page (`html`, `body`, `main`, `*`). An entry that matches nothing
 * in a full run fails the run as an unused exclusion, so this list cannot go stale: delete the
 * entry in the PR that fixes the issue. `issue` must name an open issue.
 */
export const EXCLUSIONS = [];

const WHOLE_PAGE = new Set(['html', 'body', 'main', '*', ':root']);

/** Throws on an entry the runner must not apply. Pure; the self-test calls it on the real list. */
export function validateExclusions(list) {
  if (!Array.isArray(list)) throw new Error('exclusions must be an array');
  list.forEach((e, i) => {
    const at = `exclusion #${i + 1}`;
    for (const key of ['rule', 'selector', 'issue', 'reason']) {
      if (typeof e?.[key] !== 'string' || !e[key].trim()) throw new Error(`${at}: "${key}" must be a non-empty string`);
    }
    if (!/^#\d+$/.test(e.issue)) throw new Error(`${at}: issue "${e.issue}" must match ^#\\d+$`);
    if (WHOLE_PAGE.has(e.selector.trim().toLowerCase())) throw new Error(`${at}: selector "${e.selector}" covers a whole page`);
  });
  return list;
}
