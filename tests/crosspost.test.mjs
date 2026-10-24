// Cross-posting the short copy to Bluesky and Mastodon (issue #23): payloads, limits, optional
// networks and per-network Posting record rows. Pure functions only: no network, no build, no n8n.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBlueskyRecord,
  buildMastodonStatus,
  composeShort,
  decide,
  idempotencyKey,
  networksFor,
  readConfig,
  recordPostResult,
  stateFor,
} from '../automation/n8n/select.mjs';

const CHAT = '1000';
const NOW = new Date('2026-11-03T06:00:00Z');
const URL_A = 'https://pearse.dev/writing/gruesse/';
const INSTANCE = 'https://social.example';
const graphemes = (s) => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].length;
const bytes = (s) => Buffer.byteLength(s, 'utf8');

const article = (over = {}) => ({
  kind: 'article',
  id: 'gruesse',
  slug: 'gruesse',
  title: 'Grüße aus Innsbruck: Café ☕ und 🚀',
  date: '2026-11-03',
  pubDate: '2026-11-03',
  url: URL_A,
  published: true,
  status: 'approved',
  tags: [],
  social: { linkedin: 'Long copy.', short: `Grüße aus Innsbruck: Café ☕ und 🚀. ${URL_A}` },
  ...over,
});
const standalone = (over = {}) => ({
  kind: 'standalone',
  id: 'p01',
  title: 'Lesson',
  date: '2026-11-03',
  published: true,
  status: 'approved',
  social: { linkedin: 'p01 long', short: 'Write the rule as a hook, not a sentence.' },
  ...over,
});
const FEED = [article(), standalone()];
const ON = {
  bluesky: { enabled: true },
  mastodon: { enabled: true, instance: INSTANCE },
};
const config = (over = {}) => ({ dryRun: false, chatId: CHAT, authorUrn: 'urn:li:person:abc123', today: '2026-11-03', ...ON, ...over });
const approve = (state, cfg = config(), id = 'gruesse') => decide({ request: { mode: 'approve', id }, config: cfg, feed: FEED, state, now: NOW });
const rows = (state) => state.record.map((r) => [r.id, r.network, r.status]);
const ok = (body) => ({ statusCode: 200, body, headers: {} });

// ---- Bluesky record ----

test('Bluesky link facet sits on UTF-8 byte offsets, past non-ASCII text', () => {
  const r = buildBlueskyRecord(article(), NOW);
  assert.equal(r.$type, 'app.bsky.feed.post');
  assert.equal(r.createdAt, NOW.toISOString());
  assert.equal(r.text, `Grüße aus Innsbruck: Café ☕ und 🚀. ${URL_A}`, 'short copy that already holds the URL is posted as written');
  assert.equal(r.facets.length, 1);
  const { byteStart, byteEnd } = r.facets[0].index;
  const prefix = r.text.slice(0, r.text.indexOf(URL_A));
  assert.equal(byteStart, bytes(prefix));
  assert.ok(byteStart > prefix.length, 'byte offsets, not string offsets');
  assert.equal(byteEnd - byteStart, bytes(URL_A));
  assert.equal(Buffer.from(r.text, 'utf8').subarray(byteStart, byteEnd).toString('utf8'), URL_A);
  assert.deepEqual(r.facets[0].features, [{ $type: 'app.bsky.richtext.facet#link', uri: URL_A }]);
});

test('short copy without the URL gets it on its own line, with the facet on it', () => {
  const r = buildBlueskyRecord(article({ social: { linkedin: 'x', short: 'Grüße, ein Beitrag über Café-Kultur.' } }), NOW);
  assert.equal(r.text, `Grüße, ein Beitrag über Café-Kultur.\n\n${URL_A}`);
  const { byteStart, byteEnd } = r.facets[0].index;
  assert.equal(Buffer.from(r.text).subarray(byteStart, byteEnd).toString(), URL_A);
  assert.equal(byteEnd, bytes(r.text));
});

