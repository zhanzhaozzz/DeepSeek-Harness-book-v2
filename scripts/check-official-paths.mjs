// 核对笔记里引用的官方路径是否存在于 VERSION 钉住的 SHA。
// 本地有检出时：DSH_ROOT=/path/to/deepseek-harness node scripts/check-official-paths.mjs
// 否则对 raw.githubusercontent.com 做存在性请求。不把官方仓库拷进本教程库。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const versionText = readFileSync(join(root, 'VERSION'), 'utf8');
const sha = versionText.match(/^sha:\s*([0-9a-f]{40})\s*$/m)?.[1];
const tag = versionText.match(/^tag:\s*(\S+)\s*$/m)?.[1];
if (!sha || tag !== 'dsh-v0.2.3-alpha.2') {
  console.error('VERSION must pin tag dsh-v0.2.3-alpha.2 and a 40-char sha');
  process.exit(1);
}

const modulesDir = join(root, 'src/content/modules');
const requiredChapters = [
  'ch13-desktop.md',
  'ch14-python-sdk.md',
  'ch15-mcp.md',
  'ch16-teams.md',
  'ch17-session-v4-migration.md',
];
const files = [
  join(root, 'README.md'),
  ...readdirSync(modulesDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(modulesDir, name)),
];
for (const name of requiredChapters) {
  if (!files.includes(join(modulesDir, name))) {
    console.error(`missing follow-up chapter ${name}`);
    process.exit(1);
  }
}

const blobRe =
  /https:\/\/github\.com\/deepseek-ai\/deepseek-harness\/blob\/([0-9a-f]{40}|master|main)\/([A-Za-z0-9_./@+-]+)/g;
const tickRe =
  /`((?:packages|docs|apps|scripts|python|native|vendor|website)\/[A-Za-z0-9_./@+-]+\.[A-Za-z0-9]+|AGENTS\.md|README\.md|README\.zh\.md|LICENSE|package\.json|pnpm-workspace\.yaml|SAFETY\.md)`/g;

/** @type {Map<string, string>} */
const paths = new Map();
const problems = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = file.slice(root.length);
  if (text.includes('/blob/master/') || text.includes('/blob/main/')) {
    problems.push(`${rel}: blob link points at master/main`);
  }
  for (const match of text.matchAll(blobRe)) {
    const linkSha = match[1];
    const officialPath = decodeURIComponent(match[2]);
    if (linkSha !== sha) {
      problems.push(`${rel}: blob SHA ${linkSha} != VERSION ${sha} (${officialPath})`);
      continue;
    }
    paths.set(officialPath, rel);
  }
  for (const match of text.matchAll(tickRe)) {
    paths.set(match[1], rel);
  }
}

if (paths.size < 70) {
  problems.push(`only ${paths.size} official paths cited; expected the 17-chapter pin`);
}

const checkout = process.env.DSH_ROOT;
const missing = [];

async function exists(officialPath) {
  if (checkout) {
    try {
      statSync(join(checkout, officialPath));
      return true;
    } catch {
      return false;
    }
  }
  const url = `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/${sha}/${officialPath}`;
  const response = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
  return response.ok;
}

const entries = [...paths.keys()].sort();
const queue = entries.slice();
const workers = Array.from({ length: checkout ? 1 : 8 }, async () => {
  while (queue.length) {
    const officialPath = queue.pop();
    if (!(await exists(officialPath))) missing.push(officialPath);
  }
});
await Promise.all(workers);

if (missing.length) {
  problems.push(`missing on ${sha}:\n  ${missing.sort().join('\n  ')}`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

console.log(`ok ${entries.length} paths on ${tag} ${sha}${checkout ? ` via ${checkout}` : ' via GitHub'}`);
