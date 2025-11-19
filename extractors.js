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

module.exports = { performRadialSearch };