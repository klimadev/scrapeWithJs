#!/usr/bin/env node
const fs = require('fs');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const { fetch } = require('undici');

class UndiciResourceLoader extends ResourceLoader {
  constructor(opts = {}) {
    super();
    this.diagnose = !!opts.diagnose;
  }
  async fetch(url, options) {
    try {
      if (this.diagnose) console.log('[ResourceLoader] fetch', url);
      const res = await fetch(url, {
        method: options && options.method ? options.method : 'GET',
        headers: options && options.headers ? options.headers : undefined,
      });
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      if (this.diagnose) console.error('[ResourceLoader] fetch error', url, err && err.message);
      return null;
    }
  }
}

function waitForQuiescence(window, opts = {}) {
  const { timeout = 10000, quiet = 500 } = opts;
  return new Promise((resolve) => {
    let lastChange = Date.now();
    const obs = new window.MutationObserver(() => {
      lastChange = Date.now();
    });
    obs.observe(window.document, { childList: true, subtree: true, attributes: true, characterData: true });

    function check() {
      const now = Date.now();
      if (now - lastChange >= quiet) {
        obs.disconnect();
        resolve();
      } else if (now - start >= timeout) {
        obs.disconnect();
        resolve();
      } else {
        setTimeout(check, 100);
      }
    }

    const start = Date.now();
    if (window.document.readyState === 'complete') {
      setTimeout(check, quiet);
    } else {
      window.addEventListener('load', () => setTimeout(check, 50));
      setTimeout(check, 100);
    }
  });
}

async function renderWithJsdom(url, opts = {}) {
  const virtualConsole = new VirtualConsole();
  if (opts && opts.diagnose) {
    virtualConsole.sendTo(console);
  } else {
    virtualConsole.sendTo(console, { omitJSDOMErrors: true });
  }

  const res = await fetch(url);
  const html = await res.text();

  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    resources: new UndiciResourceLoader({ diagnose: !!opts.diagnose }),
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      // Inject lightweight polyfills and diagnostics before page scripts run
      try {
        // fetch shim that logs
        window.fetch = async function(input, init) {
          try {
            if (opts && opts.diagnose) console.log('[page fetch]', input);
            const r = await fetch(input, init);
            const buf = await r.arrayBuffer();
            const body = Buffer.from(buf);
            const headers = {};
            r.headers && r.headers.forEach && r.headers.forEach((v, k) => (headers[k] = v));
            return {
              ok: r.status >= 200 && r.status < 300,
              status: r.status,
              text: async () => body.toString('utf8'),
              json: async () => JSON.parse(body.toString('utf8')),
              arrayBuffer: async () => buf,
              headers,
            };
          } catch (e) {
            if (opts && opts.diagnose) console.error('[page fetch] error', input, e && e.message);
            throw e;
          }
        };

        // XHR logging
        try {
          const XHRProto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
          if (XHRProto) {
            const _open = XHRProto.open;
            XHRProto.open = function(method, url) {
              this._diagUrl = url;
              return _open.apply(this, arguments);
            };
            const _send = XHRProto.send;
            XHRProto.send = function() {
              try { if (opts && opts.diagnose) console.log('[page XHR]', this._diagUrl); } catch(e){}
              return _send.apply(this, arguments);
            };
          }
        } catch (e) {}

        // IntersectionObserver polyfill (fires immediately)
        window.IntersectionObserver = function(cb) {
          this.observe = function(el) {
            try { cb([{ target: el, isIntersecting: true, intersectionRatio: 1 }]); } catch(e){}
          };
          this.unobserve = function() {};
          this.disconnect = function() {};
        };

        // requestAnimationFrame stub
        window.requestAnimationFrame = function(cb) { return setTimeout(() => cb(Date.now()), 16); };
        window.cancelAnimationFrame = function(id) { clearTimeout(id); };

        // Minimal localStorage/sessionStorage if missing
        if (!window.localStorage) {
          window.localStorage = (function(){
            const store = {};
            return { getItem:k=>store[k]||null, setItem:(k,v)=>store[k]=String(v), removeItem:k=>delete store[k], clear:()=>{Object.keys(store).forEach(k=>delete store[k])} };
          })();
        }

      } catch (e) {
        if (opts && opts.diagnose) console.error('[beforeParse] polyfill error', e && e.message);
      }
    }
  });


  // If diagnose mode, add additional runtime instrumentation and interaction simulation
  if (opts && opts.diagnose) {
    try {
      // Additional page-level fetch logging (if not already set by beforeParse)
      try {
        if (!dom.window.fetch || dom.window.fetch.name === 'fetch') {
          dom.window.fetch = async function(input, init) {
            if (opts.diagnose) console.log('[page fetch - post] ', input);
            const r = await fetch(input, init);
            const buf = await r.arrayBuffer();
            const body = Buffer.from(buf);
            const headers = {};
            r.headers && r.headers.forEach && r.headers.forEach((v, k) => (headers[k] = v));
            return {
              ok: r.status >= 200 && r.status < 300,
              status: r.status,
              text: async () => body.toString('utf8'),
              json: async () => JSON.parse(body.toString('utf8')),
              arrayBuffer: async () => buf,
              headers,
            };
          };
        }
      } catch(e){}

      // simulate interactions after load
      dom.window.addEventListener('load', () => {
        try {
          // dispatch a few scroll events to trigger infinite-scroll handlers
          const doScroll = (n=3, delay=300) => {
            let i=0;
            const tick = () => {
              dom.window.scrollTo(0, dom.window.document.body.scrollHeight);
              dom.window.dispatchEvent(new dom.window.Event('scroll'));
              i++; if (i<n) setTimeout(tick, delay);
            };
            setTimeout(tick, 100);
          };
          doScroll(4, 250);

          // try clicking typical load-more buttons
          setTimeout(() => {
            const btn = dom.window.document.querySelector('.load-more, [data-load-more], .btn-load-more');
            if (btn) {
              try { btn.click(); if (opts.diagnose) console.log('[diagnose] clicked load-more button'); } catch(e){}
            }
          }, 500);
        } catch(e) { if (opts.diagnose) console.error('[diagnose] interaction error', e && e.message); }
      });
    } catch (e) { /* swallow */ }
  }

  const maxWait = opts.timeout || 10000;
  const idleTime = opts.quiet || 500;

  await waitForQuiescence(dom.window, { timeout: maxWait, quiet: idleTime });

  const finalHtml = dom.serialize();
  try { dom.window.close(); } catch (e) {}
  return finalHtml;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('Usage: node scrape.js <url> [--out filename] [--timeout ms]');
    process.exit(2);
  }
  const url = argv[0];
  let out = null;
  let timeout = 10000;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i+1]) { out = argv[i+1]; i++; }
    else if (argv[i] === '--timeout' && argv[i+1]) { timeout = parseInt(argv[i+1], 10); i++; }
  }

  try {
    const html = await renderWithJsdom(url, { timeout });
    if (out) {
      fs.writeFileSync(out, html, 'utf8');
      console.log('Saved to', out);
    } else {
      process.stdout.write(html);
    }
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

if (require.main === module) main();
