// Scheduler (ADR 0004): selection, LinkedIn payloads, the Posting record, and the
// exported n8n workflow. No build and no n8n needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasUrl } from './lib/sanitise.mjs';
import {
  buildBlueskyRecord,
  buildLinkedInPayload,
  buildMastodonStatus,
  callbackData,
  decide,
  findForPosting,
  hourIn,
  isEligible,
  LAST_DAILY_HOUR,
  parseCommand,
  parseFeedResponse,
  readConfig,
  recordPostResult,
  routeUpdate,
  selectForDay,
  selectToOffer,
  stateFor,
} from '../automation/n8n/select.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const WORKFLOW_TEXT = read('automation/n8n/social-scheduler.json');
const workflow = JSON.parse(WORKFLOW_TEXT);
const node = (name) => workflow.nodes.find((n) => n.name === name);
const ERRORS_TEXT = read('automation/n8n/scheduler-errors.json');
const errors = JSON.parse(ERRORS_TEXT);
const errorNode = (name) => errors.nodes.find((n) => n.name === name);

const AUTHOR = 'urn:li:person:abc123';
const CHAT = '1000';
const NOW = new Date('2026-11-03T04:00:00Z'); // 05:00 Vienna: before the daily run, so not the last daily run
const LAST_RUN = new Date('2026-11-03T06:00:00Z'); // 07:00 Vienna: the one daily run
const copy = (s) => ({ linkedin: `${s} long`, short: `${s} short` });

const FEED = [
  { kind: 'article', id: 'old-live', slug: 'old-live', title: 'Old', date: '2026-10-24', pubDate: '2026-10-24', url: 'https://pearse.dev/writing/old-live/', published: true, status: 'approved', tags: [], social: copy('old') },
  { kind: 'article', id: 'today-live', slug: 'today-live', title: 'Today live', date: '2026-11-03', pubDate: '2026-11-03', url: 'https://pearse.dev/writing/today-live/', published: true, status: 'approved', tags: [], social: copy('a') },
  { kind: 'article', id: 'today-unbuilt', slug: 'today-unbuilt', title: 'Not built yet', date: '2026-11-03', pubDate: '2026-11-03', url: 'https://pearse.dev/writing/today-unbuilt/', published: false, status: 'approved', tags: [], social: copy('b') },
  { kind: 'standalone', id: 'p01', title: 'Lesson', date: '2026-11-03', pillar: 'Agentic engineering', published: true, status: 'approved', social: copy('p01') },
  { kind: 'standalone', id: 'p02', title: 'Later', date: '2026-11-10', pillar: 'Platform building', published: true, status: 'approved', social: copy('p02') },
];
const ids = (entries) => entries.map((e) => e.id);
const config = (over = {}) => ({ dryRun: false, chatId: CHAT, authorUrn: AUTHOR, today: '2026-11-03', ...over });

test('selects eligible entries dated that day only', () => {
  assert.deepEqual(ids(selectForDay(FEED, '2026-11-03', [])), ['today-live', 'p01']);
  assert.deepEqual(ids(selectForDay(FEED, '2026-10-24', [])), ['old-live']);
  assert.deepEqual(ids(selectForDay(FEED, '2026-11-04', [])), []);
});

test('skips ids already in the posting record, posted or skipped', () => {
  const record = [
    { id: 'today-live', network: 'linkedin', postedAt: '2026-11-03T06:01:00Z', postUrn: 'urn:li:share:1', status: 'posted' },
    { id: 'p01', network: 'linkedin', postedAt: '2026-11-03T06:02:00Z', postUrn: null, status: 'skipped' },
  ];
  assert.deepEqual(ids(selectForDay(FEED, '2026-11-03', record)), []);
});

test('an unpublished article is never selected, offered or posted', () => {
  assert.ok(!ids(selectForDay(FEED, '2026-11-03', [])).includes('today-unbuilt'));
  assert.match(findForPosting(FEED, 'today-unbuilt', '2026-11-03', []).error, /not published/);
  assert.throws(() => buildLinkedInPayload(FEED[2], AUTHOR), /not published/);
  const out = decide({ request: { mode: 'approve', id: 'today-unbuilt' }, config: config(), feed: FEED, state: stateFor({}, false), now: NOW });
  assert.deepEqual(out.map((o) => o.action), ['notify']);
});

test('a stripped scheduled article (#111) is never selected, offered or posted, and reoffer says not published', () => {
  // Appended, not inserted: FEED[1..3] are used by position elsewhere.
  const feed = [...FEED, { kind: 'article', id: 'today-stripped', date: '2026-11-03', published: false }];
  assert.ok(!ids(selectForDay(feed, '2026-11-03', [])).includes('today-stripped'));
  assert.ok(!ids(selectToOffer(feed, '2026-11-03', stateFor({}, false))).includes('today-stripped'));
  assert.match(findForPosting(feed, 'today-stripped', '2026-11-03', []).error, /not published yet/);
  const out = decide({ request: { mode: 'reoffer', id: 'today-stripped' }, config: config(), feed, state: stateFor({}, false), now: NOW });
  assert.deepEqual(out.map((o) => o.action), ['notify']);
  assert.match(out[0].text, /not published yet/);
  assert.doesNotMatch(out[0].text, /not in the feed/);
});

test('a draft never reaches the feed, and an unapproved standalone is not eligible', () => {
  const feed = [{ kind: 'standalone', id: 'p09', title: 'x', date: '2026-11-03', published: true, status: 'draft', social: copy('x') }];
  assert.deepEqual(selectForDay(feed, '2026-11-03', []), []);
});

test('an approved future-dated standalone post is offered on its date only', () => {
  assert.ok(!ids(selectForDay(FEED, '2026-11-03', [])).includes('p02'));
  assert.ok(!ids(selectForDay(FEED, '2026-11-09', [])).includes('p02'));
  assert.deepEqual(ids(selectForDay(FEED, '2026-11-10', [])), ['p02']);
  assert.match(findForPosting(FEED, 'p02', '2026-11-03', []).error, /after 2026-11-03/);
});

test('legacy feed entries without kind are treated as articles', () => {
  const legacy = [{ slug: 'x', title: 'X', url: 'https://pearse.dev/writing/x/', pubDate: '2026-11-03', published: true, tags: [], social: copy('x') }];
  assert.deepEqual(ids(selectForDay(legacy, '2026-11-03', [])), ['x']);
});

test('article payload is an ARTICLE share with the URL and title', () => {
  assert.deepEqual(buildLinkedInPayload(FEED[1], AUTHOR), {
    author: AUTHOR,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: 'a long' },
        shareMediaCategory: 'ARTICLE',
        media: [{ status: 'READY', originalUrl: 'https://pearse.dev/writing/today-live/', title: { text: 'Today live' } }],
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  });
});

test('standalone payload is text only', () => {
  const p = buildLinkedInPayload(FEED[3], AUTHOR);
  assert.deepEqual(p.specificContent['com.linkedin.ugc.ShareContent'], { shareCommentary: { text: 'p01 long' }, shareMediaCategory: 'NONE' });
  assert.equal(p.visibility['com.linkedin.ugc.MemberNetworkVisibility'], 'PUBLIC');
  assert.throws(() => buildLinkedInPayload(FEED[3], ''), /LINKEDIN_AUTHOR_URN/);
});

test('callback data fits Telegram and only the configured chat is heard', () => {
  assert.equal(callbackData('approve', 'p01'), 'approve:p01');
  assert.throws(() => callbackData('approve', 'x'.repeat(60)), /64 bytes/);
  const cb = (chat, data) => ({ callback_query: { id: 'q1', data, message: { chat: { id: Number(chat) } } } });
  assert.deepEqual(routeUpdate(cb(CHAT, 'skip:p01'), CHAT), { mode: 'skip', id: 'p01', queryId: 'q1' });
  assert.equal(routeUpdate(cb('2000', 'approve:p01'), CHAT), null);
  assert.deepEqual(routeUpdate({ message: { chat: { id: 1000 }, text: '/reoffer p01' } }, CHAT), { mode: 'reoffer', id: 'p01' });
  assert.equal(routeUpdate({ message: { chat: { id: 1000 }, text: 'hello' } }, CHAT), null);
  assert.deepEqual(parseCommand('/run@somebot'), { mode: 'run' });
  const group = { callback_query: { id: 'q', data: 'approve:p01', from: { id: 5 }, message: { chat: { id: 1000, type: 'group' } } } };
  assert.equal(routeUpdate(group, CHAT), null, 'group chats are never heard');
  const tapBy = (user) => ({ callback_query: { id: 'q', data: 'approve:p01', from: { id: user }, message: { chat: { id: 1000, type: 'private' } } } });
  assert.equal(routeUpdate(tapBy(6), CHAT, '5'), null, 'wrong user');
  assert.equal(routeUpdate(tapBy(5), CHAT, '5').mode, 'approve');
});

test('config defaults to dry run; the date override works in dry runs only', () => {
  const get = (vals) => (k) => vals[k];
  assert.equal(readConfig(get({ TELEGRAM_CHAT_ID: CHAT }), NOW).dryRun, true);
  assert.equal(readConfig(get({ TELEGRAM_CHAT_ID: CHAT, DRY_RUN: 'False' }), NOW).dryRun, false);
  assert.equal(readConfig(get({ TELEGRAM_CHAT_ID: CHAT, SCHEDULER_TODAY: '2026-11-10' }), NOW).today, '2026-11-10');
  assert.equal(readConfig(get({ TELEGRAM_CHAT_ID: CHAT, DRY_RUN: 'false', SCHEDULER_TODAY: '2026-11-10' }), NOW).today, '2026-11-03');
  assert.equal(readConfig(get({ TELEGRAM_CHAT_ID: CHAT }), new Date('2026-11-02T23:30:00Z')).today, '2026-11-03'); // Vienna
  assert.throws(() => readConfig(get({}), NOW), /TELEGRAM_CHAT_ID/);
  assert.throws(() => readConfig(get({ TELEGRAM_CHAT_ID: '-100123' }), NOW), /private chat/);
  assert.equal(readConfig(get({ TELEGRAM_CHAT_ID: CHAT, TELEGRAM_USER_ID: '5' }), NOW).userId, '5');
});

test('a second run the same day offers nothing; skip records and is never re-offered', () => {
  const state = stateFor({}, false);
  const first = decide({ request: { mode: 'daily' }, config: config(), feed: FEED, state, now: NOW });
  assert.deepEqual(first.map((o) => [o.action, o.id]), [['offer', 'today-live'], ['offer', 'p01']]);
  assert.equal(first[0].approveData, 'approve:today-live');
  assert.match(first[0].text, /a long/);
  assert.deepEqual(decide({ request: { mode: 'daily' }, config: config(), feed: FEED, state, now: NOW }), []);
  decide({ request: { mode: 'skip', id: 'p01', queryId: 'q' }, config: config(), feed: FEED, state, now: NOW });
  assert.deepEqual(state.record.map((r) => [r.id, r.status, r.network]), [['p01', 'skipped', 'linkedin']]);
  state.offered = {};
  assert.deepEqual(ids(selectToOffer(FEED, '2026-11-03', state)), ['today-live']);
  const again = decide({ request: { mode: 'reoffer', id: 'p01' }, config: config(), feed: FEED, state, now: NOW });
  assert.deepEqual(again.map((o) => [o.action, o.id]), [['offer', 'p01']]);
  assert.equal(state.record.length, 0);
});

