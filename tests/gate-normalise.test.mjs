import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalise, foldPattern } from '../scripts/gate-normalise.mjs';

// All fixture text is synthetic. Escapes keep the intended code points visible.
const RSQUO = '’';
const FULLWIDTH_PAREN = '（';

test('normalise decodes the common entities', () => {
  assert.equal(normalise('Plant&#39;ed'), "Plant'ed");
  assert.equal(normalise('Plant&#x27;ed'), "Plant'ed");
  assert.equal(normalise('&quot;Secret&quot;'), '"Secret"');
  assert.equal(normalise('Fish &amp; Chips'), 'Fish & Chips');
  assert.equal(normalise('Plant&rsquo;ed'), "Plant'ed");
});

test('normalise decodes once: &amp;#39; becomes the literal &#39;', () => {
  assert.equal(normalise('&amp;#39;'), '&#39;');
});

test('out-of-range, surrogate and zero references stay as written and never throw', () => {
  for (const s of ['&#99999999;', '&#x110000;', '&#xD800;', '&#0;', '&#xDFFF;', '&#x0;']) {
    assert.equal(normalise(s), s);
  }
  assert.equal(normalise('&#' + '9'.repeat(400) + ';'), '&#' + '9'.repeat(400) + ';');
});

test('an unknown named entity stays as written', () => {
  assert.equal(normalise('&bogus;'), '&bogus;');
});

test('NFC and NFD spellings normalise to the same string, mark stripped', () => {
  const nfc = 'Zoë Example'.normalize('NFC');
  const nfd = 'Zoë Example'.normalize('NFD');
  assert.notEqual(nfc, nfd);
  assert.equal(normalise(nfc), 'Zoe Example');
  assert.equal(normalise(nfd), 'Zoe Example');
});

test('curly quotes and dashes fold to ASCII', () => {
  assert.equal(normalise('‘a’'), "'a'");
  assert.equal(normalise('“a”'), '"a"');
  assert.equal(normalise('„a“'), '"a"');
  assert.equal(normalise('a–b—c−d'), 'a-b-c-d');
});

test('whitespace runs collapse to one space', () => {
  assert.equal(normalise('a \n\t  b'), 'a b');
  assert.equal(normalise('a&nbsp; b'), 'a b');
});

test('foldPattern leaves escapes alone and folds the rest', () => {
  assert.equal(foldPattern(`Plant${RSQUO}ed\\s\\b\\.`), "Plant'ed\\s\\b\\.");
  assert.equal(foldPattern('a\\’b'), 'a\\’b');
});

test('foldPattern leaves character classes alone', () => {
  assert.equal(foldPattern('[a–z]'), '[a–z]');
  assert.equal(foldPattern('[–-]'), '[–-]');
  assert.equal(foldPattern('x–[–]–y'), 'x-[–]-y');
});

test('foldPattern does not decode entities', () => {
  assert.equal(foldPattern('a&#39;b'), 'a&#39;b');
});

test('a fullwidth parenthesis folds to a source RegExp rejects (fail-closed fixture)', () => {
  const source = `Plant${FULLWIDTH_PAREN}ed`;
  assert.doesNotThrow(() => new RegExp(source, 'im'));
  assert.throws(() => new RegExp(foldPattern(source), 'im'), SyntaxError);
});

test('anchored patterns do not match the normalised text: the raw pass owns them', () => {
  const text = 'alpha\nbeta line\ngamma\n';
  const source = '^beta line$';
  assert.ok(new RegExp(source, 'im').test(text));
  assert.ok(!new RegExp(foldPattern(source), 'im').test(normalise(text)));
  // At the very start and end of the file they still work.
  assert.ok(new RegExp(foldPattern('^alpha'), 'im').test(normalise(text)));
});
