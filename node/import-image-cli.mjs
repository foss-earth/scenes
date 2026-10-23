#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { addPreparedPanorama } from '../dist/authoring.js';
import { validateSceneDocument } from './scene-check.mjs';

const HELP = `foss-earth-add-image --fragment asset.fragment.json --id photo --title "My photo" --lat 44.97 --lon -93.23
  --media-base-url https://example.org/tour/ --out scene.json
  [--scene existing.json --scene-base-url https://example.org/tour/scene.json]
  [--scene-id my-scene --scene-title "My scene"] [--group-id east-bank] [--initial]
Writes a validated scene. Prepared media must also be published at its declared URLs.
Existing files are never overwritten; choose a new output name and review before replacing.`;

try {
  const options = {};
  const allowed = new Set(['fragment','id','title','lat','lon','media-base-url','out','scene','scene-base-url','scene-id','scene-title','group-id']);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (args[i] === '--help') { console.log(HELP); process.exit(0); }
    if (args[i] === '--initial') { options.initial = true; continue; }
    if (!args[i].startsWith('--') || !allowed.has(key) || args[i+1] === undefined || args[i+1].startsWith('--')) throw new Error('Invalid arguments. Use --help.');
    options[key] = args[++i];
  }
  for (const key of ['fragment','id','title','lat','lon','media-base-url','out']) if (!options[key]) throw new Error(`--${key} is required.`);
  if (options.scene && !options['scene-base-url']) throw new Error('--scene-base-url is required to preserve existing image addresses when exporting.');
  const input = options.scene ? JSON.parse(readFileSync(options.scene, 'utf8')) : { format:'foss-earth-scene', version:1, id:options['scene-id'] ?? 'my-scene', title:options['scene-title'] ?? 'My scene', revision:'draft', assets:[], entities:[] };
  const scene = addPreparedPanorama(input, JSON.parse(readFileSync(options.fragment, 'utf8')), {
    id:options.id, title:options.title, latitudeDeg:Number(options.lat), longitudeDeg:Number(options.lon),
    mediaBaseUrl:options['media-base-url'], sceneBaseUrl:options['scene-base-url'], groupId:options['group-id'], initial:options.initial,
  });
  const result = validateSceneDocument(scene, { baseUrl:options['scene-base-url'] ?? options['media-base-url'] });
  if (!result.ok) throw new Error(result.errors.map(error=>`${error.path}: ${error.message}`).join('\n'));
  writeFileSync(options.out, `${JSON.stringify(scene,null,2)}\n`, { flag:'wx' });
  console.log(`Wrote ${options.out} with ${scene.entities.length} panoramas; publish the prepared media separately.`);
} catch (error) { console.error(`add-image: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