test('approve writes a pending row first, so a second tap is refused, then posts once', () => {
  const state = stateFor({}, false);
  const out = decide({ request: { mode: 'approve', id: 'p01', queryId: 'q' }, config: config(), feed: FEED, state, now: NOW });
  assert.deepEqual(out.map((o) => o.action), ['ack', 'post', 'notify']);
  assert.match(out[2].text, /skipped: no Bluesky credential.*\nskipped: no Mastodon credential/s);
  assert.deepEqual(state.record.map((r) => [r.id, r.status]), [['p01', 'pending']]);
  const doubleTap = decide({ request: { mode: 'approve', id: 'p01', queryId: 'q2' }, config: config(), feed: FEED, state, now: NOW });
  assert.deepEqual(doubleTap.map((o) => o.action), ['ack', 'notify']);
  assert.match(doubleTap[1].text, /already pending/);
  const ok = recordPostResult({ state, id: 'p01', chatId: CHAT, response: { statusCode: 201, body: { id: 'urn:li:share:9' }, headers: {} }, now: NOW });
  assert.match(ok.text, /urn:li:share:9/);
  assert.deepEqual(state.record, [{ id: 'p01', network: 'linkedin', postedAt: NOW.toISOString(), postUrn: 'urn:li:share:9', status: 'posted' }]);
  assert.match(decide({ request: { mode: 'approve', id: 'p01' }, config: config(), feed: FEED, state, now: NOW })[0].text, /already posted/);
  assert.deepEqual(decide({ request: { mode: 'reoffer', id: 'p01' }, config: config(), feed: FEED, state, now: NOW }).map((o) => o.action), ['notify']);
});

test('a 4xx from LinkedIn drops the pending row and allows a retry', () => {
  const state = stateFor({}, false);
  decide({ request: { mode: 'approve', id: 'p01' }, config: config(), feed: FEED, state, now: NOW });
  const fail = recordPostResult({ state, id: 'p01', chatId: CHAT, response: { statusCode: 422, body: '{"message":"duplicate"}' }, now: NOW });
  assert.match(fail.text, /refused p01 with HTTP 422.*tap Approve again\.\n.*duplicate/s);
  assert.equal(state.record.length, 0);
  assert.equal(decide({ request: { mode: 'approve', id: 'p01' }, config: config(), feed: FEED, state, now: NOW })[0].action, 'post');
});

test('a timeout or 5xx records unknown and never invites a blind retry', () => {
  for (const response of [{ error: { message: 'ETIMEDOUT' } }, { statusCode: 0 }, { statusCode: 504, body: 'gateway' }]) {
    const state = stateFor({}, false);
    decide({ request: { mode: 'approve', id: 'p01' }, config: config(), feed: FEED, state, now: NOW });
    const res = recordPostResult({ state, id: 'p01', chatId: CHAT, response, now: NOW });
    assert.match(res.text, /may have been posted.*check LinkedIn/s);
    assert.doesNotMatch(res.text, /tap Approve/);
    assert.deepEqual(state.record.map((r) => [r.id, r.status]), [['p01', 'unknown']]);
    assert.equal(decide({ request: { mode: 'approve', id: 'p01' }, config: config(), feed: FEED, state, now: NOW })[0].action, 'notify');
    assert.deepEqual(selectForDay(FEED, '2026-11-03', state.record).map((e) => e.id), ['today-live']);
  }
});

test('an id too long for callback data is reported, not marked offered, and does not block siblings', () => {
  const slug = 'a'.repeat(70);
  const feed = [{ ...FEED[1], id: slug, slug }, FEED[3]];
  const state = stateFor({}, false);
  const out = decide({ request: { mode: 'daily' }, config: config(), feed, state, now: NOW });
  assert.deepEqual(out.map((o) => o.action), ['notify', 'offer']);
  assert.match(out[0].text, /Cannot offer a{70}: .*64 bytes/);
  assert.equal(out[1].id, 'p01');
  assert.deepEqual(Object.keys(state.offered), ['p01']);
});

