// Asserts a case study's body text (its story) renders before the "What it does in depth"
// sections, under its own rule, so it is not read as part of the last sub-section or
// diagram (#68). Pages without sections keep the body exactly as before.
// Relies on `npm test`'s pretest build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projects } from './lib/projects.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const visible = projects().filter((p) => p.visible);
const page = (slug) => readFileSync(`dist/work/${slug}/index.html`, 'utf8');
const bodyTag = (html) => html.match(/<section[^>]*aria-label="Notes"[^>]*>/);

test('with sections, the body comes first and carries its own rule', () => {
  const withSections = visible.filter((p) => (p.sections ?? []).length > 0);
  assert.ok(withSections.length >= 2, 'both MTS case studies have sections');
  for (const p of withSections) {
    const html = page(p.slug);
    const body = bodyTag(html);
    assert.ok(body, `${p.slug}: body section`);
    assert.match(body[0], /\bcase-intro\b/, `${p.slug}: body has its own rule`);
    const sections = html.indexOf('id="sections-title"');
    assert.ok(sections > 0, `${p.slug}: in-depth heading`);
    assert.ok(body.index < sections, `${p.slug}: body before "in depth"`);
    // Nothing from a sub-section (its heading or diagram) sits between the body and "in depth".
    const between = html.slice(body.index, sections);
    for (const s of p.sections) {
      assert.ok(!between.includes(`id="${s.id}-title"`), `${p.slug}: ${s.id} after the body`);
    }
  }
});

test('the MTS stories open the body, before any sub-section', () => {
  const opening = {
    'mts-hub': 'MTS runs hands-on surgical training',
    'wetlabs-app': 'A wetlab is a room full of microscopes',
  };
  for (const [slug, text] of Object.entries(opening)) {
    const html = page(slug);
    const at = html.indexOf(text);
    assert.ok(at > 0, `${slug}: story text`);
    assert.ok(at < html.indexOf('id="sections-title"'), `${slug}: story before "in depth"`);
  }
});

test('without sections, the body is unchanged', () => {
  const plain = visible.filter((p) => (p.sections ?? []).length === 0);
  assert.ok(plain.length > 0);
  for (const p of plain) {
    const html = page(p.slug);
    assert.ok(!html.includes('id="sections-title"'), `${p.slug}: no in-depth block`);
    const body = bodyTag(html);
    if (body) assert.doesNotMatch(body[0], /\bcase-intro\b/, p.slug);
  }
});
