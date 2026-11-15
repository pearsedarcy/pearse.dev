// Case-study outcomes (GLOSSARY "Outcome"): the optional `outcome` sentence and the `outcomes`
// engineering-metrics row shown above the fold (#159). Engineering metrics only: no money, no
// percentages, no business counts, and every figure restates one already in the page's own copy
// (tests/outcomes.test.mjs holds the allowlist). Pure: the schema (src/content.config.ts) and
// the tests (Node type stripping) both load it, so imports carry explicit `.ts` extensions and
// nothing here may import astro:content, ./site or ./diagrams.
import { VERIFY_MARKER } from './verify-marker.ts';

/** Max characters in the `outcome` sentence. */
export const OUTCOME_MAX = 160;
/** Min and max items in an `outcomes` row. */
export const OUTCOMES_MIN = 1;
export const OUTCOMES_MAX = 4;
/** Max characters in an item's `value` and `label`. */
export const OUTCOME_VALUE_MAX = 8;
export const OUTCOME_LABEL_MAX = 40;

/** Words that make a label a business count, matched case-insensitively as whole words. */
export const BUSINESS_COUNT_WORDS = [
  'customers',
  'clients',
  'attendees',
  'participants',
  'delegates',
  'users',
  'revenue',
  'sales',
  'bookings',
  'orders',
] as const;

export interface OutcomeItem {
  value: string;
  label: string;
}

export interface OutcomeFields {
  outcome?: string;
  outcomes?: readonly OutcomeItem[];
}

/** One rule broken: `path` is dotted (`outcomes.1.label`); `message` names the path and the rule. */
export interface OutcomeIssue {
  path: string;
  message: string;
}

const CURRENCY = /[€$£¥]|\b(?:EUR|USD|GBP)\b/i;
const BUSINESS = new RegExp(`\\b(?:${BUSINESS_COUNT_WORDS.join('|')})\\b`, 'i');

/** Rules for every field. Messages never echo the field's text, so a marker is never repeated. */
function textIssues(path: string, text: string): OutcomeIssue[] {
  const issues: OutcomeIssue[] = [];
  if (CURRENCY.test(text)) issues.push({ path, message: `${path}: no currency symbols or codes; engineering metrics only` });
  if (text.includes('%')) issues.push({ path, message: `${path}: no percentages; engineering metrics only` });
  if (text.includes(VERIFY_MARKER)) issues.push({ path, message: `${path}: still has a verify marker; resolve it first` });
  return issues;
}

function capIssue(path: string, text: string, max: number): OutcomeIssue[] {
  return text.length > max ? [{ path, message: `${path}: ${text.length} characters, max ${max}` }] : [];
}

/**
 * Every rule `outcome` and `outcomes` break, in field order. Both fields are optional; an
 * absent field has no issues. The schema declares the same length and count caps itself; they
 * are repeated here so the tests can exercise them without Astro.
 */
export function outcomeIssues({ outcome, outcomes }: OutcomeFields): OutcomeIssue[] {
  const issues: OutcomeIssue[] = [];
  if (outcome !== undefined) {
    issues.push(...capIssue('outcome', outcome, OUTCOME_MAX));
    issues.push(...textIssues('outcome', outcome));
    if (/\d/.test(outcome)) issues.push({ path: 'outcome', message: 'outcome: no digits; put figures in outcomes' });
  }
  if (outcomes !== undefined) {
    if (outcomes.length < OUTCOMES_MIN || outcomes.length > OUTCOMES_MAX) {
      issues.push({ path: 'outcomes', message: `outcomes: ${outcomes.length} items, need ${OUTCOMES_MIN} to ${OUTCOMES_MAX}` });
    }
    outcomes.forEach(({ value, label }, i) => {
      const v = `outcomes.${i}.value`;
      const l = `outcomes.${i}.label`;
      issues.push(...capIssue(v, value, OUTCOME_VALUE_MAX), ...textIssues(v, value));
      issues.push(...capIssue(l, label, OUTCOME_LABEL_MAX), ...textIssues(l, label));
      if (BUSINESS.test(label)) issues.push({ path: l, message: `${l}: no business counts; engineering metrics only` });
    });
  }
  return issues;
}
