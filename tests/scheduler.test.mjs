// Scheduler (ADR 0004): selection, LinkedIn payloads, the Posting record, and the
// exported n8n workflow. No build and no n8n needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildLinkedInPayload,
  callbackData,
  decide,
  findForPosting,
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

const AUTHOR = 'urn:li:person:abc123';
const CHAT = '1000';
const NOW = new Date('2026-11-03T06:00:00Z');
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
  assert.deepEqual(out.map((o) => o.action), ['ack', 'post']);
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
  assert.deepEqual(out.map((o) => o.action), ['dryrun']);
  assert.match(out[0].text, /^DRY RUN: would POST https:\/\/api\.linkedin\.com\/v2\/ugcPosts\nX-Restli-Protocol-Version: 2\.0\.0/);
  assert.deepEqual(JSON.parse(out[0].text.slice(out[0].text.indexOf('{'))), buildLinkedInPayload(FEED[1], AUTHOR));
  assert.equal(data.live, undefined);
  const feedDown = decide({ request: { mode: 'run' }, config: config({ dryRun: true }), feed: null, feedError: 'HTTP 503', state, now: NOW });
  assert.match(feedDown[0].text, /^DRY RUN: Could not read the social feed: HTTP 503/);
});

// ---- the exported workflow ----

test('workflow is valid n8n JSON with credentials referenced by name only', () => {
  assert.ok(Array.isArray(workflow.nodes) && workflow.connections);
  assert.equal(workflow.settings.timezone, 'Europe/Vienna');
  const schedule = node('Daily schedule').parameters.rule.interval.map((r) => r.expression);
  assert.ok(schedule.includes('0 7 * * *'));
  for (const n of workflow.nodes) {
    for (const [type, ref] of Object.entries(n.credentials ?? {})) {
      assert.deepEqual(Object.keys(ref), ['name'], `${n.name} ${type}`);
      assert.ok(['linkedin-member', 'telegram-pearse-dev'].includes(ref.name), `${n.name} uses ${ref.name}`);
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

test('workflow holds no credential values or chat ids', () => {
  assert.doesNotMatch(WORKFLOW_TEXT, /bot\d+:/i, 'telegram bot url');
  assert.doesNotMatch(WORKFLOW_TEXT, /\d{6,}:[A-Za-z0-9_-]{20,}/, 'telegram bot token');
  assert.doesNotMatch(WORKFLOW_TEXT, /\bAQ[A-Za-z0-9_-]{20,}/, 'linkedin token');
  assert.doesNotMatch(WORKFLOW_TEXT, /Bearer\s+[A-Za-z0-9]/, 'bearer value');
  assert.doesNotMatch(WORKFLOW_TEXT, /"-?\d{5,}"/, 'digits-only string, like a chat id');
  assert.doesNotMatch(WORKFLOW_TEXT, /chat_?id\W{1,4}-?\d{5,}/i, 'chat id literal');
});

test('Code nodes embed select.mjs verbatim', () => {
  const lib = read('automation/n8n/select.mjs').replace(/^export /gm, '');
  for (const name of ['Decide', 'Record result']) {
    assert.ok(node(name).parameters.jsCode.startsWith(lib), `${name} has drifted from select.mjs: re-paste it`);
  }
});

// Runs the Decide and Record result node code with n8n's globals stubbed.
function runNode(name, { input, upstream = {}, staticData, vars = {} }) {
  const $ = (n) => {
    if (n === 'Decide' && upstream.Decide) return { isExecuted: true, first: () => ({ json: upstream.Decide[0] }), all: () => upstream.Decide.map((json) => ({ json })) };
    if (!(n in upstream)) throw new Error(`Referenced node is unexecuted: ${n}`);
    return { isExecuted: true, first: () => ({ json: upstream[n] }) };
  };
  const fn = new Function('$input', '$', '$getWorkflowStaticData', '$vars', '$env', node(name).parameters.jsCode);
  const env = new Proxy({}, { get: () => { throw new Error('access to env vars denied'); } });
  return fn({ first: () => ({ json: input }), all: () => [{ json: input }] }, $, () => staticData, vars, env).map((i) => i.json);
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
  assert.deepEqual(approved.map((o) => o.action), ['ack', 'dryrun']);
  assert.equal(approved[1].payload.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory, 'NONE');
  assert.deepEqual(runNode('Decide', { input: feedRes, upstream: { 'Daily schedule': {} }, staticData, vars }), []);
  assert.equal(staticData.live, undefined);
  const stranger = { callback_query: { id: 'q2', data: 'approve:p01', message: { chat: { id: 2000 } } } };
  assert.deepEqual(runNode('Decide', { input: feedRes, upstream: { 'Telegram update': stranger }, staticData, vars }), []);
  const bad = runNode('Decide', { input: feedRes, upstream: { 'Daily schedule': {} }, staticData, vars: { ...vars, TELEGRAM_USER_ID: 'me' } });
  assert.deepEqual(bad.map((o) => [o.action, o.chatId]), [['notify', CHAT]]);
  assert.match(bad[0].text, /configuration error/);
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
