import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FlowMounts} from './modules.mjs';
const frames = [
  {id:'visible', x:100,y:100,w:200,h:400},
  {id:'near', x:1450,y:100,w:200,h:400},
  {id:'far', x:2000,y:100,w:200,h:400},
  {id:'above', x:100,y:-800,w:200,h:400},
];
const viewport={x:0,y:0,w:1280,h:800};
const choose = (args={}) => FlowMounts.choose({frames,viewport,...args});
test('mounts visible and nearby frames, with selected and requested screens even far away', () => {
  assert.deepEqual(choose(), ['visible','near']);
  assert.deepEqual(choose({selected:['far'], requested:['above','missing']}), ['visible','near','far','above']);
});
test('near is 300 CSS pixels at every zoom and includes boundary-touching frames', () => {
  const frames=[{id:'edge',x:3160,y:0,w:200,h:400},{id:'outside',x:3161,y:0,w:200,h:400}];
  assert.deepEqual(choose({frames,viewport:{x:0,y:0,w:2560,h:1600},scale:0.5}), ['edge']);
  assert.deepEqual(choose({frames,viewport:{x:0,y:0,w:640,h:400},scale:2}), []);
});
test('moving the viewport releases old screens and keeps forced ids in scan order without duplicates', () => {
  assert.deepEqual(choose({viewport:{x:2000,y:0,w:500,h:800},selected:['visible','visible'],requested:['visible','far']}), ['visible','far']);
  assert.deepEqual(choose({frames:[]}), []);
});