test('over 300 graphemes: the copy is cut with an ellipsis, never the URL', () => {
  const long = article({ social: { linkedin: 'x', short: `${'Schöne Grüße 👍🏽 '.repeat(40)}${URL_A}` } });
  const r = buildBlueskyRecord(long, NOW);
  assert.ok(graphemes(r.text) <= 300, `${graphemes(r.text)} graphemes`);
  assert.ok(r.text.endsWith(`…\n\n${URL_A}`), 'URL moved to the end, intact');
  assert.equal(r.text.split(URL_A).length, 2, 'URL appears once');
  assert.ok(r.text.isWellFormed(), 'no split surrogate pair');
  const { byteStart, byteEnd } = r.facets[0].index;
  assert.equal(Buffer.from(r.text).subarray(byteStart, byteEnd).toString(), URL_A);
});

test('the cut never splits a grapheme cluster', () => {
  const thumbs = '👍🏽'; // 1 grapheme, 2 code points, 4 UTF-16 units
  const { text } = composeShort(thumbs.repeat(400), null, 300);
  assert.equal(graphemes(text), 300);
  assert.equal(text, thumbs.repeat(299) + '…');
});

test('a standalone post is text only: no URL, no facet', () => {
  const r = buildBlueskyRecord(standalone(), NOW);
  assert.deepEqual(r, { $type: 'app.bsky.feed.post', text: 'Write the rule as a hook, not a sentence.', createdAt: NOW.toISOString() });
  const long = buildBlueskyRecord(standalone({ social: { linkedin: 'x', short: 'ä'.repeat(301) } }), NOW);
  assert.equal(long.text, 'ä'.repeat(299) + '…');
  assert.equal(long.facets, undefined);
});

test('an unpublished article or missing short copy cannot be built', () => {
  assert.throws(() => buildBlueskyRecord(article({ published: false }), NOW), /not published/);
  assert.throws(() => buildMastodonStatus(article({ published: false })), /not published/);
  assert.throws(() => buildBlueskyRecord(standalone({ social: { linkedin: 'x' } }), NOW), /no short copy/);
});

// ---- Mastodon status ----

test('Mastodon status: short copy and URL, public, cut at 500 without touching the URL', () => {
  assert.deepEqual(buildMastodonStatus(article()), { status: `Grüße aus Innsbruck: Café ☕ und 🚀. ${URL_A}`, visibility: 'public' });
  assert.deepEqual(buildMastodonStatus(article({ social: { linkedin: 'x', short: 'Neu.' } })), { status: `Neu.\n\n${URL_A}`, visibility: 'public' });
  assert.deepEqual(buildMastodonStatus(standalone()), { status: 'Write the rule as a hook, not a sentence.', visibility: 'public' });
  const s = buildMastodonStatus(article({ social: { linkedin: 'x', short: 'ö'.repeat(600) } })).status;
  assert.equal(graphemes(s), 500);
  assert.equal(s, `${'ö'.repeat(500 - 2 - URL_A.length - 1)}…\n\n${URL_A}`);
});

test('the idempotency key is stable per item and network', () => {
  assert.equal(idempotencyKey('gruesse', 'mastodon'), idempotencyKey('gruesse', 'mastodon'));
  assert.notEqual(idempotencyKey('gruesse', 'mastodon'), idempotencyKey('gruesse', 'bluesky'));
  assert.notEqual(idempotencyKey('gruesse', 'mastodon'), idempotencyKey('p01', 'mastodon'));
});

// ---- settings ----

