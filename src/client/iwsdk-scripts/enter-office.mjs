// IWSDK agent script: finish first-run character setup and enter the office.
export default async function run({ frame }) {
  console.log('at:', frame.url());
  await frame.locator('input[aria-label="Your name"]').fill('XR Tester');
  await frame.locator('button.btn.primary').click();
  await frame.waitForSelector('canvas', { timeout: 15000 }).catch(() => {});
  await frame.waitForTimeout(4000);
  return { ok: true, url: frame.url() };
}
