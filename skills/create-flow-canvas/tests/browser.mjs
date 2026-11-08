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
    await new Promise(requestAnimationFrame);
  }
  throw new Error(message);
};
const html = await (await fetch('../assets/flow-canvas.html')).text();
const devices = ['mobile', 'tablet', 'desktop'];
const renders = (markup) => Object.fromEntries(devices.map((id) => [id, markup]));
const render = `<svg aria-label="Fixture icon"><use href="#fixture-icon"/></svg>
  <h1>Entry</h1><p id="taps">0</p><input aria-label="Entry field" value="initial">
  <button data-toggle>Toggle</button><a href="/unwanted" data-go="next">Continue</a>
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
async function canvas(data = scan()) {
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
  frame.srcdoc = source;
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
const nextFrame = () => new Promise(requestAnimationFrame);
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
  const x = rect.x * 270 / 390;
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
test('state and device changes await their documents before rebuilding Inspect', async () => {
  const { doc } = await canvas();
  await screen(doc);
  doc.querySelector('#seltb [title^="Inspect"]').click();
  doc.querySelector('.col[data-id="entry"] .states').click();
  let frame = await screen(doc);
  equal(frame.contentDocument.querySelector('h1').textContent,'Offline','state render mounted');
  await until(() => doc.querySelector('[data-comp="Action"]')?.getAttribute('aria-label') === 'Action, 1 on this screen', 'Inspect retained the previous state count');
  frame = await switchDevice(doc,'desktop',1200,772);
  equal(frame.contentDocument.querySelector('h1').textContent,'Offline','chosen state survives desktop switch');
  equal(doc.querySelector('[data-comp="Action"]').getAttribute('aria-label'),'Action, 1 on this screen','Inspect waits for desktop document');
  frame = await switchDevice(doc,'tablet',768,1024);
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
