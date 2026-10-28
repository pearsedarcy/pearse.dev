// GitHub integration (issue #45): the pure shaping of API responses into the view model,
// the snapshot fallback of loadGithub with an injected fetch, and the rendered home-page
// section. The dist/ assertions rely on `npm test`'s pretest build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HIDDEN_REPOS, loadGithub, shapeAvatar, shapeCalendar, shapeGithub, shapeRepos } from '../src/lib/github.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);

const repo = (name, pushed, extra = {}) => ({
  name,
  private: false,
  fork: false,
  owner: { login: 'pearsedarcy' },
  description: `${name} desc`,
  language: 'Python',
  stargazers_count: 1,
  pushed_at: `${pushed}T10:00:00Z`,
  ...extra,
});

const USER = {
  login: 'pearsedarcy',
  name: "Pearse D'Arcy",
  bio: ' Engineer. ',
  avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
  public_repos: 22,
  followers: 2,
};

const RAW_CAL = {
  totalContributions: 7,
  weeks: [
    { contributionDays: [{ date: '2026-10-25', contributionCount: 0, contributionLevel: 'NONE' }] },
    {
      contributionDays: [
        { date: '2026-10-26', contributionCount: 3, contributionLevel: 'SECOND_QUARTILE' },
        { date: '2026-10-27', contributionCount: 4, contributionLevel: 'FOURTH_QUARTILE' },
      ],
    },
    { contributionDays: [] },
  ],
};

// ---- shaping ---------------------------------------------------------------

test('shapeRepos keeps own public non-fork repos, newest push first, at most six', () => {
  const raw = [
    repo('old', '2024-01-01'),
    repo('secret', '2026-10-01', { private: true }),
    repo('forked', '2026-10-02', { fork: true }),
    repo('org-repo', '2026-10-03', { owner: { login: 'MTS-Wetlabs' } }),
    ...HIDDEN_REPOS.map((n) => repo(n, '2026-10-04')),
    repo('a', '2026-09-01'),
    repo('b', '2026-09-05'),
    repo('c', '2026-08-01'),
    repo('d', '2026-07-01'),
    repo('e', '2026-06-01'),
    repo('f', '2026-05-01'),
  ];
  const out = shapeRepos(raw);
  assert.deepEqual(
    out.map((r) => r.name),
    ['b', 'a', 'c', 'd', 'e', 'f'],
  );
  for (const r of out) assert.equal(r.url, `https://github.com/pearsedarcy/${r.name}`);
  assert.deepEqual(out[0], {
    name: 'b',
    url: 'https://github.com/pearsedarcy/b',
    description: 'b desc',
    language: 'Python',
    stars: 1,
    pushed: '2026-09-05',
  });
});

test('shapeRepos normalises empty description and language to null', () => {
  const [r] = shapeRepos([repo('x', '2026-01-01', { description: '  ', language: null, stargazers_count: undefined })]);
  assert.equal(r.description, null);
  assert.equal(r.language, null);
  assert.equal(r.stars, 0);
});

test('shapeAvatar only accepts GitHub avatars and sizes them', () => {
  assert.equal(shapeAvatar('https://avatars.githubusercontent.com/u/1?v=4'), 'https://avatars.githubusercontent.com/u/1?v=4&s=160');
  assert.equal(shapeAvatar('https://evil.example/a.png'), null);
  assert.equal(shapeAvatar('http://avatars.githubusercontent.com/u/1'), null);
  assert.equal(shapeAvatar(null), null);
});

test('shapeCalendar maps levels and drops empty weeks', () => {
  const cal = shapeCalendar(RAW_CAL);
  assert.equal(cal.total, 7);
  assert.equal(cal.weeks.length, 2);
  assert.deepEqual(cal.weeks[1], [
    { date: '2026-10-26', count: 3, level: 2 },
    { date: '2026-10-27', count: 4, level: 4 },
  ]);
});