test('LinkedIn copy over 3000 characters is caught at offer time', () => {
  const long = { ...FEED[3], social: { linkedin: 'x'.repeat(3001), short: 's' } };
  assert.throws(() => buildLinkedInPayload(long, AUTHOR), /3001 characters/);
  const out = decide({ request: { mode: 'daily' }, config: config(), feed: [long], state: stateFor({}, false), now: NOW });
  assert.match(out[0].text, /Cannot offer p01: .*over LinkedIn's 3000/);
});

test('skip only accepts ids in the feed', () => {
  const state = stateFor({}, false);
  const out = decide({ request: { mode: 'skip', id: 'nope' }, config: config(), feed: FEED, state, now: NOW });
  assert.match(out[0].text, /not in the social feed/);
  assert.equal(state.record.length, 0);
});

test('feed response is read from body, as text or nested', () => {
  assert.deepEqual(parseFeedResponse({ statusCode: 200, body: '[{"id":"a"}]' }), { feed: [{ id: 'a' }] });
  assert.deepEqual(parseFeedResponse({ statusCode: 200, body: { feed: '[]' } }), { feed: [] });
  assert.deepEqual(parseFeedResponse({ statusCode: 503, body: '' }), { feedError: 'HTTP 503' });
  assert.match(parseFeedResponse({ statusCode: 200, body: '{}' }).feedError, /not a JSON array/);
});

test('dry run reports the exact payload with a DRY RUN prefix and never posts', () => {
  const data = {};
  const state = stateFor(data, true);
  const out = decide({ request: { mode: 'approve', id: 'today-live' }, config: config({ dryRun: true }), feed: FEED, state, now: NOW });
  assert.deepEqual(out.map((o) => o.action), ['dryrun', 'notify'], 'one payload, plus the note that the other networks were skipped');
  assert.match(out[0].text, /^DRY RUN: would POST https:\/\/api\.linkedin\.com\/v2\/ugcPosts\nX-Restli-Protocol-Version: 2\.0\.0/);
  assert.deepEqual(JSON.parse(out[0].text.slice(out[0].text.indexOf('{'))), buildLinkedInPayload(FEED[1], AUTHOR));
  assert.equal(data.live, undefined);
  const feedDown = decide({ request: { mode: 'run' }, config: config({ dryRun: true }), feed: null, feedError: 'HTTP 503', state, now: NOW });
  assert.match(feedDown[0].text, /^DRY RUN: Could not read the social feed: HTTP 503/);
});

// ---- last-run warning: an article dated today that is still unpublished ----

const UNBUILT = 'today-unbuilt';
const daily = (over = {}) => ({ request: { mode: 'daily' }, config: config(), feed: FEED, state: stateFor({}, false), now: LAST_RUN, ...over });
const warnings = (out) => out.filter((o) => o.action === 'notify');

test('the last daily run warns about an unpublished article dated today, after the offers', () => {
  const out = decide(daily());
  assert.deepEqual(out.map((o) => o.action), ['offer', 'offer', 'notify']);
  assert.deepEqual(ids(out.slice(0, 2)), ['today-live', 'p01']);
  assert.equal(warnings(out).length, 1);
  assert.match(out[2].text, new RegExp(UNBUILT));
  assert.match(out[2].text, /2026-11-03/);
  assert.match(out[2].text, /Deploy to GitHub Pages/);
  assert.match(out[2].text, new RegExp(`/reoffer ${UNBUILT}`));
  assert.deepEqual(Object.keys(out[2]).sort(), ['action', 'chatId', 'text'], 'a plain notify: no buttons');
});

test('the warning offers nothing, marks nothing offered and records nothing', () => {
  const feed = [FEED[2]];
  const state = stateFor({}, false);
  const out = decide(daily({ feed, state }));
  assert.deepEqual(out.map((o) => o.action), ['notify']);
  assert.deepEqual(state.offered, {});
  assert.deepEqual(state.record, []);
});

test('a run before the daily run (05:00 Vienna) does not warn', () => {
  const out = decide(daily({ now: NOW }));
  assert.deepEqual(out.map((o) => o.action), ['offer', 'offer']);
});

test('a late last run still warns (hour >= the last hour, not ===)', () => {
  const out = decide(daily({ now: new Date('2026-11-03T10:30:00Z') }));
  assert.equal(warnings(out).length, 1);
});

test('the hour is Vienna wall-clock time across daylight saving', () => {
  assert.equal(hourIn('Europe/Vienna', new Date('2026-07-01T07:00:00Z')), 9);
  assert.equal(hourIn('Europe/Vienna', new Date('2026-07-01T05:00:00Z')), 7);
  assert.equal(hourIn('Europe/Vienna', new Date('2026-11-03T06:00:00Z')), 7);
  assert.equal(hourIn('Europe/Vienna', new Date('2026-06-30T22:00:00Z')), 0, 'midnight is 0, never 24');
  const summer = { config: config({ today: '2026-07-01' }), feed: [{ kind: 'article', id: 'summer', date: '2026-07-01', published: false }] };
  assert.equal(warnings(decide(daily({ ...summer, now: new Date('2026-07-01T07:00:00Z') }))).length, 1);
  assert.equal(warnings(decide(daily({ ...summer, now: new Date('2026-07-01T03:00:00Z') }))).length, 0);
});

test('two unpublished articles dated today give two warnings, one per id, in feed order', () => {
  const feed = [
    { kind: 'article', id: 'second-b', date: '2026-11-03', published: false },
    FEED[1],
    { kind: 'article', id: 'first-a', date: '2026-11-03', published: false },
  ];
  const out = decide(daily({ feed }));
  assert.deepEqual(out.map((o) => o.action), ['offer', 'notify', 'notify']);
  assert.match(out[1].text, /second-b/);
  assert.match(out[2].text, /first-a/);
});

test('the warning works on the #111 stub shape without title, url, slug or status', () => {
  const feed = [{ kind: 'article', id: 'stub-today', date: '2026-11-03', published: false }];
  const out = decide(daily({ feed }));
  assert.deepEqual(out.map((o) => o.action), ['notify']);
  assert.match(out[0].text, /stub-today/);
  assert.match(out[0].text, /2026-11-03/);
});

test('only articles dated today warn: not an unapproved standalone post, not another day', () => {
  const standalone = { kind: 'standalone', id: 'p-draft', title: 'x', date: '2026-11-03', published: false, status: 'draft', social: copy('x') };
  const otherDay = { kind: 'article', id: 'tomorrow', date: '2026-11-04', published: false };
  const yesterday = { kind: 'article', id: 'yesterday', date: '2026-11-02', published: false };
  assert.deepEqual(decide(daily({ feed: [standalone, otherDay, yesterday] })), []);
});

test('/run, /reoffer, buttons and help do not warn, even at the last run', () => {
  const feed = [FEED[2]];
  const run = decide(daily({ feed, request: { mode: 'run' } }));
  assert.deepEqual(run.map((o) => o.text), ['Nothing new to offer for 2026-11-03.']);
  const reoffer = decide(daily({ feed, request: { mode: 'reoffer', id: UNBUILT } }));
  assert.deepEqual(reoffer.map((o) => o.action), ['notify']);
  assert.match(reoffer[0].text, /not published/);
  assert.doesNotMatch(reoffer[0].text, /Deploy to GitHub Pages/);
  const skip = decide(daily({ feed: FEED, request: { mode: 'skip', id: 'p01', queryId: 'q' } }));
  assert.ok(!skip.some((o) => /Deploy to GitHub Pages/.test(o.text ?? '')));
  const approve = decide(daily({ feed: FEED, request: { mode: 'approve', id: 'p01', queryId: 'q' } }));
  assert.ok(!approve.some((o) => /Deploy to GitHub Pages/.test(o.text ?? '')));
  const help = decide(daily({ request: { mode: 'help' } }));
  assert.deepEqual(help.map((o) => o.action), ['notify']);
  assert.doesNotMatch(help[0].text, /Deploy to GitHub Pages/);
});

test('a feed read failure at the last run gives only the feed error, no warning', () => {
  const out = decide(daily({ feed: null, feedError: 'HTTP 503' }));
  assert.deepEqual(out.map((o) => o.text), ['Could not read the social feed: HTTP 503']);
});

test('in dry run the warning carries the DRY RUN prefix', () => {
  const out = decide(daily({ config: config({ dryRun: true }) }));
  assert.match(warnings(out)[0].text, /^DRY RUN: /);
});

test('the date comes from config.today and the hour from now', () => {
  // A dry run rehearsing another date: today's feed entry is dated 2026-11-10, the clock says 07:00.
  const feed = [{ kind: 'article', id: 'rehearsal', date: '2026-11-10', published: false }];
  const out = decide(daily({ feed, config: config({ dryRun: true, today: '2026-11-10' }) }));
  assert.match(out[0].text, /rehearsal/);
});

test('the Daily schedule cron rules are daily on the hour, and the last hour matches the constant', () => {
  const rules = node('Daily schedule').parameters.rule.interval.map((r) => r.expression);
  assert.ok(rules.length > 0);
  const hours = rules.map((expression) => {
    const m = /^(\d+) (\d+) \* \* \*$/.exec(expression);
    assert.ok(m, `"${expression}" must be "M H * * *": a different shape needs a conscious change to the last-run rule`);
    assert.equal(Number(m[1]), 0, `"${expression}" must fire on the hour: a non-zero minute makes "hour >= LAST_DAILY_HOUR" fire before the run it identifies`);
    return Number(m[2]);
  });
  assert.equal(Math.max(...hours), LAST_DAILY_HOUR);
});

test('the deploy workflow has exactly one scheduled rebuild, at 04:23 UTC, ahead of the 07:00 Vienna run in both seasons', () => {
  const yml = read('.github/workflows/deploy.yml');
  const block = /^ {2}schedule:\n((?: {4}.*\n|\s*#.*\n)+)/m.exec(yml);
  assert.ok(block, 'deploy.yml has a schedule: block');
  const crons = [...block[1].matchAll(/^\s*- cron:\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(crons, ['23 4 * * *']);
});

// ---- the exported workflow ----

test('workflow is valid n8n JSON with credentials referenced by name only', () => {
  assert.ok(Array.isArray(workflow.nodes) && workflow.connections);
  assert.equal(workflow.settings.timezone, 'Europe/Vienna');
  const schedule = node('Daily schedule').parameters.rule.interval.map((r) => r.expression);
  assert.deepEqual(schedule, ['0 7 * * *']);
  for (const n of [...workflow.nodes, ...errors.nodes]) {
    for (const [type, ref] of Object.entries(n.credentials ?? {})) {
      assert.deepEqual(Object.keys(ref), ['name'], `${n.name} ${type}`);
      assert.ok(['linkedin-member', 'telegram-pearse-dev', 'bluesky-app-password', 'mastodon-token'].includes(ref.name), `${n.name} uses ${ref.name}`);
    }
  }
  for (const [from, c] of Object.entries(workflow.connections)) {
    assert.ok(node(from), from);
    for (const out of c.main) for (const link of out) assert.ok(node(link.node), `${from} -> ${link.node}`);
  }
  assert.equal(node('Answer button').onError, 'continueRegularOutput', 'a stale button must not halt the post');
  assert.equal(node('Fetch social feed').parameters.options.response.response.outputPropertyName, undefined);
  const li = node('Post to LinkedIn').parameters;
  assert.equal(li.url, 'https://api.linkedin.com/v2/ugcPosts');
  assert.deepEqual(li.headerParameters.parameters, [{ name: 'X-Restli-Protocol-Version', value: '2.0.0' }]);
});

test('workflow holds no credential values, chat ids or webhook ids', () => {
  for (const n of [...workflow.nodes, ...errors.nodes]) {
    assert.ok(!('webhookId' in n), `${n.name}: an instance-specific webhookId is committed`);
  }
  for (const [file, text] of [['social-scheduler.json', WORKFLOW_TEXT], ['scheduler-errors.json', ERRORS_TEXT]]) {
    assert.doesNotMatch(text, /bot\d+:/i, `${file}: telegram bot url`);
    assert.doesNotMatch(text, /\d{6,}:[A-Za-z0-9_-]{20,}/, `${file}: telegram bot token`);
    assert.doesNotMatch(text, /\bAQ[A-Za-z0-9_-]{20,}/, `${file}: linkedin token`);
    assert.doesNotMatch(text, /Bearer\s+[A-Za-z0-9]/, `${file}: bearer value`);
    assert.doesNotMatch(text, /"-?\d{5,}"/, `${file}: digits-only string, like a chat id`);
    assert.doesNotMatch(text, /chat_?id\W{1,4}-?\d{5,}/i, `${file}: chat id literal`);
  }
});

test('Fetch social feed retries 3 times, 5 s apart, and the error item still reaches Decide (ADR 0004)', () => {
  const f = node('Fetch social feed');
  assert.equal(f.retryOnFail, true);
  assert.equal(f.maxTries, 3);
  assert.equal(f.waitBetweenTries, 5000);
  assert.equal(f.onError, 'continueRegularOutput', 'after the last try the error item goes on to Decide');
  const response = f.parameters.options.response.response;
  // neverError: true would hide every HTTP error from n8n, so nothing would ever be retried.
  assert.ok(response.neverError === undefined || response.neverError === false, 'neverError must be absent or false');
  assert.equal(f.parameters.options.timeout, 30000);
  assert.deepEqual(workflow.connections['Fetch social feed'].main[0].map((l) => l.node), ['Decide']);
});

test('no other httpRequest node retries: a post is never blindly repeated (ADR 0004)', () => {
  const http = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest' && n.name !== 'Fetch social feed');
  assert.ok(http.length >= 5, 'the post and session nodes are still there');
  for (const n of http) {
    assert.equal(n.retryOnFail, undefined, `${n.name} must not retry`);
    assert.equal(n.maxTries, undefined, `${n.name} must not set maxTries`);
    assert.equal(n.waitBetweenTries, undefined, `${n.name} must not set waitBetweenTries`);
  }
  for (const n of workflow.nodes.filter((x) => x.name !== 'Fetch social feed')) assert.notEqual(n.retryOnFail, true, `${n.name} must not retry`);
});

test('Send offer has no onError, so its failure fails the execution and reaches the error workflow', () => {
  assert.equal(node('Send offer').onError, undefined);
  assert.equal(node('Send offer').continueOnFail, undefined);
});

test('the scheduler export carries no errorWorkflow id: it is instance-specific and chosen at import', () => {
  assert.equal('errorWorkflow' in workflow.settings, false);
  assert.match(node('About').parameters.content, /Error workflow/);
  assert.match(node('About').parameters.content, /pearse\.dev scheduler errors/);
});

test('scheduler-errors.json is Error trigger -> Send alert and nothing else', () => {
  assert.equal(errors.name, 'pearse.dev scheduler errors');
  assert.deepEqual(errors.nodes.map((n) => n.type), ['n8n-nodes-base.errorTrigger', 'n8n-nodes-base.telegram']);
  assert.equal(errors.nodes.length, 2);
  assert.deepEqual(errors.nodes.map((n) => n.name), ['Error trigger', 'Send alert']);
  assert.deepEqual(Object.keys(errors.connections), ['Error trigger']);
  const links = errors.connections['Error trigger'].main;
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].map((l) => l.node), ['Send alert']);
  for (const [from, c] of Object.entries(errors.connections)) {
    assert.ok(errorNode(from), from);
    for (const out of c.main) for (const link of out) assert.ok(errorNode(link.node), `${from} -> ${link.node}`);
  }
  assert.equal('errorWorkflow' in errors.settings, false);
});

test('Send alert: the named credential only, plain text, chat id from $vars then $env', () => {
  const alert = errorNode('Send alert');
  assert.deepEqual(alert.credentials, { telegramApi: { name: 'telegram-pearse-dev' } });
  assert.equal(alert.parameters.additionalFields.appendAttribution, false);
  assert.equal('parse_mode' in alert.parameters.additionalFields, false, 'raw error text must go as plain text');
  assert.doesNotMatch(JSON.stringify(alert.parameters), /parse_?mode/i);
  const chat = alert.parameters.chatId;
  assert.match(chat, /TELEGRAM_CHAT_ID/);
  assert.ok(chat.indexOf('$vars') !== -1 && chat.indexOf('$vars') < chat.indexOf('$env'), '$vars is read before $env');
  assert.doesNotMatch(chat, /\d/, 'no digits literal in the chat id');
});

// Evaluates the Send alert text expression the way n8n would, over one error item.
function alertText(item) {
  const expr = errorNode('Send alert').parameters.text;
  assert.ok(expr.startsWith('={{') && expr.endsWith('}}'));
  return new Function('$json', `return (${expr.slice(3, -2)});`)(item);
}

test('Send alert text names the workflow, last node, error, execution id and url, and the /reoffer hint', () => {
  const text = alertText({
    workflow: { id: 'w1', name: 'pearse.dev social scheduler' },
    execution: { id: '77', url: 'https://n8n.example/workflow/w1/executions/77', lastNodeExecuted: 'Send offer', error: { message: 'Bad Request: chat not found' } },
  });
  assert.match(text, /pearse\.dev social scheduler/);
  assert.match(text, /Last node executed: Send offer/);
  assert.match(text, /Bad Request: chat not found/);
  assert.match(text, /Execution id: 77/);
  assert.match(text, /Execution URL: https:\/\/n8n\.example\/workflow\/w1\/executions\/77/);
  assert.match(text, /If it failed at Send offer, that item is marked offered: check the execution, then \/reoffer <id>\./);
  const expr = errorNode('Send alert').parameters.text;
  for (const word of ['lastNodeExecuted', 'error', 'execution', '.id', '.url', 'slice(0, 500)', '?.']) assert.ok(expr.includes(word), word);
});

test('Send alert text cuts a long error to 500 characters', () => {
  const text = alertText({ workflow: { name: 'w' }, execution: { id: '1', url: 'u', lastNodeExecuted: 'n', error: { message: `${'x'.repeat(2000)}END` } } });
  const err = text.split('\n').find((l) => l.startsWith('Error: '));
  assert.equal(err.length, 'Error: '.length + 500);
  assert.doesNotMatch(text, /END/);
});

test('Send alert still sends when a trigger-level failure delivers trigger instead of execution', () => {
  const text = alertText({ workflow: { name: 'pearse.dev social scheduler' }, trigger: { error: { message: 'Webhook registration failed', node: { name: 'Telegram update' } }, mode: 'trigger' } });
  assert.match(text, /pearse\.dev social scheduler/);
  assert.match(text, /Last node executed: Telegram update/);
  assert.match(text, /Webhook registration failed/);
  assert.match(text, /\/reoffer <id>/);
  assert.doesNotThrow(() => alertText({}));
});

test('scheduler-errors.json names no host or address, and only the allowed literals', () => {
  assert.doesNotMatch(ERRORS_TEXT, /https?:\/\//i, 'no URL');
  assert.doesNotMatch(ERRORS_TEXT, /\b\d{1,3}(\.\d{1,3}){3}\b/, 'no IPv4 address');
  assert.doesNotMatch(ERRORS_TEXT, /Bearer|token/i);
});

test('Code nodes embed select.mjs verbatim', () => {
  const lib = read('automation/n8n/select.mjs').replace(/^export /gm, '');
  for (const name of ['Decide', 'Record result']) {
    assert.ok(node(name).parameters.jsCode.startsWith(lib), `${name} has drifted from select.mjs: re-paste it`);
  }
});

// Runs the Decide and Record result node code with n8n's globals stubbed.
// `now` pins the clock: a zero-argument `new Date()` and `Date.now()` return it; dates built from arguments are untouched.
function runNode(name, { input, upstream = {}, staticData, vars = {}, now = NOW }) {
  const pinned = now.getTime();
  class PinnedDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(pinned);
      else super(...args);
    }
    static now() {
      return pinned;
    }
  }
  const $ = (n) => {
    if (n === 'Decide' && upstream.Decide) return { isExecuted: true, first: () => ({ json: upstream.Decide[0] }), all: () => upstream.Decide.map((json) => ({ json })) };
    if (!(n in upstream)) throw new Error(`Referenced node is unexecuted: ${n}`);
    return { isExecuted: true, first: () => ({ json: upstream[n] }), all: () => [{ json: upstream[n] }] };
  };
  const fn = new Function('$input', '$', '$getWorkflowStaticData', '$vars', '$env', 'Date', node(name).parameters.jsCode);
  const env = new Proxy({}, { get: () => { throw new Error('access to env vars denied'); } });
  return fn({ first: () => ({ json: input }), all: () => [{ json: input }] }, $, () => staticData, vars, env, PinnedDate).map((i) => i.json);
}

test('embedded Decide node: daily offer, Approve in dry run, then a no-op rerun', () => {
  const staticData = {};
  const vars = { TELEGRAM_CHAT_ID: CHAT, LINKEDIN_AUTHOR_URN: AUTHOR, SCHEDULER_TODAY: '2026-11-03' };
  const feedRes = { statusCode: 200, body: JSON.stringify(FEED) };
  const daily = runNode('Decide', { input: feedRes, upstream: { 'Daily schedule': {} }, staticData, vars });
  assert.deepEqual(daily.map((o) => [o.action, o.id]), [['offer', 'today-live'], ['offer', 'p01']]);
  assert.match(daily[0].text, /^DRY RUN: /);
  const tap = { callback_query: { id: 'q1', data: 'approve:p01', message: { chat: { id: 1000 } } } };
  const approved = runNode('Decide', { input: feedRes, upstream: { 'Telegram update': tap }, staticData, vars });
  assert.deepEqual(approved.map((o) => o.action), ['ack', 'dryrun', 'notify']);
  assert.equal(approved[1].payload.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory, 'NONE');
  assert.deepEqual(runNode('Decide', { input: feedRes, upstream: { 'Daily schedule': {} }, staticData, vars }), []);
  assert.equal(staticData.live, undefined);
  const stranger = { callback_query: { id: 'q2', data: 'approve:p01', message: { chat: { id: 2000 } } } };
  assert.deepEqual(runNode('Decide', { input: feedRes, upstream: { 'Telegram update': stranger }, staticData, vars }), []);
  const bad = runNode('Decide', { input: feedRes, upstream: { 'Daily schedule': {} }, staticData, vars: { ...vars, TELEGRAM_USER_ID: 'me' } });
  assert.deepEqual(bad.map((o) => [o.action, o.chatId]), [['notify', CHAT]]);
  assert.match(bad[0].text, /configuration error/);
});

test('embedded Decide node: a feed read error is reported to the chat, never recorded or posted', () => {
  const vars = { TELEGRAM_CHAT_ID: CHAT, LINKEDIN_AUTHOR_URN: AUTHOR, SCHEDULER_TODAY: '2026-11-03' };
  const input = { error: { message: 'ETIMEDOUT' } };
  const staticData = {};
  const daily = runNode('Decide', { input, upstream: { 'Daily schedule': {} }, staticData, vars });
  assert.equal(daily.length, 1);
  assert.equal(daily[0].action, 'notify');
  assert.equal(daily[0].chatId, CHAT);
  assert.match(daily[0].text, /Could not read the social feed: ETIMEDOUT/);
  const tap = { callback_query: { id: 'q1', data: 'approve:p01', message: { chat: { id: 1000 } } } };
  const approved = runNode('Decide', { input, upstream: { 'Telegram update': tap }, staticData, vars });
  assert.deepEqual(approved.map((o) => o.action), ['ack', 'notify']);
  assert.match(approved[1].text, /Could not read the social feed: ETIMEDOUT/);
  assert.ok(!approved.some((o) => ['post', 'dryrun', 'bluesky', 'mastodon'].includes(o.action)), 'nothing is posted');
  assert.deepEqual(staticData, { dryRun: { record: [], offered: {} } }, 'nothing is recorded or marked offered');
});

test('embedded Decide node: the warning appears at 07:00 Vienna and not at 05:00, whatever the real time', () => {
  const vars = { TELEGRAM_CHAT_ID: CHAT, LINKEDIN_AUTHOR_URN: AUTHOR, SCHEDULER_TODAY: '2026-11-03' };
  const feedRes = { statusCode: 200, body: JSON.stringify(FEED) };
  const at = (now) => runNode('Decide', { input: feedRes, upstream: { 'Daily schedule': {} }, staticData: {}, vars, now });
  const last = at(LAST_RUN);
  assert.deepEqual(last.map((o) => o.action), ['offer', 'offer', 'notify']);
  assert.match(last[2].text, /^DRY RUN: .*today-unbuilt.*Deploy to GitHub Pages/s);
  assert.deepEqual(at(NOW).map((o) => o.action), ['offer', 'offer']);
});

test('embedded Decide node: the date and the hour come from one clock reading', () => {
  // Without SCHEDULER_TODAY the date comes from the same pinned instant: 07:00 Vienna on 2026-11-03.
  const vars = { TELEGRAM_CHAT_ID: CHAT, LINKEDIN_AUTHOR_URN: AUTHOR };
  const feedRes = { statusCode: 200, body: JSON.stringify(FEED) };
  const out = runNode('Decide', { input: feedRes, upstream: { 'Daily schedule': {} }, staticData: {}, vars, now: LAST_RUN });
  assert.deepEqual(out.map((o) => o.action), ['offer', 'offer', 'notify']);
  const decideCode = node('Decide').parameters.jsCode;
  const shim = decideCode.slice(decideCode.indexOf('// ---- n8n shim'));
  assert.equal(shim.split('new Date()').length - 1, 1, 'the shim reads the clock once');
  assert.match(shim, /readConfig\(setting, now\)/);
  assert.match(shim, /decide\(\{[^}]*\bnow\b[^}]*\}\)/);
});

