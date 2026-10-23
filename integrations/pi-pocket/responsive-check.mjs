#!/usr/bin/env node
// Check the original desktop Office DOM and bounded dialogs. No renderer, live server, or model.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const root = join(import.meta.dirname, '../..');
const source = await readFile(join(root, 'src/client/index.html'), 'utf8');
const fixture = source.replace('<script type="module" src="./main.ts"></script>', `<script type="module">
import '/shared/pocket/responsive.css';
import { openPrompt } from '/ui/prompt.ts';
import { openHelp } from '/ui/hud.ts';
import { openSettings } from '/ui/settings.ts';
import { closeAllModals } from '/ui/dom.ts';
import { mountHud } from '/ui/menu.ts';
import { renderWorkers } from '/ui/workers-panel.ts';
import { renderPeople } from '/ui/people.ts';
import { store, loadSettings } from '/state/index.ts';
document.getElementById('loading').remove();
document.documentElement.classList.add('pocket-office');
const settings = loadSettings();
settings.hud = {workers:true, people:true, chat:true, spend:false, limits:false, floor:false};
store.you = 'owner'; store.floor = 'chat-1';
for (let i=0; i<12; i++) {
  store.peers.set('person-'+i, { id:'person-'+i, name:'Participant '+i, color:'#06d6a0', floor:'chat-1', x:0,y:0,z:0,rotY:0,moving:false,voice:false,muted:true,sharing:false,look:{skin:0,hair:0,style:0} });
  store.workers.set('worker-'+i, {id:'worker-'+i,deskId:'desk-'+(i+1),name:'Agent '+i,color:'#4f86f7',kind:'agent',provider:'pi',status:'idle',createdAt:Date.now(),createdBy:'Owner',acked:true,cols:80,rows:24,viewers:[],viewerIds:[]});
}
const prompt = () => openPrompt({title:'Hire a worker with an initial task', subtitle:'A real Pocket conversation inherits this floor’s model, thinking, tools, folder, and team budget. '.repeat(18), submitLabel:'Hire & start', allowEmpty:false, onSubmit:()=>{}});
const hud = mountHud([{id:'help',icon:'?',label:'Controls',section:'Office',run:openHelp}, {id:'hire',icon:'+',label:'Hire worker',section:'Open',run:prompt}], settings, ()=>{});
renderWorkers(()=>{}); renderPeople({},()=>{},()=>{});
document.getElementById('project-name').textContent = 'Desktop Pocket root conversation';
document.getElementById('hint').classList.remove('hidden');
document.getElementById('hint').textContent = 'Press E to interact with the desk';
window.__desktop = {prompt, help:openHelp, menu:hud.toggleMenu, close:closeAllModals,
  settings:()=>openSettings({send(){}},settings,()=>{},()=>{},{ding(){},needsYou(){}},{sample(){}},()=>{})};
</script>`);
const host = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;overflow:hidden;background:#202431"><iframe title="Desktop Office UI" src="/__desktop-world" style="position:fixed;inset:0;border:0;width:100vw;height:100vh;min-width:1024px;min-height:600px"></iframe></body></html>';
const server = await createServer({
  configFile: join(root, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 5193, strictPort: true, open: false },
  plugins: [{ name:'desktop-layout-fixture', configureServer(app) {
    app.middlewares.use(async (req,res,next) => {
      if (req.url === '/__desktop-host') { res.setHeader('content-type','text/html'); res.end(host); return; }
      if (req.url !== '/__desktop-world') return next();
      try { res.setHeader('content-type','text/html'); res.end(await app.transformIndexHtml('/__desktop-world', fixture)); }
      catch(error) { next(error); }
    });
  }}],
});
let browser;
const output = join(root,'dist/screenshots');
await mkdir(output,{recursive:true});
try {
  await server.listen();
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/google-chrome-stable',headless:true,args:['--no-sandbox']});
  const page = await browser.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
  const world = page.frameLocator('iframe');
  const bounds = selector => world.locator(selector).evaluate(element=>{
    const r=element.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,vw:innerWidth,vh:innerHeight,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth};
  });
  function inside(box,label) {
    assert.ok(box.x>=-1 && box.y>=-1 && box.right<=box.vw+1 && box.bottom<=box.vh+1,`${label} leaves ${box.vw}×${box.vh}: ${JSON.stringify(box)}`);
  }
  for(const [width,height] of [[1280,800],[1440,900],[1024,768],[1920,1080]]) {
    await page.setViewportSize({width,height});
    await page.goto('http://127.0.0.1:5193/__desktop-host');
    await world.locator('html.pocket-office').waitFor();
    await page.waitForTimeout(200);
    assert.deepEqual(await world.locator('body').evaluate(()=>[innerWidth,innerHeight]),[width,height]);
    inside(await bounds('.topbar'),'Original desktop HUD bar');
    inside(await bounds('.side'),'Original participant and worker panels');
    await page.screenshot({path:join(output,`office-desktop-${width}x${height}-hud.png`)});
    for(const kind of ['prompt','help','settings','menu']) {
      const open = () => world.locator('body').evaluate((_,name)=>window.__desktop[name](),kind);
      const selector = kind==='menu'?'.hud-menu':'.modal';
      await open();
      await world.locator(selector).waitFor();
      await page.waitForTimeout(200);
      const box=await bounds(selector);
      inside(box,kind);
      assert.ok(box.scrollWidth<=box.clientWidth+1,`${kind} has horizontal overflow at ${width}×${height}`);
      if(kind!=='menu') {
        const before=await bounds('.modal .close');
        inside(before,`${kind} close`);
        assert.equal(Math.round(before.width),34,'Keep the original desktop close-button width');
        assert.equal(Math.round(before.height),34,'Keep the original desktop close-button height');
        if(kind==='prompt') {
          inside(await bounds('.modal footer'),'Initial task actions');
          await world.locator('.modal > .body').evaluate(body=>{ body.scrollTop=body.scrollHeight; });
          const after=await bounds('.modal .close');
          assert.equal(after.y,before.y,'The close button stays outside scrolling task content');
        }
        await page.screenshot({path:join(output,`office-desktop-${width}x${height}-${kind}.png`)});
        await world.getByRole('button',{name:'Close',exact:true}).click();
        assert.equal(await world.locator(selector).count(),0,'X closes the desktop dialog');
        await open();
        await world.locator(selector).waitFor();
      }
      await world.locator('body').press('Escape');
      assert.equal(await world.locator(selector).count(),0,'Esc closes the desktop popup');
    }
    console.log(`PASS: desktop ${width}×${height}: original HUD, task, controls, settings, menu, X, Esc, and bounded scrolling.`);
  }
  assert.deepEqual(errors,[],'No browser exceptions');
} finally {
  await browser?.close();
  await server.close();
}
