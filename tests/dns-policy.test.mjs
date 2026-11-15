// Issue #161: the DNS and mail posture check. The pure policy (`scripts/dns-policy.mjs`) runs over
// synthetic observations; the transport (`scripts/dns-check.mjs`) runs against a stubbed fetch.
// No network, no dist/. Fixtures use example.com-style hosts, a fake mailbox and a fake key only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  CAA_ISSUERS,
  CHECK_IDS,
  DKIM_SELECTOR,
  DKIM_SELECTOR_PLACEHOLDER,
  EXPIRY_WINDOW_DAYS,
  GOOGLE_SITE_VERIFICATION,
  GOOGLE_SITE_VERIFICATION_PLACEHOLDER,
  MTA_STS_MIN_MAX_AGE,
  PENDING,
  POLICY,
  evaluate,
  exitCode,
  format,
  txtValue,
} from '../scripts/dns-policy.mjs';
import { get, observe, rdap, rdapBase, resolve, RESOLVER, RDAP_BOOTSTRAP } from '../scripts/dns-check.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8');

const DAY = 86400000;
const NOW = Date.parse('2026-11-15T12:00:00Z');
const T = { SOA: 6, TXT: 16, DS: 43, CAA: 257 };
const doh = (type, ...values) => ({ Status: 0, AD: true, Answer: values.map((data) => ({ name: 'example.com.', type, TTL: 300, data })) });
const TEST_TOKEN = 'testtoken_0123456789abcdef';
const verification = (token = TEST_TOKEN) => `google-site-verification=${token}`;
const empty = () => ({ Status: 0, AD: true, Answer: [] });
const rdapAt = (expiresMs, status = ['client transfer prohibited', 'active']) => ({
  status: 200,
  body: { status, events: [{ eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' }, { eventAction: 'expiration', eventDate: new Date(expiresMs).toISOString() }] },
});

function compliant() {
  return {
    now: NOW,
    apexTxt: doh(T.TXT, 'v=spf1 include:_spf.mail.example.com -all', 'site-verification=abc123', verification()),
    dkimTxt: doh(T.TXT, 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiFAKEKEYAAAA'),
    dmarcTxt: doh(T.TXT, 'v=DMARC1; p=reject; rua=mailto:reports@example.com'),
    mtaStsTxt: doh(T.TXT, 'v=STSv1; id=20261115'),
    mtaStsPolicy: { status: 200, body: `version: STSv1\nmode: enforce\nmx: mx1.example.com\nmax_age: ${MTA_STS_MIN_MAX_AGE}\n` },
    caa: doh(T.CAA, `0 issue "${CAA_ISSUERS[0]}"`, `0 issuewild "${CAA_ISSUERS[1]}"`, '0 iodef "mailto:security@example.com"'),
    ds: doh(T.DS, '12345 13 2 0123456789ABCDEF'),
    soa: doh(T.SOA, 'ns1.example.com. hostmaster.example.com. 1 7200 3600 1209600 300'),
    rdap: rdapAt(NOW + 200 * DAY),
  };
}

/** The shipped policy with a real-looking selector, a pinned test token and nothing pending: every check enforced. */
const ACTIVE = { ...POLICY, dkimSelector: 'sel1', googleSiteVerification: TEST_TOKEN, pending: [] };
const byId = (results) => Object.fromEntries(results.map((r) => [r.id, r]));

/** `id` has `status` and every other check passes. */
function only(results, id, status) {
  for (const r of results) assert.equal(r.status, r.id === id ? status : 'PASS', `${r.id}: ${r.status} ${r.reason}`);
}

test('the policy constants: eleven check IDs, a 30-day window, placeholder DKIM selector and Google token', () => {
  assert.equal(CHECK_IDS.length, 11);
  assert.equal(new Set(CHECK_IDS).size, 11);
  assert.equal(CHECK_IDS.at(-1), 'search-verification');
  assert.equal(CHECK_IDS.at(-2), 'rdap-expiry');
  assert.equal(EXPIRY_WINDOW_DAYS, 30);
  assert.equal(DKIM_SELECTOR, DKIM_SELECTOR_PLACEHOLDER, 'the placeholder ships until Pearse supplies the selector');
  assert.ok(CAA_ISSUERS.length > 0 && CAA_ISSUERS.every((d) => /^[a-z0-9.-]+\.[a-z]+$/.test(d)));
  assert.ok(Number.isInteger(MTA_STS_MIN_MAX_AGE) && MTA_STS_MIN_MAX_AGE > 0);
  assert.deepEqual(POLICY.pending, PENDING);
});

test('every ID in PENDING is a known check ID; dkim and search-verification stay pending while their constants are placeholders', () => {
  for (const id of PENDING) assert.ok(CHECK_IDS.includes(id), `unknown pending id ${id}`);
  assert.equal(new Set(PENDING).size, PENDING.length);
  if (DKIM_SELECTOR === DKIM_SELECTOR_PLACEHOLDER) assert.ok(PENDING.includes('dkim'));
  assert.ok(PENDING.includes('search-verification'));
  if (GOOGLE_SITE_VERIFICATION === GOOGLE_SITE_VERIFICATION_PLACEHOLDER) assert.ok(PENDING.includes('search-verification'));
});

test('a typo in pending throws instead of silently disabling a check', () => {
  assert.throws(() => evaluate({ ...ACTIVE, pending: ['dmarc-'] }, compliant()), /unknown pending check id/);
});

test('a fully compliant observation set passes every check, in CHECK_IDS order, with exit 0', () => {
  const results = evaluate(ACTIVE, compliant());
  assert.deepEqual(results.map((r) => r.id), CHECK_IDS);
  for (const r of results) assert.equal(r.status, 'PASS', `${r.id}: ${r.reason}`);
  assert.equal(exitCode(results), 0);
});

const failing = [
  ['two SPF records', 'spf', (o) => (o.apexTxt = doh(T.TXT, 'v=spf1 -all', 'v=spf1 include:_spf.example.com -all', verification())), /2 SPF records/],
  ['SPF ending ~all', 'spf', (o) => (o.apexTxt = doh(T.TXT, 'v=spf1 include:_spf.example.com ~all', verification())), /ends ~all, want -all/],
  ['no SPF record', 'spf', (o) => (o.apexTxt = doh(T.TXT, 'site-verification=abc123', verification())), /no SPF record/],
  ['no Google verification record', 'search-verification', (o) => (o.apexTxt = doh(T.TXT, 'v=spf1 include:_spf.mail.example.com -all', 'site-verification=abc123')), /^no Google verification record$/],
  ['two Google verification records', 'search-verification', (o) => o.apexTxt.Answer.push({ type: T.TXT, data: verification('another_token') }), /^2 Google verification records$/],
  ['a different Google verification value', 'search-verification', (o) => (o.apexTxt = doh(T.TXT, 'v=spf1 include:_spf.mail.example.com -all', 'site-verification=abc123', verification('other_token'))), /^token mismatch$/],
  ['DMARC p=none', 'dmarc', (o) => (o.dmarcTxt = doh(T.TXT, 'v=DMARC1; p=none; rua=mailto:reports@example.com')), /p=none, want reject/],
  ['DMARC with no rua', 'dmarc', (o) => (o.dmarcTxt = doh(T.TXT, 'v=DMARC1; p=reject')), /no rua=mailto:/],
  ['DMARC NXDOMAIN', 'dmarc', (o) => (o.dmarcTxt = { Status: 3, AD: true }), /no DMARC record/],
  ['DKIM with empty p=', 'dkim', (o) => (o.dkimTxt = doh(T.TXT, 'v=DKIM1; k=rsa; p=')), /empty p=/],
  ['DKIM without v=DKIM1', 'dkim', (o) => (o.dkimTxt = doh(T.TXT, 'k=rsa; p=MIIBFAKE')), /no v=DKIM1/],
  ['MTA-STS record without id=', 'mta-sts-record', (o) => (o.mtaStsTxt = doh(T.TXT, 'v=STSv1;')), /no valid id=/],
  ['MTA-STS policy mode: testing', 'mta-sts-policy', (o) => (o.mtaStsPolicy.body = o.mtaStsPolicy.body.replace('enforce', 'testing')), /mode: testing, want enforce/],
  ['MTA-STS max_age too low', 'mta-sts-policy', (o) => (o.mtaStsPolicy.body = o.mtaStsPolicy.body.replace(/max_age: \d+/, 'max_age: 86400')), /max_age below/],
  ['MTA-STS policy with no mx', 'mta-sts-policy', (o) => (o.mtaStsPolicy.body = o.mtaStsPolicy.body.replace(/mx: .*\n/, '')), /no mx: lines/],
  ['MTA-STS policy 404', 'mta-sts-policy', (o) => (o.mtaStsPolicy = { status: 404, body: 'nope' }), /HTTP 404/],
  ['MTA-STS TLS failure', 'mta-sts-policy', (o) => (o.mtaStsPolicy = { tls: true }), /TLS failure/],
  ['a CAA issuer outside the allowlist', 'caa', (o) => o.caa.Answer.push({ type: T.CAA, data: '0 issue "rogue-ca.example"' }), /^1 CAA issuer not in allowlist$/],
  ['a CAA issuewild outside the allowlist', 'caa', (o) => o.caa.Answer.push({ type: T.CAA, data: '0 issuewild "rogue-ca.example; policy=x"' }), /1 CAA issuer not in allowlist/],
  ['no CAA issue record', 'caa', (o) => (o.caa = empty()), /no CAA issue record/],
  ['no DS record', 'dnssec-ds', (o) => (o.ds = empty()), /no DS record/],
  ['AD false on the apex SOA', 'dnssec-ad', (o) => (o.soa = { Status: 0, AD: false, Answer: o.soa.Answer }), /AD false/],
  ['a SERVFAIL on the apex SOA', 'dnssec-ad', (o) => (o.soa = { Status: 2, AD: false }), /SERVFAIL/],
  ['no client transfer prohibited', 'rdap-lock', (o) => (o.rdap.body.status = ['active']), /no client transfer prohibited/],
  ['RDAP with no expiration event', 'rdap-expiry', (o) => (o.rdap.body.events = []), /no expiration event/],
];

for (const [name, id, mutate, reason] of failing) {
  test(`${name}: FAIL for ${id} only`, () => {
    const obs = compliant();
    mutate(obs);
    const results = evaluate(ACTIVE, obs);
    only(results, id, 'FAIL');
    assert.match(byId(results)[id].reason, reason);
    assert.equal(exitCode(results), 1);
  });
}

test('a CAA record forbidding issuance (issue ";") names no CA and passes alongside an allowed issuer', () => {
  const obs = compliant();
  obs.caa.Answer.push({ type: T.CAA, data: '0 issuewild ";"' });
  assert.equal(byId(evaluate(ACTIVE, obs)).caa.status, 'PASS');
});

test('DKIM fails with "selector not set" while the placeholder is configured', () => {
  const results = evaluate({ ...ACTIVE, dkimSelector: DKIM_SELECTOR_PLACEHOLDER }, compliant());
  only(results, 'dkim', 'FAIL');
  assert.equal(byId(results).dkim.reason, 'selector not set');
});

test('search-verification: the other-owner record is neither counted nor treated as a Google record; chunked and padded records still match', () => {
  const obs = compliant();
  assert.ok(obs.apexTxt.Answer.some((a) => a.data === 'site-verification=abc123'));
  only(evaluate(ACTIVE, obs), null, 'PASS');
  obs.apexTxt = doh(T.TXT, 'v=spf1 -all', `"google-site-verification=${TEST_TOKEN.slice(0, 8)}" "${TEST_TOKEN.slice(8)}"`);
  assert.equal(byId(evaluate(ACTIVE, obs))['search-verification'].status, 'PASS');
});

test('search-verification fails with "token not set" while the placeholder is configured, whatever DNS says', () => {
  const placeholder = { ...ACTIVE, googleSiteVerification: GOOGLE_SITE_VERIFICATION_PLACEHOLDER };
  const dnsStates = [
    compliant().apexTxt,
    doh(T.TXT, 'v=spf1 -all'),
    doh(T.TXT, 'v=spf1 -all', verification(GOOGLE_SITE_VERIFICATION_PLACEHOLDER)),
    doh(T.TXT, 'v=spf1 -all', verification(), verification('second')),
    { error: 'timeout' },
    { Status: 2 },
    null,
  ];
  for (const apexTxt of dnsStates) {
    const results = evaluate(placeholder, { ...compliant(), apexTxt });
    assert.equal(byId(results)['search-verification'].status, 'FAIL');
    assert.equal(byId(results)['search-verification'].reason, 'token not set');
  }
  const shipped = byId(evaluate(POLICY, compliant()))['search-verification'];
  if (GOOGLE_SITE_VERIFICATION === GOOGLE_SITE_VERIFICATION_PLACEHOLDER) {
    assert.equal(shipped.status, 'PENDING');
    assert.equal(shipped.reason, '(would FAIL: token not set)');
    assert.equal(shipped.wouldBe, 'FAIL');
  }
});


test(`RDAP expiry: ${EXPIRY_WINDOW_DAYS - 1} days out FAILs, ${EXPIRY_WINDOW_DAYS + 1} days out PASSes`, () => {
  const at = (days) => {
    const obs = compliant();
    obs.rdap = rdapAt(NOW + days * DAY);
    return evaluate(ACTIVE, obs);
  };
  const soon = at(EXPIRY_WINDOW_DAYS - 1);
  only(soon, 'rdap-expiry', 'FAIL');
  assert.equal(byId(soon)['rdap-expiry'].reason, `expires in ${EXPIRY_WINDOW_DAYS - 1} days, want more than ${EXPIRY_WINDOW_DAYS}`);
  only(at(EXPIRY_WINDOW_DAYS + 1), null, 'PASS');
  only(at(EXPIRY_WINDOW_DAYS), 'rdap-expiry', 'FAIL');
});

test('multi-chunk TXT records are concatenated before parsing', () => {
  assert.equal(txtValue('"v=DMARC1; p=rej" "ect"'), 'v=DMARC1; p=reject');
  assert.equal(txtValue('"a\\"b" "c\\059d"'), 'a"bc;d');
  assert.equal(txtValue('v=spf1 -all'), 'v=spf1 -all');
  const obs = compliant();
  obs.apexTxt = doh(T.TXT, '"v=spf1 include:_spf.mail.exa" "mple.com " "-all"', verification());
  obs.dmarcTxt = doh(T.TXT, '"v=DMARC1; p=rej" "ect; rua=mai" "lto:reports@example.com"');
  obs.dkimTxt = doh(T.TXT, '"v=DKIM1; k=rsa; " "p=MIIBIjANBgkqhkiFAKE" "KEYAAAA"');
  only(evaluate(ACTIVE, obs), null, 'PASS');
  // Unjoined, the split DMARC tag would read "p=rej": the chunks must be joined, not parsed one by one.
  obs.dmarcTxt = doh(T.TXT, '"v=DMARC1; p=none" "; rua=mailto:reports@example.com"');
  only(evaluate(ACTIVE, obs), 'dmarc', 'FAIL');
});

test('a CAA answer in RFC 3597 \\# form is ERROR, never PASS', () => {
  const obs = compliant();
  obs.caa = doh(T.CAA, '\\# 22 00 05 69 73 73 75 65 6c 65 74 73 65 6e 63 72 79 70 74 2e 6f 72 67');
  const results = evaluate(ACTIVE, obs);
  only(results, 'caa', 'ERROR');
  assert.match(byId(results).caa.reason, /unparsable/);
  assert.equal(exitCode(results), 2);
});

test('a transport error is ERROR with exit 2; a FAIL alongside it gives exit 1', () => {
  const obs = compliant();
  obs.apexTxt = { error: 'timeout' };
  const results = evaluate(ACTIVE, obs);
  // The apex answer feeds spf and search-verification alike, so both report the one transport error.
  for (const r of results) assert.equal(r.status, r.id === 'spf' || r.id === 'search-verification' ? 'ERROR' : 'PASS', `${r.id}: ${r.status} ${r.reason}`);
  assert.equal(byId(results).spf.reason, 'timeout');
  assert.equal(exitCode(results), 2);
  obs.dmarcTxt = doh(T.TXT, 'v=DMARC1; p=none; rua=mailto:reports@example.com');
  assert.equal(exitCode(evaluate(ACTIVE, obs)), 1);
});

test('an RDAP transport error is ERROR for both RDAP checks', () => {
  const obs = compliant();
  obs.rdap = { error: 'network' };
  const r = byId(evaluate(ACTIVE, obs));
  assert.equal(r['rdap-lock'].status, 'ERROR');
  assert.equal(r['rdap-expiry'].status, 'ERROR');
});

test('only PASS and PENDING gives exit 0, even when a pending check would fail; a pending pass says "would PASS"', () => {
  const obs = compliant();
  obs.caa = empty();
  obs.dmarcTxt = { error: 'timeout' };
  const results = evaluate({ ...ACTIVE, pending: ['caa', 'dkim', 'dmarc'] }, obs);
  const r = byId(results);
  assert.equal(r.caa.status, 'PENDING');
  assert.equal(r.caa.reason, '(would FAIL: no CAA issue record)');
  assert.equal(r.dmarc.reason, '(would ERROR: timeout)');
  assert.equal(r.dkim.status, 'PENDING');
  assert.equal(r.dkim.reason, '(would PASS: remove flag)');
  assert.ok(results.every((x) => x.status === 'PASS' || x.status === 'PENDING'));
  assert.equal(exitCode(results), 0);
  assert.match(format(results), /^dkim PENDING \(would PASS: remove flag\)$/m);
});

test('the output is one line per check: <id> <STATUS> <reason>', () => {
  const lines = format(evaluate(POLICY, compliant())).split('\n');
  assert.equal(lines.length, CHECK_IDS.length);
  lines.forEach((line, i) => assert.match(line, new RegExp(`^${CHECK_IDS[i]} (PASS|FAIL|ERROR|PENDING) \\S`)));
});

test('no output line echoes record data: a sentinel in the rua, SPF include, MX host, DKIM key and Google verification value never appears', () => {
  const S = 'zzsentinel7f3a';
  const planted = () => {
    const o = compliant();
    o.apexTxt = doh(T.TXT, `v=spf1 include:_spf.${S}.example -all`, verification(S));
    o.dmarcTxt = doh(T.TXT, `v=DMARC1; p=reject; rua=mailto:${S}@example.com`);
    o.dkimTxt = doh(T.TXT, `v=DKIM1; k=rsa; p=${S}`);
    o.mtaStsPolicy.body = o.mtaStsPolicy.body.replace('mx1.example.com', `mx.${S}.example`);
    return o;
  };
  const variants = [
    () => {},
    (o) => (o.apexTxt = doh(T.TXT, `v=spf1 include:${S}.example ${S}`)),
    (o) => (o.apexTxt = doh(T.TXT, `v=spf1 include:${S}.example ~all`, `v=spf1 a:${S}.example -all`)),
    (o) => (o.dmarcTxt = doh(T.TXT, `v=DMARC1; p=${S}; rua=${S}@example.com`)),
    (o) => (o.dkimTxt = doh(T.TXT, `v=${S}; p=${S}`)),
    (o) => (o.mtaStsPolicy.body = `version: ${S}\nmode: ${S}\nmx: ${S}.example\nmax_age: ${S}\n`),
    (o) => (o.mtaStsTxt = doh(T.TXT, `v=STSv1; id=${S}-${S}`)),
    (o) => (o.caa = doh(T.CAA, `0 issue "${S}.example"`, `0 iodef "mailto:${S}@example.com"`)),
    (o) => (o.rdap.body.status = [S]),
    // A sentinel only in the Google verification value: it matches a pinned token (compliant) or not (mismatch).
    (o) => (o.apexTxt = doh(T.TXT, 'v=spf1 -all', verification(S))),
    (o) => (o.apexTxt = doh(T.TXT, 'v=spf1 -all', verification(S), verification(`${S}2`))),
    (o) => (o.apexTxt = doh(T.TXT, `v=spf1 -all ${S}`, `site-verification=${S}`)),
  ];
  const pinned = { ...ACTIVE, googleSiteVerification: S };
  for (const policy of [ACTIVE, pinned, POLICY, { ...ACTIVE, pending: CHECK_IDS }, { ...pinned, pending: CHECK_IDS }]) {
    for (const v of variants) {
      const obs = planted();
      v(obs);
      for (const line of format(evaluate(policy, obs)).split('\n')) assert.ok(!line.toLowerCase().includes(S), line);
    }
  }
});

// Transport, against a stubbed fetch: no network.
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
function stub(...outcomes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, opts: { fetchImpl, backoffMs: 0 } };
}
const netErr = (code) => Object.assign(new TypeError('fetch failed'), { cause: { code } });

test('resolve queries the DoH JSON resolver with a timeout and no cd flag', async () => {
  const { calls, opts } = stub(reply(200, doh(T.TXT, 'v=spf1 -all')));
  const r = await resolve('example.com', 'TXT', opts);
  assert.equal(r.Answer[0].data, 'v=spf1 -all');
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, RESOLVER);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['name', 'type']);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('resolve retries once: a 5xx then an answer succeeds; a 5xx, timeout or network error that survives is ERROR', async () => {
  let s = stub(reply(503, ''), reply(200, empty()));
  assert.deepEqual(await resolve('example.com', 'DS', s.opts), empty());
  assert.equal(s.calls.length, 2);
  s = stub(reply(503, ''));
  assert.deepEqual(await resolve('example.com', 'DS', s.opts), { error: 'resolver HTTP 503' });
  assert.equal(s.calls.length, 2);
  s = stub(Object.assign(new Error('t'), { name: 'TimeoutError' }));
  assert.deepEqual(await resolve('example.com', 'DS', s.opts), { error: 'timeout' });
  s = stub(netErr('ECONNRESET'));
  const obs = { ...compliant(), ds: await resolve('example.com', 'DS', s.opts) };
  only(evaluate(ACTIVE, obs), 'dnssec-ds', 'ERROR');
});

test('a SERVFAIL is retried once and, if it survives, is FAIL (what validating resolvers see for bogus DNSSEC)', async () => {
  let s = stub(reply(200, { Status: 2 }), reply(200, doh(T.SOA, 'ns1.example.com. h.example.com. 1 2 3 4 5')));
  assert.equal((await resolve('example.com', 'SOA', s.opts)).Status, 0);
  assert.equal(s.calls.length, 2);
  s = stub(reply(200, { Status: 2 }));
  const soa = await resolve('example.com', 'SOA', s.opts);
  assert.equal(s.calls.length, 2);
  const results = evaluate(ACTIVE, { ...compliant(), soa });
  only(results, 'dnssec-ad', 'FAIL');
  assert.equal(byId(results)['dnssec-ad'].reason, 'SERVFAIL');
});

test('get: a TLS failure is FAIL for the MTA-STS policy, redirects are not followed', async () => {
  let s = stub(netErr('CERT_HAS_EXPIRED'));
  const tls = await get('https://mta-sts.example.com/.well-known/mta-sts.txt', s.opts);
  assert.deepEqual(tls, { tls: true });
  only(evaluate(ACTIVE, { ...compliant(), mtaStsPolicy: tls }), 'mta-sts-policy', 'FAIL');
  s = stub(reply(301, ''));
  const moved = await get('https://mta-sts.example.com/.well-known/mta-sts.txt', s.opts);
  assert.equal(s.calls[0].init.redirect, 'manual');
  assert.equal(moved.status, 301);
  s = stub(reply(502, ''));
  assert.deepEqual(await get('https://mta-sts.example.com/x', s.opts), { error: 'HTTP 502' });
  assert.equal(s.calls.length, 2);
  s = stub(netErr('ENOTFOUND'));
  assert.deepEqual(await get('https://mta-sts.example.com/x', s.opts), { error: 'host not found' });
});

test('RDAP: the base URL comes from the IANA bootstrap file, then domain/<name> with the RDAP Accept header', async () => {
  const bootstrap = { services: [[['com', 'net'], ['https://rdap.other.example/']], [['dev', 'app'], ['http://rdap.tld.example/v1', 'https://rdap.tld.example/v1']]] };
  assert.equal(rdapBase(bootstrap, 'dev'), 'https://rdap.tld.example/v1/');
  assert.equal(rdapBase(bootstrap, 'xyz'), null);
  const body = rdapAt(NOW + 200 * DAY).body;
  const s = stub(reply(200, bootstrap), reply(200, body));
  const res = await rdap('example.dev', s.opts);
  assert.deepEqual(res, { status: 200, body });
  assert.equal(s.calls[0].url, RDAP_BOOTSTRAP);
  assert.equal(s.calls[1].url, 'https://rdap.tld.example/v1/domain/example.dev');
  assert.equal(s.calls[1].init.headers.Accept, 'application/rdap+json');
});

test('observe sends no DKIM query while the selector is the placeholder, and one once it is set', async () => {
  const base = { domain: 'example.dev' };
  let s = stub(reply(200, empty()));
  let obs = await observe({ ...base, dkimSelector: DKIM_SELECTOR_PLACEHOLDER }, s.opts);
  assert.equal(obs.dkimTxt, null);
  assert.ok(!s.calls.some((c) => c.url.includes('_domainkey')));
  assert.match(evaluate({ ...POLICY, ...base, dkimSelector: DKIM_SELECTOR_PLACEHOLDER }, obs).find((r) => r.id === 'dkim').reason, /selector not set/);
  s = stub(reply(200, empty()));
  obs = await observe({ ...base, dkimSelector: 's1' }, s.opts);
  assert.equal(s.calls.filter((c) => c.url.includes('s1._domainkey.example.dev')).length, 1);
});

test('the transport uses global fetch only: no node:dns, no dig, no child process', () => {
  const src = read('scripts/dns-check.mjs');
  assert.doesNotMatch(src, /from ['"](node:)?(dns|child_process)['"]/);
  assert.doesNotMatch(src, /\bdig\s/);
  assert.doesNotMatch(src, /[?&]cd=/);
  assert.equal(JSON.parse(read('package.json')).scripts.dns, 'node scripts/dns-check.mjs');
});

// The workflow.
const wfText = read('.github/workflows/dns.yml');
const wf = parse(wfText);
// yaml 2.x (YAML 1.2) parses `on` as a string key; a YAML 1.1 parser yields boolean `true`.
const triggers = wf.on ?? wf[true];

test('dns.yml: one weekly cron, workflow_dispatch, and pull requests on the three dns paths', () => {
  assert.deepEqual(Object.keys(triggers).sort(), ['pull_request', 'schedule', 'workflow_dispatch']);
  assert.equal(triggers.schedule.length, 1);
  const [, , dayOfMonth, month, dayOfWeek] = triggers.schedule[0].cron.trim().split(/\s+/);
  assert.deepEqual([dayOfMonth, month], ['*', '*']);
  assert.match(dayOfWeek, /^[0-6]$/, 'weekly: one day of the week');
  assert.ok('workflow_dispatch' in triggers);
  assert.deepEqual([...triggers.pull_request.paths].sort(), ['.github/workflows/dns.yml', 'scripts/dns-*.mjs', 'tests/dns-policy.test.mjs']);
});

test('dns.yml: permissions are exactly contents: read, no job widens them, no secrets', () => {
  assert.deepEqual(wf.permissions, { contents: 'read' });
  for (const [id, job] of Object.entries(wf.jobs)) assert.equal(job.permissions, undefined, id);
  assert.doesNotMatch(wfText, /secrets\./);
});

test('dns.yml: Node 22.23.4 and npm run dns, with no npm ci', () => {
  const steps = Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
  const node = steps.find((s) => String(s.uses ?? '').startsWith('actions/setup-node@'));
  assert.equal(String(node.with['node-version']), '22.23.4');
  const runs = steps.map((s) => s.run).filter(Boolean);
  assert.deepEqual(runs, ['npm run dns']);
});

test('check.yml and deploy.yml never run the DNS check', () => {
  for (const f of ['check.yml', 'deploy.yml']) assert.doesNotMatch(read(`.github/workflows/${f}`), /dns/i, f);
});
