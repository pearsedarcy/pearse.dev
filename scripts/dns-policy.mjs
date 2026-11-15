// Issue #161: the DNS and mail posture pearse.dev should have, as pure data plus one pure
// function. No I/O: `scripts/dns-check.mjs` fetches the raw resolver, HTTPS and RDAP responses and
// passes them in; `tests/dns-policy.test.mjs` passes synthetic ones.
//
// Reasons are property-level only ("p=none, want reject", "2 SPF records"). They never echo record
// data: no mailbox, no MX host, no key, no policy text. Any value echoed back is first matched
// against a short list of known keywords.

export const DOMAIN = 'pearse.dev';

/** RDAP expiry must be more than this many days away. RDAP cannot see auto-renew; this is the proxy. */
export const EXPIRY_WINDOW_DAYS = 30;

/** Placeholder until Pearse supplies the real selector; the `dkim` check fails while it is set. */
export const DKIM_SELECTOR_PLACEHOLDER = 'selector-not-set';
export const DKIM_SELECTOR = DKIM_SELECTOR_PLACEHOLDER;

/**
 * Certificate authorities allowed in CAA `issue`/`issuewild`. It must list every CA the edge and
 * Pages use, including the ones that renew automatically: too narrow a list breaks renewal
 * silently. Pearse confirms it before `caa` leaves PENDING.
 */
export const CAA_ISSUERS = ['letsencrypt.org', 'pki.goog', 'ssl.com', 'sectigo.com'];

/** Minimum MTA-STS `max_age` in seconds: one week (RFC 8461 recommends weeks or more). */
export const MTA_STS_MIN_MAX_AGE = 604800;

export const CHECK_IDS = [
  'spf',
  'dkim',
  'dmarc',
  'mta-sts-record',
  'mta-sts-policy',
  'caa',
  'dnssec-ds',
  'dnssec-ad',
  'rdap-lock',
  'rdap-expiry',
];

/**
 * Checks that are reported but never fail the run, set to exactly what did not pass on the first
 * live run (2026-11-15). Removing one is a one-line diff: do it once the step is done and
 * `npm run dns` shows `would PASS`.
 */
export const PENDING = ['spf', 'dkim', 'dmarc', 'mta-sts-record', 'mta-sts-policy', 'caa'];

export const POLICY = Object.freeze({
  domain: DOMAIN,
  expiryWindowDays: EXPIRY_WINDOW_DAYS,
  dkimSelector: DKIM_SELECTOR,
  caaIssuers: CAA_ISSUERS,
  mtaStsMinMaxAge: MTA_STS_MIN_MAX_AGE,
  pending: PENDING,
});

// DNS RR type numbers in DNS-over-HTTPS JSON answers.
const TYPE = { SOA: 6, TXT: 16, DS: 43, CAA: 257 };
const RCODE = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };
const DAY_MS = 86400000;

const pass = () => ({ status: 'PASS', reason: 'ok' });
const fail = (...reasons) => ({ status: 'FAIL', reason: reasons.join('; ') });
const error = (reason) => ({ status: 'ERROR', reason });

/** A transport failure that survived the retry: `{ error: 'timeout' | 'network' | 'http 503' | ... }`. */
const transportError = (obs) => (obs == null ? 'no observation' : typeof obs.error === 'string' ? obs.error : null);

/** Only known words are echoed back; anything else is reported as unrecognised. */
const known = (value, words) => (words.includes(String(value).toLowerCase()) ? String(value).toLowerCase() : null);

/**
 * TXT `data` arrives either bare or as one or more quoted chunks (`"v=DMARC1; " "p=reject"`).
 * Chunks are concatenated with no separator, as RFC 7208 and RFC 6376 require.
 */
export function txtValue(data) {
  const s = String(data).trim();
  if (!s.startsWith('"')) return s;
  const chunks = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(s))) chunks.push(m[1].replace(/\\(\d{3}|.)/g, (_, c) => (c.length === 3 ? String.fromCharCode(Number(c)) : c)));
  return chunks.join('');
}

/** `{ ok: string[] }` with the TXT values of a DoH answer, or `{ result }` when the answer settles it. */
function dnsAnswer(obs, type) {
  const err = transportError(obs);
  if (err) return { result: error(err) };
  if (obs.Status === 2) return { result: fail('SERVFAIL') };
  if (obs.Status !== 0 && obs.Status !== 3) return { result: fail(RCODE[obs.Status] ?? `rcode ${obs.Status}`) };
  return { ok: (obs.Answer ?? []).filter((a) => a.type === type).map((a) => a.data) };
}

const txtRecords = (obs) => {
  const a = dnsAnswer(obs, TYPE.TXT);
  return a.result ? a : { ok: a.ok.map(txtValue) };
};

