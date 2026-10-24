// Scheduler logic (ADR 0004): which social feed entries to offer for Approval,
// what to post to LinkedIn, and how the Posting record changes. Pure and
// dependency-free so node:test can run it without n8n.
//
// This file is the tested reference for the "Decide" and "Record result" Code
// nodes in social-scheduler.json. Both nodes embed it verbatim with the leading
// `export ` keywords removed, followed by a short n8n-specific shim.
// tests/scheduler.test.mjs fails if an embedded copy drifts: edit here first,
// then paste the change into both nodes (see README.md).

const NETWORK = 'linkedin';
const TIME_ZONE = 'Europe/Vienna';
const CALLBACK_MAX_BYTES = 64; // Telegram's limit for inline button callback_data
const TELEGRAM_MAX_CHARS = 4096; // Telegram's limit for one message
export const LINKEDIN_UGC_URL = 'https://api.linkedin.com/v2/ugcPosts';
export const LINKEDIN_HEADERS = { 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json' };

/** Feed entries from before standalone posts carry no `kind`: they are articles keyed by slug and pubDate. */
export function normaliseEntry(entry) {
  const kind = entry.kind ?? 'article';
  return { ...entry, kind, id: entry.id ?? entry.slug, date: entry.date ?? entry.pubDate };
}

/** An article may be posted once its page is live; a standalone post once it is approved. */
export function isEligible(entry) {
  const e = normaliseEntry(entry);
  if (e.kind === 'article') {
    return e.published === true && typeof e.url === 'string' && e.url !== '' && (e.status ?? 'approved') === 'approved';
  }
  if (e.kind === 'standalone') return e.status === 'approved';
  return false;
}

export function recordFor(record, id) {
  return (record ?? []).find((r) => r.id === id);
}

/** Entries dated `isoDate` that may be posted and have no Posting record row yet. */
export function selectForDay(feed, isoDate, record) {
  const seen = new Set((record ?? []).map((r) => r.id));
  return (feed ?? []).map(normaliseEntry).filter((e) => e.date === isoDate && isEligible(e) && !seen.has(e.id));
}

/** What a run offers: the day's selection minus anything already offered, so a second run is a no-op. */
export function selectToOffer(feed, isoDate, state) {
  const offered = state.offered ?? {};
  return selectForDay(feed, isoDate, state.record).filter((e) => !Object.hasOwn(offered, e.id));
}

/** Re-checks an entry at Approve time against the live feed: it must still be eligible and not recorded. */
export function findForPosting(feed, id, isoDate, record) {
  const entry = (feed ?? []).map(normaliseEntry).find((e) => e.id === id);
  if (!entry) return { error: `${id} is not in the social feed.` };
  const row = recordFor(record, id);
  if (row) return { error: `${id} is already ${row.status} (${row.postedAt}).` };
  if (!isEligible(entry)) {
    return { error: entry.kind === 'article' ? `${id} is not published yet; it cannot be linked.` : `${id} is not approved.` };
  }
  if (entry.date > isoDate) return { error: `${id} is dated ${entry.date}, after ${isoDate}.` };
  return { entry };
}

/** The ugcPosts body: an article share with the page URL, or a text-only standalone post. */
export function buildLinkedInPayload(entry, authorUrn) {
  const e = normaliseEntry(entry);
  if (!/^urn:li:person:[A-Za-z0-9_-]+$/.test(authorUrn ?? '')) {
    throw new Error('LINKEDIN_AUTHOR_URN must be set and look like urn:li:person:<id>.');
  }
  const text = (e.social?.linkedin ?? '').trim();
  if (!text) throw new Error(`${e.id} has no LinkedIn copy.`);
  let share;
  if (e.kind === 'article') {
    if (e.published !== true || !e.url) throw new Error(`${e.id} is not published; refusing to link it.`);
    share = {
      shareCommentary: { text },
      shareMediaCategory: 'ARTICLE',
      media: [{ status: 'READY', originalUrl: e.url, title: { text: e.title } }],
    };
  } else if (e.kind === 'standalone') {
    share = { shareCommentary: { text }, shareMediaCategory: 'NONE' };
  } else {
    throw new Error(`${e.id} has unknown kind ${e.kind}.`);
  }
  return {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: { 'com.linkedin.ugc.ShareContent': share },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };
}

function utf8Bytes(s) {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Inline button data `approve:<id>` / `skip:<id>`; throws past Telegram's 64-byte limit. */
export function callbackData(action, id) {
  const data = `${action}:${id}`;
  if (utf8Bytes(data) > CALLBACK_MAX_BYTES) throw new Error(`callback data for ${id} exceeds ${CALLBACK_MAX_BYTES} bytes; shorten the id.`);
  return data;
}

export function parseCallback(data) {
  const m = /^(approve|skip):(.+)$/.exec(String(data ?? ''));
  return m ? { mode: m[1], id: m[2] } : null;
}

/** `/run`, `/reoffer <id>`, `/help`; `@botname` suffixes allowed. Plain text is ignored. */
export function parseCommand(text) {
  const m = /^\/([a-z]+)(?:@\S+)?(?:\s+(\S+))?\s*$/i.exec(String(text ?? '').trim());
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  if (cmd === 'run') return { mode: 'run' };
  if (cmd === 'reoffer' && m[2]) return { mode: 'reoffer', id: m[2] };
  return { mode: 'help' };
}

/** A Telegram update from the configured chat, as a request; anything else is null (ignored). */
export function routeUpdate(update, chatId) {
  const q = update.callback_query;
  if (q) {
    if (String(q.message?.chat?.id) !== String(chatId)) return null;
    const cb = parseCallback(q.data);
    return cb ? { ...cb, queryId: q.id } : null;
  }
  const msg = update.message;
  if (!msg || String(msg.chat?.id) !== String(chatId)) return null;
  return parseCommand(msg.text);
}

export function dateIn(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Settings from n8n variables or environment variables, through `get(name)`.
 * DRY_RUN defaults to true: only the exact value `false` posts for real.
 * SCHEDULER_TODAY (YYYY-MM-DD) pretends today is another date, in dry runs only.
 */
export function readConfig(get, now = new Date()) {
  const val = (name) => String(get(name) ?? '').trim();
  const dryRun = val('DRY_RUN').toLowerCase() !== 'false';
  const chatId = val('TELEGRAM_CHAT_ID');
  if (!/^-?\d+$/.test(chatId)) throw new Error('TELEGRAM_CHAT_ID is not set: add it as an n8n variable or environment variable.');
  const override = val('SCHEDULER_TODAY');
  const today = dryRun && /^\d{4}-\d{2}-\d{2}$/.test(override) ? override : dateIn(TIME_ZONE, now);
  return { dryRun, chatId, authorUrn: val('LINKEDIN_AUTHOR_URN'), today };
}

/** Dry runs keep their own record and offers, so they never block or fake a live post. */
export function stateFor(staticData, dryRun) {
  const key = dryRun ? 'dryRun' : 'live';
  if (!staticData[key] || typeof staticData[key] !== 'object') staticData[key] = {};
  const s = staticData[key];
  if (!Array.isArray(s.record)) s.record = [];
  if (!s.offered || typeof s.offered !== 'object') s.offered = {};
  return s;
}

export function recordEntry(id, status, postUrn, now) {
  return { id, network: NETWORK, postedAt: now.toISOString(), postUrn: postUrn ?? null, status };
}

function truncate(text, max) {
  const note = '\n… (truncated here; the full copy is what gets posted)';
  return text.length <= max ? text : text.slice(0, max - note.length) + note;
}

export function offerText(entry, dryRun) {
  const e = normaliseEntry(entry);
  const lines = [
    `${dryRun ? 'DRY RUN: ' : ''}Approve this LinkedIn post for ${e.date}?`,
    `${e.kind === 'article' ? 'Article' : 'Standalone post'} ${e.id}: ${e.title}`,
  ];
  if (e.url) lines.push(e.url);
  if (e.pillar) lines.push(`Pillar: ${e.pillar}`);
  lines.push('', e.social?.linkedin ?? '', '', `Short copy: ${e.social?.short ?? ''}`);
  return truncate(lines.join('\n'), TELEGRAM_MAX_CHARS);
}

const HELP = 'Commands: /run offers today\'s posts that were not offered yet. /reoffer <id> offers one item again (skipped, or offered and not answered).';

/**
 * One run of the Scheduler. `request.mode` is daily | run | reoffer | approve | skip | help.
 * Mutates `state` ({ record, offered }) and returns the actions for the workflow to carry out:
 * ack (answer the button), offer (prompt with Approve / Skip), notify (plain message),
 * dryrun (log the payload and report it), post (call LinkedIn).
 */
export function decide({ request, config, feed, feedError, state, now }) {
  const out = [];
  const chatId = config.chatId;
  const say = (text) => truncate(`${config.dryRun ? 'DRY RUN: ' : ''}${text}`, TELEGRAM_MAX_CHARS);
  const notify = (text) => out.push({ action: 'notify', chatId, text: say(text) });
  const offer = (e) => {
    state.offered[e.id] = now.toISOString();
    out.push({
      action: 'offer',
      chatId,
      id: e.id,
      text: offerText(e, config.dryRun),
      approveData: callbackData('approve', e.id),
      skipData: callbackData('skip', e.id),
    });
  };
  if (request.queryId) {
    const ack = request.mode === 'skip' ? 'Skipping' : config.dryRun ? 'Dry run' : 'Posting';
    out.push({ action: 'ack', queryId: request.queryId, text: ack });
  }
  if (request.mode === 'help') {
    notify(HELP);
    return out;
  }
  if (feedError) {
    notify(`Could not read the social feed: ${feedError}`);
    return out;
  }
  const id = request.id;
  if (request.mode === 'daily' || request.mode === 'run') {
    const entries = selectToOffer(feed, config.today, state);
    entries.forEach(offer);
    if (entries.length === 0 && request.mode === 'run') notify(`Nothing new to offer for ${config.today}.`);
  } else if (request.mode === 'reoffer') {
    const row = recordFor(state.record, id);
    if (row && row.status === 'posted' && !config.dryRun) {
      notify(`${id} was posted ${row.postedAt} (${row.postUrn}); it is not offered again.`);
      return out;
    }
    const found = findForPosting(feed, id, config.today, state.record.filter((r) => r.id !== id));
    if (found.error) {
      notify(found.error);
      return out;
    }
    state.record = state.record.filter((r) => r.id !== id);
    delete state.offered[id];
    offer(found.entry);
  } else if (request.mode === 'skip') {
    const row = recordFor(state.record, id);
    if (row) {
      notify(`${id} is already ${row.status}.`);
      return out;
    }
    state.record.push(recordEntry(id, 'skipped', null, now));
    notify(`Skipped ${id}. It will not be offered again; /reoffer ${id} brings it back.`);
  } else if (request.mode === 'approve') {
    const found = findForPosting(feed, id, config.today, state.record);
    if (found.error) {
      notify(found.error);
      return out;
    }
    let payload;
    try {
      payload = buildLinkedInPayload(found.entry, config.authorUrn);
    } catch (err) {
      notify(err.message);
      return out;
    }
    if (config.dryRun) {
      state.record.push(recordEntry(id, 'posted', null, now));
      const headers = Object.entries(LINKEDIN_HEADERS).map(([k, v]) => `${k}: ${v}`).join('\n');
      out.push({
        action: 'dryrun',
        chatId,
        id,
        payload,
        text: say(`would POST ${LINKEDIN_UGC_URL}\n${headers}\n\n${JSON.stringify(payload, null, 2)}`),
      });
    } else {
      out.push({ action: 'post', chatId, id, payload });
    }
  }
  return out;
}

function parseBody(body) {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** After the LinkedIn call: on 2xx record the post; otherwise report status and a body excerpt, record nothing. */
export function recordPostResult({ state, id, chatId, response, now }) {
  const status = Number(response.statusCode ?? 0);
  const body = parseBody(response.body);
  if (status >= 200 && status < 300) {
    const headers = response.headers ?? {};
    const urn = (body && typeof body === 'object' && body.id) || headers['x-restli-id'] || null;
    if (!recordFor(state.record, id)) state.record.push(recordEntry(id, 'posted', urn, now));
    const link = urn ? `\nhttps://www.linkedin.com/feed/update/${urn}/` : '';
    return { action: 'notify', chatId, text: `Posted ${id} to LinkedIn: ${urn ?? '(no id returned)'}${link}` };
  }
  const detail = response.error ? String(response.error.message ?? response.error) : typeof body === 'string' ? body : JSON.stringify(body ?? null);
  return {
    action: 'notify',
    chatId,
    text: `LinkedIn answered HTTP ${status || 'error'} for ${id}; nothing recorded, tap Approve again to retry.\n${detail.slice(0, 500)}`,
  };
}
