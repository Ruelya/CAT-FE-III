import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = '/usr/local/bin/google-chrome';

async function capture() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900']
  });

  const prototypes = ['linear', 'stripe', 'notion'];
  const scenarios = [
    { name: '01_standard_grid', action: async (page) => { await page.click('.scenario-btn:nth-child(2)'); } },
    { name: '02_qa_alert', action: async (page) => { await page.click('.scenario-btn:nth-child(3)'); } },
    { name: '03_agent_audit', action: async (page) => { await page.click('.scenario-btn:nth-child(4)'); } },
    { name: '04_export_gate', action: async (page) => { await page.click('.scenario-btn:nth-child(5)'); } },
  ];

  for (const proto of prototypes) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    const htmlPath = path.resolve(`/workspace/docs/design-studies/saas-gemini-${proto}/index.html`);
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

    for (const sc of scenarios) {
      try {
        await sc.action(page);
        await new Promise(r => setTimeout(r, 200));
        
        const shot1 = `/opt/cursor/artifacts/design-saas-gemini/${proto}/${sc.name}.png`;
        const shot2 = `/workspace/docs/design-studies/saas-gemini-${proto}/shots/${sc.name}.png`;
        
        await page.screenshot({ path: shot1 });
        fs.copyFileSync(shot1, shot2);
        console.log(`Captured ${proto} - ${sc.name}`);
      } catch (err) {
        console.error(`Error in ${proto} - ${sc.name}:`, err.message);
      }
    }
    await page.close();
  }

  await browser.close();
  console.log('All screenshots captured successfully!');
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
