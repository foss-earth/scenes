#!/usr/bin/env node
/**
 * Checks a scene manifest on disk before it is published: validates it as the
 * loader would (validateScene), then checks every media file it names against
 * what it declares (checkSceneFiles): the file exists, its header gives the
 * declared type and pixel size, and a representation's files add up to its
 * encodedBytes. A preview sheet is decoded and each face in it held against
 * the cube's own face file: it has to be the same picture. Nothing is fetched
 * from the network.
 *
 *   node scripts/check-scene.mjs tour/scene.json --base-url https://example.org/tour/scene.json
 *
 * Options:
 *   --base-url url   the address the manifest will be served from. Relative media URLs
 *                    resolve against it, and a URL under its folder is read from the
 *                    manifest's folder on disk. Default: https://scene.invalid/<file name>,
 *                    which suits a scene whose media URLs are all relative.
 *   --json file      also write the report there as JSON
 *
 * A media URL outside the base URL's folder cannot be read from disk and fails
 * the check. The limits are the loader's defaults, not a user's settings.
 * Exits 1 when the manifest is invalid or any file does not match.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkSceneManifest } from "./scene-check.mjs";

function parseArgs(argv) {
  const options = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { options.positional.push(arg); continue; }
    const [name, inline] = arg.slice(2).split("=", 2);
    if (name === "help") { options.help = true; continue; }
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    options[name] = value;
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = options.positional[0];
  if (options.help || !manifestPath) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
    process.exitCode = options.help ? 0 : 1;
    return;
  }
  const report = checkSceneManifest(manifestPath, { baseUrl: options["base-url"] });
  if (options.json) writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);

  for (const error of report.errors) console.error(`error ${error.path}: ${error.message}`);
  for (const problem of report.problems) console.error(`file ${problem.path}: ${problem.message}`);
  for (const warning of report.warnings) console.warn(`warning ${warning.path}: ${warning.message}`);
  if (report.summary) {
    const s = report.summary;
    const mib = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
    console.log(`${report.ok ? "OK" : "FAILED"}: ${s.title} (${s.id}, revision ${s.revision})`);
    console.log(`  ${s.spheres} panoramas, ${s.assets} images, ${s.groups} groups, ${s.links} links; manifest ${s.manifestBytes} bytes`);
    console.log(`  ${s.files} media files, ${mib(s.mediaBytes)}${s.largestFile ? `; largest ${mib(s.largestFile.bytes)}, ${s.largestFile.url}` : ""}`);
    if (s.sheets) console.log(`  ${s.sheets} preview ${s.sheets === 1 ? "sheet" : "sheets"} holding ${s.sheetCubes} cubes; its faces are within ${s.sheetLowestPsnrDb} dB of their files`);
  } else {
    console.log("FAILED: the manifest is not a valid scene");
  }
  process.exitCode = report.ok ? 0 : 1;
}

try { main(); }
catch (error) {
  console.error(`check-scene: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
