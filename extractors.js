/**
 * Enhanced Duplicate Remover for HTML Content
 * Removes duplicate elements within "Linked Content" sections while maintaining proper associations
 */

class DuplicateRemover {
  constructor() {
    this.duplicatePatterns = [
      // Photo duplicates pattern (same photo URLs appearing multiple times)
      /(!\[Foto \d+\]\(https:\/\/imgserver\.autocarro\.com\.br\/fotos\/grande\/[^)]+\))/g,
      // Year and price duplicates (same year/price appearing consecutively)
      /(202[0-9]\s*\n\s*R\$\s*[\d.,]+\s*\n)/g,
      // Basic element duplicates (same content repeated)
      /([^\n]+)\s*\n\s*\1\s*\n/g
    ];
  }

  /**
   * Main function to remove duplicates from HTML content
   * @param {string} htmlContent - The HTML content to process
   * @returns {string} - Cleaned HTML content without duplicates
   */
  removeDuplicates(htmlContent) {
    let cleanedContent = htmlContent;

    // Split content into sections based on fragments
    const sections = this.splitIntoSections(cleanedContent);
    
    // Process each section
    const processedSections = sections.map(section => {
      return this.processSection(section);
    });

    return processedSections.join('\n');
  }

  /**
   * Split content into sections based on fragments
   * @param {string} content - Full HTML content
   * @returns {Array<string>} - Array of sections
   */
  splitIntoSections(content) {
    const fragmentPattern = /<!-- FRAGMENTO \d+ \|/g;
    const sections = [];
    let lastIndex = 0;
    let match;

    // Find all fragment positions
    while ((match = fragmentPattern.exec(content)) !== null) {
      if (match.index > lastIndex) {
        sections.push(content.substring(lastIndex, match.index));
      }
      lastIndex = match.index;
    }

    // Add the last section
    if (lastIndex < content.length) {
      sections.push(content.substring(lastIndex));
    }

    return sections.filter(section => section.trim().length > 0);
  }

  /**
   * Process individual section to remove duplicates
   * @param {string} section - Individual section content
   * @returns {string} - Processed section
   */
  processSection(section) {
    let processed = section;

    // Remove duplicate photo sequences
    processed = this.removeDuplicatePhotos(processed);

    // Remove duplicate year/price entries
    processed = this.removeDuplicateYearPrice(processed);

    // Remove all duplicate lines
    processed = this.removeAllDuplicateLines(processed);

    return processed.trim();
  }

  /**
   * Remove duplicate photo sequences
   * @param {string} content - Section content
   * @returns {string} - Content with duplicate photos removed
   */
  removeDuplicatePhotos(content) {
    const lines = content.split('\n');
    const processedLines = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();
      
      // Check if this is a photo line
      if (line.startsWith('![') && line.includes('imgserver.autocarro.com.br')) {
        // Found a photo line, look for the sequence end
        const photoLines = [];
        const startIndex = i;
        
        // Collect consecutive photo lines
        while (i < lines.length && lines[i].trim().startsWith('![') && lines[i].trim().includes('imgserver.autocarro.com.br')) {
          photoLines.push(lines[i]);
          i++;
        }
        
        // Remove duplicates from photo sequence
        const uniquePhotos = this.removeDuplicateArrayItems(photoLines);
        processedLines.push(...uniquePhotos);
        
        // Continue processing after photo sequence
        continue;
      }
      
      processedLines.push(lines[i]);
      i++;
    }

    return processedLines.join('\n');
  }

  /**
   * Remove duplicate year/price entries
   * @param {string} content - Section content
   * @returns {string} - Content with duplicate year/price removed
   */
  removeDuplicateYearPrice(content) {
    const lines = content.split('\n');
    const processedLines = [];
    let skipNext = false;

    for (let i = 0; i < lines.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }

      const currentLine = lines[i].trim();
      const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
      
      // Check for year followed by price pattern
      if (/^20\d{2}\s*$/.test(currentLine) && 
          nextLine.startsWith('R$') && 
          nextLine.includes(',')) {
        // Check if this pattern repeats immediately
        const followingLine = lines[i + 2] ? lines[i + 2].trim() : '';
        const followingLine2 = lines[i + 3] ? lines[i + 3].trim() : '';
        
        if (followingLine === currentLine && 
            followingLine2.startsWith('R$') && 
            followingLine2.includes(',')) {
          // Skip the duplicate year/price
          skipNext = true;
        }
      }
      
      processedLines.push(lines[i]);
    }

    return processedLines.join('\n');
  }

  /**
   * Remove all duplicate lines within the section
   * @param {string} content - Section content
   * @returns {string} - Content with all duplicate lines removed
   */
  removeAllDuplicateLines(content) {
    const lines = content.split('\n');
    const seen = new Set();
    const processedLines = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!seen.has(trimmedLine)) {
        seen.add(trimmedLine);
        processedLines.push(line);
      }
    }

    return processedLines.join('\n');
  }

  /**
   * Remove duplicate items from array
   * @param {Array<string>} array - Array of strings
   * @returns {Array<string>} - Array with duplicates removed (preserving order)
   */
  removeDuplicateArrayItems(array) {
    const seen = new Set();
    const unique = [];

    for (const item of array) {
      const normalized = item.trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        unique.push(item);
      }
    }

    return unique;
  }
}

