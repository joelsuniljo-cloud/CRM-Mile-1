// Offline checks for the parts that are easy to get subtly wrong. Run: npm test
import assert from 'node:assert/strict';
import { deepMerge } from '../lib/merge.js';
import { parseLoose } from '../lib/ai.js';
import { isPrivateIp, extract, readSite, SiteError } from '../lib/fetchsite.js';

// merge: objects merge, arrays replace, null is stored, __delete__ removes
assert.deepEqual(
  deepMerge({ a: { x: 1, y: 2 }, list: [1, 2], gone: 1 }, { a: { y: 3 }, list: [9], gone: { __delete__: true }, n: null }),
  { a: { x: 1, y: 3 }, list: [9], n: null }
);
assert.equal(deepMerge({}, JSON.parse('{"__proto__":{"polluted":true}}')).polluted, undefined);

// tolerant JSON
assert.deepEqual(parseLoose('{"a":1}'), { a: 1 });
assert.deepEqual(parseLoose('Here you go:\n```json\n{"a":2}\n```'), { a: 2 });
assert.deepEqual(parseLoose('Sure. {"a":3} Hope that helps'), { a: 3 });
assert.throws(() => parseLoose('no json here'), { code: 'invalid_json' });

// private address guard
for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '100.64.0.1']) {
  assert.equal(isPrivateIp(ip), true, ip);
}
for (const ip of ['8.8.8.8', '151.101.1.1', '2606:4700:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);

// extraction
const html = `<html><head><title>Northfield Dental</title><meta name="description" content="Quality dental care"></head>
<body><nav><a href="/about">About</a><a href="/blog">Blog</a></nav>
<main><h1>Quality dental care for the whole family</h1><p>Book today.</p>
<form><input type="email" name="email"></form><a href="https://instagram.com/nf">IG</a></main>
<script>var x=1</script></body></html>`;
const e = extract(html, 'https://northfield.example/');
assert.equal(e.title, 'Northfield Dental');
assert.ok(e.headings[0].startsWith('H1: Quality dental care'));
assert.ok(e.signals.some((s) => s.includes('Email signup form on page: yes')));
assert.ok(e.signals.some((s) => s.includes('instagram')));
assert.ok(!e.body.includes('var x'));
assert.ok(e.pages.some((p) => p.href.endsWith('/blog')));

// SSRF: private and local targets are refused before any request is made
for (const url of ['http://127.0.0.1', 'http://localhost', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'ftp://example.com', 'http://example.com:8080']) {
  await assert.rejects(() => readSite(url), SiteError, url);
}

console.log('selftest passed');
