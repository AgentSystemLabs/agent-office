// Isolated UI check: serve src/client with Vite on 127.0.0.1:5199.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
  const page = await browser.newPage({viewport:{width:1200,height:800}});
  await page.route('http://127.0.0.1:5199/', r => r.fulfill({contentType:'text/html',body:'<html><link rel="stylesheet" href="/style.css"><body><div id="modal-root"></div></body></html>'}));
  await page.route('**/api/maintenance/issue?*', r => r.fulfill({contentType:'application/json',body:JSON.stringify({number:42,state:'OPEN',body:'Fix the fork issues board.',comments:[],viewer:'alex'})}));
  await page.goto('http://127.0.0.1:5199/');
  await page.evaluate(async () => {
    const board = await import('/ui/maintenance-board.ts');
    const {store} = await import('/state.ts');
    store.maintenanceIssues = {repo:'Ruben00alex/agent-office',items:[],loading:false,fetchedAt:1};
    window.sent = [];
    board.openMaintenanceIssue({number:42,title:'Use this fork',url:'https://github.com/Ruben00alex/agent-office/issues/42'}, () => {}, m => window.sent.push(m));
  });
  await page.getByRole('button',{name:'🚧 Move to In progress & start Maintenance'}).waitFor();
  await page.screenshot({path:'/tmp/maintenance-board.png'});
  await page.getByRole('button',{name:'🚧 Move to In progress & start Maintenance'}).click();
  const sent = await page.evaluate(() => window.sent);
  if(sent.length !== 1 || sent[0].maintenanceIssue !== 42 || sent[0].deskId !== 'station-maintenance') throw Error('Issue did not reach Maintenance');
  if(await page.locator('.maintenance-issue').count()) throw Error('Issue modal did not close');
  console.log('Maintenance issue start control passed; screenshot: /tmp/maintenance-board.png');
} finally { await browser.close(); }
