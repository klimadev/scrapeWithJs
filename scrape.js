#!/usr/bin/env node
/*
  scrape_universal.js
  Pipeline:
   1) simple fetch and return HTML
   2) jsdom render (execute JS) with polyfills and interaction simulation
  
  Usage:
    node scrape_universal.js <url> [--out file] [--timeout ms] [--diagnose]
*/

const fs = require('fs');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const { fetch, Agent } = require('undici');

async function retryFetch(url, opts = {}, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, opts);
      // Treat 5xx errors as transient failures, but allow 4xx and 2xx to pass
      if (res.status >= 200 && res.status < 500) {
        return res;
      }
      throw new Error(`HTTP status ${res.status}`);
    } catch (e) {
      if (attempt === maxRetries - 1) throw e;
      const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s...
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function simpleFetch(url, timeout = 10000, opts = {}) {
  const defaultHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
  const res = await retryFetch(url, { keepalive: false, bodyTimeout: timeout, headers: defaultHeaders, ...opts });
  return await res.text();
}

class UndiciResourceLoader extends ResourceLoader {
  constructor(fetchOpts = {}) {
    super();
    this.fetchOpts = fetchOpts;
  }

  async fetch(url) {
    try {
      const res = await retryFetch(url, this.fetchOpts);
      const buf = await res.arrayBuffer();
      return Buffer.from(buf);
    } catch (e) {
      return null;
    }
  }
}

function waitForQuiescence(window, opts = {}) {
  const { timeout = 10000, quiet = 500 } = opts;
  return new Promise((resolve) => {
    let lastChange = Date.now();
    const obs = new window.MutationObserver(() => { lastChange = Date.now(); });
    obs.observe(window.document, { childList: true, subtree: true, attributes: true, characterData: true });

    function check() {
      const now = Date.now();
      if (now - lastChange >= quiet) { obs.disconnect(); resolve(); }
      else if (now - start >= timeout) { obs.disconnect(); resolve(); }
      else setTimeout(check, 100);
    }

    const start = Date.now();
    if (window.document.readyState === 'complete') setTimeout(check, quiet);
    else { window.addEventListener('load', () => setTimeout(check, 50)); setTimeout(check, 100); }
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) { console.error('Usage: node scrape_universal.js <url> [--out file] [--timeout ms] [--force-browser] [--diagnose] [--render-links] [--max-links N] [--link-timeout ms]'); process.exit(2); }
  const url = argv[0];
  let out = null; let timeout = 10000; let forceBrowser = false; let diagnose = false;
  let radial = false; let term = null; let radiusLevels = 3; let minRepeat = 2;
  let insecure = false; let renderLinks = false; let maxLinks = 10; let linkTimeout = 15000;
  for (let i=1;i<argv.length;i++){
    if (argv[i]==='--out' && argv[i+1]){ out=argv[i+1]; i++; }
    else if (argv[i]==='--timeout' && argv[i+1]){ timeout = parseInt(argv[i+1],10); i++; }
    else if (argv[i]==='--force-browser') forceBrowser = true;
    else if (argv[i]==='--diagnose') diagnose = true;
    else if (argv[i]==='--radial') radial = true;
    else if (argv[i]==='--term' && argv[i+1]){ term = argv[i+1]; i++; }
    else if (argv[i]==='--radius-levels' && argv[i+1]){ radiusLevels = parseInt(argv[i+1],10); i++; }
    else if (argv[i]==='--min-repeat' && argv[i+1]){ minRepeat = parseInt(argv[i+1],10); i++; }
    else if (argv[i]==='--insecure') insecure = true;
    else if (argv[i]==='--render-links') renderLinks = true;
    else if (argv[i]==='--max-links' && argv[i+1]){ maxLinks = parseInt(argv[i+1],10); i++; }
    else if (argv[i]==='--link-timeout' && argv[i+1]){ linkTimeout = parseInt(argv[i+1],10); i++; }
  }

  const defaultHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
  let fetchOpts = { headers: defaultHeaders };
  if (insecure) {
    const agent = new Agent({ connect: { rejectUnauthorized: false } });
    fetchOpts = { ...fetchOpts, dispatcher: agent };
  }

  try {
    const { performRadialSearch, convertToLlmReadyMarkdown, processLinksFromContent } = require('./extractors');
    if (!forceBrowser) {
      // 1) try simple fetch
      try {
        const simple = await simpleFetch(url, timeout, fetchOpts);
        if (!needBrowserFallback(simple)) {
          if (out) fs.writeFileSync(out, simple, 'utf8'); else process.stdout.write(simple);
          return;
        }
      } catch(e) { if (diagnose) console.error('[universal] simple fetch failed', e && e.message); }

      // 2) try jsdom render
      try {
        const res = await retryFetch(url, fetchOpts);
        const html = await res.text();
        const dom = new JSDOM(html, {
          url,
          runScripts: 'dangerously',
          resources: new UndiciResourceLoader(fetchOpts),
          pretendToBeVisual: true,
          virtualConsole: (diagnose ? (new VirtualConsole()).sendTo(console) : (new VirtualConsole()).sendTo(console, { omitJSDOMErrors: true })),
          beforeParse: function(window) {
            // light polyfills useful for many dynamic sites
            try {
              if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
              if (!window.cancelAnimationFrame) window.cancelAnimationFrame = (id) => clearTimeout(id);
              // window.scrollTo may be present but unimplemented in JSDOM (throws). Overwrite with a noop that dispatches scroll
              window.scrollTo = function(x, y) {
                try {
                  if (typeof x === 'object' && x !== null) {
                    y = x.top || x.y || 0;
                  }
                  if (window.document && window.document.documentElement) {
                    try { window.document.documentElement.scrollTop = y || 0; } catch (e) {}
                    try { window.document.body && (window.document.body.scrollTop = y || 0); } catch (e) {}
                  }
                  try { window.dispatchEvent(new window.Event('scroll')); } catch (e) {}
                } catch (e) {}
              };
              if (!window.IntersectionObserver) window.IntersectionObserver = function(cb){ this.observe = (el)=>{ try{ cb([{target:el,isIntersecting:true,intersectionRatio:1}]); }catch(e){} }; this.unobserve=()=>{}; this.disconnect=()=>{}; };
              if (!window.Image) window.Image = function(){ return { set src(v){}, set onload(v){}, set onerror(v){}, set width(v){}, set height(v){} }; };
              if (!window.localStorage) window.localStorage = (function(){const s={}; return {getItem:k=>s[k]||null,setItem:(k,v)=>s[k]=String(v),removeItem:k=>delete s[k],clear:()=>{Object.keys(s).forEach(k=>delete s[k])}} })();
              if (!window.matchMedia) window.matchMedia = (query) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} });
              // basic fetch passthrough using undici
              // also track pending requests for network-idle detection
              window.__pendingRequests = 0;
              window.__incPending = function(){ window.__pendingRequests = (window.__pendingRequests || 0) + 1; };
              window.__decPending = function(){ window.__pendingRequests = Math.max(0, (window.__pendingRequests || 1) - 1); };
              const _origFetch = fetch;
              const _fetchOpts = fetchOpts || {};
              window.fetch = async function(input, init){
                try{
                  window.__incPending();
                }catch(e){}
                try {
                  // Resolve relative URLs against the JSDOM URL
                  const resolvedInput = (typeof input === 'string' && input.startsWith('/')) ? new URL(input, dom.window.location.href).href : input;
                  const r = await _origFetch(resolvedInput, { ...init, ..._fetchOpts });
                  const b = await r.arrayBuffer();
                  const body = Buffer.from(b);
                  return { ok: r.status>=200&&r.status<300, status: r.status, text: async ()=>body.toString('utf8'), json: async ()=>JSON.parse(body.toString('utf8')), arrayBuffer: async ()=>b, headers: {} };
                } finally {
                  try{ window.__decPending(); }catch(e){}
                }
              };
              // log XHR requests if diagnose and track pending XHRs
              try {
                const proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
                if (proto) {
                  const _open = proto.open;
                  proto.open = function(m,u){ this._url=u; return _open.apply(this, arguments); };
                  const _send = proto.send;
                  proto.send = function(){ try{ if (diagnose) console.log('[page XHR]', this._url); try{ window.__incPending(); }catch(e){} }catch(e){} const onreadystatechange = this.onreadystatechange; this.onreadystatechange = function(){ try{ if(this.readyState===4){ try{ window.__decPending(); }catch(e){} } }catch(e){} if(onreadystatechange) return onreadystatechange.apply(this, arguments); }; return _send.apply(this, arguments); };
                }
              } catch(e){}
            } catch(e){}
          }
        });

        // ...existing code de simulação de interação, quiescência, network idle...
        const maxWait = timeout;
        const idle = 500;
        dom.window.addEventListener && dom.window.addEventListener('load', () => {
          try { dom.window.scrollTo && dom.window.scrollTo(0, dom.window.document.body.scrollHeight); dom.window.dispatchEvent(new dom.window.Event('scroll')); } catch(e){}
          setTimeout(()=>{ try{ const btn = dom.window.document.querySelector('.load-more, [data-load-more], .btn-load-more'); if(btn) btn.click(); }catch(e){} }, 300);
        });
        await waitForQuiescence(dom.window, { timeout: maxWait, quiet: idle });
        // network idle
        const networkIdleMs = 2000;
        const networkMaxWait = 30000;
        const startNet = Date.now();
        function pending() { try { return dom.window.__pendingRequests || 0 } catch(e){ return 0 } }
        let lastZero = pending() === 0 ? Date.now() : 0;
        while (Date.now() - startNet < networkMaxWait) {
          if (pending() === 0) {
            if (lastZero === 0) lastZero = Date.now();
            if (Date.now() - lastZero >= networkIdleMs) break;
          } else {
            lastZero = 0;
          }
          await new Promise(r => setTimeout(r, 200));
        }

        // NEW: Improved output logic
        if (out && radial && term) {
          // NEW: Enhanced radial search with organized linked content
          const results = performRadialSearch(dom.window.document, term, { radiusLevels, minRepeat });
          if (results.length === 0) {
            fs.writeFileSync(out, '<!-- Nenhum fragmento encontrado -->', 'utf8');
          } else {
            // Process each fragment with its linked content
            const fragmentOutputs = [];
            
            for (let i = 0; i < results.length; i++) {
              const r = results[i];
              
              // Start with base fragment
              let fragmentContent = `<!-- FRAGMENTO ${i+1} | SELETOR: ${r.selector} | MÉTODO: ${r.method} | TERMO: ${r.term} -->\n`;
              fragmentContent += convertToLlmReadyMarkdown(r.html);
              
              // If renderLinks enabled, add linked content for this fragment
              if (renderLinks) {
                try {
                  const linksPerFragment = Math.max(1, Math.floor(maxLinks / results.length));
                  const linkProcessingOptions = {
                    renderLinks: true,
                    maxLinks: linksPerFragment,
                    linkTimeout: linkTimeout,
                    diagnose: diagnose,
                    fetchOpts: fetchOpts
                  };
                  
                  const fragmentWithLinks = await processLinksFromContent(r.html, linkProcessingOptions);
                  
                  // Extract only the linked content (skip the base content that's already included)
                  const baseContent = convertToLlmReadyMarkdown(r.html);
                  if (fragmentWithLinks.length > baseContent.length) {
                    const linkedContent = fragmentWithLinks.substring(baseContent.length);
                    fragmentContent += `\n\n${linkedContent}`;
                  }
                  
                } catch (error) {
                  if (diagnose) {
                    console.error(`[renderLinks] Error processing links from fragment ${i+1}:`, error.message);
                  }
                }
              }
              
              fragmentOutputs.push(fragmentContent);
            }
            
            const finalOutput = fragmentOutputs.join('\n\n---\n\n');
            fs.writeFileSync(out, finalOutput, 'utf8');
          }
        } else if (renderLinks) {
          // NEW: Improved general link processing
          const html = dom.serialize();
          const linkProcessingOptions = {
            renderLinks: true,
            maxLinks: maxLinks,
            linkTimeout: linkTimeout,
            diagnose: diagnose,
            fetchOpts: fetchOpts
          };
          
          try {
            const contentWithLinks = await processLinksFromContent(html, linkProcessingOptions);
            if (out) fs.writeFileSync(out, contentWithLinks, 'utf8'); else process.stdout.write(contentWithLinks);
          } catch (error) {
            if (diagnose) console.error('[renderLinks] Error processing links:', error.message);
            // Fallback to regular content without links
            const fallbackContent = convertToLlmReadyMarkdown(html);
            if (out) fs.writeFileSync(out, fallbackContent, 'utf8'); else process.stdout.write(fallbackContent);
          }
        } else if (!out) {
          // Output markdown to stdout when no output file is specified and renderLinks is false
          const content = convertToLlmReadyMarkdown(dom.serialize());
          process.stdout.write(content);
        } else {
          // Comportamento padrão: salva HTML completo
          const outHtml = dom.serialize();
          if (out) fs.writeFileSync(out, outHtml, 'utf8'); else process.stdout.write(outHtml);
        }
        try { dom.window.close(); } catch(e){}
        return;
      } catch(e) { if (diagnose) console.error('[universal] jsdom render failed', e && e.message); }
    }

    // as last resort, try simple fetch again and return
    try { const simple2 = await simpleFetch(url, timeout); if (out) fs.writeFileSync(out, simple2, 'utf8'); else process.stdout.write(simple2); } catch(e){ console.error('All methods failed', e && e.message ? e.message : e); process.exit(1);} 
  } catch (err) { console.error('Error:', err && err.message ? err.message : err); process.exit(1); }
}

function needBrowserFallback(html, opts = {}) {
  // Heuristic checks to decide if jsdom result is likely incomplete.
  // 1) If body contains common placeholder URLs only (placeholder.com, via.placeholder)
  // 2) If main item container (e.g. many repeated placeholders) count < threshold
  const doc = html.toLowerCase();
  if (doc.includes('via.placeholder.com') || doc.includes('placeholder.com')) return true;
  // Generic heuristic: if there are elements with class names suggesting 'loading' or 'skeleton'
  if (doc.indexOf('skeleton') !== -1 || doc.indexOf('placeholder') !== -1) return true;
  // If very few repeating item cards (e.g., less than 2 .col-md-4) treat as incomplete
  const matches = html.match(/class=["'][^"']*(col-md-4|vehicle-card|product-card|item-card)[^"']*["']/gi);
  if (!matches || matches.length < 2) return true;
  return false;
}

if (require.main === module) main();