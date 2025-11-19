# Light JS Scraper (single-file prototype)

Este é um protótipo mínimo em Node que carrega uma URL, executa o JavaScript presente na página (via `jsdom` + `undici`) e retorna o HTML final renderizado.

Requisitos
- Node.js 18+ (recomendado)

Instalação

```powershell
cd c:\Users\darci\desenvolvimento
npm install
```

Uso

```powershell
# Imprime HTML final no stdout
node scrape.js https://example.com

# Salva em arquivo com timeout em ms
node scrape.js https://example.com --out result.html --timeout 8000
```

Limitações
- `jsdom` não executa layout real (Canvas/WebGL) e algumas Web APIs podem faltar.
- O script usa `runScripts: 'dangerously'` e executa JS arbitrário — não usar em ambientes sensíveis sem isolamento.

Se a página depender de APIs de navegador avançadas, considere um fallback com Playwright (opcional).
