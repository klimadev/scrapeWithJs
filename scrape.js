#!/usr/bin/env node
/*
  scrape.js - Universal JS scraper with JSDOM
  Pipeline: fetch -> render JS -> extract content -> process links
  Usage: node scrape.js <url> --term "search" [--out file]
*/

const fs = require('fs');
const { Agent } = require('undici');
const {
  JSDOM, VirtualConsole, retryFetch, UndiciResourceLoader, waitForQuiescence,
  applyJsdomPolyfills, simpleFetch, convertToLlmReadyMarkdown, defaultHeaders,
  duplicateRemover
} = require('./src');
const { processLinksFromContent, performRadialSearch } = require('./src');

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) { console.error('Usage: node scrape.js <url> --term "search term" --out output.html'); process.exit(2); }
  const url = argv[0];
  let out = null; let term = null;
  // suporte a múltiplos detalhes: armazenamos numa lista. Aceita
  // `--detalhe "a,b"` ou flags repetidas `--detalhe a --detalhe b`.
  let detalheList = [];
  let timeout = 10000; let forceBrowser = false; let diagnose = false;
  let radial = true; let radiusLevels = 3; let minRepeat = 2;
  let insecure = true; let renderLinks = true; let maxLinks = 1; let linkTimeout = 15000;
  for (let i=1;i<argv.length;i++){
    if (argv[i]==='--out' && argv[i+1]){ out=argv[i+1]; i++; }
    else if (argv[i]==='--term' && argv[i+1]){ term = argv[i+1]; i++; }
    else if (argv[i]==='--detalhe' && argv[i+1]){
      const raw = argv[i+1];
      // permitir lista separada por vírgula
      raw.split(',').map(s => s.trim()).filter(Boolean).forEach(s => detalheList.push(s));
      i++;
    }
    // Ignore unknown arguments to allow flexibility
  }
  if (!term) { console.error('Error: --term is required'); process.exit(2); }

  let fetchOpts = { headers: defaultHeaders };
  if (insecure) {
    const agent = new Agent({ connect: { rejectUnauthorized: false } });
    fetchOpts = { ...fetchOpts, dispatcher: agent };
  }

  try {
    if (!forceBrowser) {
      // 1) try simple fetch
      try {
        const simple = await simpleFetch(url, timeout, fetchOpts);
        if (!needBrowserFallback(simple)) {
          const cleaned = duplicateRemover ? duplicateRemover.removeDuplicates(simple) : simple;
          if (out) fs.writeFileSync(out, cleaned, 'utf8'); else process.stdout.write(cleaned);
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
            applyJsdomPolyfills(window, { fetchOpts });
            if (diagnose) {
              window.addEventListener('error', (e) => console.log('[page error]', e.message));
            }
          }
        });

        // Simulate interaction, quiescence, network idle
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

        // Remove scripts dynamically added by JS
        dom.window.document.querySelectorAll('script').forEach(script => script.remove());

        // Determine final output content
        let finalContent = '';

        if (radial && term) {
          const results = performRadialSearch(dom.window.document, term, { radiusLevels, minRepeat });
          const fragmentOutputs = [];

          if (results.length === 0) {
            finalContent = '<!-- Nenhum fragmento encontrado -->';
          } else {
            for (let i = 0; i < results.length; i++) {
              const r = results[i];
              let fragmentContent = `<!-- FRAGMENTO ${i+1} | SELETOR: ${r.selector} | MÉTODO: ${r.method} | TERMO: ${r.term} -->\n`;
              fragmentContent += convertToLlmReadyMarkdown(r.html);

              if (renderLinks) {
                try {
                  const linksPerFragment = Math.max(1, Math.floor(maxLinks / results.length));
                  const linkProcessingOptions = {
                    renderLinks: true,
                    maxLinks: linksPerFragment,
                    linkTimeout: linkTimeout,
                    diagnose: diagnose,
                    fetchOpts: fetchOpts,
                    baseUrl: url
                  };
                  const fragmentWithLinks = await processLinksFromContent(r.html, linkProcessingOptions);
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

              // Aplicar filtro de detalhe (se fornecido)
              if (Array.isArray(detalheList) && detalheList.length > 0) {
                try {
                  const lowerFragment = fragmentContent.toLowerCase();
                  const missing = detalheList.find(d => {
                    try { return !lowerFragment.includes(d.toLowerCase()); } catch(e){ return true }
                  });
                  if (missing) {
                    if (diagnose) console.log(`[detalhe] Pulando fragmento ${i+1}: detalhe "${missing}" não encontrado.`);
                    continue; // Pula este fragmento
                  }
                } catch (e) {
                  if (diagnose) console.error('[detalhe] Erro ao aplicar filtro de detalhe:', e && e.message);
                }
              }

              fragmentOutputs.push(fragmentContent);
            }
            finalContent = fragmentOutputs.join('\n\n---\n\n');
          }
        } else if (renderLinks) {
          // Existing renderLinks logic for full HTML
          const html = dom.serialize();
          const linkProcessingOptions = {
            renderLinks: true,
            maxLinks: maxLinks,
            linkTimeout: linkTimeout,
            diagnose: diagnose,
            fetchOpts: fetchOpts,
            baseUrl: url
          };
          try {
            finalContent = await processLinksFromContent(html, linkProcessingOptions);
          } catch (error) {
            if (diagnose) console.error('[renderLinks] Error processing links:', error.message);
            finalContent = convertToLlmReadyMarkdown(html);
          }
        } else {
          // Existing default markdown conversion
          finalContent = convertToLlmReadyMarkdown(dom.serialize());
        }

        // Final output writing
        const cleanedFinal = duplicateRemover ? duplicateRemover.removeDuplicates(finalContent) : finalContent;
        if (out) fs.writeFileSync(out, cleanedFinal, 'utf8'); else process.stdout.write(cleanedFinal);
        try { dom.window.close(); } catch(e){}
        return;
      } catch(e) { if (diagnose) console.error('[universal] jsdom render failed', e && e.message); }
    }

    // fallback simple fetch
    try { const simple2 = await simpleFetch(url, timeout); const cleanedSimple2 = duplicateRemover ? duplicateRemover.removeDuplicates(simple2) : simple2; if (out) fs.writeFileSync(out, cleanedSimple2, 'utf8'); else process.stdout.write(cleanedSimple2); } catch(e){ console.error('All methods failed', e && e.message ? e.message : e); process.exit(1);}
  } catch (err) { console.error('Error:', err && err.message ? err.message : err); process.exit(1); }
}

function needBrowserFallback(html, opts = {}) {
  const doc = html.toLowerCase();
  if (doc.includes('via.placeholder.com') || doc.includes('placeholder.com')) return true;
  if (doc.indexOf('skeleton') !== -1 || doc.indexOf('placeholder') !== -1) return true;
  const matches = html.match(/class=["'][^"']*(col-md-4|vehicle-card|product-card|item-card)[^"']*["']/gi);
  if (!matches || matches.length < 2) return true;
  return false;
}

if (require.main === module) main();
