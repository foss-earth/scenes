import { describe, expect, it } from 'vitest';
import { addPreparedPanorama } from '../src/authoring.js';
import { validateScene } from '../src/validateScene.js';
import { createBuiltInRepresentations, validateViewerAsset } from '@foss-earth/sphere-image';

const fragment = {
  asset: { id:'new-image', revision:'image-r1', type:'panorama-image', colorSpace:'srgb', alpha:'opaque', attribution:{text:'Test photographer'}, representations:[
    {id:'preview',role:'preview',projection:'cube',faceSize:16,mimeType:'image/jpeg',encodedBytes:600,faces:Object.fromEntries(['px','nx','py','ny','pz','nz'].map(face=>[face,`media/new/${face}.jpg`]))},
    {id:'whole',role:'immersion',projection:'equirectangular',width:128,height:64,mimeType:'image/jpeg',encodedBytes:1000,url:'media/new/whole.jpg'},
  ]}, imagePose:{headingDeg:0,pitchDeg:0,rollDeg:0},
};
const scene = {format:'foss-earth-scene',version:1,id:'test-scene',revision:'before',title:'Test',assets:[],entities:[],extensions:{'test.keep':{value:'preserved'}}};
const options={id:'new-photo',title:'New photo',latitudeDeg:44.97,longitudeDeg:-93.23,mediaBaseUrl:'https://example.org/tour/'};
const hooks=createBuiltInRepresentations(()=>({tileMemoryBytes:0,responseBytes:0,requests:0,waiting:0,uploadOutstandingBytes:0})).map(entry=>entry.hooks);
describe('prepared scene authoring',()=>{
  it('adds a real prepared asset immutably with absolute media, unknown height and valid envelope',()=>{
    const before=JSON.stringify({scene,fragment});
    const result=addPreparedPanorama(scene,fragment,{...options,groupId:'east-bank'});
    expect(JSON.stringify({scene,fragment})).toBe(before);
    expect(result.initialPanorama).toBe('new-photo');
    expect(result.entities[0]).toMatchObject({capture:{height:null}});
    expect(result.assets[0].representations[0]).toMatchObject({faces:{px:'https://example.org/tour/media/new/px.jpg'}});
    expect(result.extensions).toEqual(scene.extensions);
    expect(validateScene(result,{baseUrl:'https://example.org/tour/scene.json',representations:hooks,validateImageAsset:validateViewerAsset}).ok).toBe(true);
  });
  it('preserves existing entities, ordering and links while rejecting collisions',()=>{
    const first=addPreparedPanorama(scene,fragment,options);
    expect(()=>addPreparedPanorama(first,fragment,{...options,id:'second'})).toThrow(/Asset ID already exists/);
    expect(()=>addPreparedPanorama(first,{...fragment,asset:{...fragment.asset,id:'other'}},options)).toThrow(/Panorama ID already exists/);
    expect(first.entities).toHaveLength(1);
  });
  it('rejects invalid placement, executable image URLs, missing credit and incomplete fragments',()=>{
    expect(()=>addPreparedPanorama(scene,fragment,{...options,latitudeDeg:NaN})).toThrow(/latitude/);
    expect(()=>addPreparedPanorama(scene,fragment,{...options,mediaBaseUrl:'javascript:alert(1)'})).toThrow();
    expect(()=>addPreparedPanorama(scene,{...fragment,asset:{...fragment.asset,attribution:{text:''}}},options)).toThrow(/credit/);
    expect(()=>addPreparedPanorama(scene,{},options)).toThrow(/Prepared asset/);
  });
});
