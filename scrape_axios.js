#!/usr/bin/env node
const fs = require('fs');
const axios = require('axios');

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('Usage: node scrape_axios.js <url> [--out filename] [--timeout ms]');
    process.exit(2);
  }
  const url = argv[0];
  let out = null;
  let timeout = 10000;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i+1]) { out = argv[i+1]; i++; }
    else if (argv[i] === '--timeout' && argv[i+1]) { timeout = parseInt(argv[i+1], 10); i++; }
  }

  try {
    const resp = await axios.get(url, {
      timeout,
      responseType: 'text',
      headers: {
        'User-Agent': 'node-axios-scraper/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const html = resp.data;
    if (out) {
      fs.writeFileSync(out, html, 'utf8');
      console.log('Saved to', out);
    } else {
      process.stdout.write(html);
    }
  } catch (err) {
    if (err.response) {
      console.error('HTTP error:', err.response.status, err.response.statusText);
    } else if (err.code === 'ECONNABORTED') {
      console.error('Timeout after', timeout, 'ms');
    } else {
      console.error('Error:', err.message || err);
    }
    process.exit(1);
  }
}

if (require.main === module) main();
