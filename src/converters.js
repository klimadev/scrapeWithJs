const TurndownService = require('turndown');
const { duplicateRemover } = require('./duplicates');

/**
 * Converte um fragmento HTML em Markdown formatado para ser mais limpo e amigável a LLMs.
 */
function convertToLlmReadyMarkdown(html) {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    hr: '---'
  });

  td.remove('nav');
  td.remove('footer');

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

  let markdown = td.turndown(html);

  // Remove Next.js and script data blocks
  const scriptBlockRegex = /\{[\s\S]*?("props"|"__N_SSP"|"buildId"|"scripts"|"gtag"|"page"|"query"|"gssp"|"scriptLoader"|"isFallback"|"isExperimentalCompile")[\s\S]*?\}/g;
  markdown = markdown.replace(scriptBlockRegex, '');
  // Additionally remove trailing JSON-like script data that might not be enclosed in curly braces from the start.
  // Remove Next.js and script data blocks including the specific buildId pattern
  // This regex targets the buildId string with optional leading comma and handles various boolean values.
  markdown = markdown.replace(/,?\s*"buildId":"[^"]+"\s*,\s*"isFallback":(?:true|false)\s*,\s*"isExperimentalCompile":(?:true|false)\s*,\s*"gssp":(?:true|false)\s*,\s*"scriptLoader":\[\]}/g, '');
  markdown = markdown.replace(/window\.__[A-Z_]+[\s]*=[\s]*\{[^}]*\}/g, '');
  markdown = markdown.replace(/__INITIAL_STATE__[\s]*=[\s]*\{[^}]*\}/g, '');
  markdown = markdown.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  markdown = markdown.replace(/\$\(document\)\.ready\(function\(\)\s*\{[^}]*\}\);/gs, '');
  markdown = markdown.replace(/window\.addEventListener\(['"]scroll['"],\s*function\(\)\s*\{[^}]*\}\);/gs, '');
  markdown = markdown.replace(/console\.log\([^)]*\);?/g, '');

  // Clean duplicates and clutter
  // General cleanup
  markdown = markdown.replace(/\[\!\[\]\([^)]*logo[^)]*\)\]\([^)]*\)\s*### MAGNAUTOS MULTIMARCAS.*?(?=\n\n|\n\[\])/gs, '');
  markdown = markdown.replace(/Enviar Proposta\s*\n\s*,/g, '');
  markdown = markdown.replace(/\[\[[!\]\([^)]*image[^)]*\)\]\([^)]*Home[^)]*\)\s*\n\s*\[Estoque\]\([^)]*\)/g, '');

  return markdown.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Remove atributos e conteúdo interno de todos os elementos SVG dentro de um elemento.
 */
function cleanSvgContent(element) {
  if (!element || typeof element.querySelectorAll !== 'function') return;

  const svgs = element.querySelectorAll('svg');
  svgs.forEach(svg => {
    const attributes = Array.from(svg.attributes);
    attributes.forEach(attr => {
      if (attr.name !== 'xmlns') {
        svg.removeAttribute(attr.name);
      }
    });
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
  });
}

module.exports = {
  convertToLlmReadyMarkdown,
  cleanSvgContent,
  TurndownService
};
