/* Multiplayer shell navigation, native controls and WCAG regression coverage. */
'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const target=process.env.SEEN_TEST_URL||'http://127.0.0.1:8765/index.html';
const results=[],errors=[],audits=[];
let browser;
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS',name);}catch(e){results.push({name,ok:false,error:String(e)});console.error('FAIL',name,e.stack);}}
(async()=>{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 for(const viewport of [{width:320,height:780},{width:412,height:915},{width:915,height:412},{width:1024,height:1536},{width:1536,height:1024}]){
  const c=await browser.newContext({viewport,isMobile:true,hasTouch:true,reducedMotion:'reduce'}),p=await c.newPage();
  p.on('pageerror',e=>errors.push(e.message));await p.goto(target);await p.waitForFunction(()=>SeenTeamUI.ready());await c.setOffline(true);await p.evaluate(()=>{prefs.textSize=130;prefs.reduced=true;prefs.sound=0;applyPrefs();render();});
  if(process.env.SEEN_AXE_PATH)await p.addScriptTag({path:process.env.SEEN_AXE_PATH});
  for(const screen of ['home','settings','teamHistory','library'])await check(`${screen}: RTL, readable controls and WCAG ${viewport.width}x${viewport.height}`,async()=>{
   await p.evaluate(screen=>navigate(screen),screen);
   const data=await p.evaluate(()=>({dir:document.documentElement.dir,width:innerWidth,scroll:document.documentElement.scrollWidth,invalid:[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length&&!(e.textContent.trim()||e.getAttribute('aria-label'))).map(e=>e.outerHTML),digits:/[٠-٩۰-۹]/.test(document.body.innerText)}));
   assert.equal(data.dir,'rtl');assert(data.scroll<=data.width+1);assert.deepEqual(data.invalid,[]);assert.equal(data.digits,false);
   if(process.env.SEEN_AXE_PATH){const out=await p.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}});return{violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),incomplete:r.incomplete.map(v=>v.id)};});audits.push({screen,viewport,...out});assert.deepEqual(out.violations,[]);}
  });
  await check(`removed routes cannot be reached by keyboard or navigation ${viewport.width}`,async()=>{
   for(const route of ['play','setup','profile','result','solo','daily','survival','practice']){await p.evaluate(r=>navigate(r),route);assert.equal(await p.evaluate(()=>route),'home');}
   assert.equal(await p.locator('[data-mode="solo"],[data-route="play"],[data-action="daily"],[data-action="solo-export"]').count(),0);
   await p.keyboard.press('Tab');assert(await p.evaluate(()=>document.activeElement!==null));
  });
  await c.close();
 }
 await check('no browser runtime exceptions',async()=>assert.deepEqual(errors,[]));await browser.close();const report={checks:results,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,skipped:0,errors,audits,environment:'Chromium touch emulation, no physical Samsung devices'};await fs.writeFile('/tmp/seen-accessibility-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed}));if(report.failed)process.exitCode=1;
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1;});