// Global instance for use throughout the module
const duplicateRemover = new DuplicateRemover();

const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const { fetch, Agent } = require('undici');
const TurndownService = require('turndown');

/**
 * Converte um fragmento HTML em Markdown formatado para ser mais limpo e amigável a LLMs.
 * Remove atributos e elementos irrelevantes para a compreensão do conteúdo.
 * @param {string} html O HTML a ser convertido.
 * @returns {string} O conteúdo em Markdown.
 */
function convertToLlmReadyMarkdown(html) {
  // Inicializa Turndown com configurações para LLM-readiness
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    hr: '---'
  });

// Regra 1: Remover todos os links (tags <a>) e manter apenas o texto
// Links geralmente não são úteis para extração de conteúdo e poluem o Markdown
//td.addRule('remove-links', {
//  filter: ['a'],
//  replacement: function (content) {
//    return content;
//  }
// });

  // Regra 2: Remover elementos comuns de navegação e rodapé se aparecerem (embora a extração radial deve limitar isso)
  td.remove('nav');
  td.remove('footer');

  // Regra 3: Remover elementos com classes comuns de placeholder ou visual
  td.addRule('visual-cleanup', {
      filter: (node, options) => {
          const classList = (node.className || '').split(' ');
          const unwantedClasses = ['skip-content', 'sr-only', 'hidden', 'visually-hidden', 'icon', 'svg'];
          return unwantedClasses.some(cls => classList.includes(cls));
      },
      replacement: () => ''
  });

  td.addRule('fix-space', {
      filter: (node) => {
          return node.nodeType === 1 && ["SPAN", "B", "EM", "STRONG"].includes(node.nodeName);
      },
      replacement: (content) => {
        return content.trim() + ' ';
      }
  });

  // Convert to markdown first
  let markdown = td.turndown(html);
  
  // Remove large JSON blocks and technical data
  // Remove Next.js JSON props blocks
  markdown = markdown.replace(/\{[\s\S]*?"props"[\s\S]*?\}/g, '');
  // Remove Next.js SSR data
  markdown = markdown.replace(/\{[\s\S]*?"__N_SSP"[\s\S]*?\}/g, '');
  // Remove build data
  markdown = markdown.replace(/\{[\s\S]*?"buildId"[\s\S]*?\}/g, '');
  // Remove script configurations
  markdown = markdown.replace(/\{[\s\S]*?"scripts"[\s\S]*?\}/g, '');
  // Remove analytics data
  markdown = markdown.replace(/\{[\s\S]*?"gtag"[\s\S]*?\}/g, '');
  // Remove page data
  markdown = markdown.replace(/\{[\s\S]*?"page"[\s\S]*?\}/g, '');
  // Remove query data
  markdown = markdown.replace(/\{[\s\S]*?"query"[\s\S]*?\}/g, '');
  // Remove gsp data
  markdown = markdown.replace(/\{[\s\S]*?"gssp"[\s\S]*?\}/g, '');
  // Remove scriptLoader data
  markdown = markdown.replace(/\{[\s\S]*?"scriptLoader"[\s\S]*?\}/g, '');
  // Remove isFallback data
  markdown = markdown.replace(/\{[\s\S]*?"isFallback"[\s\S]*?\}/g, '');
  // Remove isExperimentalCompile data
  markdown = markdown.replace(/\{[\s\S]*?"isExperimentalCompile"[\s\S]*?\}/g, '');
  
  // Remove script tags completely
  markdown = markdown.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  
  // Remove window global variables with JSON data
  markdown = markdown.replace(/window\.__[A-Z_]+[\s]*=[\s]*\{[^}]*\}/g, '');
  markdown = markdown.replace(/__INITIAL_STATE__[\s]*=[\s]*\{[^}]*\}/g, '');
  // Remove window global variables with JSON data
  markdown = markdown.replace(/window\.__[A-Z_]+[\s]*=[\s]*\{[^}]*\}/g, '');
  markdown = markdown.replace(/__INITIAL_STATE__[\s]*=[\s]*\{[^}]*\}/g, '');
  
  // Clean up linked content duplicates and clutter using comprehensive duplicate remover
  // Apply comprehensive duplicate removal to the markdown content
  markdown = duplicateRemover.removeDuplicates(markdown);
  
  // Additional specific cleanups for remaining patterns
  // Remove unnecessary navigation and branding
  markdown = markdown.replace(/\[\!\[\]\([^)]*logo[^)]*\)\]\([^)]*\)\s*\n\s*### MAGNAUTOS MULTIMARCAS.*?(?=\n\n|\n\[\])/gs, '');
  // Remove "Enviar Proposta" and similar clutter
  markdown = markdown.replace(/Enviar Proposta\s*\n\s*,/g, '');
  // Remove navigation elements
  markdown = markdown.replace(/\[\[!\]\([^)]*image[^)]*\)\]\([^)]*Home[^)]*\)\s*\n\s*\[Estoque\]\([^)]*\)/g, '');
  // Clean excessive whitespace and trim
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
  
  return markdown;
}

