// extractors.js
// Função universal de pesquisa radial: localiza menções ao termo e extrai fragmentos relevantes

function performRadialSearch(document, term, opts = {}) {
  const results = [];
  const minRepeat = opts.minRepeat || 2;
  const radiusLevels = opts.radiusLevels || 3;
  const lowerTerm = term.toLowerCase();

  // 1. Encontrar todos os nós de texto que mencionam o termo
  function findTextNodes(node) {
    const nodes = [];
    if (node.nodeType === 3 && node.textContent.toLowerCase().includes(lowerTerm)) {
      nodes.push(node);
    } else if (node.nodeType === 1) {
      for (const child of node.childNodes) {
        nodes.push(...findTextNodes(child));
      }
    }
    return nodes;
  }

  const textNodes = findTextNodes(document.body);

  // 2. Para cada nó, subir na árvore até encontrar container repetido ou significativo
  for (const textNode of textNodes) {
    let el = textNode.parentElement;
    let best = el;
    let repeatCount = 1;
    for (let i = 0; i < radiusLevels && el; i++) {
      // Heurística: contar quantos irmãos com mesma tagName e classe
      if (el.parentElement) {
        const siblings = Array.from(el.parentElement.children).filter(sib =>
          sib !== el && sib.tagName === el.tagName && sib.className === el.className
        );
        if (siblings.length + 1 >= minRepeat) {
          best = el;
          repeatCount = siblings.length + 1;
          break;
        }
        el = el.parentElement;
      }
    }
    // 3. Promover 'best' para o pai se foi encontrado um elemento repetido, para capturar mais contexto.
    if (repeatCount > 1 && best.parentElement && best.parentElement.tagName !== 'BODY' && best.parentElement.tagName !== 'HTML') {
      best = best.parentElement;
      // We keep the original repeatCount, as it refers to the number of items this container holds.
    }

    // 4. Extrair HTML do container
    if (best && best.outerHTML) {
      results.push({
        html: best.outerHTML,
        selector: best.className ? `.${best.className.split(' ').join('.')}` : best.tagName,
        repeatCount,
        method: 'radial',
        term
      });
    }
  }

  // 4. Se nada encontrado, retorna vazio
  return results;
}

module.exports = { performRadialSearch };