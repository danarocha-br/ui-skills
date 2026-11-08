import {largeScan} from './large-scan.mjs';
/* Browser seam: the real page, including its live screen host. Open tests/browser.html over HTTP.
   No test reaches into a module's private state. The scan fixture is replaced exactly as a generator would. */
const checks = [];
const test = (name, run) => checks.push({ name, run });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected),
  `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const until = async (read, message) => {
  const end = performance.now() + 8000;
  while (performance.now() < end) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 30));   /* a timer, so a tab that does not paint fails here instead of hanging */
  }
  throw new Error(message);
};
const html = await (await fetch('../assets/flow-canvas.html')).text();
const devices = ['mobile', 'tablet', 'desktop'];
const renders = (markup) => Object.fromEntries(devices.map((id) => [id, markup]));
const render = `<svg aria-label="Fixture icon"><use href="#fixture-icon"/></svg>
  <h1>Entry</h1><p id="taps">0</p><input aria-label="Entry field" value="initial">
  <button data-toggle>Toggle</button><a href="/unwanted" data-go="next">Continue</a><a id="plain" href="/other">Plain link</a>
  <div class="note scan cap states hop cx" id="collision">Product content</div>
  <div id="long-content" style="height:1800px;flex-shrink:0">Scrollable screen</div><button id="bottom">Bottom action</button>`;
const styles = `
  :where(.phone,.phone *){box-sizing:border-box;margin:0;padding:0}
  .phone{background:#e8f5ff;color:#005e89;font:16px system-ui,sans-serif;padding:24px;gap:16px}
  .phone svg{width:32px;height:32px;fill:currentColor;flex-shrink:0}
  button,input,a{font:inherit;padding:10px}
  #collision{--viewport-kind:wide}
  @media(max-width:500px){#collision{--viewport-kind:narrow}}
  #viewport-probe{position:fixed;width:100vw;height:100vh;pointer-events:none;opacity:0}
  .ui{background:#ff0000!important} /* this must never style the canvas chrome */`;
const scan = () => ({
  product: { id: `b2-browser-${Date.now()}-${Math.random()}`, name: 'Browser fixture' }, start: 'entry',
  icons: '<defs><symbol id="fixture-icon" viewBox="0 0 24 24"><path d="M12 1L23 12L12 23L1 12Z"/></symbol></defs>',
  components: { Action: 'button', Field: 'input', Collision: '#collision' },
  screens: [
    { id: 'entry', name: 'Entry', route: '/entry', components: ['Action', 'Field', 'Collision'],
      html: renders(render + '<i id="viewport-probe"></i>'),
      states: [{ name: 'Default' }, { name: 'Offline', html: renders('<h1>Offline</h1><button>Retry</button>') }] },
    { id: 'next', name: 'Next', route: '/next', components: ['Action'], html: renders('<h1>Next</h1><button>Done</button>'), states: [] },
  ],
  groups: [{ id: 'panel', title: 'Fixture flow', screens: ['entry','next'], open: true }],
  links: [{ from: 'entry', to: 'next', label: 'Continue' }], notes: [], findings: [],
});
async function canvas(data = scan(), { reducedMotion } = {}) {
  const frame = document.createElement('iframe');
  frame.title = 'Canvas under test';
  const source = html
    .replace(/(<style id="flow-scan-styles"[^>]*>)[\s\S]*?(<\/style>)/,
      (_, open, close) => open + styles + close)
    .replace(/(<script type="application\/json" id="flow-scan">)[\s\S]*?(<\/script>)/,
      (_, open, close) => open + JSON.stringify(data).replace(/<\//g, '<\\/') + close)
    .replace(/(<script id="flow-scan-behaviour">)[\s\S]*?(<\/script>)/,
      (_, open, close) => open + `window.FlowScanBehaviour={interactive:'[data-toggle]',onTap(id,target,root){
        if(target.closest('[data-toggle]'))root.querySelector('#taps').textContent=Number(root.querySelector('#taps').textContent)+1;
      }};` + close);
  const preference = `<script>
    (() => {
      const native = window.matchMedia.bind(window), changes = new EventTarget();
      const motion = { matches: false, addEventListener: (...args) => changes.addEventListener(...args),
        set(value) { this.matches=value; const event=new Event('change'); event.matches=value; changes.dispatchEvent(event); } };
      window.motionPreference=motion;
      window.matchMedia=query=>query==='(prefers-reduced-motion: reduce)' ? motion : native(query);
    })();
  </script>`;
  frame.srcdoc = reducedMotion === undefined ? source : source.replace('<head>', '<head>' + preference.replace('matches: false', 'matches: ' + reducedMotion));
  document.querySelector('#fixture').replaceChildren(frame);
  await until(() => frame.contentDocument?.querySelector('.col'), 'canvas did not boot');
  return { frame, doc: frame.contentDocument, win: frame.contentWindow };
}
async function screen(doc, id = 'entry') {
  const frame = await until(() => doc.querySelector(`.col[data-id="${id}"] iframe`), 'screen is not an iframe');
  await until(() => frame.contentDocument?.querySelector('h1') && frame.parentElement.getAttribute('aria-busy') === 'false', 'screen document did not mount');
  return frame;
}

test('a screen has an isolated document and the mobile viewport shown by the device switcher', async () => {
  const { doc } = await canvas();
  const frame = await screen(doc);
  equal([frame.contentWindow.innerWidth, frame.contentWindow.innerHeight], [390,844], 'mobile viewport');
  equal(doc.querySelectorAll('#collision').length, 0, 'product DOM stays out of the shell');
  const probe = frame.contentDocument.querySelector('#viewport-probe').getBoundingClientRect();
  equal([probe.width,probe.height], [390,844], 'viewport units');
  equal(frame.contentWindow.getComputedStyle(frame.contentDocument.querySelector('#collision')).getPropertyValue('--viewport-kind').trim(),
    'narrow', 'media queries use the screen viewport');
  assert(frame.contentDocument.querySelector('use').getBBox().width > 0, 'SVG symbols resolve in the screen document');
  assert(!doc.querySelector('#fixture-icon'), 'product SVG ids do not enter the shell');
  assert(doc.defaultView.getComputedStyle(doc.querySelector('.ui')).backgroundColor !== 'rgb(255, 0, 0)', 'product styles do not style chrome');
});

test('screen taps run product behaviour and follow only canvas connectors', async () => {
  const { doc } = await canvas();
  const frame = await screen(doc);
  frame.contentDocument.querySelector('[data-toggle]').click();
  equal(frame.contentDocument.querySelector('#taps').textContent, '1', 'product tap reaches its own root');
  frame.contentDocument.querySelector('[data-go]').click();
  await until(() => doc.querySelector('.col[data-id="next"].sel'), 'linked screen was not selected');
  assert(frame.contentDocument.querySelector('#taps'), 'data-go does not navigate the iframe');
  frame.contentDocument.querySelector('#plain').click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert(frame.contentDocument.querySelector('#taps') && frame.contentDocument.querySelector('#plain'), 'a plain link does not navigate the screen away');
  const data = scan();
  data.links = [];
  const unlinked = await canvas(data), other = await screen(unlinked.doc);
  other.contentDocument.querySelector('[data-go]').click();
  assert(unlinked.doc.querySelector('#toast').textContent.startsWith('No connector'), 'a data-go without a connector stays put');
  assert(unlinked.doc.querySelector('.col[data-id="entry"].sel'), 'the unlinked screen remains selected');
});

function press(frame, target, type, x, y, extra = {}) {
  const event = new frame.contentWindow.PointerEvent(type, { bubbles:true, cancelable:true,
    pointerId:1, pointerType:'mouse', isPrimary:true, button:0, buttons:type === 'pointerup' ? 0 : 1,
    clientX:x, clientY:y, ...extra });
  target.dispatchEvent(event);
  return event;
}
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 60));
test('background drags move a frame; native controls and product chrome-like names keep their meaning', async () => {
  const data = scan();
  data.groups = [];
  const { doc } = await canvas(data);
  const frame = await screen(doc), col = doc.querySelector('.col[data-id="entry"]');
  const at = () => col.style.translate.split(' ').map(parseFloat);
  const start = at();
  const target = frame.contentDocument.querySelector('#collision');
  press(frame,target,'pointerdown',100,200);
  press(frame,target,'pointermove',160,240);
  press(frame,target,'pointerup',160,240);
  await nextFrame();
  assert(at()[0] > start[0] && at()[1] > start[1], 'product class names do not intercept a frame drag');
  await until(() => at().every(Number.isInteger), 'dropped frame did not settle');
  // Consume the click after the drag, as the browser does.
  target.click();
  const moved = at();
  const field = frame.contentDocument.querySelector('input');
  press(frame,field,'pointerdown',100,100);
  press(frame,field,'pointermove',160,140);
  press(frame,field,'pointerup',160,140);
  equal(at(), moved, 'native inputs do not drag their frame');
  press(frame,target,'pointerdown',100,200);
  press(frame,target,'pointermove',200,260);
  press(frame,target,'pointercancel',200,260);
  await until(() => JSON.stringify(at()) === JSON.stringify(moved), 'cancelled frame did not settle back');
  equal(at(), moved, 'pointer cancellation restores the frame');
  press(frame,target,'pointermove',260,300);
  equal(at(), moved, 'cancelled pointer cannot keep dragging');
});

function key(frame, target, type, key, code, extra = {}) {
  const e = new frame.contentWindow.KeyboardEvent(type, { bubbles:true,cancelable:true,key,code,...extra });
  target.dispatchEvent(e);
  return e;
}
test('screen wheels scroll locally, modifier wheels zoom, and Space pans over controls without stealing typing', async () => {
  const { doc } = await canvas();
  const frame = await screen(doc), root = frame.contentDocument.body;
  const camera = () => doc.querySelector('#world').style.transform;
  const before = camera();
  const wheel = (extra = {}) => {
    const e = new frame.contentWindow.WheelEvent('wheel', {bubbles:true,cancelable:true,deltaY:30,clientX:120,clientY:200,...extra});
    root.dispatchEvent(e);
    return e;
  };
  equal(wheel().defaultPrevented,false,'ordinary wheel retains native screen scrolling');
  equal(camera(),before,'ordinary screen wheel does not pan the canvas');
  assert(root.scrollHeight > root.clientHeight, 'long screen has a native scroll area');
  assert(wheel({ctrlKey:true}).defaultPrevented,'modifier wheel suppresses browser zoom');
  assert(camera() !== before,'modifier wheel zooms the canvas');
  const field = root.querySelector('input'), col = doc.querySelector('.col[data-id="entry"]');
  key(frame,field,'keydown','d','KeyD');
  key(frame,field,'keydown','n','KeyN');
  equal(doc.querySelector('[data-dev="mobile"]').getAttribute('aria-pressed'),'true','typing does not switch devices');
  equal(doc.querySelectorAll('#notes .note').length,0,'typing does not create notes');
  const position = col.style.translate;
  const zoomed = camera();
  key(frame,root,'keydown',' ','Space');
  press(frame,field,'pointerdown',100,100);
  press(frame,field,'pointermove',180,150);
  press(frame,field,'pointerup',180,150);
  key(frame,field,'keyup',' ','Space');
  assert(camera() !== zoomed,'Space drag pans even when it begins on a control');
  equal(col.style.translate,position,'Space pan does not move the frame');
  key(frame,field,'keydown','k','KeyK',{ctrlKey:true});
  assert(doc.querySelector('#q'),'Search shortcut works from an input');
});

test('Inspect counts iframe components and draws highlights in canvas coordinates', async () => {
  const { doc, win } = await canvas();
  const frame = await screen(doc);
  doc.querySelector('#seltb [title^="Inspect"]').click();
  const field = await until(() => doc.querySelector('[data-comp="Field"]'), 'Inspector did not open');
  equal(field.getAttribute('aria-label'),'Field, 1 on this screen','component inventory sees the document');
  field.dispatchEvent(new win.MouseEvent('mouseenter'));
  const spot = doc.querySelector('.col[data-id="entry"] .spot');
  assert(spot,'hovering a component highlights it');
  const ring = spot.querySelector('rect[stroke]');
  const rect = frame.contentDocument.querySelector('input').getBoundingClientRect();
  const x = rect.x * doc.querySelector('.col[data-id="entry"] .phone').offsetWidth / frame.contentWindow.innerWidth;
  assert(Math.abs(Number(ring.getAttribute('x')) - Math.max(0,x - 3)) < 1,'highlight converts viewport coordinates to canvas pixels');
  frame.contentDocument.body.scrollTop = 500;
  await nextFrame();
  assert(!doc.querySelector('.spot'),'scroll clears the old highlight');
});

test('Search previews snapshot the current screen in their own inert documents', async () => {
  const { doc } = await canvas();
  const frame = await screen(doc);
  frame.contentDocument.querySelector('[data-toggle]').click();
  frame.contentDocument.querySelector('input').value = 'edited';
  doc.querySelector('#btnSearch').click();
  const preview = await until(() => {
    const current = doc.querySelector('#results .tile iframe');
    return current?.contentDocument?.querySelector('#taps') && current;
  }, 'preview did not load');
  equal(preview.contentDocument.querySelector('#taps').textContent,'1','preview copies live product state');
  equal(preview.contentDocument.querySelector('input').value,'edited','preview copies current field values');
  equal(preview.contentWindow.innerWidth,390,'preview keeps the real viewport');
  equal(preview.tabIndex,-1,'preview is outside the tab sequence');
  assert(preview.inert,'preview controls cannot receive focus');
  assert(preview.getBoundingClientRect().width > 0,'preview is scaled into a visible card');
  assert(preview.contentDocument.querySelector('use').getBBox().width > 0,'preview owns its SVG symbols');
});

async function switchDevice(doc, id, width, height) {
  doc.querySelector(`[data-dev="${id}"]`).click();
  await until(() => {
    const frame = doc.querySelector('.col[data-id="entry"] iframe');
    return frame?.contentWindow.innerWidth === width && frame.contentWindow.innerHeight === height
      && frame.parentElement.getAttribute('aria-busy') === 'false' && !doc.querySelector('#world.fading');
  }, `${id} did not finish mounting`);
  return screen(doc);
}
/* one scale for both axes: a card whose shape differs from the viewport's must not stretch the screen */
const uniformScale = (frame) => {
  const m = new DOMMatrix(frame.ownerDocument.defaultView.getComputedStyle(frame).transform);
  equal([m.a === m.d, m.a > 0], [true, true], 'the screen is scaled equally on both axes');
  const card = frame.parentElement;
  assert(frame.offsetWidth * m.a <= card.offsetWidth + 0.5 && frame.offsetHeight * m.d <= card.offsetHeight + 0.5, 'the scaled screen fits its card');
};
test('state and device changes await their documents before rebuilding Inspect', async () => {
  const { doc } = await canvas();
  await screen(doc);
  doc.querySelector('#seltb [title^="Inspect"]').click();
  doc.querySelector('.col[data-id="entry"] .states').click();
  let frame = await screen(doc);
  equal(frame.contentDocument.querySelector('h1').textContent,'Offline','state render mounted');
  await until(() => doc.querySelector('[data-comp="Action"]')?.getAttribute('aria-label') === 'Action, 1 on this screen', 'Inspect retained the previous state count');
  frame = await switchDevice(doc,'desktop',1200,772);
  uniformScale(frame);
  equal(frame.contentDocument.querySelector('h1').textContent,'Offline','chosen state survives desktop switch');
  equal(doc.querySelector('[data-comp="Action"]').getAttribute('aria-label'),'Action, 1 on this screen','Inspect waits for desktop document');
  frame = await switchDevice(doc,'tablet',768,1024);
  uniformScale(frame);
  equal(frame.contentDocument.querySelector('h1').textContent,'Offline','chosen state survives tablet switch');
  doc.querySelector('[data-st="0"]').click();
  frame = await screen(doc);
  frame.contentDocument.querySelector('[data-toggle]').click();
  equal(frame.contentDocument.querySelector('#taps').textContent,'1','behaviour binds to the replacement document');
  frame = await switchDevice(doc,'mobile',390,844);
  equal(frame.contentDocument.querySelector('#taps').textContent,'0','temporary interactions reset on device switch');
  equal(doc.querySelector('[data-comp="Field"]').getAttribute('aria-label'),'Field, 1 on this screen','Inspect sees the newly mounted mobile document');
});

test('native labels and disclosure summaries retain pointer and keyboard activation', async () => {
  const data = scan();
  data.screens[0].html = renders(`<h1>Native controls</h1>
    <label for="choice">Choose this</label><input id="choice" type="checkbox">
    <details><summary>More options</summary><p>Extra options</p></details>`);
  const { doc } = await canvas(data), frame = await screen(doc);
  const root = frame.contentDocument;
  for (const target of [root.querySelector('label'),root.querySelector('summary')]) {
    equal(press(frame,target,'pointerdown',100,100).defaultPrevented,false,'native activation does not begin a frame drag');
    press(frame,target,'pointerup',100,100);
    target.click();
  }
  assert(root.querySelector('input').checked,'label activates its checkbox');
  assert(root.querySelector('details').open,'summary toggles its disclosure');
  equal(key(frame,root.querySelector('summary'),'keydown',' ','Space').defaultPrevented,false,'Space remains native on summary');
  key(frame,root.querySelector('summary'),'keyup',' ','Space');
});

test('Search debounces typing and reuses unchanged preview documents', async () => {
  const {doc,win} = await canvas();
  await screen(doc);
  doc.querySelector('#btnSearch').click();
  const preview=await until(()=>doc.querySelector('#results .tile iframe'),'Search has no preview');
  const q=doc.querySelector('#q');
  for(const value of ['E','En','Entry']) { q.value=value; q.dispatchEvent(new win.Event('input',{bubbles:true})); }
  equal(doc.querySelectorAll('#results .tile').length,2,'typing does not immediately rebuild the results');
  await until(()=>doc.querySelectorAll('#results .tile').length===1,'debounced query did not run');
  equal(doc.querySelector('#results .tile iframe'),preview,'unchanged screen reuses its preview document');
  const live = doc.querySelector('.col[data-id="entry"] iframe');
  live.contentDocument.querySelector('#taps').textContent='changed';
  live.contentDocument.querySelector('input').value='new field value';
  q.value='Entr'; q.dispatchEvent(new win.Event('input',{bubbles:true}));
  const updated=await until(()=>{
    const f=doc.querySelector('#results .tile iframe');
    return f!==preview && f?.contentDocument?.querySelector('#taps')?.textContent==='changed' && f;
  },'changed screen did not invalidate its snapshot');
  equal(updated.contentDocument.querySelector('input').value,'new field value','cached snapshots track property-only field changes');
});

test('unmounting preserves product taps, field values, scroll and the shown state', async () => {
  const {doc,win}=await canvas(largeScan(scan()));
  await until(()=>!doc.body.classList.contains('boot'),'canvas did not finish booting');
  doc.querySelector('#seltb [title^="Focus"]').click();
  await until(()=>!doc.querySelector('#stage.fly'),'focus did not finish');
  let frame=await screen(doc,'screen-1');
  frame.contentDocument.querySelector('[data-toggle]').click();
  frame.contentDocument.querySelector('input').value='kept across unmount';
  frame.contentDocument.body.scrollTop=350;
  const scroll=frame.contentDocument.body.scrollTop;
  key(frame,frame.contentDocument.body,'keydown','Escape','Escape');
  const stage=doc.querySelector('#stage');
  stage.dispatchEvent(new win.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:12000,deltaY:0}));
  await until(()=>!doc.querySelector('.col[data-id="screen-1"] iframe'),'screen did not unmount');
  /* a spotlight drawn the moment a resumed screen has loaded (a finding does this) must outlive the scroll
     event that restoring the offset makes the browser fire; only the person scrolling clears it */
  const spot=doc.createElement('div');spot.className='spot';
  const ph=doc.querySelector('.col[data-id="screen-1"] .phone');
  new win.MutationObserver((_,watch)=>{
    const f=ph.querySelector('iframe');
    if(!f)return;
    watch.disconnect();
    f.addEventListener('load',()=>{ if(f.contentDocument.querySelector('#taps')) ph.appendChild(spot); });
  }).observe(ph,{childList:true});
  doc.querySelector('.col[data-id="screen-1"] .label').click();
  frame=await screen(doc,'screen-1');
  assert(spot.isConnected,'a spotlight drawn as a resumed document loads survives its restored scroll');
  equal(frame.contentDocument.querySelector('#taps').textContent,'1','product reaction survives unmount');
  equal(frame.contentDocument.querySelector('input').value,'kept across unmount','field value survives unmount');
  equal(frame.contentDocument.body.scrollTop,scroll,'scroll survives unmount');
  await nextFrame();await nextFrame();
  assert(spot.isConnected,'restoring the scroll offset does not clear a spotlight');
  frame.contentDocument.body.scrollTop=scroll-40;
  await nextFrame();
  assert(!spot.isConnected,'the person scrolling still clears it');
  frame.contentDocument.body.scrollTop=scroll;
  doc.querySelector('.col[data-id="screen-1"] .states').click();
  frame=await screen(doc,'screen-1');
  equal(frame.contentDocument.querySelector('h1').textContent,'Offline','state switches to its own render');
  key(frame,frame.contentDocument.body,'keydown','Escape','Escape');
  stage.dispatchEvent(new win.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:12000,deltaY:0}));
  await until(()=>!doc.querySelector('.col[data-id="screen-1"] iframe'),'state document did not unmount');
  doc.querySelector('.col[data-id="screen-1"] .label').click();
  frame=await screen(doc,'screen-1');
  equal(frame.contentDocument.querySelector('h1').textContent,'Offline','shown state survives unmount');
});

