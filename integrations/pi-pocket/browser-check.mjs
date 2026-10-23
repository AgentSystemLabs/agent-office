#!/usr/bin/env node
// Fullscreen acceptance in temporary Pocket data, with real WebGL and a scripted model. No live server.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
process.env.OFFICE_POCKET_PREVIEW_PORT ??= '0';
const {app,base,session,other,guest,context,closePreview}=await import('./preview.mjs');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/google-chrome-stable',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const screenshots=join(import.meta.dirname,'../../dist/screenshots');
await mkdir(screenshots,{recursive:true});
const errors=[];
const pages=[];
let sockets=0;
async function until(check,label,timeout=30000){const start=Date.now();while(Date.now()-start<timeout){try{if(await check())return;}catch{/* A frame can be replaced during a floor switch. */}await new Promise(r=>setTimeout(r,100));}throw Error(`Timed out: ${label}`);}
async function frame(page,selector){const handle=await page.locator(selector).elementHandle();const result=await handle.contentFrame();if(!result)throw Error(`Missing frame ${selector}`);return result;}
async function world(page){await page.locator('.office-v2-worldframe').waitFor();const game=await frame(page,'.office-v2-worldframe');await game.locator('html.pocket-office').waitFor({state:'attached',timeout:45000});await game.locator('#loading').waitFor({state:'detached',timeout:45000});return game;}
async function boot(game){return game.evaluate(()=>JSON.parse(decodeURIComponent(document.querySelector('meta[name="pocket-bootstrap"]').content)));}
async function state(page,source,client){const res=await page.request.get(`${base}/api/x/office-v2/state/${source}?clientId=${client}`,{headers:{'X-Pocket':'1'}});assert.equal(res.status(),200);return res.json();}
async function self(page,source,identity){return (await state(page,source,identity.slice(-36))).peers.find(peer=>peer.id===identity);}
async function walk(actor,identity,key,reached,label){
  let pose;
  for(let attempt=0;attempt<90;attempt++){
    pose=await self(actor.page,session,identity);
    if(attempt%10===0)console.log('Walking',label,attempt,pose?.x,pose?.z,await actor.game.evaluate(()=>({focused:document.hasFocus(),active:document.activeElement?.tagName,modals:document.querySelector('#modal-root')?.children.length,locked:!!document.pointerLockElement})));
    if(pose&&reached(pose))return;
    await actor.game.locator('#scene').focus();
    await actor.page.keyboard.down(key);
    try{await actor.page.waitForTimeout(100);}finally{await actor.page.keyboard.up(key);}
    // Release the key before reading network feedback, so round-trip latency cannot cause overshoot.
    await actor.page.waitForTimeout(250);
  }
  throw Error(`${label}: stopped at ${JSON.stringify(pose)}`);
}
async function open(userToken){
  const ctx=await browser.newContext({viewport:{width:1280,height:800}});
  const page=await ctx.newPage();pages.push(page);page.setDefaultTimeout(30000);
  page.on('pageerror',error=>errors.push(error.message));page.on('websocket',()=>sockets++);
  page.on('console',message=>{if(message.type()==='warning'&&message.text().includes('with nothing happening'))errors.push(message.text());});
  await page.goto(`${base}/login?token=${encodeURIComponent(userToken)}&next=/s/${session}`);
  await page.locator('.sidebar .rail-ext[title="Office v2"]').click();
  return {ctx,page,game:await world(page)};
}
// Equivalent to releasing mouse-look with the browser's Escape control, not a scene-state mutation.
async function freeMouse(game){await game.evaluate(()=>document.exitPointerLock());await until(()=>game.evaluate(()=>!document.pointerLockElement),'released mouse-look');}
async function inspector(page){await page.locator('.office-v2-inspector-view iframe').waitFor();const view=await frame(page,'.office-v2-inspector-view iframe');await view.locator('.composer textarea').waitFor();assert.equal(await view.locator('.sidebar,.ext-page').count(),0);return view;}
async function send(view,text){await view.locator('.composer textarea').fill(text);await view.getByRole('button',{name:'Send',exact:true}).click();await view.getByText(`echo: ${text}`,{exact:true}).waitFor();}
async function closeInspector(page){await page.getByRole('button',{name:'Close inspector',exact:true}).press('Enter');await page.locator('.office-v2-inspector').waitFor({state:'detached'});}
async function menu(game,page,label){await game.locator('#scene').focus();await page.keyboard.press('Tab');await game.locator('.menu-item').filter({hasText:label}).first().press('Enter');}
async function fullscreen(page){if(!await page.evaluate(()=>!!document.fullscreenElement))await page.getByRole('button',{name:'Fullscreen',exact:true}).press('Enter');assert.equal(await page.evaluate(()=>document.fullscreenElement?.classList.contains('office-v2-world')),true);}
async function bounds(page){assert.equal(await page.getByRole('button',{name:'Close inspector'}).evaluate(el=>{const r=el.getBoundingClientRect();return r.width>=32&&r.height>=32&&r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}),true);}
try{
  const owner=await open(app.config.ownerToken);
  // A reader's native inspector pauses drawing, not the real world, simulation, or presence.
  // Keep only one software-rendered world drawing at a time on this CPU-only acceptance host.
  await owner.page.getByRole('button',{name:'Master chat',exact:true}).press('Enter');
  const desktopMaster=await inspector(owner.page);
  const teammate=await open(guest.token);
  const originalUrl=owner.page.url();
  const initial=await boot(owner.game);
  assert.equal(initial.person.name,'Owner');assert.equal(initial.snapshot.source,Number(session));assert.equal(initial.floors.length,2);
  await owner.game.locator('#people').getByText('Office teammate',{exact:false}).waitFor();
  await teammate.game.locator('#people').getByText('Owner',{exact:false}).waitFor();
  console.log('PASS: real 3D boot, authenticated appearance, and two people on the same chat floor.');
  await freeMouse(teammate.game);
  await teammate.page.getByRole('button',{name:'Master chat',exact:true}).press('Enter');
  await inspector(teammate.page);
  await owner.page.bringToFront();
  assert.ok(await desktopMaster.evaluate(()=>innerWidth)>=960,'native Master inspector must use its desktop layout');
  assert.ok(await owner.game.evaluate(()=>innerWidth)>=1024,'3D world must use its desktop layout');
  await owner.page.screenshot({path:join(screenshots,'office-v2-desktop-master-inspector.png'),timeout:10000});
  await closeInspector(owner.page);
  console.log('PASS: full-window desktop 3D and computer-width native Master inspector.');

  // Use the actual movement controls to leave the elevator and approach a regular desk.
  await owner.page.bringToFront();
  // Closing the inspector restores pointer lock. Tab opens the menu and yields it before a DOM click.
  await menu(owner.game,owner.page,'Settings');
  await freeMouse(owner.game);
  await owner.game.getByRole('radio',{name:'Third person',exact:true}).press('Enter');
  await owner.game.getByRole('dialog',{name:'Pocket room settings',exact:true}).getByRole('button',{name:'Close',exact:true}).press('Enter');
  await walk(owner,initial.snapshot.you,'w',p=>p.z>-10,'walking out of the elevator');
  await walk(owner,initial.snapshot.you,'d',p=>p.x<5.5,'walking around the board kiosk');
  await walk(owner,initial.snapshot.you,'w',p=>p.z>-7.5,'passing the board kiosk');
  await walk(owner,initial.snapshot.you,'d',p=>p.x<1,'approaching a regular desk');
  await owner.page.keyboard.press('e');
  await owner.game.getByRole('textbox',{name:'Prompt',exact:true}).waitFor();
  const hire=owner.game.getByRole('dialog').filter({has:owner.game.getByRole('textbox',{name:'Prompt',exact:true})});
  await hire.getByRole('button',{name:'Hire & start',exact:true}).press('Enter');
  assert.equal((await state(owner.page,session,initial.snapshot.you.slice(-36))).workers.length,0,'empty hiring never admits work');
  await owner.game.getByRole('textbox',{name:'Prompt',exact:true}).fill('Office worker initial task');
  await hire.getByRole('button',{name:'Hire & start',exact:true}).press('Enter');
  await until(async()=>(await state(owner.page,session,initial.snapshot.you.slice(-36))).bindings.length===1,'real child binding');
  const hired=await state(owner.page,session,initial.snapshot.you.slice(-36));
  const child=hired.bindings[0].conversationId;
  await teammate.game.locator('#workers li').first().waitFor();
  assert.equal(app.sessions().length,3,'exactly one child, separate from both master floors');
  console.log('PASS: movement, required task at E/hire, inherited real child, and shared worker desk.');

  await owner.page.keyboard.press('e');
  let view=await inspector(owner.page);
  assert.equal(new URL(view.url()).pathname,`/s/${child}`);
  await view.getByText('echo: Office worker initial task',{exact:true}).waitFor();
  assert.equal(owner.page.url(),originalUrl);
  await fullscreen(owner.page);
  assert.equal(await owner.page.locator('.office-v2-inspector-view iframe').evaluate(el=>document.fullscreenElement.contains(el)),true);
  await send(view,'Human follow-up inside the office');
  assert.equal(owner.page.url(),originalUrl);
  await until(async()=>(await self(owner.page,session,initial.snapshot.you))?.reading===true,'inspector reading presence');
  await closeInspector(owner.page);
  await until(async()=>(await self(owner.page,session,initial.snapshot.you))?.reading!==true,'restored game focus');
  await owner.game.locator('#scene').focus();await owner.page.keyboard.press('p');
  await owner.game.getByRole('textbox',{name:'Prompt',exact:true}).fill('Review-only follow-up draft');
  await owner.game.getByRole('button',{name:/Review/}).press('Enter');
  view=await inspector(owner.page);
  await until(async()=>await view.locator('.composer textarea').inputValue()==='Review-only follow-up draft','unsent native draft');
  assert.equal(await view.getByText('echo: Review-only follow-up draft',{exact:true}).count(),0);
  await view.getByRole('button',{name:'Send',exact:true}).click();await view.getByText('echo: Review-only follow-up draft',{exact:true}).waitFor();
  await view.locator('.composer textarea').fill('office tool check');await view.getByRole('button',{name:'Send',exact:true}).click();
  await view.getByText('echo: office-tool-ok',{exact:true}).waitFor();
  const decision=app.approvals.request({id:'office-inspector-approval',conversationId:child,taskId:999,tool:'bash',subject:'printf isolated-approval',reason:'Isolated Office inspector approval test',createdAt:Date.now()},context).catch(error=>({error}));
  await view.getByRole('button',{name:'Allow',exact:true}).waitFor();
  await bounds(owner.page);await owner.page.screenshot({path:join(screenshots,'office-v2-fullscreen-approval.png')});
  await view.getByRole('button',{name:'Allow',exact:true}).click();assert.equal((await decision).allow,true);
  assert.equal(await owner.page.evaluate(()=>!!document.fullscreenElement),true);
  assert.equal(owner.page.url(),originalUrl);
  console.log('PASS: fullscreen native child conversation, live tool result, human follow-ups, unsent drafts, and explicit approval.');

  await closeInspector(owner.page);
  await owner.page.getByRole('button',{name:'Master chat',exact:true}).press('Enter');
  view=await inspector(owner.page);
  assert.equal(new URL(view.url()).pathname,`/s/${session}`);
  assert.equal(await view.getByText('Human follow-up inside the office',{exact:true}).count(),0,'child history was not copied into the master');
  await closeInspector(owner.page);
  await menu(owner.game,owner.page,'Switch workspace');
  await owner.game.getByRole('dialog',{name:'Elevator',exact:true}).getByRole('button',{name:/Workspace switch test project/}).press('Enter');
  await until(async()=>{const candidate=await world(owner.page);if((await boot(candidate)).snapshot.source!==Number(other))return false;owner.game=candidate;return true;},'replacement scene for the selected chat floor',60000);
  assert.equal(await owner.page.evaluate(()=>!!document.fullscreenElement),true,'scene replacement keeps the fullscreen host');
  await teammate.game.locator('#workers li').first().waitFor();
  await until(async()=>!(await teammate.game.locator('#people').innerText()).includes('Owner'),'old-floor presence removed');
  assert.equal((await state(owner.page,other,initial.snapshot.you.slice(-36))).workers.length,0);
  await owner.page.getByRole('button',{name:'Master chat',exact:true}).press('Enter');view=await inspector(owner.page);
  assert.equal(new URL(view.url()).pathname,`/s/${other}`);await send(view,'Second floor master message');
  assert.equal(owner.page.url(),originalUrl);
  await closeInspector(owner.page);
  await owner.page.screenshot({path:join(screenshots,'office-v2-world-fullscreen.png')});
  console.log('PASS: elevator switches real master chats without moving workers or teammates, without exiting fullscreen.');

  await menu(owner.game,owner.page,'Settings');
  await owner.game.getByRole('button',{name:'Change avatar',exact:true}).press('Enter');
  await owner.page.getByLabel('Shirt color',{exact:true}).selectOption('#06d6a0');
  await owner.page.getByRole('button',{name:'Save my appearance',exact:true}).press('Enter');
  await until(async()=>{const candidate=await world(owner.page);if((await boot(candidate)).profile.color!=='#06d6a0')return false;owner.game=candidate;return true;},'appearance bootstrap after edit',60000);
  const fresh=await open(app.config.ownerToken);
  assert.equal((await boot(fresh.game)).profile.color,'#06d6a0','appearance follows the account into a fresh desktop browser');
  await fresh.page.getByRole('button',{name:'Master chat',exact:true}).press('Enter');
  const freshView=await inspector(fresh.page);await fullscreen(fresh.page);await bounds(fresh.page);
  assert.ok(await freshView.evaluate(()=>innerWidth)>=960,'native inspector must retain the computer layout');
  assert.ok(await fresh.game.evaluate(()=>innerWidth)>=1024,'world must retain the computer layout');
  await fresh.page.screenshot({path:join(screenshots,'office-v2-desktop-inspector.png')});
  await fresh.page.setViewportSize({width:1024,height:768});await bounds(fresh.page);
  assert.ok(await freshView.evaluate(()=>innerWidth)>=960);
  await fresh.page.screenshot({path:join(screenshots,'office-v2-compact-desktop-inspector.png')});
  await fresh.page.getByRole('button',{name:'Exit fullscreen',exact:true}).press('Enter');
  await freshView.locator('.composer textarea').focus();await fresh.page.keyboard.press('Escape');
  await fresh.page.locator('.office-v2-inspector').waitFor({state:'detached'});
  assert.equal(await fresh.game.locator('#modal-root .backdrop').count(),0);
  await fresh.page.setViewportSize({width:900,height:650});
  await fresh.page.getByText('Desktop Office',{exact:true}).waitFor();
  assert.equal(await fresh.page.locator('.office-v2-worldframe').count(),0,'a small window must not silently switch to phone UI');
  assert.deepEqual(errors,[]);assert.equal(sockets,0,'no Office WebSocket backend');
  console.log('PASS: account-owned appearance, forced desktop world/inspector, reachable close targets, no phone fallback, and Escape/focus cleanup.');
  console.log(`PASS: all fullscreen acceptance checks. Screenshots: ${screenshots}`);
}catch(error){
  console.error('Browser exceptions:',errors);
  for(const [index,page] of pages.entries())try{
    await page.screenshot({path:join(screenshots,`office-v2-failure-${index}.png`),timeout:10000});
    const game=await frame(page,'.office-v2-worldframe');const data=await boot(game);
    console.error('World diagnostic',index,await game.locator('#hint').innerText(),await self(page,data.snapshot.source,data.snapshot.you));
    console.error('Hit-test diagnostic',await page.evaluate(()=>({frame:document.querySelector('.office-v2-worldframe')?.getBoundingClientRect().toJSON(),top:document.elementFromPoint(innerWidth-36,80)?.outerHTML.slice(0,200)})),await game.evaluate(()=>{const r=document.querySelector('.dock-menu')?.getBoundingClientRect();return{menu:r?.toJSON(),hit:r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,200):null};}));
  }catch{/* Preserve the original failure. */}
  throw error;
}finally{await browser.close();await closePreview();}
