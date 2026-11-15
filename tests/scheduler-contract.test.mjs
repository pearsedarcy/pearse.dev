// Contract between the built feed and the scheduler (#167): every entry of the real dist/social.json
// goes through selectForDay and the three payload builders, within each network's limits. Ids,
// titles and copy are read from the build, never written here.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildBlueskyRecord,
  buildLinkedInPayload,
  buildMastodonStatus,
  callbackData,
  findForPosting,
  isEligible,
  offerText,
  selectForDay,
} from '../automation/n8n/select.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const AUTHOR = 'urn:li:person:abc123';
const NOW = new Date('2026-11-03T06:00:00Z');
const NETWORKS = ['linkedin', 'bluesky', 'mastodon'];
const graphemes = (s) => Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)).length;
const selectedOnItsDate = (feed, e) => selectForDay(feed, e.date, []).some((x) => x.id === e.id);

let feed;

before(() => {
  assert.ok(existsSync('dist/social.json'), 'dist/social.json is missing: run `npm run build` first (npm test does it in pretest)');
  feed = JSON.parse(readFileSync('dist/social.json', 'utf8'));
});

test('every eligible entry is offered on its date and builds a payload for each network within its limits', () => {
  const eligible = feed.filter(isEligible);
  assert.ok(eligible.length > 0, 'the feed has eligible entries');
  for (const e of eligible) {
    assert.ok(selectedOnItsDate(feed, e), `${e.id} is selected on ${e.date}`);
    assert.ok(!findForPosting(feed, e.id, e.date, [], NETWORKS).error, `${e.id} can be approved on ${e.date}`);

    const li = buildLinkedInPayload(e, AUTHOR);
    const share = li.specificContent['com.linkedin.ugc.ShareContent'];
    assert.ok(share.shareCommentary.text.length <= 3000, `${e.id}: LinkedIn commentary within 3,000 characters`);
    assert.equal(share.shareMediaCategory, e.kind === 'standalone' ? 'NONE' : 'ARTICLE', e.id);

    const bsky = buildBlueskyRecord(e, NOW);
    assert.ok(graphemes(bsky.text) <= 300, `${e.id}: Bluesky text within 300 graphemes`);
    // composeShort counts the whole URL, not Mastodon's flat 23: the same measure, so stricter than Mastodon.
    const masto = buildMastodonStatus(e);
    assert.ok(graphemes(masto.status) <= 500, `${e.id}: Mastodon status within 500 characters`);
    // Every eligible kind carries a url now: a standalone post's is the deep link in its short copy (#285).
    assert.ok(bsky.facets.length > 0 && bsky.facets.every((f) => f.features[0].uri === e.url), `${e.id}: Bluesky links its page`);
    assert.ok(masto.status.includes(e.url), `${e.id}: Mastodon links its page`);

    assert.ok(Buffer.byteLength(callbackData('approve', e.id)) <= 64, `${e.id}: callback data within 64 bytes`);
    assert.ok(offerText(e, false, NETWORKS).length <= 4096, `${e.id}: offer within one Telegram message`);
  }
});

test('an entry that is not eligible is not selected on its date and is refused at Approve (passes with none)', () => {
  for (const e of feed.filter((x) => !isEligible(x))) {
    assert.ok(!selectedOnItsDate(feed, e), `${e.id} is not selected on ${e.date}`);
    assert.match(findForPosting(feed, e.id, e.date, []).error ?? '', /not published/, e.id);
    // A full unpublished entry is refused as not published; a stub with no copy (#111) as missing copy.
    assert.throws(() => buildLinkedInPayload(e, AUTHOR), /not published|no LinkedIn copy/, e.id);
    assert.throws(() => buildBlueskyRecord(e, NOW), /not published|no short copy/, e.id);
    assert.throws(() => buildMastodonStatus(e), /not published|no short copy/, e.id);
  }
});

test('selection on each date is exactly the eligible entries of that date', () => {
  for (const date of new Set(feed.map((e) => e.date))) {
    const expected = feed.filter((e) => e.date === date && isEligible(e)).map((e) => e.id);
    assert.deepEqual(selectForDay(feed, date, []).map((e) => e.id), expected, date);
  }
});

// The regression guard: the equivalence above holds even if isEligible drops projects again; this does not.
test('the feed has case studies, and every project entry is selected on its own date', () => {
  const projects = feed.filter((e) => e.kind === 'project');
  assert.ok(projects.length > 0, 'the feed has at least one project entry');
  for (const e of projects) assert.ok(selectedOnItsDate(feed, e), `project ${e.id} is selected on ${e.date}`);
});
