// Synthetic UI integration harness; never connects to a running office.
// Start this worktree's Vite preview on 127.0.0.1:5199, then run:
// CHROMIUM_PATH=/path/to/chrome node tests/maintenance-chat.browser.mjs
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page = await browser.newPage({viewport:{width:1360,height:980}});
const issues=[];page.on('pageerror',e=>issues.push(e.message));
await page.route('http://127.0.0.1:5199/', r=>r.fulfill({contentType:'text/html',body:'<html><link rel="stylesheet" href="/style.css"><body><div id="modal-root"></div></body></html>'}));
let worker={id:'maintenance',createdAt:1,name:'Maintenance',status:'working',deskId:'station-maintenance',provider:'codex',kind:'agent',color:'#f08c00'};
const msg=(id,role,content,at=1790856000000)=>({id,role,content,at,by:role==='user'?'Alex':undefined});
const threads={
 maintenance:{id:'maintenance',title:'Build a modern Maintenance chat view',createdAt:1,updatedAt:1790856000000,hasOlder:false,messages:[
 msg('u1','user','Build a modern Maintenance chat view with Markdown, HTML previews, and a saved archive.'),
 msg('a1','assistant','## A clearer way to work\n\nThe experimental view is ready for review.\n\n| Format | Rendering |\n| --- | --- |\n| Markdown | Tables, lists, links and code |\n| HTML | Isolated, styled preview |\n\n- [x] Persistent office archive\n- [x] Terminal access for approvals\n\n```ts\nconst experimentalChat = true;\n```\n\n```html\n<div style="padding:22px;background:#eef2ff;border-radius:12px;color:#334c9b;font:16px system-ui"><b>HTML preview</b><p>Agent layouts keep their styling.</p></div>\n```\n\n[Read the controls](https://example.com/controls)\n\n<img src="x" onerror="window.pwned=1"><script>window.pwned=1</script>'),
 msg('u2','user','Keep the history after Maintenance goes home.',1790856060000),
 msg('a2','assistant','**Done.** Conversations live in the shared office archive, independently of the worker. The change is on the stack.',1790856065000)]},
 old:{id:'old',title:'Fix the Shift shortcut hint',createdAt:1,updatedAt:1790770000000,hasOlder:false,messages:[msg('old1','user','Fix the Shift hint.'),msg('old2','assistant','Fixed reliable release handling. All checks passed.')]}
};
await page.route('**/api/maintenance/chat?*', async route=>{
 const u=new URL(route.request().url());const id=u.searchParams.get('thread')??worker?.id;
 await route.fulfill({contentType:'application/json',body:JSON.stringify({conversations:Object.values(threads).map(({messages,hasOlder,...t})=>({...t,count:messages.length})),conversation:threads[id],worker,floor:'test-floor',floorName:'Agent Office',richReplies:true})});
});
await page.goto('http://127.0.0.1:5199/');
await page.evaluate(async()=>{
 const chat=await import('/ui/maintenance-chat.ts'),state=await import('/state.ts');window.chat=chat;window.store=state.store;
 state.store.floor='test-floor';window.sent=[];window.watches=[];window.stackOpens=0;
 window.actions={correct(){},watch:(...args)=>window.watches.push(args)};
 window.openChat=()=>window.chatModal=chat.openMaintenanceChat(m=>window.sent.push(m),window.actions,()=>window.stackOpens++);
 window.openChat();
});
await page.waitForSelector('[data-message="a2"]');
if(await page.locator('.maintenance-bubble table').count()!==1)throw Error('Markdown table missing');
if(await page.locator('.maintenance-bubble script').count())throw Error('unsanitized script');
if(await page.evaluate(()=>window.pwned))throw Error('script executed');
if(await page.locator('.maintenance-bubble img').getAttribute('onerror'))throw Error('unsafe event attribute');
await page.locator('.maintenance-preview summary').click();
const frame=page.frameLocator('.maintenance-html');
await frame.locator('b').waitFor();
if(await frame.locator('b').textContent()!=='HTML preview')throw Error('HTML not rendered');
if(await page.locator('.maintenance-html').getAttribute('sandbox')!=='')throw Error('preview is not fully sandboxed');
await page.screenshot({path:'/tmp/maintenance-chat-html.png',animations:'disabled'});
await page.locator('.maintenance-preview summary').click();
await page.locator('.maintenance-chat-messages').evaluate(el=>el.scrollTop=0);
await page.screenshot({path:'/tmp/maintenance-chat-desktop.png',animations:'disabled'});
writeFileSync('/tmp/maintenance-chat-demo-markup.html',await page.locator('.maintenance-chat').evaluate(el=>el.outerHTML));
await page.getByRole('button',{name:'Fix the Shift shortcut hint'}).click();
await page.waitForSelector('[data-message="old2"]');
if(!await page.getByRole('textbox',{name:'Message to Maintenance'}).isDisabled())throw Error('archived composer enabled');
await page.getByRole('button',{name:'Current conversation',exact:true}).click();await page.waitForSelector('[data-message="a2"]');
await page.getByRole('searchbox').fill('Shift');
if(await page.locator('.maintenance-conversation').count()!==1)throw Error('search failed');
await page.getByRole('searchbox').fill('');
const input=page.getByRole('textbox',{name:'Message to Maintenance'});
await input.fill('Try this request');await input.press('Shift+Enter');
if((await page.evaluate(()=>window.sent.length))!==0)throw Error('Shift+Enter sent');
await input.press('Enter');
const sent=await page.evaluate(()=>window.sent.at(-1));
if(sent.t!=='maintenance.chat.send'||sent.prompt!=='Try this request')throw Error('request routing failed');
await page.evaluate(id=>chat.onMaintenanceChatSent({t:'maintenance.chat.sent',id,error:'Maintenance is waiting on an approval'}),sent.id);
await page.getByRole('alert').filter({hasText:'waiting on an approval'}).waitFor();
if(await input.inputValue()!=='Try this request')throw Error('failed request not restored');
await input.fill('Add a compact view');await input.press('Enter');
const success=await page.evaluate(()=>window.sent.at(-1));
threads.maintenance.messages.push(msg('u3','user','Add a compact view',1790856080000));
await page.evaluate(id=>chat.onMaintenanceChatSent({t:'maintenance.chat.sent',id,workerId:'maintenance'}),success.id);
await page.waitForSelector('[data-message="u3"]');
if(await input.inputValue()!=='')throw Error('accepted request not cleared');
worker={...worker,status:'needs_input'};
await page.evaluate(()=>store.emit('workers'));
await page.waitForFunction(()=>document.querySelector('textarea').disabled);
await page.getByRole('button',{name:'Open terminal'}).click();
if(await page.evaluate(()=>window.watches.length)!==1)throw Error('terminal unavailable');
if(await page.locator('.maintenance-chat').count())throw Error('terminal does not close chat');
worker={...worker,status:'done'};
await page.evaluate(()=>openChat());await page.waitForSelector('[data-message="a2"]');
await page.getByRole('button',{name:'+ New conversation',exact:true}).click();
await page.waitForSelector('.maintenance-chat-empty');
if(await input.isDisabled())throw Error('new issue composer disabled after completion');
await input.fill('Build a meeting room');await input.press('Enter');
const newIssue=await page.evaluate(()=>window.sent.at(-1));
if(!newIssue.newConversation||newIssue.thread)throw Error('new issue did not request a fresh session');
threads.room={id:'room',title:'Build a meeting room',createdAt:2,updatedAt:1790856100000,hasOlder:false,messages:[msg('room1','user','Build a meeting room')]};
worker={...worker,id:'room',status:'working'};
await page.evaluate(id=>chat.onMaintenanceChatSent({t:'maintenance.chat.sent',id,workerId:'room'}),newIssue.id);
await page.waitForSelector('[data-message="room1"]');
if(await page.locator('[data-message="a2"]').count())throw Error('previous issue leaked into new conversation');
await page.getByRole('button',{name:'+ New conversation',exact:true}).click();
await page.waitForSelector('.maintenance-chat-empty');
if(!await input.isDisabled())throw Error('new issue allowed while Maintenance works');
await page.getByRole('button',{name:'Build a modern Maintenance chat view'}).click();
await page.waitForSelector('[data-message="a2"]');
if(!await input.isDisabled())throw Error('previous issue is not archived');
await page.getByRole('button',{name:'Current conversation',exact:true}).click();
await page.waitForSelector('[data-message="room1"]');
await page.screenshot({path:'/tmp/maintenance-chat-threads.png',animations:'disabled'});