test('shapeGithub builds the view with a github.com profile URL', () => {
  const v = shapeGithub({ user: USER, repos: [repo('a', '2026-01-01')], calendar: null }, new Date('2026-10-28T12:00:00Z'));
  assert.equal(v.url, 'https://github.com/pearsedarcy');
  assert.equal(v.bio, 'Engineer.');
  assert.equal(v.publicRepos, 22);
  assert.equal(v.followers, 2);
  assert.equal(v.asOf, '2026-10-28');
  assert.equal(v.repos.length, 1);
});

// ---- fetch and fallback ----------------------------------------------------

function tmpSnapshot(view) {
  const dir = mkdtempSync(join(tmpdir(), 'gh-'));
  const path = join(dir, 'github.json');
  if (view) writeFileSync(path, JSON.stringify(view));
  return { dir, path };
}

const SNAP = shapeGithub(
  { user: { ...USER, followers: 1 }, repos: [repo('snap', '2025-01-01')], calendar: shapeCalendar(RAW_CAL) },
  new Date('2026-01-01T00:00:00Z'),
);

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch({ rest = true, graphql = true } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, auth: init.headers?.Authorization });
    if (!rest) throw new TypeError('fetch failed');
    if (url.endsWith('/graphql')) {
      if (!graphql) return json({ message: 'Bad credentials' }, 401);
      return json({ data: { user: { contributionsCollection: { contributionCalendar: { ...RAW_CAL, totalContributions: 99 } } } } });
    }
    if (url.includes('/repos')) return json([repo('live', '2026-10-01'), repo('hidden', '2026-10-02', { private: true })]);
    return json(USER);
  };
  return { f, calls };
}

const quiet = () => {
  const lines = [];
  return { lines, log: (m) => lines.push(`log ${m}`), warn: (m) => lines.push(`warn ${m}`) };
};

