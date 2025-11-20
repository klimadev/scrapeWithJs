const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const { fetch, Agent } = require('undici');

// Common defaults
const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const defaultConfig = {
  timeout: 10000,
  maxRetries: 3,
  networkIdleMs: 2000,
  networkMaxWait: 30000
};

/**
 * Retry fetch with exponential backoff
 */
async function retryFetch(url, opts = {}, maxRetries = defaultConfig.maxRetries) {
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

/**
 * Resource loader for JSDOM using undici with retry logic
 */
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

/**
 * Wait for DOM quiescence
 */
function waitForQuiescence(window, opts = {}) {
  const { timeout = defaultConfig.timeout, quiet = 500 } = opts;
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

/**
 * Apply common polyfills to jsdom window
 */
function applyJsdomPolyfills(window, opts = {}) {
  const { fetchOpts = {} } = opts;

  if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  if (!window.cancelAnimationFrame) window.cancelAnimationFrame = (id) => clearTimeout(id);

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

  if (!window.IntersectionObserver) window.IntersectionObserver = function(cb){
    this.observe = (el)=>{ try{ cb([{target:el,isIntersecting:true,intersectionRatio:1}]); }catch(e){} };
    this.unobserve=()=>{}; this.disconnect=()=>{};
  };

  if (!window.Image) window.Image = function(){
    return { set src(v){}, set onload(v){}, set onerror(v){}, set width(v){}, set height(v){} };
  };

  if (!window.localStorage) window.localStorage = (function(){
    const s={};
    return {getItem:k=>s[k]||null,setItem:(k,v)=>s[k]=String(v),removeItem:k=>delete s[k],clear:()=>{Object.keys(s).forEach(k=>delete s[k])}};
  })();

  if (!window.matchMedia) window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {}
  });

  // Track pending requests
  window.__pendingRequests = 0;
  window.__incPending = function(){ window.__pendingRequests = (window.__pendingRequests || 0) + 1; };
  window.__decPending = function(){ window.__pendingRequests = Math.max(0, (window.__pendingRequests || 1) - 1); };

  const _origFetch = fetch;
  window.fetch = async function(input, init){
    try{ window.__incPending(); }catch(e){}
    try {
      // Resolve relative URLs against the JSDOM URL
      const resolvedInput = (typeof input === 'string' && input.startsWith('/')) ? new URL(input, window.location.href).href : input;
      const r = await _origFetch(resolvedInput, { ...init, ...fetchOpts });
      const b = await r.arrayBuffer();
      const body = Buffer.from(b);
      return {
        ok: r.status>=200&&r.status<300, status: r.status,
        text: async ()=>body.toString('utf8'),
        json: async ()=>JSON.parse(body.toString('utf8')),
        arrayBuffer: async ()=>b, headers: {}
      };
    } finally {
      try{ window.__decPending(); }catch(e){}
    }
  };

  // Track XHR
  try {
    const proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (proto) {
      const _open = proto.open;
      proto.open = function(m,u){ this._url=u; return _open.apply(this, arguments); };
      const _send = proto.send;
      proto.send = function(){ try{ window.__incPending(); }catch(e){} const onreadystatechange = this.onreadystatechange; this.onreadystatechange = function(){ try{ if(this.readyState===4){ try{ window.__decPending(); }catch(e){} } }catch(e){} if(onreadystatechange) return onreadystatechange.apply(this, arguments); }; return _send.apply(this, arguments); };
    }
  } catch(e){}

  // Suppress addEventListener errors
  const originalAddEventListener = window.EventTarget.prototype.addEventListener;
  window.EventTarget.prototype.addEventListener = function(type, listener, options) {
    try {
      return originalAddEventListener.call(this, type, listener, options);
    } catch (e) {
      return;
    }
  };
}

/**
 * Simple fetch with retry
 */
async function simpleFetch(url, timeout = defaultConfig.timeout, opts = {}) {
  const res = await retryFetch(url, { keepalive: false, bodyTimeout: timeout, headers: defaultHeaders, ...opts });
  return await res.text();
}

module.exports = {
  retryFetch,
  UndiciResourceLoader,
  waitForQuiescence,
  applyJsdomPolyfills,
  simpleFetch,
  defaultHeaders,
  defaultConfig,
  JSDOM: JSDOM,
  ResourceLoader: ResourceLoader,
  VirtualConsole: VirtualConsole
};