/** Tag-value list (`k=v; k=v`), as DKIM, DMARC and MTA-STS records use. Keys are lower-cased. */
function tags(record) {
  const out = {};
  for (const part of record.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim().toLowerCase();
    if (key && !(key in out)) out[key] = part.slice(i + 1).trim();
  }
  return out;
}

const startsWithVersion = (record, version) => new RegExp(`^v=${version}(\\s|;|$)`, 'i').test(record.trim());
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function checkSpf(_policy, obs) {
  const a = txtRecords(obs.apexTxt);
  if (a.result) return a.result;
  const spf = a.ok.filter((r) => startsWithVersion(r, 'spf1'));
  if (spf.length === 0) return fail('no SPF record');
  if (spf.length > 1) return fail(plural(spf.length, 'SPF record'));
  const terms = spf[0].trim().split(/\s+/);
  const last = terms.at(-1).toLowerCase();
  if (last === '-all') return pass();
  const all = known(last, ['+all', 'all', '~all', '?all']);
  return fail(all ? `ends ${all}, want -all` : 'does not end in -all');
}

function checkDkim(policy, obs) {
  if (!policy.dkimSelector || policy.dkimSelector === DKIM_SELECTOR_PLACEHOLDER) return fail('selector not set');
  const a = txtRecords(obs.dkimTxt);
  if (a.result) return a.result;
  if (a.ok.length === 0) return fail('no DKIM record');
  if (a.ok.length > 1) return fail(plural(a.ok.length, 'DKIM record'));
  const t = tags(a.ok[0]);
  const reasons = [];
  if ((t.v ?? '').toUpperCase() !== 'DKIM1') reasons.push('no v=DKIM1');
  if (!('p' in t)) reasons.push('no p=');
  else if (t.p.replace(/\s+/g, '') === '') reasons.push('empty p= (key revoked)');
  return reasons.length ? fail(...reasons) : pass();
}

function checkDmarc(_policy, obs) {
  const a = txtRecords(obs.dmarcTxt);
  if (a.result) return a.result;
  const dmarc = a.ok.filter((r) => startsWithVersion(r, 'DMARC1'));
  if (dmarc.length === 0) return fail('no DMARC record');
  if (dmarc.length > 1) return fail(plural(dmarc.length, 'DMARC record'));
  const t = tags(dmarc[0]);
  const reasons = [];
  if ((t.p ?? '').toLowerCase() !== 'reject') {
    const p = known(t.p ?? '', ['none', 'quarantine']);
    reasons.push(p ? `p=${p}, want reject` : 'p missing or unrecognised, want reject');
  }
  const rua = (t.rua ?? '').split(',').filter((u) => /^\s*mailto:\S/i.test(u));
  if (rua.length === 0) reasons.push('no rua=mailto:');
  return reasons.length ? fail(...reasons) : pass();
}

function checkMtaStsRecord(_policy, obs) {
  const a = txtRecords(obs.mtaStsTxt);
  if (a.result) return a.result;
  const sts = a.ok.filter((r) => startsWithVersion(r, 'STSv1'));
  if (sts.length === 0) return fail('no MTA-STS record');
  if (sts.length > 1) return fail(plural(sts.length, 'MTA-STS record'));
  return /^[A-Za-z0-9]{1,32}$/.test(tags(sts[0]).id ?? '') ? pass() : fail('no valid id=');
}

function checkMtaStsPolicy(policy, obs) {
  const o = obs.mtaStsPolicy;
  if (o?.tls) return fail('TLS failure');
  const err = transportError(o);
  if (err) return error(err);
  if (o.status !== 200) return fail(`HTTP ${o.status}`);
  const fields = {};
  let mx = 0;
  for (const line of String(o.body ?? '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === 'mx') mx += value ? 1 : 0;
    else if (!(key in fields)) fields[key] = value;
  }
  const reasons = [];
  if (fields.version !== 'STSv1') reasons.push('no version: STSv1');
  if (fields.mode !== 'enforce') {
    const mode = known(fields.mode ?? '', ['testing', 'none']);
    reasons.push(mode ? `mode: ${mode}, want enforce` : 'mode missing or unrecognised, want enforce');
  }
  const maxAge = /^\d{1,10}$/.test(fields.max_age ?? '') ? Number(fields.max_age) : NaN;
  if (Number.isNaN(maxAge)) reasons.push('no valid max_age');
  else if (maxAge < policy.mtaStsMinMaxAge) reasons.push(`max_age below ${policy.mtaStsMinMaxAge}`);
  if (mx === 0) reasons.push('no mx: lines');
  return reasons.length ? fail(...reasons) : pass();
}

/** CAA presentation format: `<flags> <tag> "<value>"`. `null` when it is not in that form. */
function parseCaa(data) {
  const m = /^\s*(\d{1,3})\s+([A-Za-z0-9]+)\s+(?:"((?:[^"\\]|\\.)*)"|(\S*))\s*$/.exec(String(data));
  if (!m) return null;
  return { tag: m[2].toLowerCase(), value: m[3] ?? m[4] ?? '' };
}

