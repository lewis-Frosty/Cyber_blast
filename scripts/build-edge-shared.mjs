#!/usr/bin/env node
/**
 * Copy the pure core into the Edge Function trees.
 *
 * Deno requires explicit file extensions on relative imports; the browser build
 * does not use them. Rather than contort the source for one consumer, this
 * script copies src/config and src/core verbatim and rewrites the relative
 * imports to add `.ts`.
 *
 * src/ stays the single source of truth. Run it after touching anything in
 * src/core or src/config, and commit the result so a deploy is reproducible.
 *
 * `--check` verifies the committed copies match src/ WITHOUT rewriting them,
 * and exits 1 on drift. That is the mode CI and `pretest` run: a guard that
 * regenerates first can never fail, so it would guard nothing.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Functions that need the whole core (they replay games). */
const TARGETS = ['submit-run'];

const CORE = ['validation', 'replay', 'gameState', 'Board', 'Piece', 'cascade', 'scoring', 'stats', 'powerups', 'rng', 'types'];
const CONFIG = ['gameplay'];

/** `from './X'` -> `from './X.ts'`, leaving package specifiers alone. */
function addExtensions(source) {
  return source.replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (all, a, path, z) =>
    path.endsWith('.ts') || path.endsWith('.js') ? all : `${a}${path}.ts${z}`,
  );
}

const banner = (from) =>
  `// GENERATED FILE — do not edit.\n` +
  `// Copied from ${from} by scripts/build-edge-shared.mjs so the Edge Function\n` +
  `// runs the SAME logic as the client. Edit the source, then re-run the script.\n\n`;

const check = process.argv.includes('--check');

/** Every generated file, as { path, expected } — computed from src/ alone. */
const expected = [];
for (const fn of TARGETS) {
  const base = join(root, 'supabase', 'functions', fn);
  for (const [sub, names] of [['core', CORE], ['config', CONFIG]]) {
    for (const name of names) {
      const from = `src/${sub}/${name}.ts`;
      expected.push({
        path: join(base, sub, `${name}.ts`),
        content: banner(from) + addExtensions(readFileSync(join(root, sub === 'core' ? 'src/core' : 'src/config', `${name}.ts`), 'utf8')),
        from,
      });
    }
  }
}

if (check) {
  const drifted = [];
  for (const f of expected) {
    let actual;
    try {
      actual = readFileSync(f.path, 'utf8');
    } catch {
      drifted.push(`${f.from} -> missing generated copy`);
      continue;
    }
    if (actual !== f.content) drifted.push(`${f.from} -> copy is stale`);
  }
  if (drifted.length) {
    console.error('build-edge-shared: generated Edge Function copies are out of date:');
    for (const d of drifted) console.error(`  ${d}`);
    console.error('Run `node scripts/build-edge-shared.mjs` and commit the result.');
    process.exit(1);
  }
  console.log(`build-edge-shared: ${expected.length} generated files match source.`);
} else {
  for (const fn of TARGETS) {
    const base = join(root, 'supabase', 'functions', fn);
    for (const sub of ['core', 'config']) {
      rmSync(join(base, sub), { recursive: true, force: true });
      mkdirSync(join(base, sub), { recursive: true });
    }
  }
  for (const f of expected) writeFileSync(f.path, f.content);
  console.log(`build-edge-shared: wrote ${expected.length} files for ${TARGETS.join(', ')}`);
}
