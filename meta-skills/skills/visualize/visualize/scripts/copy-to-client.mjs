/**
 * Copy exported PNG to a client's EXPORTS folder.
 *
 * Reads client_projects/client-index.yml to resolve the client folder.
 * Creates the EXPORTS directory if it doesn't exist.
 * Copies with a date stamp: {name}-{YYYYMMDD}.png
 *
 * Usage:
 *   node scripts/copy-to-client.mjs output/<name>.png --client conveo
 *   node scripts/copy-to-client.mjs output/<name>.png --client eagl
 */

import { readFileSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, basename, join, dirname } from 'path';
import { execSync } from 'child_process';

// Resolve workspace root (git root or cwd)
const workspaceRoot = (() => {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch {
    return process.cwd();
  }
})();

// Parse args
const args = process.argv.slice(2);
const pngPath = resolve(args[0]);
const clientIdx = args.indexOf('--client');
const clientKey = clientIdx >= 0 ? args[clientIdx + 1] : null;

if (!pngPath || !clientKey) {
  console.error('Usage: node scripts/copy-to-client.mjs <png-path> --client <client-key>');
  console.error('  client-key: lowercase key from client_projects/client-index.yml');
  process.exit(1);
}

if (!existsSync(pngPath)) {
  console.error(`File not found: ${pngPath}`);
  process.exit(1);
}

// Load client index
const indexPath = join(workspaceRoot, 'client_projects', 'client-index.yml');
if (!existsSync(indexPath)) {
  console.error(`Client index not found: ${indexPath}`);
  process.exit(1);
}

// Simple YAML parsing for the folder field — avoid dependency on yaml package
const indexContent = readFileSync(indexPath, 'utf-8');

// Find the client block and extract the folder field
const clientPattern = new RegExp(`^  ${clientKey}:\\s*$`, 'm');
const clientMatch = indexContent.match(clientPattern);

if (!clientMatch) {
  console.error(`Client "${clientKey}" not found in client-index.yml`);
  console.error('Available clients:');
  const clients = [...indexContent.matchAll(/^  (\w[\w-]*):\s*$/gm)].map(m => m[1]);
  clients.forEach(c => console.error(`  - ${c}`));
  process.exit(1);
}

// Extract folder from the client block
const clientStartIdx = clientMatch.index + clientMatch[0].length;
const nextClientMatch = indexContent.slice(clientStartIdx).match(/^\n  \w[\w-]*:\s*$/m);
const clientBlock = nextClientMatch
  ? indexContent.slice(clientStartIdx, clientStartIdx + nextClientMatch.index)
  : indexContent.slice(clientStartIdx);

const folderMatch = clientBlock.match(/folder:\s*(.+)/);
if (!folderMatch || folderMatch[1].trim() === 'null') {
  console.error(`Client "${clientKey}" has no folder defined in client-index.yml`);
  process.exit(1);
}

const folder = folderMatch[1].trim().replace(/^["']|["']$/g, '');

// Build target path
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const srcName = basename(pngPath, '.png');
const targetDir = join(workspaceRoot, 'client_projects', folder, 'EXPORTS');
const targetFile = join(targetDir, `${srcName}-${today}.png`);

// Create EXPORTS dir if needed
if (!existsSync(targetDir)) {
  mkdirSync(targetDir, { recursive: true });
  console.log(`Created: ${targetDir}`);
}

// Copy
copyFileSync(pngPath, targetFile);
console.log(`Copied: ${targetFile}`);
