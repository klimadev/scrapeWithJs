const { cleanSvgContent } = require('./converters');

/**
 * Perform radial search in DOM, finding and extracting fragments
 */
function performRadialSearch(document, term, opts = {}) {
  const minRepeat = opts.minRepeat || 2;
  const radiusLevels = opts.radiusLevels || 3;
  const lowerTerm = term.toLowerCase();

  function findTextNodes(node) {
    const nodes = [];
    if (node.nodeType === 1) {
      const tagName = node.tagName.toUpperCase();
      if (tagName === 'SCRIPT' || tagName === 'STYLE') {
        return nodes;
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
  const results = [];

  for (const textNode of textNodes) {
    let el = textNode.parentElement;
    let best = el;

    for (let i = 0; i < radiusLevels && el; i++) {
      const parent = el.parentElement;
      if (parent && parent.tagName !== 'BODY' && parent.tagName !== 'HTML') {
        el = parent;
        best = el;
      } else {
        break;
      }
    }

    if (best && best.outerHTML) {
      cleanSvgContent(best);
      const contextSelector = best.className ? `.${best.className.split(' ').join('.')}` : best.tagName;

      results.push({
        html: best.outerHTML,
        selector: contextSelector,
        repeatCount: 1,
        method: 'fixed_radial',
        term
      });
    }
  }

  return results;
}

module.exports = { performRadialSearch };
