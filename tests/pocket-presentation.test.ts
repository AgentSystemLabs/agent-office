import test from 'node:test';
import assert from 'node:assert/strict';
import type { Stage } from '../src/client/core/scene';
import { pocketPresentation, softwareRenderer } from '../src/client/shared/pocket/presentation';

test('software graphics detection does not classify ordinary GPUs as software', () => {
  for(const name of ['ANGLE (Google, SwiftShader Device)','llvmpipe','Microsoft Basic Render Driver','Software Rasterizer']) assert.equal(softwareRenderer(name),true);
  for(const name of ['Apple M2','ANGLE (NVIDIA GeForce RTX)','Intel Iris Xe','AMD Radeon']) assert.equal(softwareRenderer(name),false);
});

test('Pocket pauses expensive drawing for its native inspector without changing simulation or networking', () => {
  const overlay={open:false};
  const presentation=pocketPresentation(overlay);
  assert.equal(presentation.shouldDraw({now:0}),true);
  assert.equal(presentation.shouldDraw({now:1}),true,'hardware retains normal rendering');
  overlay.open=true;
  assert.equal(presentation.shouldDraw({now:2}),false);
  overlay.open=false;
  assert.equal(presentation.shouldDraw({now:3}),true);
});

test('actual software WebGL uses the real world with bounded drawing and no costly shadow or outline passes', () => {
  const before=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{devicePixelRatio:2}});
  try {
    let ratio=2;
    const stage={renderer:{getContext:()=>({getExtension:()=>({UNMASKED_RENDERER_WEBGL:1}),getParameter:()=> 'ANGLE SwiftShader'}),setPixelRatio:(value:number)=>{ratio=value;},shadowMap:{enabled:true}},effect:{enabled:true}} as unknown as Stage;
    let localModal = false;
    const presentation=pocketPresentation({open:false}, () => localModal);
    presentation.setup(stage);
    assert.equal(ratio,0.6);
    assert.equal(stage.renderer.shadowMap.enabled,false);
    assert.equal(stage.effect.enabled,false);
    assert.equal(presentation.shouldDraw({now:0}),true);
    assert.equal(presentation.shouldDraw({now:49}),false);
    assert.equal(presentation.shouldDraw({now:50}),true);
    localModal = true;
    assert.equal(presentation.shouldDraw({now:100}),false,'software drawing yields to the real settings and hiring dialogs');
    localModal = false;
    assert.equal(presentation.shouldDraw({now:101}),true,'drawing resumes after the dialog closes');
  } finally { if(before) Object.defineProperty(globalThis,'window',before); else Reflect.deleteProperty(globalThis,'window'); }
});
