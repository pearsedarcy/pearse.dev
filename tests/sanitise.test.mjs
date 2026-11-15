// The shared sanitiser helper (#250). It is what the other suites use to strip HTML, decode
// entities and judge hosts, so it gets the corner cases CodeQL's rules are about.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, hostOf, isHost, isHostOrSubdomain, hasUrl, mentionsHost, parseUrl, stripTags, textOf } from './lib/sanitise.mjs';

test('decodeEntities decodes each entity once: a double-encoded one keeps its second layer', () => {
  assert.equal(decodeEntities('&amp;lt;b&amp;gt;'), '&lt;b&gt;');
  assert.equal(decodeEntities('&amp;#38;'), '&#38;');
  assert.equal(decodeEntities('&amp;amp;'), '&amp;');
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x26; &#38;'), 'a & b <c> "d" \'e\' & &');
});

test('decodeEntities leaves what it does not know alone', () => {
  assert.equal(decodeEntities('&bogus; &#0; &#xD800; &#1114112; &amp'), '&bogus; &#0; &#xD800; &#1114112; &amp');
});

test('stripTags returns text, drops script and style bodies and decodes once', () => {
  assert.equal(stripTags('<p>One <b>two</b></p><style>p{color:red}</style><script>x<y</script>').replace(/\s+/g, ' ').trim(), 'One two');
  assert.equal(textOf('<h2>What <em>it</em>\n does</h2>'), 'What it does');
  assert.equal(stripTags('<b>a</b><i>b</i>', '').trim(), 'ab');
  assert.equal(stripTags('<b>a</b><i>b</i>').replace(/\s+/g, ' ').trim(), 'a b');
});

test('stripTags returns text: an encoded tag stays characters and is decoded last, once', () => {
  assert.equal(textOf('&lt;b&gt;bold&lt;/b&gt;'), '<b>bold</b>');
  assert.equal(textOf('<p>&amp;lt;b&amp;gt;</p>'), '&lt;b&gt;');
  // a stray `<` that opens no tag is text, and the real tags around it are gone
  assert.equal(textOf('<p>1 < 2 <b>and</b> 3 > 2</p>'), '1 < 2 and 3 > 2');
});

test('isHost compares the parsed hostname, never a substring', () => {
  assert.equal(isHost('https://github.com/pearsedarcy', 'github.com'), true);
  assert.equal(isHost('HTTPS://GitHub.com:443/x', 'github.com'), true);
  for (const lookalike of [
    'https://evil-github.com/',
    'https://github.com.evil/',
    'https://github.com.evil.com/',
    'https://notgithub.com/',
    'https://evil.com/?u=https://github.com/',
    'https://evil.com/github.com',
    'https://github.com@evil.com/',
    'https://evil.com#github.com',
    'mailto:me@github.com',
    '/relative/github.com',
    'github.com',
  ]) {
    assert.equal(isHost(lookalike, 'github.com'), false, lookalike);
  }
});

test('isHostOrSubdomain accepts a real subdomain and still refuses look-alikes', () => {
  assert.equal(isHostOrSubdomain('https://gist.github.com/x', 'github.com'), true);
  assert.equal(isHostOrSubdomain('https://github.com/x', 'github.com'), true);
  for (const lookalike of ['https://evil-github.com/', 'https://github.com.evil/', 'https://xgithub.com/']) {
    assert.equal(isHostOrSubdomain(lookalike, 'github.com'), false, lookalike);
  }
});

test('mentionsHost finds a host in free text and refuses look-alikes', () => {
  assert.equal(mentionsHost('fetch("https://avatars.githubusercontent.com/u/1")', 'avatars.githubusercontent.com'), true);
  assert.equal(mentionsHost('a.b{background:url(//cdn.github.com/x.png)}', 'github.com'), true);
  assert.equal(mentionsHost('see evil-github.com and github.com.evil and notgithub.com', 'github.com'), false);
  assert.equal(mentionsHost('no hosts here', 'github.com'), false);
});

test('parseUrl and hostOf return undefined, not a throw, on what does not parse', () => {
  assert.equal(parseUrl('http://'), undefined);
  assert.equal(hostOf('not a url'), undefined);
  assert.equal(hostOf('https://Pearse.Dev/x'), 'pearse.dev');
  assert.equal(parseUrl('/x', 'https://pearse.dev').href, 'https://pearse.dev/x');
});

test('hasUrl finds the whole URL as a token and refuses prefixes and look-alikes', () => {
  const url = 'https://example.test/owner/repo/actions/runs/777';
  assert.equal(hasUrl(`Run: ${url}\nEvent: schedule`, url), true);
  assert.equal(hasUrl(`gh issue close 12 --comment "see ${url}"`, url), true);
  assert.equal(hasUrl(`closed by (${url}).`, url), true);
  assert.equal(hasUrl('Run: https://example.test/owner/repo/actions/runs/7770', url), false);
  assert.equal(hasUrl('Run: https://example.test.evil/owner/repo/actions/runs/777', url), false);
  assert.equal(hasUrl(`${url}x`, url), false);
  assert.equal(hasUrl('no url here', url), false);
  assert.equal(hasUrl(url, 'not a url'), false);
});
