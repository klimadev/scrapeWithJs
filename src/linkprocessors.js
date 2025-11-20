const { retryFetch, UndiciResourceLoader, waitForQuiescence, applyJsdomPolyfills, defaultHeaders, VirtualConsole } = require('./utils');
const { convertToLlmReadyMarkdown } = require('./converters');

/**
 * Extract and filter links from HTML content
 */
function extractFilteredLinks(html, baseUrl) {
  const dom = baseUrl ? new (require('./utils').JSDOM)(html, { url: baseUrl }) : new (require('./utils').JSDOM)(html);
  const document = dom.window.document;
  const links = document.querySelectorAll('a[href]');
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico'];
  const imageMimeTypes = ['image/'];
  const filteredLinks = [];

  links.forEach(link => {
    const href = link.getAttribute('href');
    if (!href) return;
    if (!href.trim() || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('#')) {
      return;
    }
    const hrefLower = href.toLowerCase();
    const isImage = imageExtensions.some(ext => hrefLower.endsWith(ext)) ||
                   imageMimeTypes.some(mime => hrefLower.includes(mime));
    if (!isImage) {
      try {
        const resolverBase = baseUrl || document.baseURI || undefined;
        const absoluteUrl = resolverBase ? new URL(href, resolverBase).href : new URL(href, document.baseURI).href;
        filteredLinks.push(absoluteUrl);
      } catch (e) {}
    }
  });

  try { extractMarkdownLinks(html, baseUrl, filteredLinks); } catch(e){}

  function extractMarkdownLinks(content, baseUrl, existing) {
    const mdLinkRegex = /\[[^\]]*\]\(([^)]+)\)/g;
    let m;
    while ((m = mdLinkRegex.exec(content)) !== null) {
      const href = m[1];
      if (!href) continue;
      const hrefTrim = href.trim();
      if (!hrefTrim || hrefTrim.startsWith('javascript:') || hrefTrim.startsWith('mailto:') || hrefTrim.startsWith('#')) continue;
      try {
        if (!baseUrl) continue;
        const absoluteUrl = new URL(hrefTrim, baseUrl).href;
        if (!existing.includes(absoluteUrl)) existing.push(absoluteUrl);
      } catch (e) {}
    }
  }

  return filteredLinks;
}

/**
 * Resolve markdown links
 */
function resolveMarkdownLinks(markdown, baseUrl) {
  if (!baseUrl || !markdown) return markdown;
  const mdLinkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  return markdown.replace(mdLinkRegex, (match, text, href) => {
    const hrefTrim = href.trim();
    if (!hrefTrim || hrefTrim.startsWith('javascript:') || hrefTrim.startsWith('mailto:') || hrefTrim.startsWith('#')) return match;
    try {
      const maybe = new URL(hrefTrim, baseUrl);
      return `[${text}](${maybe.href})`;
    } catch (e) {
      return match;
    }
  });
}

/**
 * Render a URL with jsdom and extract body as markdown
 */