test('a network is on only when its credential is named; anything else skips it, never throws', () => {
  const cfg = (vars) => readConfig((k) => ({ TELEGRAM_CHAT_ID: CHAT, ...vars })[k], NOW);
  assert.deepEqual(networksFor(cfg({})), {
    networks: ['linkedin'],
    skipped: [
      { network: 'bluesky', reason: 'no Bluesky credential (BLUESKY_CREDENTIAL is unset)' },
      { network: 'mastodon', reason: 'no Mastodon credential (MASTODON_CREDENTIAL is unset)' },
    ],
  });
  const both = cfg({ BLUESKY_CREDENTIAL: 'bluesky-app-password', MASTODON_CREDENTIAL: 'mastodon-token', MASTODON_INSTANCE_URL: `${INSTANCE}/` });
  assert.deepEqual(networksFor(both).networks, ['linkedin', 'bluesky', 'mastodon']);
  assert.equal(both.mastodon.instance, INSTANCE, 'trailing slash dropped');
  const noInstance = cfg({ MASTODON_CREDENTIAL: 'mastodon-token' });
  assert.match(noInstance.mastodon.reason, /MASTODON_INSTANCE_URL is unset/);
  assert.match(cfg({ MASTODON_CREDENTIAL: 'mastodon-token', MASTODON_INSTANCE_URL: 'http://x.example' }).mastodon.reason, /https:\/\/<host>/);
  assert.match(cfg({ MASTODON_CREDENTIAL: 'mastodon-token', MASTODON_INSTANCE_URL: `${INSTANCE}/@me` }).mastodon.reason, /no path/);
  assert.match(cfg({ BLUESKY_CREDENTIAL: 'my-bsky' }).bluesky.reason, /must be bluesky-app-password/);
});

test('a missing credential skips that network cleanly, with a note', () => {
  const state = stateFor({}, false);
  const out = approve(state, config({ bluesky: { enabled: false, reason: 'no Bluesky credential (BLUESKY_CREDENTIAL is unset)' } }));
  assert.deepEqual(out.map((o) => o.action), ['post', 'post_mastodon', 'notify']);
  assert.equal(out[2].text, 'gruesse: skipped: no Bluesky credential (BLUESKY_CREDENTIAL is unset)');
  assert.deepEqual(rows(state), [['gruesse', 'linkedin', 'pending'], ['gruesse', 'mastodon', 'pending']]);
});

// ---- approve, dry run and live ----

test('dry run shows three payloads per approved item when both credentials are named', () => {
  const data = {};
  const state = stateFor(data, true);
  const out = approve(state, config({ dryRun: true }));
  assert.deepEqual(out.map((o) => [o.action, o.network]), [['dryrun', 'linkedin'], ['dryrun', 'bluesky'], ['dryrun', 'mastodon']]);
  assert.match(out[1].text, /^DRY RUN: would POST https:\/\/bsky\.social\/xrpc\/com\.atproto\.server\.createSession with the bluesky-app-password credential, then\nPOST https:\/\/bsky\.social\/xrpc\/com\.atproto\.repo\.createRecord\n/);
  const bsky = JSON.parse(out[1].text.slice(out[1].text.indexOf('{')));
  assert.equal(bsky.collection, 'app.bsky.feed.post');
  assert.deepEqual(bsky.record, buildBlueskyRecord(article(), NOW));
  assert.match(out[2].text, new RegExp(`^DRY RUN: would POST ${INSTANCE}/api/v1/statuses\\n.*Idempotency-Key: pearse\\.dev:mastodon:gruesse`, 's'));
  assert.deepEqual(JSON.parse(out[2].text.slice(out[2].text.indexOf('{'))), buildMastodonStatus(article()));
  assert.deepEqual(rows(state), [['gruesse', 'linkedin', 'posted'], ['gruesse', 'bluesky', 'posted'], ['gruesse', 'mastodon', 'posted']]);
  assert.equal(data.live, undefined);
});

test('live approve writes one pending row per network and one post action each', () => {
  const state = stateFor({}, false);
  const out = decide({ request: { mode: 'approve', id: 'gruesse', queryId: 'q' }, config: config(), feed: FEED, state, now: NOW });
  assert.deepEqual(out.map((o) => o.action), ['ack', 'post', 'post_bluesky', 'post_mastodon']);
  assert.deepEqual(out[2].record, buildBlueskyRecord(article(), NOW));
  assert.equal(out[3].url, `${INSTANCE}/api/v1/statuses`);
  assert.equal(out[3].idempotencyKey, 'pearse.dev:mastodon:gruesse');
  assert.deepEqual(out[3].payload, buildMastodonStatus(article()));
  assert.deepEqual(rows(state), [['gruesse', 'linkedin', 'pending'], ['gruesse', 'bluesky', 'pending'], ['gruesse', 'mastodon', 'pending']]);
  assert.match(approve(state)[0].text, /already pending/, 'a second tap is refused');
});

