// Issue #161: `npm run dns`. Fetches the live DNS, MTA-STS and RDAP answers for pearse.dev, hands
// them to the pure `evaluate()` in `scripts/dns-policy.mjs` and prints one line per check.
// Exit 0: every non-pending check passes. 1: a non-pending FAIL. 2: a non-pending ERROR, no FAIL.
//
// Global fetch only, no dependencies. DNS goes over DNS-over-HTTPS JSON to a validating public
// resolver, never `dig` or `node:dns`, which cannot show the AD flag. `cd` is left unset so the
// resolver validates. Nothing here prints a record value, a URL or a response body.
import { pathToFileURL } from 'node:url';
import { DKIM_SELECTOR_PLACEHOLDER, POLICY, evaluate, exitCode, format } from './dns-policy.mjs';

export const RESOLVER = 'https://dns.google/resolve';
export const RDAP_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
export const TIMEOUT_MS = 10000;
export const BACKOFF_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A short, value-free name for a fetch failure. */
function failureKind(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
  if (err?.cause?.code === 'ENOTFOUND') return 'host not found';
  return 'network';
}

/** True when a fetch failure is the TLS handshake or certificate, not the network. */
export function isTlsError(err) {
  const code = String(err?.cause?.code ?? err?.code ?? '');
  return /CERT|TLS|SSL|ERR_SSL/i.test(code);
}

/**
 * One request with `AbortSignal.timeout`, retried once after a short backoff when `retry(outcome)`
 * says so. Returns the last outcome: `{ response }` or `{ err }`.
 */
async function attempt(doFetch, retry, { fetchImpl, backoffMs }) {
  let outcome;
  for (let i = 0; i < 2; i++) {
    if (i) await sleep(backoffMs);
    try {
      outcome = { response: await doFetch(fetchImpl, AbortSignal.timeout(TIMEOUT_MS)) };
    } catch (err) {
      outcome = { err };
    }
    if (!(await retry(outcome))) break;
  }
  return outcome;
}

/**
 * DoH JSON for one name and type: the resolver's object (`{ Status, AD, Answer }`) or
 * `{ error }`. Network errors, timeouts, HTTP 5xx and SERVFAIL are retried once; a SERVFAIL that
 * survives is returned as is (the policy calls it FAIL), the rest become `{ error }`.
 */
export async function resolve(name, type, { fetchImpl = fetch, backoffMs = BACKOFF_MS } = {}) {
  const url = `${RESOLVER}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
  let json;
  const outcome = await attempt(
    (f, signal) => f(url, { signal, headers: { Accept: 'application/dns-json' } }),
    async (o) => {
      json = undefined;
      if (o.err || o.response.status >= 500) return true;
      if (o.response.ok) {
        try {
          json = await o.response.json();
        } catch {
          return true;
        }
        return json.Status === 2;
      }
      return false;
    },
    { fetchImpl, backoffMs },
  );
  if (outcome.err) return { error: failureKind(outcome.err) };
  if (!outcome.response.ok) return { error: `resolver HTTP ${outcome.response.status}` };
  return json ?? { error: 'resolver answer unparsable' };
}

/**
 * Plain HTTPS GET: `{ status, body }`, `{ tls: true }` on a certificate or handshake failure, or
 * `{ error }`. Redirects are not followed (RFC 8461 forbids them for the MTA-STS policy).
 */
export async function get(url, { fetchImpl = fetch, backoffMs = BACKOFF_MS, headers = {}, json = false } = {}) {
  const outcome = await attempt(
    (f, signal) => f(url, { signal, headers, redirect: 'manual' }),
    async (o) => Boolean(o.err) || o.response.status >= 500,
    { fetchImpl, backoffMs },
  );
  if (outcome.err) return isTlsError(outcome.err) ? { tls: true } : { error: failureKind(outcome.err) };
  const { status } = outcome.response;
  if (status >= 500) return { error: `HTTP ${status}` };
  let body;
  try {
    body = json ? await outcome.response.json() : await outcome.response.text();
  } catch {
    body = null;
  }
  return { status, body };
}

/** The RDAP base URL for a TLD from the IANA bootstrap file, never hard-coded. */
export function rdapBase(bootstrap, tld) {
  const service = (bootstrap?.services ?? []).find(([tlds]) => tlds.map((t) => t.toLowerCase()).includes(tld));
  const urls = service?.[1] ?? [];
  const base = urls.find((u) => u.startsWith('https://')) ?? urls[0];
  if (!base) return null;
  return base.endsWith('/') ? base : `${base}/`;
}

export async function rdap(domain, opts = {}) {
  const boot = await get(RDAP_BOOTSTRAP, { ...opts, json: true });
  if (boot.error || boot.tls) return { error: boot.error ?? 'bootstrap TLS failure' };
  if (boot.status !== 200) return { error: `bootstrap HTTP ${boot.status}` };
  const base = rdapBase(boot.body, domain.split('.').at(-1));
  if (!base) return { error: 'no RDAP base for TLD' };
  const res = await get(`${base}domain/${domain}`, { ...opts, json: true, headers: { Accept: 'application/rdap+json' } });
  return res.tls ? { error: 'RDAP TLS failure' } : res;
}

/** Every observation `evaluate()` needs, fetched in parallel. */
export async function observe(policy = POLICY, opts = {}) {
  const d = policy.domain;
  // No real selector yet: `evaluate()` reports `selector not set` without looking, so ask nothing.
  const dkimSet = Boolean(policy.dkimSelector) && policy.dkimSelector !== DKIM_SELECTOR_PLACEHOLDER;
  const [apexTxt, dkimTxt, dmarcTxt, mtaStsTxt, caa, ds, soa, mtaStsPolicy, rdapRes] = await Promise.all([
    resolve(d, 'TXT', opts),
    dkimSet ? resolve(`${policy.dkimSelector}._domainkey.${d}`, 'TXT', opts) : null,
    resolve(`_dmarc.${d}`, 'TXT', opts),
    resolve(`_mta-sts.${d}`, 'TXT', opts),
    resolve(d, 'CAA', opts),
    resolve(d, 'DS', opts),
    resolve(d, 'SOA', opts),
    get(`https://mta-sts.${d}/.well-known/mta-sts.txt`, opts),
    rdap(d, opts),
  ]);
  return { now: Date.now(), apexTxt, dkimTxt, dmarcTxt, mtaStsTxt, caa, ds, soa, mtaStsPolicy, rdap: rdapRes };
}

async function main() {
  const results = evaluate(POLICY, await observe(POLICY));
  console.log(format(results));
  process.exitCode = exitCode(results);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
