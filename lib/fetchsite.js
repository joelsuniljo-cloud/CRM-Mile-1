// Reads a prospect's public website and returns plain text plus a few content signals.
// Because the URL comes from a form, every request is guarded against SSRF:
// only http(s), only public IPs (checked again at connect time), limited size and time.
import dns from 'node:dns';
import net from 'node:net';
import { fetch, Agent } from 'undici';
import * as cheerio from 'cheerio';

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 9000;
const MAX_REDIRECTS = 4;

export function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v)) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return m ? isPrivateIp(m[1]) : false;
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

const agent = new Agent({
  connect: {
    lookup(hostname, options, cb) {
      dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
        if (err) return cb(err);
        if (addrs.some((a) => isPrivateIp(a.address))) return cb(new Error('blocked address'));
        if (options && options.all) return cb(null, addrs);
        cb(null, addrs[0].address, addrs[0].family);
      });
    },
  },
});

export class SiteError extends Error {}

function parseUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new SiteError('Add a website first.');
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let u;
  try { u = new URL(raw); } catch { throw new SiteError('That does not look like a web address.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new SiteError('Only http and https addresses can be read.');
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivateIp(u.hostname.replace(/^\[|\]$/g, ''))) throw new SiteError('That address is not allowed.');
  if (u.port && !['80', '443'].includes(u.port)) throw new SiteError('Only the standard web ports can be read.');
  return u;
}

async function getHtml(url, hops = 0) {
  const u = parseUrl(url);
  let res;
  try {
    res = await fetch(u, {
      dispatcher: agent,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Mile1OutreachBot/1.0; +https://mile1.in)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
  } catch (e) {
    if (/blocked address/.test(String(e?.cause?.message || e?.message))) throw new SiteError('That address is not allowed.');
    throw new SiteError('Could not reach that website. Check the address, or paste the text yourself.');
  }
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get('location');
    if (!loc || hops >= MAX_REDIRECTS) throw new SiteError('Too many redirects.');
    return getHtml(new URL(loc, u).toString(), hops + 1);
  }
  if (!res.ok) throw new SiteError(`The site answered with status ${res.status}. Some sites block automated readers, so paste the text yourself.`);
  const type = res.headers.get('content-type') || '';
  if (!/html|xml|text/i.test(type)) throw new SiteError('That address did not return a web page.');
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_BYTES) break;
    chunks.push(chunk);
  }
  return { html: Buffer.concat(chunks).toString('utf8'), url: u };
}

const clip = (s, n) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);
const squash = (s) => s.replace(/\s+/g, ' ').trim();

export function extract(html, baseUrl) {
  const $ = cheerio.load(html);
  const out = {};
  out.title = squash($('title').first().text());
  out.description = squash($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '');

  const signals = [];
  const emailForm = $('form input[type="email"], form input[name*="email" i]').length > 0;
  signals.push(`Email signup form on page: ${emailForm ? 'yes' : 'not found'}`);
  const video = $('iframe[src*="youtube"], iframe[src*="vimeo"], video').length;
  signals.push(`Embedded video: ${video ? video + ' found' : 'none found'}`);
  const imgs = $('img').length;
  signals.push(`Images on page: ${imgs}`);
  const ctas = $('a, button').filter((_, el) => /book|get started|contact|quote|buy|shop|sign up|subscribe|demo|call/i.test($(el).text())).length;
  signals.push(`Call-to-action style links or buttons: ${ctas}`);

  const links = new Map();
  $('a[href]').each((_, el) => {
    const text = squash($(el).text());
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return;
    try {
      const abs = new URL(href, baseUrl);
      if (!links.has(abs.href)) links.set(abs.href, text);
    } catch { /* ignore */ }
  });
  const social = [];
  for (const [href] of links) {
    const m = /(instagram|linkedin|facebook|youtube|twitter|x)\.com/i.exec(new URL(href).hostname);
    if (m) social.push(m[1].toLowerCase());
  }
  signals.push(`Social profiles linked: ${[...new Set(social)].join(', ') || 'none found'}`);
  out.signals = signals;

  $('script, style, noscript, svg, iframe, template').remove();
  const nav = [];
  $('nav a, header a').each((_, el) => { const t = squash($(el).text()); if (t && t.length < 40) nav.push(t); });
  out.nav = [...new Set(nav)].slice(0, 20);
  const heads = [];
  $('h1, h2, h3').each((_, el) => { const t = squash($(el).text()); if (t) heads.push(`${el.tagName.toUpperCase()}: ${clip(t, 140)}`); });
  out.headings = heads.slice(0, 25);
  $('nav, header, footer').remove();
  out.body = clip(squash($('main').text() || $('body').text()), 3500);

  const wanted = /about|story|blog|journal|insights|news|case|work|portfolio|customers|pricing/i;
  const pages = [];
  for (const [href, text] of links) {
    try {
      const u = new URL(href);
      if (u.hostname.replace(/^www\./, '') !== new URL(baseUrl).hostname.replace(/^www\./, '')) continue;
      if (wanted.test(u.pathname) || wanted.test(text)) pages.push({ href, text });
    } catch { /* ignore */ }
  }
  out.pages = pages.slice(0, 12);
  return out;
}

function render(label, e) {
  const lines = [`PAGE: ${label}`];
  if (e.title) lines.push(`Title: ${e.title}`);
  if (e.description) lines.push(`Meta description: ${e.description}`);
  if (e.signals) lines.push(...e.signals);
  if (e.nav?.length) lines.push(`Navigation: ${e.nav.join(' | ')}`);
  if (e.headings?.length) lines.push('Headings:', ...e.headings);
  if (e.body) lines.push(`Text: ${e.body}`);
  return lines.join('\n');
}

export async function readSite(input) {
  const first = await getHtml(input);
  const home = extract(first.html, first.url.href);
  const parts = [render(first.url.href, home)];

  // Follow up to two inner pages (about, blog, case studies...) for a fuller picture.
  const seen = new Set([first.url.href]);
  const picks = [];
  for (const kind of [/about|story/i, /blog|journal|insights|news/i, /case|work|portfolio|customers/i]) {
    const hit = home.pages.find((p) => kind.test(p.href) && !seen.has(p.href));
    if (hit) { picks.push(hit); seen.add(hit.href); }
    if (picks.length === 2) break;
  }
  for (const p of picks) {
    try {
      const page = await getHtml(p.href);
      const e = extract(page.html, page.url.href);
      e.nav = []; e.signals = null; e.body = clip(e.body, 1800);
      parts.push(render(page.url.href, e));
    } catch { /* skip pages that fail */ }
  }
  if (home.pages.length) parts.push('Other content pages linked: ' + home.pages.map((p) => `${p.text || '(no label)'} -> ${new URL(p.href).pathname}`).join('; '));
  const text = clip(parts.join('\n\n'), 9000);
  return { text, pages: [first.url.href, ...picks.map((p) => p.href)] };
}