test('a 60-screen flow keeps placeholders while mounting and releasing only nearby documents', async () => {
  const data = largeScan(scan());
  const {doc,win} = await canvas(data);
  await until(()=>!doc.body.classList.contains('boot'),'canvas did not finish booting');
  equal(doc.querySelectorAll('.col').length,60,'all frame outlines and labels exist');
  assert(doc.querySelectorAll('#frames iframe').length < 60,'far screens have no document');
  const far = doc.querySelector('.col[data-id="screen-60"]');
  assert(!far.querySelector('iframe'),'last screen starts unmounted');
  // Selecting an unmounted frame and opening Inspect uses the on-demand readiness path.
  far.querySelector('.label').click();
  doc.querySelector('#seltb [title^="Inspect"]').click();
  await until(()=>doc.querySelector('[data-comp="Action"]')?.getAttribute('aria-label') === 'Action, 1 on this screen', 'Inspect did not await a far document');
  const chip=doc.querySelector('[data-comp="Action"]');
  chip.dispatchEvent(new win.MouseEvent('mouseenter'));
  assert(far.querySelector('.spot'),'spotlight reaches the newly mounted screen');
  doc.querySelector('#pclose').click();
  // Focused camera keeps live documents bounded after travelling the long flow.
  await nextFrame();
  assert(doc.querySelectorAll('#frames iframe').length < 20,'focused view releases distant documents');
});

