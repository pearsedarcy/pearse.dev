/**
 * Text and pattern normalisation for the confidentiality gate's second pass (ADR 0005, #108).
 * Pure functions, no I/O, so tests can import them: scripts/gate.mjs runs its scan at top level.
 *
 * The rendered site does not hold names the way a pattern author types them: Astro HTML-encodes
 * quotes, smartypants curls apostrophes, accents can be composed or decomposed, and Markdown
 * wraps a two-word name across a line break. `normalise(text)` flattens those differences and
 * `foldPattern(source)` folds a pattern the same way, so the folded pattern is tested against the
 * normalised text.
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

const ENTITY = /&(?:#([0-9]+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/g;

/**
 * One-pass entity decode. Replacement text is never rescanned, so `&amp;#39;` becomes the literal
 * `&#39;`. Anything unknown or unrepresentable (code point 0, above U+10FFFF, a lone surrogate, an
 * unlisted named entity) is returned as written. Never throws.
 */
function decodeEntities(text) {
  return text.replace(ENTITY, (whole, dec, hex, name) => {
    if (name !== undefined) {
      return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : whole;
    }
    const cp = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
    if (!Number.isFinite(cp) || cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      return whole;
    }
    return String.fromCodePoint(cp);
  });
}

const SINGLE_QUOTES = /[‘’‛′ʼ]/g;
const DOUBLE_QUOTES = /[‚“”„‟″]/g;
const DASHES = /[‐‑‒–—―−]/g;

/** Steps 2 to 5: NFKC, strip combining marks, fold typographic characters, collapse whitespace. */
function foldText(text) {
  return text
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(/\s+/g, ' ');
}

/** The normalised copy of a file's text: entities decoded once, then folded. */
export function normalise(text) {
  return foldText(decodeEntities(text));
}

/**
 * Fold a pattern source with steps 2 to 5 (no entity decoding). Text inside a character class
 * `[...]` and the character after a backslash are copied as written, so `\s`, `\b`, `\.` and
 * `[a-z]` keep their meaning. The class ends at the first unescaped `]`, as in a RegExp without
 * the `u` flag.
 */
export function foldPattern(source) {
  const chars = Array.from(source);
  let out = '';
  let run = '';
  const flush = () => {
    out += foldText(run);
    run = '';
  };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '\\') {
      flush();
      out += c + (i + 1 < chars.length ? chars[++i] : '');
    } else if (c === '[') {
      flush();
      out += c;
      for (i++; i < chars.length; i++) {
        out += chars[i];
        if (chars[i] === '\\') {
          if (i + 1 < chars.length) out += chars[++i];
        } else if (chars[i] === ']') {
          break;
        }
      }
    } else {
      run += c;
    }
  }
  flush();
  return out;
}
