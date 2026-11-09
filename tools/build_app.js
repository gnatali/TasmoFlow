// SPDX-License-Identifier: GPL-3.0-only
// Bundles app/src/ (Preact + htm) into dist/app.js, the file served by GitHub Pages and kept,
// gzipped, in the .tapp. Usage: npm run build
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VERSION = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();

// `import css from './x.css'` gives the minified CSS as a string
const cssText = {
  name: 'css-text',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async args => {
      const out = await esbuild.transform(fs.readFileSync(args.path, 'utf8'), { loader: 'css', minify: true });
      return { contents: `export default ${JSON.stringify(out.code.trim())}`, loader: 'js' };
    });
  }
};

esbuild.build({
  entryPoints: [path.join(ROOT, 'app', 'src', 'main.js')],
  outfile: path.join(ROOT, 'dist', 'app.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
  banner: { js: `/* TasmoFlow ${VERSION}, GPL-3.0-only, https://github.com/gnatali/TasmoFlow */` },
  plugins: [cssText],
  logLevel: 'warning'
}).then(() => {
  const size = fs.statSync(path.join(ROOT, 'dist', 'app.js')).size;
  console.log(`dist/app.js ${size} B`);
}).catch(() => process.exit(1));
