import test from 'node:test';
import assert from 'node:assert/strict';
import type { Stage } from '../src/client/core/scene';
import { pocketPresentation, softwareRenderer } from '../src/client/shared/pocket/presentation';

test('software graphics detection does not classify ordinary GPUs as software', () => {
  for(const name of ['ANGLE (Google, SwiftShader Device)','llvmpipe','Microsoft Basic Render Driver','Software Rasterizer']) assert.equal(softwareRenderer(name),true);
  for(const name of ['Apple M2','ANGLE (NVIDIA GeForce RTX)','Intel Iris Xe','AMD Radeon']) assert.equal(softwareRenderer(name),false);
});

test('software preparation disables MSAA only on software GPUs and frees its temporary probe', () => {
  const before=Object.getOwnPropertyDescriptor(globalThis,'document');
  try {
    for (const name of ['ANGLE SwiftShader', 'Apple M2']) {
      let released=0;
      const options:unknown[]=[];
      Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>({getExtension:(extension:string)=>extension==='WEBGL_debug_renderer_info'?{UNMASKED_RENDERER_WEBGL:1}:{loseContext:()=>released++},getParameter:()=>name})})}});
      const canvas={getContext:(_kind:string,attributes:unknown)=>{options.push(attributes);}} as unknown as HTMLCanvasElement;
      pocketPresentation().prepare(canvas);
      assert.deepEqual(options,name.includes('SwiftShader')?[{alpha:false,antialias:false}]:[]);
      assert.equal(released,1);
    }
    Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>{throw Error('WebGL unavailable');}})}});
    assert.doesNotThrow(()=>pocketPresentation().prepare({} as HTMLCanvasElement));
  } finally { if(before)Object.defineProperty(globalThis,'document',before);else Reflect.deleteProperty(globalThis,'document'); }
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
    assert.equal(presentation.shouldDraw({now:199}),false);
    assert.equal(presentation.shouldDraw({now:200}),true);
    localModal = true;
    assert.equal(presentation.shouldDraw({now:400}),false,'software drawing yields to the real settings and hiring dialogs');
    localModal = false;
    assert.equal(presentation.shouldDraw({now:401}),true,'drawing resumes after the dialog closes');
    presentation.afterDraw();
    const completed=performance.now();
    assert.equal(presentation.shouldDraw({now:completed}),false,'the GPU gets idle time after submission');
    assert.equal(presentation.shouldDraw({now:completed+200}),true);
  } finally { if(before) Object.defineProperty(globalThis,'window',before); else Reflect.deleteProperty(globalThis,'window'); }
});
