/* Read-only Chromium accessibility/layout/performance checks. Playwright is test tooling.
   Run with local static server: node tests/accessibility.spec.cjs
   Optional: SEEN_AXE_PATH=/absolute/path/axe.min.js adds axe-core WCAG audits.
   file:// is blocked by managed browser policy and is not tested here. */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const URL = process.env.SEEN_TEST_URL || 'http://127.0.0.1:8765/index.html';
const axePath = process.env.SEEN_AXE_PATH;
const checks = [], audits = [], measurements = [], errors = [];
let browser;
async function check(name, fn) {
  try { await fn(); checks.push({name,ok:true}); console.log('PASS', name); }
  catch(error) { checks.push({name,ok:false,error:String(error)}); console.log('FAIL', name, String(error)); }
}
async function nav(page, route) { await page.locator(`[data-action="nav"][data-route="${route}"]:visible`).first().click(); }
async function inspect(page, screen, width, theme) {
  const data = await page.evaluate(() => {
    const visible = e => !!(e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
    const tooSmall = [...document.querySelectorAll('button,a[href],select,input:not([type="file"]),summary')].filter(visible).filter(e=>!e.matches(':disabled')).map(e=>{
      let target=e;
      if(e.matches('input[type="checkbox"]')) target=e.closest('label')||e;
      const r=target.getBoundingClientRect();
      return {name:(e.getAttribute('aria-label')||e.textContent||e.labels?.[0]?.textContent||e.id).trim().slice(0,110),tag:e.tagName,action:e.dataset.action||'',width:Math.round(r.width*10)/10,height:Math.round(r.height*10)/10};
    }).filter(r=>r.width<43.5||r.height<43.5);
    return {scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,headings:[...document.querySelectorAll('h1,h2,h3')].filter(visible).map(e=>({level:e.tagName,text:e.textContent.trim()})),emptyButtons:[...document.querySelectorAll('button')].filter(visible).filter(e=>!(e.getAttribute('aria-label')||e.textContent).trim()).map(e=>e.outerHTML),tooSmall};
  });
  audits.push({screen,width,theme,...data});
  assert(data.scroll<=data.client+1,`overflow: ${data.scroll} > ${data.client}`);
  assert.equal(data.emptyButtons.length,0,'unlabelled visible buttons');
  if(axePath) {
    const axe = await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}})).violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary,html:n.html.slice(0,300)}))})));
    audits[audits.length-1].axe=axe;
  }
  await fs.writeFile('/tmp/seen-accessibility-partial.json',JSON.stringify({audits,measurements,checks},null,2));
}
(async()=>{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const width of [320,1470]) for(const theme of ['dark','light']) {
  const context=await browser.newContext({viewport:{width,height:width===320?780:956},isMobile:true,hasTouch:true,deviceScaleFactor:2,reducedMotion:'reduce'});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(String(e)));
  const start=Date.now();
  await page.goto(URL,{waitUntil:'load'}); await page.waitForFunction(()=>window.SeenDiagnostics);
  await page.evaluate(({theme})=>{prefs.theme=theme;prefs.textSize=130;prefs.reduced=true;prefs.sound=0;prefs.music=0;prefs.timer=false;applyPrefs();persist();render();},{theme});
  await context.setOffline(true);
  measurements.push({width,theme,loadWallMs:Date.now()-start,...await page.evaluate(()=>({navigation:performance.getEntriesByType('navigation').map(n=>({domContentLoadedMs:n.domContentLoadedEventEnd,loadMs:n.loadEventEnd,transferSize:n.transferSize})),heap:performance.memory?{usedBytes:performance.memory.usedJSHeapSize,totalBytes:performance.memory.totalJSHeapSize}:null,domNodes:document.querySelectorAll('*').length}))});
  if(axePath) await page.addScriptTag({path:axePath});
  await check(`home 130% ${width} ${theme}`,()=>inspect(page,'home',width,theme));
  await check(`reduced motion ${width} ${theme}`,async()=>{
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.motion),'none');
    const animated=await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).animationName!=='none').length);
    assert.equal(animated,0);
  });
  await page.locator('[data-action="setup"][data-mode="solo"]').first().click();
  await check(`setup 130% ${width} ${theme}`,()=>inspect(page,'setup',width,theme));
  await page.locator('[data-action="start"]').click();
  await check(`question 130% ${width} ${theme}`,()=>inspect(page,'question',width,theme));
  await check(`answer keyboard focus ${width} ${theme}`,async()=>{
    await page.keyboard.press('Tab'); const button=page.locator('[data-action="answer"]').first();await button.focus();
    assert.equal(await button.evaluate(el=>el===document.activeElement),true);
    const outline=await button.evaluate(el=>({style:getComputedStyle(el).outlineStyle,width:getComputedStyle(el).outlineWidth}));assert.notEqual(outline.style,'none');assert.notEqual(outline.width,'0px');
    await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>session.current.phase),'feedback');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'next','feedback should focus the next question control');
  });
  await check(`feedback 130% ${width} ${theme}`,()=>inspect(page,'feedback',width,theme));
  await nav(page,'settings');
  await check(`settings 130% ${width} ${theme}`,()=>inspect(page,'settings',width,theme));
  await check(`keyboard selection retains context ${width} ${theme}`,async()=>{
    await page.locator('[data-pref="motion"]').focus();
    await page.locator('[data-pref="motion"]').selectOption('full');
    const active=await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id}));
    assert.equal(active.id,'pref-motion',`focus moved to ${active.tag}#${active.id}`);
  });
  await nav(page,'profile');
  await check(`profile 130% ${width} ${theme}`,()=>inspect(page,'profile',width,theme));
  await nav(page,'settings');
  await page.locator('[data-action="help"]:visible').first().click();
  await check(`dialog 130% ${width} ${theme}`,()=>inspect(page,'dialog',width,theme));
  await check(`dialog keyboard trap ${width} ${theme}`,async()=>{
    for(let i=0;i<6;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement===document.body||document.activeElement.closest('dialog')?.id==='dialog'),true,'focus escaped into background document');}
    await page.keyboard.press('Escape');assert.equal(await page.locator('#dialog').evaluate(e=>e.open),false);
  });
  await nav(page,'home');
  await page.locator('[data-action="setup"][data-mode="images"]').first().click();
  await page.locator('[data-action="start"]').click();
  if(await page.locator('#confirm-start').isVisible())await page.locator('#confirm-start').click();
  await check(`all visual descriptions avoid answer leakage ${width} ${theme}`,async()=>{
    const leaked=await page.evaluate(()=>QUESTION_BANK.filter(q=>q.image&&(!VISUALS[q.image].alt||VISUALS[q.image].alt.includes(q.options[q.answer]))).map(q=>q.id));assert.deepEqual(leaked,[]);
  });
  await check(`visual question accessible descriptions ${width} ${theme}`,async()=>{
    const snapshot=await page.evaluate(()=>{
      const q=QUESTION_MAP.get(session.current.id),image=document.querySelector('.question-media img');return {answer:q.options[q.answer],alt:image?.alt,src:image?.src,sub:document.querySelector('.question-label')?.textContent};
    });
    assert(snapshot.alt?.length,'meaningful image alternative missing');assert(/^data:image\/(?:svg\+xml|jpeg|png|webp)(?:;base64|;charset=[^,;]+|,)/i.test(snapshot.src),'supported visual must be embedded offline');assert(!snapshot.alt.includes(snapshot.answer),`alt reveals answer: ${snapshot.alt}`);
    assert(await page.locator('.question-media img').evaluate(async img=>{await img.decode();return img.complete&&img.naturalWidth>0;}),'embedded image must decode successfully');
  });
  await check(`image question 130% ${width} ${theme}`,()=>inspect(page,'image-question',width,theme));
  await page.screenshot({path:`/tmp/seen-a11y-${width}-${theme}.png`,fullPage:true});
  await context.close();
 }
 await check('all meaningful controls have at least 44px touch targets',async()=>{
   const small=audits.flatMap(a=>a.tooSmall.map(s=>({screen:a.screen,width:a.width,theme:a.theme,...s})));assert.deepEqual(small,[]);
 });
 if(axePath) await check('no WCAG A/AA axe violations',async()=>{
   const failures=audits.flatMap(a=>(a.axe||[]).filter(v=>!['page-has-heading-one','heading-order','landmark-one-main'].includes(v.id)).map(v=>({screen:a.screen,width:a.width,theme:a.theme,...v})));assert.deepEqual(failures,[]);
 });
 if(axePath) await check('semantic heading order across audited screens',async()=>assert.deepEqual(audits.flatMap(a=>(a.axe||[]).filter(v=>v.id==='heading-order').map(v=>({screen:a.screen,width:a.width,theme:a.theme,...v}))),[]));
 if(!axePath)checks.push({name:'axe-core WCAG and heading audits',skipped:true,reason:'Set SEEN_AXE_PATH to a local axe.min.js file to enable this optional audit.'});
 await check('no uncaught browser errors',async()=>assert.deepEqual(errors,[]));
 await browser.close();
 const report={testURL:URL,browser:'Chromium emulated touch; not Samsung hardware',fileWorkflow:'Not executed: managed file:// policy restriction',axe:axePath?'axe-core 4.10.3':'not enabled',checks,audits,measurements,errors};
 await fs.writeFile('/tmp/seen-accessibility-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>c.ok===false).length,skipped:checks.filter(c=>c.skipped).length,report:'/tmp/seen-accessibility-report.json'}));
 if(checks.some(c=>c.ok===false))process.exitCode=1;
})().catch(async error=>{console.error(error);await browser?.close();process.exitCode=1;});
