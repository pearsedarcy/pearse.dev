// Asserts the two client articles name their clients and carry no permission scaffolding
// (#126), and that each client case study's social copy takes a different angle from its
// article. Permission was recorded in ADR 0006; the business name is the only thing it allows.
// The articles are drafts and case-study social copy is not rendered, so everything is read
// from the markdown source, not dist/. Articles are paired to case studies by their
// `project:` value, not by a hardcoded map, so a broken link fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const CLIENT_ARTICLES = [
  'wordpress-to-wagtail-without-breaking-the-business',
  'replacing-filemaker-with-django',
];

const split = (path) => {
  const text = readFileSync(path, 'utf8');
  const [, front, ...rest] = text.split(/^---$/m);
  return { text, data: parse(front), body: rest.join('---') };
};

/** Sentences as #114 defines them: URLs out, split on . ! ? + space, letters/digits only. */
const sentences = (text) =>
  text
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[.!?]\s+/)
    .map((s) =>
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N} ]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
const long = (text) => sentences(text).filter((s) => s.split(' ').length >= 8);

/** Long sentences that appear in both texts. */
const shared = (a, b) => {
  const theirs = new Set(long(b));
  return long(a).filter((s) => theirs.has(s));
};

const pairs = CLIENT_ARTICLES.map((slug) => {
  const article = split(`src/content/posts/${slug}.md`);
  const project = article.data.project;
  assert.ok(project, `${slug}: has a project: link`);
  const file = readdirSync('src/content/projects')
    .map((f) => `src/content/projects/${f}`)
    .find((f) => split(f).data.slug === project);
  assert.ok(file, `${slug}: project "${project}" is a case study`);
  return { slug, project, article, study: split(file), file };
});

test('the two client articles each link a distinct case study', () => {
  assert.equal(pairs.length, 2);
  assert.notEqual(pairs[0].project, pairs[1].project);
});

for (const { slug, article, study } of pairs) {
  const name = study.data.title;

  test(`${slug}: no permission scaffolding and still a draft`, () => {
    assert.doesNotMatch(article.text, /draft until client permission/);
    assert.doesNotMatch(article.text, /anonymised/);
    assert.equal(article.data.draft, true, 'slice 3 flips draft, not this slice');
  });

  test(`${slug}: names the client "${name}" in the body and the LinkedIn copy`, () => {
    assert.ok(article.body.includes(name), 'body');
    assert.ok(article.data.social.linkedin.includes(name), 'social.linkedin');
  });

  test(`${slug}: the case study's first LinkedIn line is not in the article`, () => {
    const first = study.data.social.linkedin.split('\n').find((l) => l.trim())?.trim();
    assert.ok(first, 'case study has a first LinkedIn line');
    assert.equal(article.text.includes(first), false, `article repeats: "${first}"`);
  });

  test(`${slug}: no 8+ word sentence shared between the case study copy and the article`, () => {
    const caseCopy = `${study.data.social.linkedin}\n${study.data.social.short}`;
    const articleCopy = `${article.data.social.linkedin}\n${article.data.social.short}`;
    assert.deepEqual(shared(caseCopy, articleCopy), [], 'article social copy');
    assert.deepEqual(shared(caseCopy, article.body), [], 'article body');
  });
}

test('the overlap normaliser splits and cleans as specified', () => {
  assert.deepEqual(sentences('One, two! Three? See https://pearse.dev/x/ now. Done'), ['one two', 'three', 'see now', 'done']);
  assert.deepEqual(shared('A b c d e f g h. Short one.', 'x. a B c d e f g h! y'), ['a b c d e f g h']);
});
