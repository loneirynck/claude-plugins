import puppeteer from 'puppeteer';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join, basename } from 'path';

// Usage: node svg-to-pdf.mjs <directory-of-svgs> [output.pdf] [--light]
// SVG files are ordered by filename (01-cover.svg, 02-problem.svg, etc.)

const inputDir = resolve(process.argv[2] || '.');
const outputPdf = process.argv[3] || join(inputDir, 'output.pdf');
const lightBg = process.argv.includes('--light');
const bgColor = lightBg ? '#ffffff' : '#0f0f1a';

const svgFiles = readdirSync(inputDir)
  .filter(f => f.endsWith('.svg'))
  .sort()
  .map(f => join(inputDir, f));

if (svgFiles.length === 0) {
  console.error('No SVG files found in', inputDir);
  process.exit(1);
}

console.log(`Found ${svgFiles.length} SVG files`);

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

// Read first SVG to determine dimensions
const firstSvg = readFileSync(svgFiles[0], 'utf-8');
const viewBoxMatch = firstSvg.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/);
const width = parseFloat(viewBoxMatch[1]);
const height = parseFloat(viewBoxMatch[2]);

// Build HTML with all slides as separate pages
const slides = svgFiles.map((f, i) => {
  const svg = readFileSync(f, 'utf-8');
  const b64 = Buffer.from(svg).toString('base64');
  const pageBreak = i < svgFiles.length - 1 ? 'page-break-after: always;' : '';
  return `<div style="width:${width}px;height:${height}px;${pageBreak}">
    <img src="data:image/svg+xml;base64,${b64}" style="width:${width}px;height:${height}px;" />
  </div>`;
}).join('\n');

const html = `<!DOCTYPE html><html><head>
<style>
  @page { size: ${width}px ${height}px; margin: 0; }
  body { margin: 0; padding: 0; background: ${bgColor}; }
</style>
</head><body>${slides}</body></html>`;

await page.setViewport({ width, height });
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.pdf({
  path: outputPdf,
  width: `${width}px`,
  height: `${height}px`,
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 }
});

await browser.close();
console.log(`Exported: ${outputPdf} (${svgFiles.length} pages, ${width}x${height}px)`);