test('Search parks previews outside the panel viewport and removes them on close', async () => {
  const {doc}=await canvas(largeScan(scan()));
  await until(()=>!doc.body.classList.contains('boot'),'canvas did not boot');
  doc.querySelector('#btnSearch').click();
  const first=await until(()=>doc.querySelector('#results .tile iframe'),'first preview did not mount');
  const body=doc.querySelector('#pbody');
  body.scrollTop=body.scrollHeight;
  await until(()=>doc.querySelector('#results .tile:last-child iframe'),'last preview did not mount');
  assert(!first.isConnected,'preview leaving the panel margin is released');
  assert(doc.querySelectorAll('#results iframe').length<12,'Search keeps only nearby preview documents');
  doc.querySelector('#pclose').click();
  equal(doc.querySelectorAll('#results iframe').length,0,'closed Search has no preview documents');
});

test('closing Search cancels an offscreen read before its document finishes loading', async () => {
  const {doc,win}=await canvas(largeScan(scan()));
  await until(()=>!doc.body.classList.contains('boot'),'canvas did not boot');
  const far=doc.querySelector('.col[data-id="screen-60"]');
  assert(!far.querySelector('iframe'),'far screen begins unmounted');
  doc.querySelector('#btnSearch').click();
  const q=doc.querySelector('#q');q.value='Screen 60';q.dispatchEvent(new win.Event('input',{bubbles:true}));
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Search never requested the far document')),6000);
    const observer=new MutationObserver(()=>{
      if(!far.querySelector('iframe'))return;
      observer.disconnect();clearTimeout(timeout);
      doc.querySelector('#pclose').click();
      Promise.resolve().then(()=>{
        try { assert(!far.querySelector('iframe'),'canceled read immediately releases its offscreen document'); resolve(); }
        catch(error) { reject(error); }
      });
    });
    observer.observe(far,{subtree:true,childList:true});
  });
});

