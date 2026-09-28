export default async function run({ frame }) {
  await frame.locator('#dock button[aria-label="Enter VR"]').click();
  await frame.waitForTimeout(600);
  const toast = await frame.evaluate(() => document.querySelector('.toast:last-child, #toasts :last-child')?.textContent ?? document.body.innerHTML.slice(-500));
  console.log('TOAST:', JSON.stringify(String(toast).slice(0, 300)));
  return { ok: true };
}
