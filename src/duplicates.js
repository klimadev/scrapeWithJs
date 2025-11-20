/**
 * Simplified duplicate remover for HTML content
 */
class DuplicateRemover {
  /**
   * Remove duplicate lines from content, preserving order
   */
  removeDuplicates(content) {
    const lines = content.split('\n');
    const seen = new Set();
    const processedLines = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        processedLines.push(line);
      } else if (!trimmed) {
        // Keep empty lines but avoid duplicates
        if (!processedLines[processedLines.length - 1]?.trim()) continue;
        processedLines.push(line);
      }
    }

    return processedLines.join('\n').trim();
  }
}

const duplicateRemover = new DuplicateRemover();

module.exports = { DuplicateRemover, duplicateRemover };