test('embedded Record result node records a live post', () => {
  const staticData = {};
  const post = { action: 'post', chatId: CHAT, id: 'p01', payload: {} };
  // Decide wrote the pending row in the same execution
  stateFor(staticData, false).record.push({ id: 'p01', network: 'linkedin', postedAt: NOW.toISOString(), postUrn: null, status: 'pending' });
  const out = runNode('Record result', {
    input: { statusCode: 201, body: { id: 'urn:li:share:7' }, headers: {} },
    upstream: { Decide: [{ action: 'ack', queryId: 'q' }, post] },
    staticData,
    vars: { TELEGRAM_CHAT_ID: CHAT },
  });
  assert.equal(out[0].chatId, CHAT);
  assert.deepEqual(staticData.live.record.map((r) => [r.status, r.postUrn]), [['posted', 'urn:li:share:7']]);
});

// ---- cross-posting branches (issue #23) ----

test('Route action sends each action to its node, Bluesky and Mastodon included', () => {
  const rules = node('Route action').parameters.rules.values;
  const target = Object.fromEntries(rules.map((r, i) => [r.conditions.conditions[0].rightValue, workflow.connections['Route action'].main[i][0].node]));
  assert.deepEqual(target, {
    ack: 'Answer button',
    offer: 'Send offer',
    notify: 'Send message',
    dryrun: 'Log dry-run payload',
    post: 'Post to LinkedIn',
    post_bluesky: 'Bluesky session',
    post_mastodon: 'Post to Mastodon',
  });
  const next = (n) => workflow.connections[n].main[0].map((l) => l.node);
  assert.deepEqual(next('Bluesky session'), ['Post to Bluesky']);
  // deleteSession runs first, so a failure further down cannot leave the session's refresh token live.
  assert.deepEqual(next('Post to Bluesky'), ['End Bluesky session']);
  assert.deepEqual(next('End Bluesky session'), ['Mark Bluesky result']);
  assert.deepEqual(next('Mark Bluesky result'), ['Record result']);
  assert.deepEqual(next('Post to Mastodon'), ['Mark Mastodon result']);
  assert.deepEqual(next('Mark Mastodon result'), ['Record result']);
});

test('Bluesky and Mastodon nodes use the named credentials and never stop the run', () => {
  const session = node('Bluesky session');
  assert.equal(session.parameters.url, 'https://bsky.social/xrpc/com.atproto.server.createSession');
  assert.equal(session.parameters.genericAuthType, 'httpCustomAuth');
  assert.deepEqual(session.credentials, { httpCustomAuth: { name: 'bluesky-app-password' } });
  const post = node('Post to Bluesky').parameters;
  assert.equal(post.url, 'https://bsky.social/xrpc/com.atproto.repo.createRecord');
  assert.equal(node('Post to Bluesky').credentials, undefined, 'authorised by the session token, not a stored credential');
  assert.match(post.headerParameters.parameters[0].value, /accessJwt/);
  assert.match(post.jsonBody, /collection: 'app\.bsky\.feed\.post'.*j\.action === 'post_bluesky'\)\.record/);
  assert.equal(node('End Bluesky session').parameters.url, 'https://bsky.social/xrpc/com.atproto.server.deleteSession');
  const masto = node('Post to Mastodon');
  assert.equal(masto.parameters.url, '={{ $json.url }}', 'the instance comes from MASTODON_INSTANCE_URL, not the export');
  assert.deepEqual(masto.credentials, { httpHeaderAuth: { name: 'mastodon-token' } });
  assert.deepEqual(masto.parameters.headerParameters.parameters, [{ name: 'Idempotency-Key', value: '={{ $json.idempotencyKey }}' }]);
  for (const name of ['Post to LinkedIn', 'Bluesky session', 'Post to Bluesky', 'End Bluesky session', 'Post to Mastodon']) {
    assert.equal(node(name).onError, 'continueRegularOutput', name);
    assert.equal(node(name).parameters.options.response.response.neverError, true, name);
  }
  // A failed reply must not halt the run either (the record is already written by then).
  assert.equal(node('Send message').onError, 'continueRegularOutput');
});

test('workflow names no account: only public API hosts, no DID, no handle', () => {
  const hosts = new Set([...WORKFLOW_TEXT.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()));
  for (const h of hosts) assert.ok(['pearse.dev', 'api.linkedin.com', 'www.linkedin.com', 'bsky.social', 'bsky.app'].includes(h), `unexpected host ${h}`);
  assert.doesNotMatch(WORKFLOW_TEXT, /did:(plc|web):/i, 'DID');
  assert.doesNotMatch(WORKFLOW_TEXT, /[a-z0-9-]+\.bsky\.social/i, 'Bluesky handle');
  assert.doesNotMatch(WORKFLOW_TEXT, /@[a-z0-9_]+@[a-z0-9.-]+/i, 'Mastodon handle');
});

const CROSS_VARS = { BLUESKY_CREDENTIAL: 'bluesky-app-password', MASTODON_CREDENTIAL: 'mastodon-token', MASTODON_INSTANCE_URL: 'https://social.example' };