test('posting record rows per network carry postUrn, uri or url', () => {
  const state = stateFor({}, false);
  approve(state);
  recordPostResult({ state, id: 'gruesse', chatId: CHAT, network: 'linkedin', response: { statusCode: 201, body: { id: 'urn:li:share:1' }, headers: {} }, now: NOW });
  const b = recordPostResult({ state, id: 'gruesse', chatId: CHAT, network: 'bluesky', session: ok({}), response: ok({ uri: 'at://did:example:me/app.bsky.feed.post/3abc', cid: 'c' }), now: NOW });
  assert.match(b.text, /Posted gruesse to Bluesky: at:\/\/.*\nhttps:\/\/bsky\.app\/profile\/did:example:me\/post\/3abc/);
  const m = recordPostResult({ state, id: 'gruesse', chatId: CHAT, network: 'mastodon', response: ok({ id: '1', url: `${INSTANCE}/@me/1`, uri: 'x' }), now: NOW });
  assert.equal(m.text, `Posted gruesse to Mastodon: ${INSTANCE}/@me/1`);
  const at = NOW.toISOString();
  assert.deepEqual(state.record, [
    { id: 'gruesse', network: 'linkedin', postedAt: at, postUrn: 'urn:li:share:1', status: 'posted' },
    { id: 'gruesse', network: 'bluesky', postedAt: at, uri: 'at://did:example:me/app.bsky.feed.post/3abc', status: 'posted' },
    { id: 'gruesse', network: 'mastodon', postedAt: at, url: `${INSTANCE}/@me/1`, status: 'posted' },
  ]);
  assert.match(approve(state)[0].text, /already posted/);
  assert.match(decide({ request: { mode: 'reoffer', id: 'gruesse' }, config: config(), feed: FEED, state, now: NOW })[0].text, /urn:li:share:1.*not offered again/);
});

test('one network failing leaves the others recorded, and Approve again posts only that network', () => {
  const state = stateFor({}, false);
  approve(state);
  recordPostResult({ state, id: 'gruesse', chatId: CHAT, network: 'linkedin', response: { statusCode: 201, body: { id: 'urn:li:share:1' }, headers: {} }, now: NOW });
  const refused = recordPostResult({ state, id: 'gruesse', chatId: CHAT, network: 'bluesky', session: ok({}), response: { statusCode: 400, body: { error: 'InvalidRequest' } }, now: NOW });
  assert.match(refused.text, /^Bluesky refused gruesse with HTTP 400; .*tap Approve again/);
  recordPostResult({ state, id: 'gruesse', chatId: CHAT, network: 'mastodon', response: ok({ url: `${INSTANCE}/@me/1` }), now: NOW });
  assert.deepEqual(rows(state), [['gruesse', 'linkedin', 'posted'], ['gruesse', 'mastodon', 'posted']]);
  const retry = approve(state);
  assert.deepEqual(retry.map((o) => o.action), ['post_bluesky'], 'LinkedIn and Mastodon are not posted twice');
  assert.deepEqual(rows(state).at(-1), ['gruesse', 'bluesky', 'pending']);
});

test('LinkedIn failing does not stop the cross-posts being recorded', () => {
  const state = stateFor({}, false);
  approve(state);
  recordPostResult({ state, id: 'gruesse', chatId: CHAT, network: 'linkedin', response: { error: { message: 'ETIMEDOUT' } }, now: NOW });
  recordPostResult({ state, id: 'gruesse', chatId: CHAT, network: 'bluesky', session: ok({}), response: ok({ uri: 'at://d/app.bsky.feed.post/1' }), now: NOW });
  recordPostResult({ state, id: 'gruesse', chatId: CHAT, network: 'mastodon', response: ok({ url: `${INSTANCE}/@me/1` }), now: NOW });
  assert.deepEqual(rows(state), [['gruesse', 'linkedin', 'unknown'], ['gruesse', 'bluesky', 'posted'], ['gruesse', 'mastodon', 'posted']]);
});

