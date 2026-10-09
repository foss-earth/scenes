/** Copied into the fresh installed workspace before CLI subprocesses execute. */
import { registerHooks } from "node:module";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = realpathSync(path.dirname(fileURLToPath(import.meta.url))) + path.sep;
registerHooks({ resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context);
  if (result.url.startsWith("file:")) {
    const actual = realpathSync(fileURLToPath(result.url));
    if (!actual.startsWith(workspace)) throw new Error("OUTSIDE_ISOLATED_WORKSPACE: " + actual);
    if (/[/\\]node_modules[/\\](?:@babylonjs[/\\]core|@foss-earth[/\\]renderer|react(?:-dom)?)(?:[/\\]|$)/.test(actual)) throw new Error("Unrelated runtime peer initialized: " + actual);
  }
  return result;
} });
