import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on('console', msg => console.log('[BROWSER]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[BROWSER ERROR]', err.message));

  try {
    console.log('Navigating to http://localhost:3456 ...');
    await page.goto('http://localhost:3456', { timeout: 30000, waitUntil: 'networkidle' });
    console.log('Page loaded. Title:', await page.title());

    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshot-home.png', fullPage: false });
    console.log('Saved: screenshot-home.png');

    const tabs = [
      { label: 'API Keys', file: 'keys' },
      { label: 'Model Groups', file: 'groups' },
      { label: 'Metrics', file: 'metrics' },
      { label: 'Settings', file: 'settings' },
    ];

    for (const { label, file } of tabs) {
      console.log(`Clicking "${label}" tab...`);
      const btn = page.locator(`button:has-text("${label}")`);
      if (await btn.count() > 0) {
        await btn.first().click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `screenshot-${file}.png`, fullPage: false });
        console.log(`Saved: screenshot-${file}.png`);
      } else {
        console.log(`Tab "${label}" not found, skipping.`);
      }
    }

    console.log('All done!');
  } catch (error) {
    console.error('Test failed:', error.message);
    await page.screenshot({ path: 'screenshot-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();