test('Inspect cancels a document read when its subject is deselected before load', async () => {
  const {doc,win}=await canvas(largeScan(scan()));
  await until(()=>!doc.body.classList.contains('boot'),'canvas did not boot');
  doc.querySelector('#seltb [title^="Inspect"]').click();
  await until(()=>doc.querySelector('[data-comp="Field"]'),'Inspect did not open');
  const far=doc.querySelector('.col[data-id="screen-60"]');
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Inspect never requested the far document')),6000);
    const observer=new MutationObserver(()=>{
      if(!far.querySelector('iframe'))return;
      observer.disconnect();clearTimeout(timeout);
      far.querySelector('.label').dispatchEvent(new win.MouseEvent('click',{bubbles:true,shiftKey:true}));
      Promise.resolve().then(()=>{
        try { assert(!far.querySelector('iframe'),'deselected Inspect subject immediately releases its pending document'); resolve(); }
        catch(error) { reject(error); }
      });
    });
    observer.observe(far,{subtree:true,childList:true});
    far.querySelector('.label').click();
  });
});

test('a finding retains its offscreen screen for the whole spotlight interaction', async () => {
  const data=largeScan(scan());
  data.findings=[{id:'far-finding',kind:'reused-component',frame:'screen-60',component:'Action',pos:{mobile:[-18000,50]}}];
  const {doc}=await canvas(data);
  await until(()=>!doc.body.classList.contains('boot'),'canvas did not boot');
  const far=doc.querySelector('.col[data-id="screen-60"]');
  assert(!far.querySelector('iframe'),'finding screen begins unmounted');
  const finding=doc.querySelector('[data-sid="far-finding"]');
  finding.focus({preventScroll:true});
  await until(()=>far.querySelector('.spot'),'finding did not mount and spotlight its screen');
  await nextFrame();
  assert(far.querySelector('iframe') && far.querySelector('.spot'),'finding keeps its document while focused');
  finding.blur();
  await until(()=>!far.querySelector('iframe'),'ending spotlight did not release the far document');
  finding.focus({preventScroll:true});
  await until(()=>far.querySelector('.spot'),'finding did not reacquire its document');
  finding.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{bubbles:true,key:'ArrowRight',code:'ArrowRight'}));
  doc.body.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{bubbles:true,key:'z',code:'KeyZ',ctrlKey:true}));
  await until(()=>!finding.isConnected,'Undo did not rebuild finding cards');
  await until(()=>!far.querySelector('iframe'),'replacing a focused finding leaked its screen request');
});