test('embedded Decide node: with both credentials named, Approve in dry run gives three payloads', () => {
  const vars = { TELEGRAM_CHAT_ID: CHAT, LINKEDIN_AUTHOR_URN: AUTHOR, SCHEDULER_TODAY: '2026-11-03', ...CROSS_VARS };
  const feedRes = { statusCode: 200, body: JSON.stringify(FEED) };
  const tap = { callback_query: { id: 'q1', data: 'approve:today-live', message: { chat: { id: 1000 } } } };
  const out = runNode('Decide', { input: feedRes, upstream: { 'Telegram update': tap }, staticData: {}, vars });
  assert.deepEqual(out.map((o) => [o.action, o.network]), [['ack', undefined], ['dryrun', 'linkedin'], ['dryrun', 'bluesky'], ['dryrun', 'mastodon']]);
  assert.equal(out[2].payload.record.facets[0].features[0].uri, 'https://pearse.dev/writing/today-live/');
});

test('embedded Record result node records Bluesky and Mastodon through the Mark nodes', () => {
  const staticData = {};
  const state = stateFor(staticData, false);
  for (const network of ['bluesky', 'mastodon']) state.record.push({ id: 'p01', network, postedAt: NOW.toISOString(), uri: null, status: 'pending' });
  const decided = [
    { action: 'post_bluesky', network: 'bluesky', chatId: CHAT, id: 'p01', record: {} },
    { action: 'post_mastodon', network: 'mastodon', chatId: CHAT, id: 'p01', url: 'https://social.example/api/v1/statuses', payload: {} },
  ];
  const vars = { TELEGRAM_CHAT_ID: CHAT };
  const tagged = (name, res) => runNode(name, { input: res, staticData, vars })[0];
  // Mark Bluesky result reads Post to Bluesky, not its input (the deleteSession response).
  const created = { statusCode: 200, body: { uri: 'at://did:example:x/app.bsky.feed.post/1' }, headers: {} };
  const bsky = runNode('Mark Bluesky result', { input: { statusCode: 200, body: '' }, upstream: { 'Post to Bluesky': created }, staticData, vars })[0];
  assert.equal(bsky.body.uri, created.body.uri);
  assert.equal(bsky.network, 'bluesky');
  const session = { statusCode: 200, body: {} };
  const b = runNode('Record result', { input: bsky, upstream: { Decide: decided, 'Bluesky session': session }, staticData, vars });
  assert.match(b[0].text, /^Posted p01 to Bluesky/);
  const masto = tagged('Mark Mastodon result', { statusCode: 504, body: 'timeout' });
  const m = runNode('Record result', { input: masto, upstream: { Decide: decided }, staticData, vars });
  assert.match(m[0].text, /Mastodon gave no clear answer/);
  assert.deepEqual(staticData.live.record.map((r) => [r.network, r.status]), [['bluesky', 'posted'], ['mastodon', 'unknown']]);
});

test('embedded Record result node: no Bluesky session output counts as a failed login', () => {
  const staticData = {};
  stateFor(staticData, false).record.push({ id: 'p01', network: 'bluesky', postedAt: NOW.toISOString(), uri: null, status: 'pending' });
  const out = runNode('Record result', {
    input: { statusCode: 401, body: {}, network: 'bluesky' },
    upstream: { Decide: [{ action: 'post_bluesky', network: 'bluesky', chatId: CHAT, id: 'p01', record: {} }] },
    staticData,
    vars: { TELEGRAM_CHAT_ID: CHAT },
  });
  assert.match(out[0].text, /Bluesky login failed for p01 \(no response\)/);
  assert.deepEqual(staticData.live.record, []);
});

// ---- automation/setup/credentials.sh: n8n base URL check, key accessor, step 7 (#145) ----
// The script is sourced (or run with --step 7 / --dry-run) in bash. No network, no curl, no browser.

// Case studies (#167). The fixture stays local to these tests: FEED is indexed by position above.
const CASE_URL = 'https://pearse.dev/work/example-build/';
const caseStudy = (over = {}) => ({
  kind: 'project', id: 'example-build', title: 'Example build', date: '2026-11-03', category: 'client',
  url: CASE_URL, published: true, status: 'approved', social: copy('case'), ...over,
});
const withCase = (over) => [...FEED, caseStudy(over)];

test('a case study is offered on its date and not the day before', () => {
  const feed = withCase();
  assert.ok(isEligible(caseStudy()));
  assert.deepEqual(ids(selectForDay(feed, '2026-11-03', [])), ['today-live', 'p01', 'example-build']);
  assert.ok(!ids(selectForDay(feed, '2026-11-02', [])).includes('example-build'));
  assert.ok(ids(selectToOffer(feed, '2026-11-03', stateFor({}, false))).includes('example-build'));
  assert.deepEqual(findForPosting(feed, 'example-build', '2026-11-03', []).entry.id, 'example-build');
});

test('case study payload is an ARTICLE share with the case study URL and title', () => {
  assert.deepEqual(buildLinkedInPayload(caseStudy(), AUTHOR), {
    author: AUTHOR,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: 'case long' },
        shareMediaCategory: 'ARTICLE',
        media: [{ status: 'READY', originalUrl: CASE_URL, title: { text: 'Example build' } }],
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  });
});

test('a case study links its page on Bluesky (facet over the URL) and Mastodon (URL at the end)', () => {
  const record = buildBlueskyRecord(caseStudy(), NOW);
  assert.equal(record.text, `case short\n\n${CASE_URL}`);
  assert.equal(record.facets.length, 1);
  const { byteStart, byteEnd } = record.facets[0].index;
  assert.equal(Buffer.from(record.text).subarray(byteStart, byteEnd).toString(), CASE_URL);
  assert.equal(record.facets[0].features[0].uri, CASE_URL);
  assert.ok(buildMastodonStatus(caseStudy()).status.endsWith(`\n\n${CASE_URL}`));
});

// Standalone deep links (#285): the feed gives an approved standalone post the `url` already in its short.
const DEEP_URL = 'https://pearse.dev/work/example-build/';
const linked = (short, over = {}) => ({ ...FEED[3], url: DEEP_URL, social: { linkedin: 'p01 long', short }, ...over });
const facetText = (record, f) => Buffer.from(record.text).subarray(f.index.byteStart, f.index.byteEnd).toString();

test('a standalone post with a url gets one Bluesky link facet over it, a full stop after it included', () => {
  for (const short of [`Lesson ü ${DEEP_URL}`, `Lesson ü ${DEEP_URL}.`]) {
    const record = buildBlueskyRecord(linked(short), NOW);
    assert.equal(record.text, short, 'posted as written');
    assert.equal(record.facets.length, 1, short);
    assert.equal(record.facets[0].features[0].$type, 'app.bsky.richtext.facet#link');
    assert.equal(record.facets[0].features[0].uri, DEEP_URL);
    assert.equal(facetText(record, record.facets[0]), DEEP_URL, short);
    assert.equal(buildMastodonStatus(linked(short)).status, short, 'Mastodon text unchanged');
  }
});

test('a standalone post from an older feed (no url) stays text only on Bluesky', () => {
  const record = buildBlueskyRecord(FEED[3], NOW);
  assert.equal(record.text, 'p01 short');
  assert.equal(record.facets, undefined);
});

test('a standalone post with a url is still a text-only LinkedIn share', () => {
  const share = buildLinkedInPayload(linked(`Lesson ${DEEP_URL}`), AUTHOR).specificContent['com.linkedin.ugc.ShareContent'];
  assert.deepEqual(share, { shareCommentary: { text: 'p01 long' }, shareMediaCategory: 'NONE' });
});

test('a case study that is not live is refused as not published, never as not approved', () => {
  for (const over of [{ published: false }, { url: '' }, { status: 'draft' }]) {
    const feed = withCase(over);
    assert.ok(!ids(selectForDay(feed, '2026-11-03', [])).includes('example-build'), JSON.stringify(over));
    const { error } = findForPosting(feed, 'example-build', '2026-11-03', []);
    assert.equal(error, 'example-build is not published yet; it cannot be linked.');
  }
  assert.throws(() => buildLinkedInPayload(caseStudy({ published: false }), AUTHOR), /not published/);
  assert.throws(() => buildBlueskyRecord(caseStudy({ url: '' }), NOW), /not published/);
});

test('an unknown kind is never eligible, cannot be built, and does not stop the rest of the day', () => {
  const poll = { kind: 'poll', id: 'poll-1', title: 'Poll', date: '2026-11-03', url: 'https://pearse.dev/x/', published: true, status: 'approved', social: copy('poll') };
  const feed = [...FEED, poll];
  assert.equal(isEligible(poll), false);
  assert.throws(() => buildLinkedInPayload(poll, AUTHOR), /^Error: poll-1 has unknown kind poll\.$/);
  assert.throws(() => buildBlueskyRecord(poll, NOW), /unknown kind/);
  assert.throws(() => buildMastodonStatus(poll), /unknown kind/);
  assert.deepEqual(ids(selectForDay(feed, '2026-11-03', [])), ['today-live', 'p01']);
  assert.equal(findForPosting(feed, 'poll-1', '2026-11-03', []).error, 'poll-1 has unknown kind poll.');
  const out = decide({ request: { mode: 'daily' }, config: config(), feed, state: stateFor({}, false), now: NOW });
  assert.deepEqual(out.map((o) => [o.action, o.id]), [['offer', 'today-live'], ['offer', 'p01']]);
});

test('embedded Decide node: a case study is offered on its date in dry run, and Approve gives the ARTICLE payload', () => {
  const staticData = {};
  const vars = { TELEGRAM_CHAT_ID: CHAT, LINKEDIN_AUTHOR_URN: AUTHOR, SCHEDULER_TODAY: '2026-11-03' };
  const feedRes = { statusCode: 200, body: JSON.stringify(withCase()) };
  const daily = runNode('Decide', { input: feedRes, upstream: { 'Daily schedule': {} }, staticData, vars });
  assert.deepEqual(daily.map((o) => [o.action, o.id]), [['offer', 'today-live'], ['offer', 'p01'], ['offer', 'example-build']]);
  assert.match(daily[2].text, /^DRY RUN: Approve this post for 2026-11-03\?\nCase study example-build: Example build\n/);
  assert.ok(hasUrl(daily[2].text, CASE_URL), 'the offer links the case study');
  const tap = { callback_query: { id: 'q1', data: 'approve:example-build', message: { chat: { id: 1000 } } } };
  const approved = runNode('Decide', { input: feedRes, upstream: { 'Telegram update': tap }, staticData, vars });
  assert.deepEqual(approved.map((o) => o.action), ['ack', 'dryrun', 'notify']);
  const share = approved[1].payload.specificContent['com.linkedin.ugc.ShareContent'];
  assert.equal(share.shareMediaCategory, 'ARTICLE');
  assert.deepEqual(share.media, [{ status: 'READY', originalUrl: CASE_URL, title: { text: 'Example build' } }]);
  assert.equal(staticData.live, undefined);
  const dayBefore = runNode('Decide', { input: feedRes, upstream: { 'Daily schedule': {} }, staticData: {}, vars: { ...vars, SCHEDULER_TODAY: '2026-11-02' } });
  assert.ok(!dayBefore.some((o) => o.id === 'example-build'));
});

const WIZARD = fileURLToPath(new URL('../automation/setup/credentials.sh', import.meta.url));
const WIZARD_TEXT = read('automation/setup/credentials.sh');
const tmpDirs = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'wizard-'));
  tmpDirs.push(d);
  return d;
};
test.after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

