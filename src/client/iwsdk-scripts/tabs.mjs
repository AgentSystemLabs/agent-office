// IWSDK agent script: list every page in the managed browser and their URLs.
export default async function run({ browser, context, page }) {
  const pages = context.pages();
  const info = pages.map((p, i) => ({ i, url: p.url(), same: p === page }));
  console.log(JSON.stringify(info, null, 1));
  return { ok: true, pages: info };
}