test('a camera flight keeps origin screens mounted while they remain near the animated viewport', async () => {
  const {doc,win}=await canvas(largeScan(scan()));
  await until(()=>!doc.body.classList.contains('boot'),'canvas did not boot');
  doc.querySelector('#seltb [title^="Focus"]').click();
  await until(()=>!doc.querySelector('#stage.fly'),'focus did not settle');
  const origin=doc.querySelector('.col[data-id="screen-2"]');
  await until(()=>origin.querySelector('iframe'),'origin neighbor did not mount');
  doc.querySelector('.col[data-id="screen-8"] .label').dispatchEvent(new win.MouseEvent('dblclick',{bubbles:true}));
  await new Promise(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(resolve)));
  const rect=origin.getBoundingClientRect();
  assert(rect.right>=-300 && rect.left<=win.innerWidth+300,'origin is still near the viewport during flight');
  assert(origin.querySelector('iframe'),'visible origin document stays mounted during flight');
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'+',code:'Equal'}));
  for(let i=0;i<8;i++) {
    await new Promise(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(resolve)));
    const near=[...doc.querySelectorAll('.col')].filter(col=>{
      const r=col.getBoundingClientRect();
      return r.right>=-280 && r.left<=win.innerWidth+280 && r.bottom>=-280 && r.top<=win.innerHeight+280;
    });
    assert(near.every(col=>col.querySelector('iframe')),'zoom interrupted a flight and released near documents');
  }
});