// Writes state.env under a fresh XDG_STATE_HOME (ENV_FILE is derived from it) and returns both paths.
function wizardState(lines) {
  const xdg = tmp();
  const dir = join(xdg, 'pearse-dev-wizard');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'state.env');
  if (lines) writeFileSync(file, lines.map((l) => `${l}\n`).join(''), { mode: 0o600 });
  return { xdg, dir, file };
}
const bash = (args, xdg, input = '') =>
  spawnSync('bash', args, {
    cwd: xdg, // outside any git repository, which the wizard refuses
    env: { PATH: process.env.PATH, HOME: xdg, XDG_STATE_HOME: xdg },
    input,
    encoding: 'utf8',
  });
// Runs a snippet after sourcing the wizard; `set +e` so a failing function is reported, not fatal.
const sourced = (body, xdg, extraEnv = {}) =>
  spawnSync('bash', ['-c', `source "$WIZARD"; set +e; ${body}`], {
    cwd: xdg,
    env: { PATH: process.env.PATH, HOME: xdg, XDG_STATE_HOME: xdg, WIZARD, ...extraEnv },
    encoding: 'utf8',
  });

const URL_ACCEPTED = [
  'https://n8n.example.org',
  'https://n8n.example.org:8443/',
  'HTTPS://N8N.EXAMPLE.ORG',
  'http://localhost:5678',
  'http://localhost/',
  'http://127.0.0.1:5678',
  'http://[::1]:5678',
];
const URL_REJECTED = [
  'http://n8n.example.org',
  'http://localhost@evil.tld',
  'http://localhost:5678@evil.tld',
  'https://user@n8n.example.org',
  'http://127.0.0.1.evil.tld',
  'http://localhost.evil.tld',
  'http://localhost:abc',
  'ftp://n8n.example.org',
  'n8n.example.org',
  '',
];

test('credentials.sh accepts https, and http only on localhost, and rejects the rest', () => {
  const { xdg } = wizardState();
  const run = spawnSync('bash', ['-c', `source "$WIZARD"; set +e; for u in "$@"; do if n8n_url_ok "$u"; then echo "yes [$u]"; else echo "no [$u]"; fi; done`, '_', ...URL_ACCEPTED, ...URL_REJECTED], {
    cwd: xdg,
    env: { PATH: process.env.PATH, HOME: xdg, XDG_STATE_HOME: xdg, WIZARD },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    run.stdout.trim().split('\n'),
    [...URL_ACCEPTED.map((u) => `yes [${u}]`), ...URL_REJECTED.map((u) => `no [${u}]`)],
  );
});

test('sourcing credentials.sh runs nothing: the wizard starts only when executed', () => {
  const { xdg } = wizardState();
  const r = sourced('echo sourced-ok', xdg);
  assert.equal(r.stdout.trim(), 'sourced-ok');
  assert.match(WIZARD_TEXT, /^if \[\[ "\$\{BASH_SOURCE\[0\]\}" == "\$0" \]\]; then run_wizard "\$@"; exit; fi$/m);
});

// n8n_create, n8n_delete and n8n_replace with http_req stubbed to record calls.
function callN8n(baseUrl) {
  const { xdg, file } = wizardState([`N8N_BASE_URL='${baseUrl}'`, "N8N_API_KEY='dummy-key'"]);
  const log = join(xdg, 'calls.log');
  const stub = `http_req() { printf '%s %s\\n' "$1" "$2" >> "$LOG"; HTTP_STATUS=200; HTTP_BODY='{"id":"cred-1"}'; }`;
  const body = `${stub}
    d='{"accessToken":"x"}'
    (n8n_create name telegramApi d >/dev/null 2>&1); echo "create=$?"
    (n8n_delete cred-9 >/dev/null 2>&1); echo "delete=$?"
    (n8n_replace name telegramApi d N8N_SOME_ID >/dev/null 2>&1); echo "replace=$?"`;
  const r = sourced(body, xdg, { LOG: log });
  const rc = Object.fromEntries(r.stdout.trim().split('\n').map((l) => l.split('=')));
  return { rc, calls: existsSync(log) ? readFileSync(log, 'utf8') : '', file };
}

test('n8n_create, n8n_delete and n8n_replace refuse a stored non-local http URL and never call the API', () => {
  const bad = callN8n('http://n8n.example.org');
  assert.deepEqual(bad.rc, { create: '1', delete: '1', replace: '1' });
  assert.equal(bad.calls, '', 'the API key must not be sent to an invalid URL');
});

test('the same stubbed calls with a stored https URL do reach the API (proves the stub is wired)', () => {
  const good = callN8n('https://n8n.example.org');
  assert.deepEqual(good.rc, { create: '0', delete: '0', replace: '0' });
  const lines = good.calls.trim().split('\n');
  assert.ok(lines.includes('POST https://n8n.example.org/api/v1/credentials'), good.calls);
  assert.ok(lines.includes('DELETE https://n8n.example.org/api/v1/credentials/cred-9'), good.calls);
  assert.equal(lines.length, 3, good.calls); // create, delete, and replace's create
});

test('renew_token reads the base URL through the accessor and falls back to a by-hand update', () => {
  const read = (u) => {
    const { xdg } = wizardState([`N8N_BASE_URL='${u}'`, "N8N_API_KEY='dummy-key'", "N8N_LINKEDIN_CRED_ID='7'", "LINKEDIN_ACCESS_TOKEN='tok'"]);
    const log = join(xdg, 'calls.log');
    const body = `step_2() { :; }
      http_req() { printf '%s %s\\n' "$1" "$2" >> "$LOG"; HTTP_STATUS=200; HTTP_BODY='{"id":"8"}'; }
      renew_token`;
    const r = sourced(body, xdg, { LOG: log });
    return { out: r.stdout + r.stderr, calls: existsSync(log) ? readFileSync(log, 'utf8') : '' };
  };
  const bad = read('http://n8n.example.org');
  assert.equal(bad.calls, '');
  assert.match(bad.out, /update 'linkedin-member' in n8n by hand/);
  assert.match(bad.out, /re-run --step 4/);
  const good = read('https://n8n.example.org');
  assert.match(good.calls, /^DELETE https:\/\/n8n\.example\.org\/api\/v1\/credentials\/7$/m);
  assert.match(good.calls, /^POST https:\/\/n8n\.example\.org\/api\/v1\/credentials$/m);
});

test('no call site reads N8N_BASE_URL from the state file except the accessor', () => {
  const reads = WIZARD_TEXT.split('\n').filter((l) => l.includes('state_get N8N_BASE_URL'));
  assert.equal(reads.length, 1, reads.join('\n'));
  const accessor = WIZARD_TEXT.slice(WIZARD_TEXT.indexOf('n8n_base() {'));
  assert.ok(accessor.slice(0, accessor.indexOf('\n}\n')).includes('state_get N8N_BASE_URL'), 'the one read is inside n8n_base');
  for (const fn of ['n8n_delete', 'n8n_create', 'n8n_replace', 'renew_token']) {
    const start = WIZARD_TEXT.indexOf(`\n${fn}() {`);
    assert.ok(start > 0, fn);
    const body = WIZARD_TEXT.slice(start, WIZARD_TEXT.indexOf('\n}\n', start));
    assert.match(body, /\bn8n_base\b/, `${fn} must use the accessor`);
  }
});

test('step 7 offers to delete the stored n8n API key: Enter or EOF keeps it, y clears it', () => {
  const keyLine = (f) => readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('N8N_API_KEY='));
  // The banner's "Ready to start?" pause reads the first line of stdin, so the answer to the
  // prompt is the second line.
  for (const input of ['', '\n', '\n\n', '\nn\n']) {
    const { xdg, file } = wizardState(["N8N_API_KEY='dummy-key'"]);
    const r = bash([WIZARD, '--step', '7'], xdg, input);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Delete N8N_API_KEY from the state file\?/);
    assert.equal(keyLine(file), "N8N_API_KEY='dummy-key'", `input ${JSON.stringify(input)} must keep the key`);
  }
  const { xdg, file } = wizardState(["N8N_API_KEY='dummy-key'"]);
  const r = bash([WIZARD, '--step', '7'], xdg, '\ny\n');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(keyLine(file), "N8N_API_KEY=''");
  assert.ok(!readFileSync(file, 'utf8').includes('dummy-key'));
  assert.match(r.stdout, /renew-token/);
  assert.match(r.stdout, /steps 4-6/);
  assert.match(r.stdout, /revoke it in n8n/);
});

test('step 7 does not ask when no n8n API key is stored, or when the stored key is already empty', () => {
  for (const lines of [["TELEGRAM_CHAT_ID='1'"], ["N8N_API_KEY=''"]]) {
    const { xdg } = wizardState(lines);
    const r = bash([WIZARD, '--step', '7'], xdg, '\ny\n');
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /Delete N8N_API_KEY/);
  }
});

test('--dry-run never prompts, exits 0, leaves the state dir alone and shows the new dry text', () => {
  const never = join(tmp(), 'not-created');
  const full = bash([WIZARD, '--dry-run'], tmp(), '');
  const absent = spawnSync('bash', [WIZARD, '--dry-run'], {
    cwd: tmp(),
    env: { PATH: process.env.PATH, HOME: tmp(), XDG_STATE_HOME: never },
    input: '',
    encoding: 'utf8',
  });
  for (const r of [full, absent]) {
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /Delete N8N_API_KEY/);
    assert.ok(r.stdout.includes('http:// only for localhost'), r.stdout);
    assert.ok(r.stdout.includes('offer to delete N8N_API_KEY'), r.stdout);
  }
  assert.ok(!existsSync(never), 'a dry run must not create the state dir');

  const { xdg, dir, file } = wizardState(["N8N_API_KEY='dummy-key'"]);
  const before = { names: readdirSync(dir), text: readFileSync(file, 'utf8') };
  const r = bash([WIZARD, '--dry-run', '--step', '7'], xdg, '\ny\n');
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /Delete N8N_API_KEY/);
  assert.ok(r.stdout.includes('offer to delete N8N_API_KEY'), r.stdout);
  assert.deepEqual({ names: readdirSync(dir), text: readFileSync(file, 'utf8') }, before);
});

test('the Delete N8N_API_KEY prompt exists once, in step_7 after its dry-run return, so steps 1-6 never show it', () => {
  assert.equal(WIZARD_TEXT.split('Delete N8N_API_KEY').length - 1, 1);
  const start = WIZARD_TEXT.indexOf('\nstep_7() {');
  const end = WIZARD_TEXT.indexOf('\n}\n', start);
  assert.ok(start > 0 && end > start);
  const body = WIZARD_TEXT.slice(start, end);
  const prompt = body.indexOf('Delete N8N_API_KEY');
  assert.ok(prompt > 0, 'the prompt is inside step_7');
  assert.ok(prompt > body.indexOf('then return; fi'), 'the prompt comes after the dry-run early return');
  assert.match(body, /state_get N8N_API_KEY\)" \]\] && confirm /, 'only asked when a key is stored, through confirm()');
});

// ── LinkedIn token expiry (#147): published by the wizard, warned about by the daily run ──────────
// Synthetic dates only, and every case passes a fixed `now` (NOW: 2026-11-03, 05:00 Vienna).

const RENEW = 'Run `credentials.sh renew-token`, then re-select linkedin-member in Post to LinkedIn.';
const EXPIRED = (date) => `LinkedIn token expired on ${date}. Approve will fail with HTTP 401 until you run \`credentials.sh renew-token\`, then re-select linkedin-member in Post to LinkedIn.`;
const MALFORMED = (v) => `LINKEDIN_TOKEN_EXPIRES_AT is not an ISO date or epoch seconds: ${v}`;
const expiryConfig = (value, over = {}) =>
  readConfig((k) => ({ TELEGRAM_CHAT_ID: CHAT, LINKEDIN_AUTHOR_URN: AUTHOR, DRY_RUN: 'false', LINKEDIN_TOKEN_EXPIRES_AT: value, ...over })[k], NOW);
