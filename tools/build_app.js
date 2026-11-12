// SPDX-License-Identifier: GPL-3.0-only
// Bundles app/src/ (Preact + htm) into two files from the same sources:
//   dist/app.js   full interface, published on GitHub Pages (pinned version, SRI hash)
//   dist/lite.js  light interface, kept gzipped in the .tapp as the local copy
// Usage: npm run build   (TF_BUILD=<id> npm run build tags a test build: the id shows in the header)
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
// the version is the git tag, resolved in one place (tools/version.py)
const VERSION = execFileSync('python3', [path.join(__dirname, 'version.py')], { encoding: 'utf8' }).trim();

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
  entryPoints: { app: path.join(ROOT, 'app', 'src', 'main.js'), lite: path.join(ROOT, 'app', 'src', 'main_lite.js') },
  outdir: path.join(ROOT, 'dist'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
  banner: { js: `/* TasmoFlow ${VERSION}, GPL-3.0-only, https://github.com/gnatali/TasmoFlow */` },
  define: { __BUILD__: JSON.stringify(process.env.TF_BUILD || '') },
  plugins: [cssText],
  logLevel: 'warning'
}).then(() => {
  for (const f of ['app.js', 'lite.js']) console.log(`dist/${f} ${fs.statSync(path.join(ROOT, 'dist', f)).size} B`);
}).catch(() => process.exit(1));