async function renderLinkAndExtractMarkdown(url, opts = {}) {
  const virtualConsole = (opts.diagnose ? (new VirtualConsole()).sendTo(console) : (new VirtualConsole()).sendTo(console, { omitJSDOMErrors: true }));
  const fetchOpts = { headers: defaultHeaders, ...opts.fetchOpts };

  try {
    const res = await retryFetch(url, fetchOpts);
    const html = await res.text();

    try {
      const simpleDom = new (require('./utils').JSDOM)(html);
      const body = simpleDom.window.document.body;
      if (body) {
        const bodyHtml = body.innerHTML;
        const simpleMarkdown = convertToLlmReadyMarkdown(bodyHtml);
        if (simpleMarkdown && simpleMarkdown.length > 100) {
          simpleDom.window.close && simpleDom.window.close();
          return simpleMarkdown;
        }
      }
    } catch (simpleError) {}

    const JSDOM = require('./utils').JSDOM;
    const dom = new JSDOM(html, {
      url,
      runScripts: 'dangerously',
      resources: new UndiciResourceLoader(fetchOpts),
      pretendToBeVisual: true,
      virtualConsole,
      beforeParse(window) {
        applyJsdomPolyfills(window, { fetchOpts });
      }
    });

    const maxWait = Math.min(opts.timeout || 10000, 15000);
    const idle = opts.quiet || 500;

    try {
      dom.window.addEventListener && dom.window.addEventListener('load', () => {
        try {
          dom.window.scrollTo && dom.window.scrollTo(0, dom.window.document.body.scrollHeight);
          dom.window.dispatchEvent(new dom.window.Event('scroll'));
        } catch(e){}
        setTimeout(()=>{ try{ const btn = dom.window.document.querySelector('.load-more, [data-load-more], .btn-load-more'); if(btn) btn.click(); }catch(e){} }, 300);
      });
    } catch(e){}

    try { await waitForQuiescence(dom.window, { timeout: maxWait, quiet: idle }); } catch(e){}

    try {
      const networkIdleMs = 1000;
      const networkMaxWait = 5000;
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
    } catch(e){}

    let bodyHtml = '';
    try {
      const body = dom.window.document.body;
      bodyHtml = body ? body.innerHTML : dom.window.document.documentElement.innerHTML;
    } catch(e) {
      try {
        bodyHtml = dom.window.document.documentElement.innerHTML;
      } catch(e2) {
        bodyHtml = html;
      }
    }

    dom.window.close && dom.window.close();
    const markdown = convertToLlmReadyMarkdown(bodyHtml);

    if (opts.diagnose) {
      console.log(`[renderLinks] Processed ${url}, markdown length: ${markdown.length}`);
    }

    return markdown;

  } catch (error) {
    if (opts.diagnose) {
      console.log(`[renderLinks] Failed to process ${url}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Process links from content
 */
async function processLinksFromContent(html, opts = {}) {
  if (!opts.renderLinks) {
    let md = convertToLlmReadyMarkdown(html);
    if (opts.baseUrl) md = resolveMarkdownLinks(md, opts.baseUrl);
    return md;
  }

  let baseMarkdown = convertToLlmReadyMarkdown(html);
  if (opts.baseUrl) baseMarkdown = resolveMarkdownLinks(baseMarkdown, opts.baseUrl);
  let linkContent = '';

  try {
    const links = extractFilteredLinks(html, opts.baseUrl);

    if (links.length === 0) {
      return baseMarkdown;
    }

    const maxLinks = opts.maxLinks || 10;
    const linkTimeout = opts.linkTimeout || 15000;
    const processedLinks = links.slice(0, maxLinks);

    for (let i = 0; i < processedLinks.length; i++) {
      const url = processedLinks[i];

      if (opts.diagnose) {
        console.log(`[renderLinks] Processing link ${i + 1}/${processedLinks.length}: ${url}`);
      }

      try {
        const linkMarkdown = await renderLinkAndExtractMarkdown(url, {
          ...opts,
          timeout: linkTimeout
        });

        linkContent += `\n\n---\n\n### Linked Content ${i + 1}: ${url}\n\n${linkMarkdown}`;

      } catch (error) {
        if (opts.diagnose) {
          console.log(`[renderLinks] Skipping failed link ${url}: ${error.message}`);
        }
        linkContent += `\n\n---\n\n### Linked Content ${i + 1}: ${url}\n\n[Failed to load: ${error.message}]`;
      }
    }

  } catch (error) {
    if (opts.diagnose) {
      console.log(`[renderLinks] Error extracting links: ${error.message}`);
    }
  }

  return baseMarkdown + linkContent;
}

module.exports = {
  extractFilteredLinks,
  renderLinkAndExtractMarkdown,
  processLinksFromContent,
  resolveMarkdownLinks
};
