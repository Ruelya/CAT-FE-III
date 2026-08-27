import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = '/usr/local/bin/google-chrome';
const ORIGINAL_IMG_PATH = '/home/ubuntu/.cursor/projects/workspace/assets/65c54d39-47e1-45ab-b5d6-3718a50cd144.png';

async function capture() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1024,683']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 683, deviceScaleFactor: 2 });
  
  const htmlPath = path.resolve('/workspace/docs/design-studies/clone-gemini/index.html');
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

  const shot1 = '/opt/cursor/artifacts/design-clone-gemini/clone.png';
  const shot2 = '/workspace/docs/design-studies/clone-gemini/shots/clone.png';
  
  await page.screenshot({ path: shot1 });
  fs.copyFileSync(shot1, shot2);
  console.log('Clone screenshot captured successfully at 1024x683 (2x DPI)!');

  // Base64 encode images for standalone comparison
  const origBase64 = fs.readFileSync(ORIGINAL_IMG_PATH).toString('base64');
  const cloneBase64 = fs.readFileSync(shot1).toString('base64');

  const compPage = await browser.newPage();
  await compPage.setViewport({ width: 2068, height: 750, deviceScaleFactor: 1 });
  
  const compHtml = `
  <!DOCTYPE html>
  <html>
  <head>
    <style>
      body { margin: 0; padding: 16px; background: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #fff; }
      .header { display: flex; justify-content: space-around; margin-bottom: 12px; font-size: 15px; font-weight: 700; letter-spacing: 0.5px; }
      .grid { display: flex; gap: 16px; justify-content: center; }
      .frame { background: #1e293b; padding: 8px; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
      img { width: 980px; height: 654px; display: block; border-radius: 4px; border: 1px solid #334155; }
    </style>
  </head>
  <body>
    <div class="header">
      <span style="color: #60a5fa;">ORIGINAL GROUND TRUTH (SCREENSHOT)</span>
      <span style="color: #4ade80;">PIXEL-FAITHFUL HTML CLONE</span>
    </div>
    <div class="grid">
      <div class="frame">
        <img src="data:image/png;base64,${origBase64}" />
      </div>
      <div class="frame">
        <img src="data:image/png;base64,${cloneBase64}" />
      </div>
    </div>
  </body>
  </html>
  `;
  
  await compPage.setContent(compHtml, { waitUntil: 'networkidle0' });
  const compShot1 = '/opt/cursor/artifacts/design-clone-gemini/side_by_side_comparison.png';
  const compShot2 = '/workspace/docs/design-studies/clone-gemini/shots/side_by_side_comparison.png';
  await compPage.screenshot({ path: compShot1, fullPage: true });
  fs.copyFileSync(compShot1, compShot2);
  console.log('Side-by-side comparison screenshot captured!');

  await browser.close();
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
