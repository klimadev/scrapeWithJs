// extractors.js
// Função universal de pesquisa radial: localiza menções ao termo e extrai fragmentos relevantes
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

  // Regra 4: Limpeza final de espaços em branco excessivos
  let markdown = td.turndown(html);
  
  // Limpa linhas vazias consecutivas (> 2) e espaços em branco no início/fim
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

module.exports = { performRadialSearch, convertToLlmReadyMarkdown };