test('frames and placeholders have names and keyboard focus independently of their documents', async () => {
  const {doc,win} = await canvas(largeScan(scan()));
  await until(()=>!doc.body.classList.contains('boot'),'canvas did not boot');
  const far = doc.querySelector('.col[data-id="screen-60"]');
  assert(!far.querySelector('iframe'),'far frame begins without a document');
  equal(far.tabIndex,0,'placeholder is a tab stop');
  equal(far.getAttribute('role'),'group','frame role keeps child controls visible');
  const label = far.getAttribute('aria-label');
  assert(label.includes('Route ') && label.includes('State Default') && label.includes('Not selected'), 'placeholder names route, state and selection');
  far.focus();
  equal(doc.activeElement,far,'focus does not await a document');
  assert(far.getAttribute('aria-label').includes('Selected.'),'selection is named');
  await screen(doc,'screen-60');
  equal(far.getAttribute('aria-label'),label.replace('Not selected.','Selected.'),'mounting does not change semantics');
  key({contentWindow:win},far,'keydown','ArrowLeft','ArrowLeft');
  equal(doc.activeElement.dataset.id,'screen-59','arrow moves DOM focus as well as selection');
  assert([...doc.querySelectorAll('.col')].every(col=>col.tabIndex===0),'every frame remains reachable by Tab');
});

test('frame keyboard actions reorder, take out, move, regroup, connect and undo through the real page', async () => {
  const data=scan(); data.links=[];
  const {doc,win}=await canvas(data);
  const frame=doc.querySelector('.col[data-id="entry"]');
  const send=(keyName,code,extra={})=>key({contentWindow:win},doc.activeElement,'keydown',keyName,code,extra);
  frame.focus();
  send('ArrowRight','ArrowRight',{altKey:true,shiftKey:true});
  assert(doc.querySelector('#toast').textContent.includes('2 of 2'),'reorder result is announced');
  send('z','KeyZ',{ctrlKey:true});
  assert(doc.querySelector('.col[data-id="entry"]').getAttribute('aria-label').includes('frame 1 of 2'),'undo restores order');
  doc.querySelector('.col[data-id="entry"]').focus();
  send('G','KeyG',{ctrlKey:true,shiftKey:true});
  let loose=doc.querySelector('.col[data-id="entry"]');
  assert(loose.classList.contains('free'),'existing take-out shortcut stays usable');
  loose.focus();
  const position=loose.style.translate;
  send('ArrowRight','ArrowRight',{shiftKey:true});
  assert(doc.querySelector('#toast').textContent.includes('Moved'),'loose movement is announced');
  await until(()=>loose.style.translate!==position,'loose frame did not move');
  send('F10','F10',{shiftKey:true});
  const dialog=doc.querySelector('#frameActions');
  assert(dialog.open,'keyboard opens frame actions');
  const target=dialog.querySelector('[name="group"]');
  target.value='panel'; dialog.querySelector('[data-frame-action="join"]').click();
  assert(!doc.querySelector('.col[data-id="entry"]').classList.contains('free'),'picker regroups frame');
  await until(()=>!dialog.open && loose.querySelector('.frame-actions').getAttribute('aria-expanded')==='false','dialog close handler did not finish');
  send('F10','F10',{shiftKey:true});
  dialog.querySelector('[name="destination"]').value='next';
  dialog.querySelector('[data-frame-action="connect"]').click();
  await until(()=>!dialog.open && loose.querySelector('.frame-actions').getAttribute('aria-expanded')==='false','connector dialog close handler did not finish');
  equal(doc.querySelectorAll('#cchips .echip').length,1,'picker creates a connector');
  assert(doc.querySelector('#toast').textContent.includes('Connected'),'connector is announced');
  equal(doc.activeElement.dataset.id,'entry','dialog returns focus to its frame');
  send('z','KeyZ',{ctrlKey:true});
  equal(doc.querySelectorAll('#cchips .echip').length,0,'connector is one undo step');
});

