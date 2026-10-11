const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function frontendDelivery(root) {
  function revision() {
    const hash = crypto.createHash('sha256');
    function visit(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (/\.(?:html|js|css)$/.test(entry.name)) {
          const stat = fs.statSync(file);
          hash.update(`${path.relative(root, file)}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}\n`);
        }
      }
    }
    visit(root);
    return hash.digest('hex').slice(0, 16);
  }
  return function serveIndex(req, res, next) {
    try {
      const version = revision();
      const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
        .replace(/\b(src|href)=(['"])(\/[^'"?#]+\.(?:js|css))\2/g,
          (_, attr, quote, url) => `${attr}=${quote}/__ui/${version}${url}${quote}`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Bindarr-UI-Version', version);
      res.type('html').send(html);
    } catch (error) { next(error); }
  };
};