test('a Bluesky 5xx is unknown; /reoffer keeps posted networks and offers only the rest', () => {
  const state = stateFor({}, false);
  approve(state);
  recordPostResult({ state, id: 'gruesse', chatId: CHAT, network: 'linkedin', response: { statusCode: 201, body: { id: 'urn:li:share:1' }, headers: {} }, now: NOW });
  const res = recordPostResult({ state, id: 'gruesse', chatId: CHAT, network: 'bluesky', session: ok({}), response: { statusCode: 502, body: 'bad gateway' }, now: NOW });
  assert.match(res.text, /may have been posted.*check Bluesky/s);
  recordPostResult({ state, id: 'gruesse', chatId: CHAT, network: 'mastodon', response: ok({ url: 'u' }), now: NOW });
  const again = decide({ request: { mode: 'reoffer', id: 'gruesse' }, config: config(), feed: FEED, state, now: NOW });
  assert.deepEqual(again.map((o) => o.action), ['offer']);
  assert.match(again[0].text, /\nPosts to: Bluesky\n/);
  assert.deepEqual(rows(state), [['gruesse', 'linkedin', 'posted'], ['gruesse', 'mastodon', 'posted']]);
  assert.deepEqual(approve(state).map((o) => o.action), ['post_bluesky']);
});

test('a failed Bluesky login means nothing was posted: the row is dropped', () => {
  const state = stateFor({}, false);
  approve(state);
  const res = recordPostResult({
    state,
    id: 'gruesse',
    chatId: CHAT,
    network: 'bluesky',
    session: { statusCode: 401, body: { error: 'AuthenticationRequired', message: 'Invalid identifier or password' } },
    response: { statusCode: 401, body: {} },
    now: NOW,
  });
  assert.match(res.text, /^Bluesky login failed for gruesse \(HTTP 401\); nothing was posted.*bluesky-app-password.*\n.*Invalid identifier/s);
  assert.deepEqual(rows(state), [['gruesse', 'linkedin', 'pending'], ['gruesse', 'mastodon', 'pending']]);
});

test('cross-post copy that cannot be built is reported and LinkedIn still posts', () => {
  const feed = [standalone({ social: { linkedin: 'p01 long' } })];
  const state = stateFor({}, false);
  const out = decide({ request: { mode: 'approve', id: 'p01' }, config: config(), feed, state, now: NOW });
  assert.deepEqual(out.map((o) => o.action), ['post', 'notify']);
  assert.equal(out[1].text, 'p01: Bluesky not posted: p01 has no short copy.\nMastodon not posted: p01 has no short copy.');
  assert.deepEqual(rows(state), [['p01', 'linkedin', 'pending']]);
});

test('a skipped item is skipped on every network', () => {
  const state = stateFor({}, false);
  decide({ request: { mode: 'skip', id: 'p01' }, config: config(), feed: FEED, state, now: NOW });
  const out = approve(state, config(), 'p01');
  assert.deepEqual(out.map((o) => o.action), ['notify']);
  assert.match(out[0].text, /already skipped/);
});

test('rows from before cross-posting (no network field) count as LinkedIn', () => {
  const state = stateFor({}, false);
  state.record.push({ id: 'gruesse', postedAt: NOW.toISOString(), postUrn: 'urn:li:share:1', status: 'posted' });
  assert.deepEqual(approve(state).map((o) => o.action), ['post_bluesky', 'post_mastodon']);
});

test('the offer lists the networks it will post to', () => {
  const out = decide({ request: { mode: 'daily' }, config: config(), feed: FEED, state: stateFor({}, false), now: NOW });
  assert.match(out[0].text, /^Approve this post for 2026-11-03\?\nArticle gruesse: .*\nPosts to: LinkedIn, Bluesky, Mastodon\n/);
});