test('group disclosures, popup menus and panel toggles expose their state and return keyboard focus', async () => {
  const {doc,win}=await canvas();
  const send=(target,name,code=name,extra={})=>key({contentWindow:win},target,'keydown',name,code,extra);
  const disclosure=doc.querySelector('.chev');
  disclosure.focus(); disclosure.click();
  equal(disclosure.getAttribute('aria-expanded'),'false','group is announced closed');
  disclosure.click(); equal(disclosure.getAttribute('aria-expanded'),'true','group is announced open');
  for (const [trigger,popup] of [['#btnAdd','#mAdd'],['#btnSpace','#mSpace'],['#btnViews','#mViews'],['.fmore','#mGroup']]) {
    const button=doc.querySelector(trigger); button.focus(); button.click();
    equal(button.getAttribute('aria-haspopup'),'menu','button declares a menu');
    equal(button.getAttribute('aria-expanded'),'true','open state is announced');
    equal(doc.querySelector(popup).getAttribute('role'),'menu','popup has the matching role');
    const first=doc.activeElement;
    send(first,'ArrowDown'); assert(doc.activeElement!==first,'arrow navigates within popup');
    send(doc.activeElement,'Escape');
    equal(button.getAttribute('aria-expanded'),'false','closed state is announced');
    equal(doc.activeElement,button,'Escape restores menu trigger');
  }
  doc.querySelector('#btnAdd').click();
  send(doc.activeElement,'k','KeyK',{ctrlKey:true});
  await until(()=>doc.activeElement.id==='q','Search shortcut was swallowed by the popup');
  assert(!doc.querySelector('#mAdd').classList.contains('open'),'Search closes the popup');
  send(doc.activeElement,'Escape');
  const frame=doc.querySelector('.col[data-id="entry"]'); frame.focus();
  send(frame,'i','KeyI');
  equal(doc.querySelector('#seltb [data-a="inspect"]').getAttribute('aria-expanded'),'true','Inspect toggle reports open');
  send(doc.activeElement,'Escape'); equal(doc.activeElement,frame,'Inspect closes back to frame');
  send(frame,'k','KeyK',{ctrlKey:true});
  equal(doc.querySelector('#btnSearch').getAttribute('aria-expanded'),'true','Search toggle reports open');
  send(doc.activeElement,'Escape');
  equal(doc.querySelector('#btnSearch').getAttribute('aria-expanded'),'false','Search toggle reports closed');
  equal(doc.activeElement,frame,'Search restores frame focus');
});

test('Enter reaches a screen control, Tab remains native, and Escape and Search return to canvas chrome', async () => {
  const {doc,win}=await canvas();
  const frame=doc.querySelector('.col[data-id="entry"]'); frame.focus();
  key({contentWindow:win},frame,'keydown','Enter','Enter');
  const product=await screen(doc);
  await until(()=>product.contentDocument.activeElement.matches('input'),'Enter did not focus the first screen control');
  const input=product.contentDocument.activeElement;
  assert(!key(product,input,'keydown','Tab','Tab').defaultPrevented,'forward Tab is native');
  assert(!key(product,input,'keydown','Tab','Tab',{shiftKey:true}).defaultPrevented,'backward Tab is native');
  key(product,input,'keydown','k','KeyK',{ctrlKey:true});
  await until(()=>doc.activeElement.id==='q','Search did not cross the document boundary');
  key({contentWindow:win},doc.activeElement,'keydown','Escape','Escape');
  input.focus(); key(product,input,'keydown','Escape','Escape');
  equal(doc.activeElement,frame,'Escape returns to wrapper');
  assert(!doc.querySelector('#panel').classList.contains('open'),'panel stays closed');
});

test('reduced-motion Play waits for Next, skips connector tokens and reacts to preference changes', async () => {
  const {doc,win}=await canvas(scan(),{reducedMotion:true});
  doc.querySelector('.fplay').click();
  await until(()=>!doc.querySelector('#playControls').hidden,'manual playback did not open');
  await new Promise(resolve=>setTimeout(resolve,2100));
  assert(doc.querySelector('.col[data-id="entry"]').classList.contains('sel'),'reduced Play did not auto-advance');
  doc.querySelector('#playNext').click();
  assert(doc.querySelector('.col[data-id="next"]').classList.contains('sel'),'Next advances manually');
  equal(doc.querySelectorAll('.token').length,0,'manual reduced playback creates no moving token');
  assert(doc.querySelector('#playNext').disabled,'last screen has no next');
  doc.querySelector('#playStop').click();
  win.motionPreference.set(false);
  doc.querySelector('.fplay').click();
  await until(()=>doc.querySelector('.col[data-id="next"]').classList.contains('sel'),'ordinary Play did not auto-advance');
  doc.querySelector('#playStop').click();
  doc.querySelector('.fplay').click();
  win.motionPreference.set(true);
  await new Promise(resolve=>setTimeout(resolve,2100));
  assert(doc.querySelector('.col[data-id="entry"]').classList.contains('sel'),'preference change cancels pending automatic tick');
  assert(!doc.querySelector('#playControls').hidden,'preference change offers manual controls');
});

test('Enter skips effectively disabled controls and can reach native summaries and editable text', async () => {
  const data=scan();
  data.screens[0].html=renders('<h1>Entry</h1><fieldset disabled><input aria-label="Unavailable"></fieldset><button hidden>Hidden</button><button tabindex="-1">Skip</button><details><summary>Options</summary><p>Details</p></details><button>Later</button>');
  let result=await canvas(data), frame=result.doc.querySelector('.col[data-id="entry"]');
  frame.focus(); key({contentWindow:result.win},frame,'keydown','Enter','Enter');
  let product=await screen(result.doc);
  await until(()=>product.contentDocument.activeElement.tagName==='SUMMARY','Enter did not reach available summary');
  data.screens[0].html=renders('<h1>Entry</h1><div contenteditable="true" aria-label="Editable">Text</div><button>Later</button>');
  result=await canvas(data); frame=result.doc.querySelector('.col[data-id="entry"]');
  frame.focus(); key({contentWindow:result.win},frame,'keydown','Enter','Enter');
  product=await screen(result.doc);
  await until(()=>product.contentDocument.activeElement.isContentEditable,'Enter did not reach editable text');
});

