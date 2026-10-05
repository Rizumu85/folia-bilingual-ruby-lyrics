// Builds the two files Folia loads, bilingual-ruby-lyrics/client.mjs and main.cjs, from src/.
//
// Why one file each: Folia re-imports a mod's client entry when the mod changes, but the entry's
// own `import './x.mjs'` lines resolve to the same URLs as before, so the page keeps running the
// helper modules it loaded earlier. After an update without a restart the new entry would run
// with old helpers. A single file cannot get out of step with itself.
//
// The sources only use single-line named imports and `export function|const`, so this needs no
// bundler: each module becomes a function scope that returns its exports.
//   node tools/build.mjs            write the files
//   node tools/build.mjs --check    exit 1 if the files on disk are not what the sources build
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'src'), OUT = path.join(ROOT, 'bilingual-ruby-lyrics');
const scope = file => '__' + path.basename(file, '.mjs').replace(/\W/g, '_');
const IMPORT = /^import \{([^}]+)\} from '\.\/([\w-]+\.mjs)';\r?\n/gm;

// the module and everything it imports, dependencies first
function order(entry, seen = []) {
  const text = fs.readFileSync(path.join(SRC, entry), 'utf8');
  for (const match of text.matchAll(IMPORT)) order(match[2], seen);
  if (!seen.includes(entry)) seen.push(entry);
  return seen;
}

function wrap(file) {
  let text = fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');
  const names = [];
  text = text.replace(IMPORT, (_, list, from) => `const { ${list.trim().replace(/ as /g, ': ')} } = ${scope(from)};\n`);
  text = text.replace(/^export (default )?((?:async )?function\*? |const )(\w+)/gm, (_, isDefault, kind, name) => { names.push(name); return kind + name; });
  if (/^(?:import|export)\b/m.test(text)) throw new Error(file + ': an import or export this build does not understand');
  return `// ---- ${file}\nconst ${scope(file)} = (() => {\n${text.trimEnd()}\nreturn { ${names.join(', ')} };\n})();\n`;
}

const banner = name => `// Built from src/ by tools/build.mjs — edit the sources, not this file. (${name})\n`;
const client = banner('client.mjs') + order('client.mjs').map(wrap).join('\n') + '\nexport default __client.activate;\n';
const main = fs.readFileSync(path.join(SRC, 'main.cjs'), 'utf8').replace(/\r\n/g, '\n')
  .replace("'use strict';\n", "'use strict';\n" + banner('main.cjs'))
  .replace(/^\/\/ @modules.*\n/m, () => order('tags.mjs').map(wrap).join('\n'));
if (main.includes('@modules')) throw new Error('main.cjs: the @modules line was not replaced');

let stale = false;
for (const [name, text] of [['client.mjs', client], ['main.cjs', main]]) {
  const file = path.join(OUT, name), current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (process.argv.includes('--check')) { if (current !== text) { stale = true; console.error(name + ' is not what src/ builds; run node tools/build.mjs'); } }
  else { fs.writeFileSync(file, text, 'utf8'); console.log(name, text.split('\n').length, 'lines'); }
}
process.exit(stale ? 1 : 0);
