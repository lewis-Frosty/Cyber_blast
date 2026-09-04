#!/usr/bin/env node
/**
 * Architectural rule enforcement — spec §6 test 13, which asks for "a lint rule,
 * not just a test".
 *
 * Deliberately dependency-free and plain .mjs so it needs no ESLint install and
 * no @types/node: it runs in CI, in `npm test`, and by hand.
 *
 * Enforces, across every file in src/core/:
 *   Rule 1 — no Phaser import
 *   Rule 2 — no Math.random()
 *   Rule 4 — no Date.now(), no wall-clock reads, no timers
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');
const coreDir = join(root, 'src', 'core');

const RULES = [
  { rule: 1, name: 'imports Phaser', pattern: /from\s+['"]phaser['"]/i },
  { rule: 2, name: 'calls Math.random()', pattern: /Math\s*\.\s*random/ },
  { rule: 4, name: 'reads the wall clock', pattern: /Date\s*\.\s*now|performance\s*\.\s*now|new\s+Date\s*\(/ },
  { rule: 4, name: 'uses a timer', pattern: /\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/ },
];

/** Comments may legitimately name a banned API to explain the rule. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = collect(coreDir);
if (files.length === 0) {
  console.error('check-core-purity: found no files in src/core — wrong path?');
  process.exit(2);
}

const violations = [];
for (const file of files) {
  const code = stripComments(readFileSync(file, 'utf8'));
  const lines = code.split('\n');
  for (const { rule, name, pattern } of RULES) {
    lines.forEach((line, i) => {
      if (pattern.test(line)) {
        violations.push(`${relative(root, file)}:${i + 1}  rule ${rule} — ${name}\n    ${line.trim()}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error(`\ncheck-core-purity: ${violations.length} violation(s) in src/core/\n`);
  for (const v of violations) console.error(`  ${v}\n`);
  console.error('These rules exist because src/core/ is reused verbatim as the');
  console.error('server-side anti-cheat verifier. See CLAUDE.md.\n');
  process.exit(1);
}

console.log(`check-core-purity: ${files.length} files clean (rules 1, 2, 4).`);