await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/maintenance-chat-mobile.png',animations:'disabled'});
if(await page.locator('.maintenance-chat').evaluate(el=>el.scrollWidth>el.clientWidth || el.getBoundingClientRect().right>innerWidth || el.getBoundingClientRect().left<0))throw Error('mobile overflow');
await page.keyboard.press('Escape');if(await page.locator('.maintenance-chat').count())throw Error('Escape fails');
await page.setViewportSize({width:1360,height:980});
// Kiosk X opens a fresh draft without sending a kill or interrupting active work.
await page.evaluate(()=>window.chatModal=chat.openMaintenanceChat(m=>window.sent.push(m),window.actions,()=>window.stackOpens++, '', true));
await page.waitForSelector('.maintenance-chat-empty');
if(!await input.isDisabled())throw Error('kiosk draft allowed while Maintenance works');
if(await page.evaluate(()=>window.sent.some(m=>m.t==='worker.kill')))throw Error('draft stopped Maintenance');
await page.screenshot({path:'/tmp/maintenance-chat-new-draft.png',animations:'disabled'});
await page.getByRole('button',{name:'Current conversation',exact:true}).click();
await page.waitForSelector('[data-message="room1"]');
await page.keyboard.press('Escape');
// The experiment is opt-in, persisted locally, and can be disabled without losing the archive.
await page.evaluate(async()=>{
 const state=await import('/state.ts');localStorage.removeItem('agent-office.settings');
 if(state.loadSettings().maintenanceChat!==false)throw Error('not opt-in');
 let settings=state.loadSettings();
 const {openSettings}=await import('/ui/settings.ts');
 window.settingsModal=openSettings({send(){}},settings,s=>{settings=s;state.saveSettings(s)},()=>{},()=>{},{},()=>{},undefined,'experiments');
});
await page.getByRole('checkbox',{name:'Experimental Maintenance chat'}).check();
if(await page.evaluate(()=>JSON.parse(localStorage.getItem('agent-office.settings')).maintenanceChat)!==true)throw Error('preference not saved');
await page.screenshot({path:'/tmp/maintenance-chat-settings.png',animations:'disabled'});
await page.getByRole('checkbox',{name:'Experimental Maintenance chat'}).uncheck();
await page.keyboard.press('Escape');
if(issues.length)throw Error('Browser errors: '+issues.join('; '));
console.log('Passed: desktop/mobile, Markdown/HTML/code rendering and sanitization, archive search/read-only/reopen, request send/rejection/acknowledgement, approvals terminal, Escape close, opt-in settings persistence, fresh issue conversations, retained archive and busy guard.');
await browser.close();
