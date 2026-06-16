import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const svgPath = resolve(process.argv[2] || 'preview-test.svg');
const pngPath = svgPath.replace('.svg', '.png');
const scale = parseInt(process.argv[3] || '3');

const svgContent = readFileSync(svgPath, 'utf-8');
const viewBoxMatch = svgContent.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/);
const width = parseFloat(viewBoxMatch[1]);
const height = parseFloat(viewBoxMatch[2]);

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: width * scale, height: height * scale, deviceScaleFactor: scale });

const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0f0f1a;">
<img src="data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}"
     style="width:${width * scale}px;height:${height * scale}px;" />
</body></html>`;

await page.setContent(html, { waitUntil: 'networkidle0' });
await page.screenshot({ path: pngPath, type: 'png', clip: { x: 0, y: 0, width: width * scale, height: height * scale } });
await browser.close();
console.log(`Exported: ${pngPath} (${width * scale}x${height * scale})`);
