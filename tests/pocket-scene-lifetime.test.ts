import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore The public extension host deliberately uses plain JavaScript.
import setup from '../integrations/pi-pocket/office-v2-client/index.js';

test('a source change unmounts the old world and cannot bind it to the new floor before passive effects run', async () => {
  const previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const previousLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
  const handlers=new Set<(event:unknown)=>void>();
  const worldWindow={postMessage:()=>{}};
  const frame={contentWindow:worldWindow};
  Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener:(_type:string,fn:(event:unknown)=>void)=>handlers.add(fn),removeEventListener:(_type:string,fn:(event:unknown)=>void)=>handlers.delete(fn)}});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://pocket.test'}});
  const states:unknown[]=[];
  const refs:{current:unknown}[]=[];
  let stateIndex=0,refIndex=0,frameCount=0;
  let layout:(()=>void|(()=>void))|undefined;
  let dispose:(()=>void)|undefined;
  let Office:(()=>unknown)|undefined;
  const calls:string[]=[];
  const pocket={
    html:(strings:TemplateStringsArray,...values:unknown[])=>{
      if(strings.join('').includes('<iframe ')) {
        frameCount++;
        const ref=values.find(value=>value && typeof value==='object' && 'current' in value) as {current:unknown};
        ref.current=frame;
      }
      return {strings,values};
    },
    useState:(initial:unknown)=>{const index=stateIndex++; if(!(index in states))states[index]=initial;return [states[index],(value:unknown)=>{states[index]=value;}];},
    useRef:(initial:unknown)=>{const index=refIndex++;return refs[index]??=( {current:initial});},
    useEffect:()=>{}, // Deliberately do not run passive effects: this is the vulnerable interval.
    useLayoutEffect:(effect:()=>void|(()=>void))=>{layout=effect;},
    page:(entry:{component:()=>unknown})=>{Office=entry.component;},
    panel:()=>{},rail:()=>{},launcher:()=>{},style:()=>{},
    api:async(path:string)=>{calls.push(path);return {source:42};},
  };
  function render() {
    stateIndex=0;refIndex=0;frameCount=0;
    Office!();
    dispose?.();
    dispose=layout?.()??undefined;
  }
  try {
    setup(pocket);
    render();
    states[0]={person:{id:'owner'},profile:{}};
    states[1]=[{id:42},{id:43}];
    states[2]=42;
    states[3]={source:42,title:'First',master:{workerId:'pocket-master-42'}};
    states[4]={source:42,channel:'channel-a',html:'<html><head></head></html>'};
    render();
    assert.equal(frameCount,1);
    assert.equal(handlers.size,1);
    states[11]=true;
    render();
    assert.equal(frameCount,0,'a small window must not substitute a phone world');
    assert.equal(handlers.size,0,'the hidden desktop scene must release its bridge');
    states[11]=false;
    render();
    assert.equal(frameCount,1,'enlarging the desktop window restores the matching scene');
    assert.equal(handlers.size,1);
    states[2]=43;
    render();
    assert.equal((states[4] as {source:number}).source,42,'the old document still exists until the passive effect runs');
    assert.equal(frameCount,0,'the mismatched document must not render');
    assert.equal(handlers.size,0,'the old frame must have no bridge, especially not one bound to floor 43');
    for(const handler of handlers)handler({source:worldWindow,origin:'https://pocket.test',data:{type:'office-v2:request',channel:'channel-a',id:'queued-chat',op:'chat',payload:{text:'old floor message'}}});
    await Promise.resolve();
    assert.deepEqual(calls,[]);
  } finally {
    dispose?.();
    if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else Reflect.deleteProperty(globalThis,'window');
    if(previousLocation)Object.defineProperty(globalThis,'location',previousLocation);else Reflect.deleteProperty(globalThis,'location');
  }
});