function checkCaa(policy, obs) {
  const a = dnsAnswer(obs.caa, TYPE.CAA);
  if (a.result) return a.result;
  if (a.ok.some((d) => /^\s*\\#/.test(String(d)))) return error('CAA answer unparsable (RFC 3597 \\# form)');
  const records = a.ok.map(parseCaa);
  if (records.some((r) => r === null)) return error('CAA answer unparsable');
  const issue = records.filter((r) => r.tag === 'issue');
  if (issue.length === 0) return fail('no CAA issue record');
  const allowed = new Set(policy.caaIssuers.map((d) => d.toLowerCase()));
  const outside = records
    .filter((r) => r.tag === 'issue' || r.tag === 'issuewild')
    .map((r) => r.value.split(';')[0].trim().toLowerCase())
    // An empty domain (`issue ";"`) forbids issuance; it names no CA.
    .filter((domain) => domain !== '' && !allowed.has(domain));
  return outside.length ? fail(`${plural(outside.length, 'CAA issuer')} not in allowlist`) : pass();
}

function checkDs(_policy, obs) {
  const a = dnsAnswer(obs.ds, TYPE.DS);
  if (a.result) return a.result;
  return a.ok.length ? pass() : fail('no DS record at the parent');
}

function checkAd(_policy, obs) {
  const a = dnsAnswer(obs.soa, TYPE.SOA);
  if (a.result) return a.result;
  if (obs.soa.Status !== 0 || a.ok.length === 0) return fail('no SOA answer');
  return obs.soa.AD === true ? pass() : fail('AD false, answer not validated');
}

/** RDAP body, or `{ result }` when the response settles both RDAP checks. */
function rdapBody(obs) {
  const err = transportError(obs);
  if (err) return { result: error(err) };
  if (obs.status !== 200) return { result: fail(`RDAP HTTP ${obs.status}`) };
  if (obs.body == null || typeof obs.body !== 'object') return { result: error('RDAP body unparsable') };
  return { body: obs.body };
}

function checkRdapLock(_policy, obs) {
  const r = rdapBody(obs.rdap);
  if (r.result) return r.result;
  const status = (r.body.status ?? []).map((s) => String(s).toLowerCase());
  return status.includes('client transfer prohibited') ? pass() : fail('no client transfer prohibited status');
}

function checkRdapExpiry(policy, obs) {
  const r = rdapBody(obs.rdap);
  if (r.result) return r.result;
  const event = (r.body.events ?? []).find((e) => String(e.eventAction).toLowerCase() === 'expiration');
  const expires = Date.parse(event?.eventDate ?? '');
  if (Number.isNaN(expires)) return fail('no expiration event');
  const now = typeof obs.now === 'number' ? obs.now : Date.parse(obs.now);
  if (Number.isNaN(now)) return error('no observation time');
  const days = Math.floor((expires - now) / DAY_MS);
  return days > policy.expiryWindowDays ? pass() : fail(`expires in ${days} days, want more than ${policy.expiryWindowDays}`);
}

const CHECKS = {
  spf: checkSpf,
  dkim: checkDkim,
  dmarc: checkDmarc,
  'mta-sts-record': checkMtaStsRecord,
  'mta-sts-policy': checkMtaStsPolicy,
  caa: checkCaa,
  'dnssec-ds': checkDs,
  'dnssec-ad': checkAd,
  'rdap-lock': checkRdapLock,
  'rdap-expiry': checkRdapExpiry,
};

/**
 * One result per check, in `CHECK_IDS` order: `{ id, status, reason }`. A pending check is still
 * evaluated; its status is `PENDING` and its reason names the would-be result. An unknown ID in
 * `policy.pending` throws, so a typo cannot silently disable a check.
 */
export function evaluate(policy, observations) {
  const pending = new Set(policy.pending ?? []);
  for (const id of pending) if (!CHECK_IDS.includes(id)) throw new Error(`unknown pending check id: ${id}`);
  return CHECK_IDS.map((id) => {
    let r;
    try {
      r = CHECKS[id](policy, observations ?? {});
    } catch {
      r = error('observation unparsable');
    }
    if (!pending.has(id)) return { id, ...r };
    const would = r.status === 'PASS' ? 'would PASS: remove flag' : `would ${r.status}: ${r.reason}`;
    return { id, status: 'PENDING', reason: `(${would})`, wouldBe: r.status };
  });
}

/** 0 when every non-pending check passes, 1 on any FAIL, 2 on ERROR with no FAIL. */
export function exitCode(results) {
  if (results.some((r) => r.status === 'FAIL')) return 1;
  if (results.some((r) => r.status === 'ERROR')) return 2;
  return 0;
}

/** One line per check: `<id> <STATUS> <reason>`. */
export function format(results) {
  return results.map((r) => `${r.id} ${r.status} ${r.reason}`).join('\n');
}