const expiryRun = (value, mode = 'daily', over = {}) =>
  decide({ request: { mode }, config: expiryConfig(value), feed: FEED, state: stateFor({}, false), now: NOW, ...over });
const notices = (out) => out.filter((o) => o.action === 'notify' && /LinkedIn token|LINKEDIN_TOKEN_EXPIRES_AT/.test(o.text));

test('LINKEDIN_TOKEN_EXPIRES_AT: ISO with Z or an offset, and epoch seconds, parse; blank is no expiry', () => {
  const at = (v) => expiryConfig(v).tokenExpiresAt?.toISOString() ?? null;
  assert.equal(at('2026-11-20T10:00:00Z'), '2026-11-20T10:00:00.000Z');
  assert.equal(at('2026-11-20T10:00:00+01:00'), '2026-11-20T09:00:00.000Z');
  assert.equal(at('1800000000'), '2027-01-15T08:00:00.000Z');
  assert.equal(at(' 1800000000 '), '2027-01-15T08:00:00.000Z');
  for (const blank of [undefined, '', '   ']) {
    const c = expiryConfig(blank);
    assert.equal(c.tokenExpiresAt, null);
    assert.equal(c.expiryNotice, null, 'unset is harmless: the consumer ships before any wizard run');
  }
  assert.equal(expiryConfig('2026-11-20T10:00:00Z').expiryNotice, null, 'far off: no notice');
});

test('LINKEDIN_TOKEN_EXPIRES_AT: 13-digit milliseconds, free text and a bare date are malformed, never thrown', () => {
  const long = 'x'.repeat(60);
  for (const [value, shown] of [
    ['1800000000000', '1800000000000'],
    ['next tuesday', 'next tuesday'],
    ['2026-11-20', '2026-11-20'],
    [long, 'x'.repeat(40)],
  ]) {
    let c;
    assert.doesNotThrow(() => { c = expiryConfig(value); });
    assert.equal(c.tokenExpiresAt, null, value);
    assert.equal(c.expiryNotice, MALFORMED(shown));
  }
  const out = expiryRun('next tuesday');
  assert.deepEqual(notices(out).map((o) => o.text), [MALFORMED('next tuesday')]);
  assert.deepEqual(out.filter((o) => o.action === 'offer').map((o) => o.id), ['today-live', 'p01'], 'a malformed value never blocks the run');
});

test('daily: no notice at 11 days; one exact notice at 10, 1, 0 and -1 days, before the offers', () => {
  assert.deepEqual(notices(expiryRun('2026-11-14T10:00:00Z')), []);
  for (const [value, text] of [
    ['2026-11-13T10:00:00Z', `LinkedIn token expires in 10 days (2026-11-13). ${RENEW}`],
    ['2026-11-04T10:00:00Z', `LinkedIn token expires tomorrow (2026-11-04). ${RENEW}`],
    ['2026-11-03T20:00:00Z', `LinkedIn token expires today (2026-11-03). ${RENEW}`],
    ['2026-11-02T10:00:00Z', EXPIRED('2026-11-02')],
  ]) {
    const out = expiryRun(value);
    assert.deepEqual(out.filter((o) => o.action === 'notify').map((o) => o.text), [text], value);
    assert.equal(out[0].action, 'notify');
    assert.equal(out[0].chatId, CHAT);
    assert.deepEqual(out.slice(1).map((o) => o.action), ['offer', 'offer']);
  }
});

test('the day count is calendar dates in Vienna: near midnight and across DST', () => {
  // 23:30 UTC on 3 November is 00:30 on 4 November in Vienna: tomorrow, although under an hour away.
  assert.equal(expiryConfig('2026-11-03T23:30:00Z').expiryNotice, `LinkedIn token expires tomorrow (2026-11-04). ${RENEW}`);
  // Clocks go forward on 28 March 2027: 27 to 29 March is two dates, not 47 hours rounded down.
  const dst = readConfig((k) => ({ TELEGRAM_CHAT_ID: CHAT, SCHEDULER_TODAY: '2027-03-27', LINKEDIN_TOKEN_EXPIRES_AT: '2027-03-29T05:00:00+02:00' })[k], NOW);
  assert.equal(dst.expiryNotice, `LinkedIn token expires in 2 days (2027-03-29). ${RENEW}`);
  // SCHEDULER_TODAY moves the count in a dry run.
  const moved = readConfig((k) => ({ TELEGRAM_CHAT_ID: CHAT, SCHEDULER_TODAY: '2026-11-12', LINKEDIN_TOKEN_EXPIRES_AT: '2026-11-14T10:00:00Z' })[k], NOW);
  assert.equal(moved.expiryNotice, `LinkedIn token expires in 2 days (2026-11-14). ${RENEW}`, 'the DRY RUN prefix is added when sent, not stored');
});

test('daily with a feed error at 5 days: the expiry notice, then the feed error', () => {
  const out = expiryRun('2026-11-08T10:00:00Z', 'daily', { feed: null, feedError: 'HTTP 503' });
  assert.deepEqual(out.map((o) => [o.action, o.text]), [
    ['notify', `LinkedIn token expires in 5 days (2026-11-08). ${RENEW}`],
    ['notify', 'Could not read the social feed: HTTP 503'],
  ]);
});

test('a day with nothing to offer still carries the notice: daily alone, /run before "Nothing new"', () => {
  const notice = `LinkedIn token expires in 5 days (2026-11-08). ${RENEW}`;
  assert.deepEqual(expiryRun('2026-11-08T10:00:00Z', 'daily', { feed: [] }).map((o) => o.text), [notice]);
  assert.deepEqual(expiryRun('2026-11-08T10:00:00Z', 'run', { feed: [] }).map((o) => o.text), [notice, 'Nothing new to offer for 2026-11-03.']);
});

test('in a dry run the notice starts with DRY RUN: ', () => {
  const c = expiryConfig('2026-11-08T10:00:00Z', { DRY_RUN: 'true' });
  const out = decide({ request: { mode: 'daily' }, config: c, feed: [], state: stateFor({}, true), now: NOW });
  assert.deepEqual(out.map((o) => o.text), [`DRY RUN: LinkedIn token expires in 5 days (2026-11-08). ${RENEW}`]);
});

test('reoffer, approve, skip and help never carry the notice', () => {
  const c = expiryConfig('2026-11-08T10:00:00Z');
  for (const request of [{ mode: 'reoffer', id: 'p01' }, { mode: 'approve', id: 'p01', queryId: 'q' }, { mode: 'skip', id: 'p01', queryId: 'q' }, { mode: 'help' }]) {
    const out = decide({ request, config: c, feed: FEED, state: stateFor({}, false), now: NOW });
    assert.ok(out.length > 0, request.mode);
    assert.deepEqual(notices(out), [], request.mode);
  }
});

test('a LinkedIn 401 names the fix; the record is the same as for any 4xx', () => {
  const kept = { id: 'old-live', network: 'linkedin', postedAt: NOW.toISOString(), postUrn: 'urn:li:share:1', status: 'posted' };
  const state = stateFor({}, false);
  state.record.push(kept);
  decide({ request: { mode: 'approve', id: 'p01' }, config: config(), feed: FEED, state, now: NOW });
  const res = recordPostResult({ state, id: 'p01', chatId: CHAT, response: { statusCode: 401, body: '{"message":"Expired token"}' }, now: NOW });
  assert.equal(
    res.text,
    'LinkedIn refused p01 with HTTP 401: the member token has expired or been revoked. Run `credentials.sh renew-token`, re-select linkedin-member in Post to LinkedIn, then tap Approve again. Nothing was posted or recorded.\n{"message":"Expired token"}',
  );
  assert.deepEqual(state.record, [kept], 'the pending row is dropped and nothing is recorded');
  assert.equal(decide({ request: { mode: 'approve', id: 'p01' }, config: config(), feed: FEED, state, now: NOW })[0].action, 'post', 'a fresh Approve is still required (ADR 0004)');
});

test('a LinkedIn 403 and a Bluesky 401 keep the generic refused text', () => {
  const state = stateFor({}, false);
  decide({ request: { mode: 'approve', id: 'p01' }, config: config(), feed: FEED, state, now: NOW });
  const li = recordPostResult({ state, id: 'p01', chatId: CHAT, response: { statusCode: 403, body: '{}' }, now: NOW });
  assert.match(li.text, /^LinkedIn refused p01 with HTTP 403; nothing was posted or recorded\. Fix the cause, then tap Approve again\.\n/);
  state.record.push({ id: 'p01', network: 'bluesky', postedAt: NOW.toISOString(), uri: null, status: 'pending' });
  const bsky = recordPostResult({ state, id: 'p01', chatId: CHAT, network: 'bluesky', session: { statusCode: 200 }, response: { statusCode: 401, body: '{}' }, now: NOW });
  assert.match(bsky.text, /^Bluesky refused p01 with HTTP 401; nothing was posted or recorded\. Fix the cause, then tap Approve again\.\n/);
  for (const r of [li, bsky]) assert.doesNotMatch(r.text, /renew-token/);
});

test('embedded Decide node: LINKEDIN_TOKEN_EXPIRES_AT 3 days after SCHEDULER_TODAY gives the notice', () => {
  const vars = { TELEGRAM_CHAT_ID: CHAT, LINKEDIN_AUTHOR_URN: AUTHOR, SCHEDULER_TODAY: '2026-11-03', LINKEDIN_TOKEN_EXPIRES_AT: '2026-11-06T09:00:00Z' };
  const feedRes = { statusCode: 200, body: JSON.stringify(FEED) };
  const out = runNode('Decide', { input: feedRes, upstream: { 'Daily schedule': {} }, staticData: {}, vars });
  assert.deepEqual(out.map((o) => o.action), ['notify', 'offer', 'offer']);
  assert.equal(out[0].text, `DRY RUN: LinkedIn token expires in 3 days (2026-11-06). ${RENEW}`);
  const without = runNode('Decide', { input: feedRes, upstream: { 'Daily schedule': {} }, staticData: {}, vars: { ...vars, LINKEDIN_TOKEN_EXPIRES_AT: '' } });
  assert.deepEqual(without.map((o) => o.action), ['offer', 'offer']);
});

test('embedded Record result node: a LinkedIn 401 names renew-token', () => {
  const staticData = { live: { record: [{ id: 'p01', network: 'linkedin', postedAt: NOW.toISOString(), postUrn: null, status: 'pending' }], offered: {} } };
  const post = { action: 'post', chatId: CHAT, id: 'p01', payload: {} };
  const out = runNode('Record result', { input: { statusCode: 401, body: '{}' }, upstream: { Decide: [post] }, staticData, vars: {} });
  assert.match(out[0].text, /^LinkedIn refused p01 with HTTP 401: the member token has expired or been revoked\. Run `credentials\.sh renew-token`/);
  assert.deepEqual(staticData.live.record, []);
});