/**
 * Remove atributos e conteúdo interno de todos os elementos SVG dentro de um elemento.
 * Isso é feito para reduzir o tamanho do HTML extraído, pois SVGs são frequentemente grandes e inúteis para a extração de dados.
 * @param {Element} element O elemento DOM a ser limpo.
 */
function cleanSvgContent(element) {
  if (!element || typeof element.querySelectorAll !== 'function') return;

  const svgs = element.querySelectorAll('svg');
  svgs.forEach(svg => {
    // 1. Remover todos os atributos, exceto 'xmlns'
    const attributes = Array.from(svg.attributes);
    attributes.forEach(attr => {
      if (attr.name !== 'xmlns') {
        svg.removeAttribute(attr.name);
      }
    });

    // 2. Remover todos os filhos
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
  });
}

function performRadialSearch(document, term, opts = {}) {
  const results = [];
  const minRepeat = opts.minRepeat || 2;
  const radiusLevels = opts.radiusLevels || 3;
  const lowerTerm = term.toLowerCase();

  // 1. Encontrar todos os nós de texto que mencionam o termo
  function findTextNodes(node) {
    const nodes = [];
    if (node.nodeType === 1) {
      const tagName = node.tagName.toUpperCase();
      if (tagName === 'SCRIPT' || tagName === 'STYLE') {
        return nodes; // Skip script and style tags entirely
      }
      for (const child of node.childNodes) {
        nodes.push(...findTextNodes(child));
      }
    } else if (node.nodeType === 3 && node.textContent.toLowerCase().includes(lowerTerm)) {
      nodes.push(node);
    }
    return nodes;
  }

  const textNodes = findTextNodes(document.body);

  // 2. Para cada nó, subir na árvore até encontrar container repetido ou significativo
  for (const textNode of textNodes) {
    let el = textNode.parentElement;
    let best = el;
    let repeatCount = 1; // Repetition is ignored, but kept for compatibility

    // Ascend 'radiusLevels' times to capture context
    for (let i = 0; i < radiusLevels && el; i++) {
      const parent = el.parentElement;
      if (parent && parent.tagName !== 'BODY' && parent.tagName !== 'HTML') {
        el = parent;
        best = el; // 'best' is the highest ancestor found so far
      } else {
        break;
      }
    }

    // 3. Extrair HTML do container (o elemento 'best' é o ancestral encontrado)
    if (best && best.outerHTML) {
      // Limpa o conteúdo de SVGs para reduzir o tamanho do fragmento
      cleanSvgContent(best);

      // The selector is based on the extracted element.
      const contextSelector = best.className ? `.${best.className.split(' ').join('.')}` : best.tagName;

      results.push({
        html: best.outerHTML,
        selector: contextSelector,
        repeatCount: 1, // Always 1 since repetition is ignored
        method: 'fixed_radial',
        term
      });
    }
  }

  // 4. Se nada encontrado, retorna vazio
  return results;
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
 * Retry fetch function with exponential backoff
 */
async function retryFetch(url, opts = {}, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, opts);
      if (res.status >= 200 && res.status < 500) {
        return res;
      }
      throw new Error(`HTTP status ${res.status}`);
    } catch (e) {
      if (attempt === maxRetries - 1) throw e;
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/**
 * Wait for DOM to reach quiescence
 */
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

/**
 * Extract and filter links from HTML content
 * @param {string} html The HTML content to extract links from
 * @returns {Array} Array of filtered URLs (non-image links)
 */
function extractFilteredLinks(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const links = document.querySelectorAll('a[href]');
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico'];
  const imageMimeTypes = ['image/'];
  
  const filteredLinks = [];
  
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (!href) return;
    
    // Skip empty or javascript: links
    if (!href.trim() || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('#')) {
      return;
    }
    
    // Check if it's an image file
    const hrefLower = href.toLowerCase();
    const isImage = imageExtensions.some(ext => hrefLower.endsWith(ext)) ||
                   imageMimeTypes.some(mime => hrefLower.includes(mime));
    
    if (!isImage) {
      try {
        // Resolve relative URLs to absolute URLs
        const absoluteUrl = new URL(href, document.baseURI).href;
        filteredLinks.push(absoluteUrl);
      } catch (e) {
        // Skip invalid URLs
      }
    }
  });
  
  return filteredLinks;
}

