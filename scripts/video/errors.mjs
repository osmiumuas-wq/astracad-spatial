// Reloads the app and returns page errors and console errors seen in the first seconds (debug aid).
export default async function run({ page }) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.reload();
  await new Promise((r) => setTimeout(r, 6000));
  return errors;
}