test('keyboard entry after a prior pointer focus selects the screen again and a closed group stays closed', async () => {
  const {doc,win}=await canvas();
  const product=await screen(doc), field=product.contentDocument.querySelector('input');
  press(product,field,'pointerdown',100,100); field.focus(); press(product,field,'pointerup',100,100);
  const other=doc.querySelector('.col[data-id="next"]');
  key({contentWindow:win},doc.body,'keydown','Tab','Tab'); other.focus();
  assert(other.classList.contains('sel'),'other screen is selected before re-entry');
  key({contentWindow:win},other,'keydown','Tab','Tab',{shiftKey:true});
  field.focus();
  assert(doc.querySelector('.col[data-id="entry"]').classList.contains('sel'),'keyboard entry is not suppressed by an old pointer event');
  const disclosure=doc.querySelector('.chev'); disclosure.click();
  await until(()=>disclosure.getAttribute('aria-expanded')==='false','group did not close');
  const col=doc.querySelector('.col[data-id="entry"]'), action=col.querySelector('.frame-actions');
  equal(col.tabIndex,-1,'a closed group\'s frame is not a Tab stop');
  equal(action.tabIndex,-1,'its invisible controls are not Tab stops');
  action.focus();
  equal(disclosure.getAttribute('aria-expanded'),'false','focus does not write the layout: the group stays closed');
});

test('Shift does not turn the global shortcuts off, and a chord still does', async () => {
  const {doc,win}=await canvas(), w={contentWindow:win};
  const camera=()=>doc.querySelector('#world').style.transform, before=camera();
  key(w,doc.body,'keydown','+','Equal',{shiftKey:true});
  await until(()=>camera()!==before,'Shift+plus did not zoom in');
  await new Promise(resolve=>setTimeout(resolve,500));
  const zoomed=camera();
  key(w,doc.body,'keydown','=','Equal',{ctrlKey:true});
  await new Promise(resolve=>setTimeout(resolve,500));
  equal(camera(),zoomed,'Control+= belongs to the browser, not to canvas zoom');
  key(w,doc.body,'keydown','/','Slash',{shiftKey:true});
  await until(()=>doc.querySelector('#q'),'a shifted slash did not open Search');
});

test('Escape inside a screen closes an open panel first, and leaves a key the product took alone', async () => {
  const {doc,win}=await canvas();
  const frame=doc.querySelector('.col[data-id="entry"]'); frame.focus();
  key({contentWindow:win},frame,'keydown','i','KeyI');
  await until(()=>doc.querySelector('#panel').classList.contains('open'),'Inspect did not open');
  const product=await screen(doc), input=product.contentDocument.querySelector('input');
  input.focus();
  key(product,input,'keydown','Escape','Escape');
  assert(!doc.querySelector('#panel').classList.contains('open'),'the first Escape closes the panel');
  assert(doc.activeElement!==frame,'the first Escape does not also leave the screen');
  input.addEventListener('keydown',(e)=>{ if (e.key==='Escape') e.preventDefault(); });
  key(product,input,'keydown','Escape','Escape');
  assert(doc.activeElement!==frame,'an Escape the product handled is not the canvas\'s');
});

test('Frame actions stay open across moves, say what happened, and keep focus inside', async () => {
  const {doc,win}=await canvas(), w={contentWindow:win};
  const frame=doc.querySelector('.col[data-id="entry"]'); frame.focus();
  key(w,frame,'keydown','F10','F10',{shiftKey:true});
  const dialog=doc.querySelector('#frameActions');
  assert(dialog.open,'keyboard opens frame actions');
  dialog.querySelector('[data-frame-action="later"]').click();
  assert(dialog.open,'a move leaves the dialog open');
  assert(doc.querySelector('#frameActionStatus').textContent.length>0,'the move is announced in the dialog');
  assert(dialog.contains(doc.activeElement),'focus stays inside the dialog');
  dialog.close();
});

test('names follow a group rename, the chevron and Play keep one state each, and Ungroup leaves focus on a frame', async () => {
  const {doc}=await canvas();
  const title=doc.querySelector('.gtitle'), chev=doc.querySelector('.chev');
  title.textContent='Renamed flow'; title.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));
  assert(chev.getAttribute('aria-label').includes('Renamed flow'),'the chevron follows the rename');
  assert(doc.querySelector('.col[data-id="entry"]').getAttribute('aria-label').includes('Renamed flow'),'frame names follow the rename');
  assert(!/^(Open|Close)/.test(chev.getAttribute('aria-label')),'the disclosure name does not flip with its state');
  assert(!doc.querySelector('.fplay').hasAttribute('aria-pressed'),'Play is an action, not a toggle');
  doc.querySelector('.fmore').click();
  const ungroup=doc.querySelector('#mGroup [data-ga="ungroup"]');
  ungroup.click();
  await until(()=>doc.activeElement?.closest?.('.col'),'focus did not land on a frame after Ungroup');
});

test('explicit keyboard navigation stops automatic Play and single-screen manual Play focuses Stop', async () => {
  let {doc,win}=await canvas();
  doc.querySelector('.fplay').click();
  const first=doc.querySelector('.col[data-id="entry"]'); first.focus();
  key({contentWindow:win},first,'keydown','ArrowRight','ArrowRight');
  assert(!doc.querySelector('.fplay').classList.contains('on'),'arrow navigation stops Play');
  const data=scan(); data.groups[0].screens=['entry'];
  ({doc,win}=await canvas(data,{reducedMotion:true}));
  doc.querySelector('.fplay').click();
  await until(()=>doc.activeElement.id==='playStop','single-screen manual flow did not focus Stop');
  assert(doc.querySelector('#playNext').disabled,'single-screen flow has no Next');
});

document.querySelector('#run').onclick = async () => {
  const button = document.querySelector('#run');
  button.disabled = true;
  const results = document.querySelector('#results');
  results.replaceChildren();
  let passed = 0;
  for (const check of checks) {
    const item = document.createElement('li');
    item.textContent = `Running: ${check.name}`;
    results.appendChild(item);
    try { await check.run(); item.dataset.result = 'pass'; item.textContent = `PASS: ${check.name}`; passed++; }
    catch (error) { item.dataset.result = 'fail'; item.textContent = `FAIL: ${check.name}\n${error.message}`; }
    document.querySelector('#summary').textContent = `${passed}/${results.children.length} passed`;
  }
  button.disabled = false;
};