// The wizard side, with http_req stubbed: each call is logged as "METHOD URL [BODY]" and answered
// from the environment (LIST, SET, DEL, CRE: an HTTP status, or "fail" for a network error).
const EXPIRY_EPOCH = '1800000000';
const EXPIRY_ISO = '2027-01-15T08:00:00Z';
const MANUAL_LINE = `Set n8n variable (or n8n environment variable) LINKEDIN_TOKEN_EXPIRES_AT=${EXPIRY_ISO}`;
const EMPTY_PAGE = '{"data":[],"nextCursor":null}';
const N8N_LINES = ["N8N_BASE_URL='https://n8n.example.org'", "N8N_API_KEY='dummy-key'", `LINKEDIN_TOKEN_EXPIRES_AT='${EXPIRY_EPOCH}'`];
const HTTP_STUB = `http_req() {
  local s
  printf '%s %s %s\\n' "$1" "$2" "\${4:-}" >> "$LOG"
  case "$1 $2" in
    "GET "*"/api/v1/variables?limit=100") s="$LIST"; HTTP_BODY="$PAGE1" ;;
    "GET "*"/api/v1/variables?limit=100&cursor="*) s="$LIST"; HTTP_BODY="$PAGE2" ;;
    "PUT "*"/api/v1/variables/"*|"POST "*"/api/v1/variables") s="$SET"; HTTP_BODY='{}' ;;
    "DELETE "*"/api/v1/credentials/"*) s="$DEL"; HTTP_BODY='' ;;
    "POST "*"/api/v1/credentials") s="$CRE"; HTTP_BODY='{"id":"8"}' ;;
    *) s=500; HTTP_BODY='' ;;
  esac
  if [[ "$s" == fail ]]; then HTTP_STATUS=000; HTTP_BODY=''; return 1; fi
  HTTP_STATUS="$s"
}`;
function wizardCalls(lines, body, env = {}) {
  const { xdg, file } = wizardState(lines);
  const log = join(xdg, 'calls.log');
  const r = sourced(`${HTTP_STUB}\n${body}`, xdg, { LOG: log, LIST: '200', SET: '201', DEL: '204', CRE: '200', PAGE1: EMPTY_PAGE, PAGE2: EMPTY_PAGE, ...env });
  const raw = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { out: r.stdout + r.stderr, raw, calls: raw.map((l) => l.split(' ').slice(0, 2).join(' ')), state: readFileSync(file, 'utf8') };
}
const SYNCED = `LINKEDIN_TOKEN_EXPIRY_SYNCED='${EXPIRY_EPOCH}'`;
const VARS_URL = 'https://n8n.example.org/api/v1/variables';

test('iso_utc formats epoch seconds as ISO 8601 UTC with python3 and refuses anything else', () => {
  const { xdg } = wizardState();
  const r = sourced(`iso_utc ${EXPIRY_EPOCH}; iso_utc 0; iso_utc 1800000000000 || echo no; iso_utc '' || echo no; iso_utc 12a || echo no`, xdg);
  assert.deepEqual(r.stdout.trim().split('\n'), [EXPIRY_ISO, '1970-01-01T00:00:00Z', 'no', 'no', 'no']);
  const fn = WIZARD_TEXT.slice(WIZARD_TEXT.indexOf('\niso_utc() {'));
  assert.doesNotMatch(fn.slice(0, fn.indexOf('\n}\n')), /\bdate\b/, 'no GNU or BSD only date flags');
});

test('sync_token_expiry follows pagination to an existing variable and updates it, then records the synced epoch', () => {
  const page1 = JSON.stringify({ data: [{ id: '1', key: 'OTHER', value: 'x' }], nextCursor: 'c/2=' });
  const page2 = JSON.stringify({ data: [{ id: '9', key: 'LINKEDIN_TOKEN_EXPIRES_AT', value: 'old' }], nextCursor: null });
  const r = wizardCalls(N8N_LINES, 'sync_token_expiry; echo rc=$?', { PAGE1: page1, PAGE2: page2, SET: '200' });
  assert.deepEqual(r.calls, [`GET ${VARS_URL}?limit=100`, `GET ${VARS_URL}?limit=100&cursor=c%2F2%3D`, `PUT ${VARS_URL}/9`]);
  assert.equal(JSON.parse(r.raw[2].slice(r.raw[2].indexOf('{'))).value, EXPIRY_ISO);
  assert.match(r.out, /rc=0/);
  assert.ok(r.state.includes(SYNCED), r.state);
  assert.ok(!r.raw.join('\n').includes('dummy-key'), 'the API key never travels in a body or URL');
});

test('sync_token_expiry creates the variable when the list ends without it', () => {
  const r = wizardCalls(N8N_LINES, 'sync_token_expiry');
  assert.deepEqual(r.calls, [`GET ${VARS_URL}?limit=100`, `POST ${VARS_URL}`]);
  assert.deepEqual(JSON.parse(r.raw[1].slice(r.raw[1].indexOf('{'))), { key: 'LINKEDIN_TOKEN_EXPIRES_AT', value: EXPIRY_ISO });
  assert.ok(r.state.includes(SYNCED));
});

test('sync_token_expiry: 403, 404, a network error or a failed write warn, print the manual line and carry on', () => {
  for (const env of [{ LIST: '403' }, { LIST: '404' }, { LIST: 'fail' }, { SET: '500' }, { LIST: '200', PAGE1: 'not json' }]) {
    const r = wizardCalls(N8N_LINES, 'sync_token_expiry; echo rc=$?', env);
    assert.match(r.out, /rc=0/, JSON.stringify(env));
    assert.ok(r.out.includes(MANUAL_LINE), `${JSON.stringify(env)}\n${r.out}`);
    assert.ok(!r.state.includes('LINKEDIN_TOKEN_EXPIRY_SYNCED'), 'a failure is not recorded as synced');
  }
  assert.match(wizardCalls(N8N_LINES, 'sync_token_expiry', { LIST: '403' }).out, /no Variables feature/);
});

test('sync_token_expiry with no base URL or key prints the manual line and calls nothing', () => {
  for (const lines of [[N8N_LINES[0], N8N_LINES[2]], [N8N_LINES[1], N8N_LINES[2]], ["N8N_BASE_URL='http://n8n.example.org'", ...N8N_LINES.slice(1)]]) {
    const r = wizardCalls(lines, 'sync_token_expiry');
    assert.deepEqual(r.calls, []);
    assert.ok(r.out.includes(MANUAL_LINE), r.out);
  }
  const none = wizardCalls(N8N_LINES.slice(0, 2), 'sync_token_expiry; echo rc=$?');
  assert.deepEqual(none.calls, []);
  assert.match(none.out, /no LinkedIn token expiry stored/);
  assert.match(none.out, /rc=0/);
});

const STEP4 = `ask() { printf -v "$1" '%s' 'https://n8n.example.org'; }
  ask_secret() { printf -v "$1" '%s' 'dummy-key'; }
  step_4; echo rc=$?`;
const STEP4_LINES = ["LINKEDIN_ACCESS_TOKEN='tok'", "TELEGRAM_BOT_TOKEN='bot'", `LINKEDIN_TOKEN_EXPIRES_AT='${EXPIRY_EPOCH}'`];

test('step 4 sets the variable after the credentials, whether they were created or fell back to manual', () => {
  const ok = wizardCalls(STEP4_LINES, STEP4);
  assert.deepEqual(ok.calls, ['POST https://n8n.example.org/api/v1/credentials', 'POST https://n8n.example.org/api/v1/credentials', `GET ${VARS_URL}?limit=100`, `POST ${VARS_URL}`]);
  assert.ok(ok.state.includes(SYNCED));
  assert.match(ok.out, /rc=0/);
  const manual = wizardCalls(STEP4_LINES, STEP4, { CRE: '403' });
  assert.deepEqual(manual.calls.slice(-2), [`GET ${VARS_URL}?limit=100`, `POST ${VARS_URL}`]);
  assert.match(manual.out, /Do this by hand in n8n/);
  assert.ok(manual.state.includes(SYNCED));
  const noVars = wizardCalls(STEP4_LINES, STEP4, { LIST: '404' });
  assert.ok(noVars.out.includes(MANUAL_LINE));
  assert.match(noVars.out, /rc=0/);
  assert.match(noVars.state, /^LAST_DONE_STEP='4'$/m, 'a refused variable does not stop step 4');
});

test('renew-token tries the variable on every exit path of the credential update', () => {
  const RENEW_BODY = 'step_2() { :; }\n  renew_token; echo rc=$?';
  const cred = "N8N_LINKEDIN_CRED_ID='7'";
  const lastTwo = [`GET ${VARS_URL}?limit=100`, `POST ${VARS_URL}`];
  const cases = {
    success: [[...N8N_LINES, cred], {}],
    'no credential recorded': [N8N_LINES, {}],
    'delete fails': [[...N8N_LINES, cred], { DEL: '403' }],
    'create fails': [[...N8N_LINES, cred], { CRE: '500' }],
  };
  for (const [name, [lines, env]] of Object.entries(cases)) {
    const r = wizardCalls(lines, RENEW_BODY, env);
    assert.deepEqual(r.calls.slice(-2), lastTwo, name);
    assert.ok(r.state.includes(SYNCED), name);
    assert.match(r.out, /rc=0/, name);
  }
  const noN8n = wizardCalls([`LINKEDIN_TOKEN_EXPIRES_AT='${EXPIRY_EPOCH}'`], RENEW_BODY);
  assert.deepEqual(noN8n.calls, []);
  assert.ok(noN8n.out.includes(MANUAL_LINE), noN8n.out);
});

test('step 7 lists LINKEDIN_TOKEN_EXPIRES_AT: already set when the synced value matches, by hand when not', () => {
  const line = (lines) => {
    const { xdg } = wizardState(lines);
    const r = bash([WIZARD, '--step', '7'], xdg, '\n');
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.split('\n').filter((l) => l.includes('LINKEDIN_TOKEN_EXPIRES_AT='));
  };
  const exp = `LINKEDIN_TOKEN_EXPIRES_AT='${EXPIRY_EPOCH}'`;
  assert.deepEqual(line([exp, SYNCED]).map((l) => l.trim()), [`LINKEDIN_TOKEN_EXPIRES_AT=${EXPIRY_ISO}   (already set: the wizard synced it)`]);
  assert.deepEqual(line([exp, "LINKEDIN_TOKEN_EXPIRY_SYNCED='1700000000'"]).map((l) => l.trim()), [`LINKEDIN_TOKEN_EXPIRES_AT=${EXPIRY_ISO}   (set it by hand: not synced to n8n)`]);
  assert.deepEqual(line([exp]).map((l) => l.trim()), [`LINKEDIN_TOKEN_EXPIRES_AT=${EXPIRY_ISO}   (set it by hand: not synced to n8n)`]);
  assert.deepEqual(line(["TELEGRAM_CHAT_ID='1'"]), [], 'no expiry stored: nothing to list');
});

test('step 2 makes no n8n call, and the dry runs of step 4 and renew-token name the variables endpoint', () => {
  const start = WIZARD_TEXT.indexOf('\nstep_2() {');
  const body = WIZARD_TEXT.slice(start, WIZARD_TEXT.indexOf('\n}\n', start));
  assert.doesNotMatch(body, /n8n|sync_token_expiry/);
  for (const args of [['--dry-run', '--step', '4'], ['--dry-run', 'renew-token']]) {
    const r = bash([WIZARD, ...args], tmp(), '');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.split('\n').some((l) => l.includes('/api/v1/variables') && l.includes('LINKEDIN_TOKEN_EXPIRES_AT')), r.stdout);
  }
  const fn = WIZARD_TEXT.slice(WIZARD_TEXT.indexOf('\nn8n_var_upsert() {'));
  assert.match(fn.slice(0, fn.indexOf('\n}\n')), /\bn8n_base\b/, 'the upsert reads the URL through the accessor');
});
