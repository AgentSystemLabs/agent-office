// IWSDK agent script: sign the FRAMED app into the office (dev password).
export default async function run({ page, frame }) {
  console.log('page:', page.url());
  console.log('frame:', frame?.url?.() ?? 'no frame param');
  for (const f of page.frames()) console.log('frame:', f.url());
  const app = page.frames().find((f) => f.url().includes('5173/login')) ?? frame;
  console.log('using:', app.url());
  await app.locator('#password').fill('dev');
  await app.locator('#form').evaluate((form) => form.requestSubmit());
  await page.waitForURL(() => true, { timeout: 1000 }).catch(() => {});
  await app.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
  console.log('landed:', app.url());
  return { ok: true, url: app.url() };
}