test('loadGithub: no network falls back to the snapshot and warns', async () => {
  const { dir, path } = tmpSnapshot(SNAP);
  const q = quiet();
  try {
    const r = await loadGithub({ snapshotPath: path, token: 't', fetch: fakeFetch({ rest: false }).f, ...q });
    assert.equal(r.source, 'snapshot');
    assert.deepEqual(r.view, SNAP);
    assert.match(q.lines.join('\n'), /^warn using snapshot from 2026-01-01: network: fetch failed$/m);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), SNAP, 'snapshot untouched');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadGithub: offline skips the network entirely', async () => {
  const { dir, path } = tmpSnapshot(SNAP);
  const { f, calls } = fakeFetch();
  try {
    const r = await loadGithub({ snapshotPath: path, offline: true, fetch: f, ...quiet() });
    assert.equal(r.source, 'snapshot');
    assert.equal(calls.length, 0);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadGithub: live fetch with a token shapes everything and writes the snapshot', async () => {
  const { dir, path } = tmpSnapshot(SNAP);
  const { f, calls } = fakeFetch();
  const q = quiet();
  try {
    const r = await loadGithub({ snapshotPath: path, token: 'tok', fetch: f, now: new Date('2026-10-28T00:00:00Z'), ...q });
    assert.equal(r.source, 'live');
    assert.deepEqual(
      r.view.repos.map((x) => x.name),
      ['live'],
    );
    assert.equal(r.view.calendar.total, 99);
    assert.ok(calls.every((c) => c.auth === 'Bearer tok'));
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), r.view);
    assert.match(q.lines.join('\n'), /^log live: 1 repos, 99 contributions$/m);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadGithub: without a token the calendar comes from the snapshot', async () => {
  const { dir, path } = tmpSnapshot(SNAP);
  const { f, calls } = fakeFetch();
  const q = quiet();
  try {
    const r = await loadGithub({ snapshotPath: path, fetch: f, ...q });
    assert.equal(r.source, 'partial');
    assert.equal(r.view.repos[0].name, 'live');
    assert.deepEqual(r.view.calendar, SNAP.calendar);
    assert.ok(!calls.some((c) => c.url.endsWith('/graphql')), 'no GraphQL call without a token');
    assert.ok(calls.every((c) => c.auth === undefined));
    assert.match(q.lines.join('\n'), /^warn contribution calendar from snapshot of 2026-01-01: no GITHUB_TOKEN/m);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadGithub: a failing GraphQL call keeps the snapshot calendar', async () => {
  const { dir, path } = tmpSnapshot(SNAP);
  try {
    const r = await loadGithub({ snapshotPath: path, token: 'bad', fetch: fakeFetch({ graphql: false }).f, ...quiet() });
    assert.equal(r.source, 'partial');
    assert.match(r.reason, /HTTP 401/);
    assert.deepEqual(r.view.calendar, SNAP.calendar);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('loadGithub: no network and no snapshot is a hard error', async () => {
  const { dir, path } = tmpSnapshot(null);
  try {
    await assert.rejects(loadGithub({ snapshotPath: path, fetch: fakeFetch({ rest: false }).f, ...quiet() }), /no snapshot/);
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// ---- committed snapshot and build ------------------------------------------

test('committed snapshot is complete enough to render the section offline', () => {
  const v = JSON.parse(readFileSync('src/data/github.json', 'utf8'));
  assert.equal(v.login, 'pearsedarcy');
  assert.equal(v.repos.length, 6);
  assert.ok(v.calendar?.weeks.length >= 52, 'calendar present');
});

test('home page has the GitHub section: profile, heatmap and six repos, all linking to github.com', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  const start = html.indexOf('<section id="github"');
  assert.ok(start > -1, 'section#github missing');
  const section = html.slice(start, html.indexOf('</section>', start));

  assert.match(section, /<svg[^>]*class="heatmap"[^>]*role="img"/);
  assert.match(section, /<title id="gh-heatmap-title">[\d,]+ GitHub contributions in the year to /);
  assert.ok((section.match(/<rect /g) ?? []).length >= 360, 'heatmap cells');
  assert.doesNotMatch(section, /<script/);

  const repos = section.slice(section.indexOf('class="gh-repos"'));
  assert.equal((repos.match(/<li/g) ?? []).length, 6, 'six repos');

  const hrefs = [...section.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 8, 'profile links plus six repos');
  for (const h of hrefs) assert.match(h, /^https:\/\/github\.com\/pearsedarcy(\/[\w.-]+)?$/, h);
  assert.ok(hrefs.includes('https://github.com/pearsedarcy'), 'profile link');
  for (const n of HIDDEN_REPOS) assert.ok(!hrefs.includes(`https://github.com/pearsedarcy/${n}`), n);
});

test('heatmap labels stay >= 8px at phone width: the calendar scrolls instead of shrinking (issue #58)', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  const start = html.indexOf('<section id="github"');
  const section = html.slice(start, html.indexOf('</section>', start));

  // Keyboard-reachable, labelled scroll region around the SVG.
  assert.match(section, /<div class="gh-scroll" tabindex="0" role="region" aria-label="[^"]+"[^>]*>\s*<svg[^>]*class="heatmap"/);

  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  assert.match(css, /\.gh-scroll[^{]*\{[^}]*overflow-x:\s*auto/, 'scroll container');
  const minRem = Number(css.match(/\.heatmap\{[^}]*min-width:\s*([\d.]+)rem/)?.[1]);
  const fontPx = Number(css.match(/\.hm-text\{[^}]*font-size:\s*([\d.]+)px/)?.[1]);
  assert.ok(minRem > 0 && fontPx > 0, `min-width ${minRem}rem, label ${fontPx}px`);

  // A 390px viewport leaves ~343px, well under the floor, so the floor sets the scale.
  const floorPx = minRem * 16;
  assert.ok(floorPx > 343);
  const viewBoxW = Number(section.match(/class="heatmap" viewBox="0 0 ([\d.]+) /)?.[1]);
  const worstW = 30 + 54 * 13 - 3; // a 54-week calendar
  for (const w of [viewBoxW, worstW]) {
    const rendered = (fontPx * floorPx) / w;
    assert.ok(rendered >= 8, `labels render at ${rendered.toFixed(2)}px for viewBox width ${w}`);
  }
});