/**
 * Render a URL with full jsdom loading and extract BODY content as markdown
 * @param {string} url The URL to process
 * @param {Object} opts Options for rendering (timeout, headers, etc.)
 * @returns {Promise<string>} Markdown content of the rendered page
 */
async function renderLinkAndExtractMarkdown(url, opts = {}) {
  const virtualConsole = new VirtualConsole();
  if (opts.diagnose) {
    virtualConsole.sendTo(console);
  } else {
    virtualConsole.sendTo(console, { omitJSDOMErrors: true });
  }

  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };
  const fetchOpts = { headers: defaultHeaders, ...opts.fetchOpts };

  try {
    const res = await retryFetch(url, fetchOpts);
    const html = await res.text();

    // First try simple DOM parsing for better reliability
    try {
      const simpleDom = new JSDOM(html);
      const body = simpleDom.window.document.body;
      if (body) {
        const bodyHtml = body.innerHTML;
        const simpleMarkdown = convertToLlmReadyMarkdown(bodyHtml);
        
        // If simple extraction produces reasonable content, use it
        if (simpleMarkdown && simpleMarkdown.length > 100) {
          try { simpleDom.window.close(); } catch(e){}
          if (opts.diagnose) {
            console.log(`[renderLinks] Used simple extraction for ${url}`);
          }
          return simpleMarkdown;
        }
      }
    } catch (simpleError) {
      if (opts.diagnose) {
        console.log(`[renderLinks] Simple extraction failed for ${url}, trying full JSDOM: ${simpleError.message}`);
      }
    }

    // If simple extraction fails, try full JSDOM with enhanced error handling
    const dom = new JSDOM(html, {
      url,
      runScripts: 'dangerously',
      resources: new UndiciResourceLoader(fetchOpts),
      pretendToBeVisual: true,
      virtualConsole,
      beforeParse(window) {
        // Add comprehensive polyfills and error suppression
        try {
          // Basic polyfills
          if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
          if (!window.cancelAnimationFrame) window.cancelAnimationFrame = (id) => clearTimeout(id);
          
          // Enhanced scrollTo with error suppression
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
          
          // IntersectionObserver polyfill
          if (!window.IntersectionObserver) window.IntersectionObserver = function(cb){
            this.observe = (el)=>{ try{ cb([{target:el,isIntersecting:true,intersectionRatio:1}]); }catch(e){} };
            this.unobserve=()=>{}; this.disconnect=()=>{};
          };
          
          // Image polyfill
          if (!window.Image) window.Image = function(){
            return { set src(v){}, set onload(v){}, set onerror(v){}, set width(v){}, set height(v){} };
          };
          
          // LocalStorage polyfill
          if (!window.localStorage) window.localStorage = (function(){
            const s={};
            return {
              getItem:k=>s[k]||null,
              setItem:(k,v)=>s[k]=String(v),
              removeItem:k=>delete s[k],
              clear:()=>{Object.keys(s).forEach(k=>delete s[k])}
            };
          })();
          
          // Track pending requests
          window.__pendingRequests = 0;
          window.__incPending = function(){ window.__pendingRequests = (window.__pendingRequests || 0) + 1; };
          window.__decPending = function(){ window.__pendingRequests = Math.max(0, (window.__pendingRequests || 1) - 1); };
          
          // Enhanced fetch polyfill with error suppression
          const _origFetch = fetch;
          window.fetch = async function(input, init){
            try{ window.__incPending(); }catch(e){}
            try {
              const r = await _origFetch(input, { ...init, ...fetchOpts });
              const b = await r.arrayBuffer();
              const body = Buffer.from(b);
              return {
                ok: r.status>=200&&r.status<300,
                status: r.status,
                text: async ()=>body.toString('utf8'),
                json: async ()=>JSON.parse(body.toString('utf8')),
                arrayBuffer: async ()=>b,
                headers: {}
              };
            } finally {
              try{ window.__decPending(); }catch(e){}
            }
          };

          // Suppress common framework errors by adding addEventListener to all objects
          const originalAddEventListener = window.EventTarget.prototype.addEventListener;
          window.EventTarget.prototype.addEventListener = function(type, listener, options) {
            try {
              return originalAddEventListener.call(this, type, listener, options);
            } catch (e) {
              if (opts.diagnose) {
                console.log(`[renderLinks] Suppressed addEventListener error for ${type}`);
              }
              return;
            }
          };

        } catch(e){
          // Suppress beforeParse errors
        }
      }
    });

    const maxWait = Math.min(opts.timeout || 10000, 15000); // Cap at 15s
    const idle = opts.quiet || 500;
    
    // Basic interactions with error suppression
    try {
      dom.window.addEventListener && dom.window.addEventListener('load', () => {
        try {
          dom.window.scrollTo && dom.window.scrollTo(0, dom.window.document.body.scrollHeight);
          dom.window.dispatchEvent(new dom.window.Event('scroll'));
        } catch(e){}
        setTimeout(()=>{
          try{
            const btn = dom.window.document.querySelector('.load-more, [data-load-more], .btn-load-more');
            if(btn) btn.click();
          } catch(e){}
        }, 300);
      });
    } catch(e){}
    
    try {
      await waitForQuiescence(dom.window, { timeout: maxWait, quiet: idle });
    } catch(e) {
      // Continue even if quiescence fails
    }

    // Wait for network idle with shorter timeout
    try {
      const networkIdleMs = 1000; // Reduced from 2000ms
      const networkMaxWait = 5000; // Reduced from 30000ms
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
    } catch(e) {
      // Continue even if network idle wait fails
    }

    // Extract BODY content with enhanced error handling
    let bodyHtml = '';
    try {
      const body = dom.window.document.body;
      bodyHtml = body ? body.innerHTML : dom.window.document.documentElement.innerHTML;
    } catch(e) {
      // Fallback to extracting from document
      try {
        bodyHtml = dom.window.document.documentElement.innerHTML;
      } catch(e2) {
        // Last resort: use original HTML
        bodyHtml = html;
      }
    }
    
    try { dom.window.close(); } catch(e){}
    
    // Convert to markdown
    const markdown = convertToLlmReadyMarkdown(bodyHtml);
    
    if (opts.diagnose) {
      console.log(`[renderLinks] Successfully processed ${url}, markdown length: ${markdown.length}`);
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
 * Process links from HTML content with full rendering and markdown extraction
 * @param {string} html The HTML content to extract links from
 * @param {Object} opts Options including renderLinks, timeout, diagnose, etc.
 * @returns {Promise<string>} Original content plus linked content as markdown
 */
async function processLinksFromContent(html, opts = {}) {
  if (!opts.renderLinks) {
    return convertToLlmReadyMarkdown(html);
  }
  
  const baseMarkdown = convertToLlmReadyMarkdown(html);
  let linkContent = '';
  
  try {
    const links = extractFilteredLinks(html);
    
    if (links.length === 0) {
      return baseMarkdown;
    }
    
    const maxLinks = opts.maxLinks || 10; // Prevent too many requests
    const linkTimeout = opts.linkTimeout || 15000; // 15s per link
    
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
  performRadialSearch,
  convertToLlmReadyMarkdown,
  extractFilteredLinks,
  renderLinkAndExtractMarkdown,
  processLinksFromContent,
  duplicateRemover
};