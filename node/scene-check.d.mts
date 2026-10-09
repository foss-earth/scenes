import type { ImageDiagnostic, RepresentationHooks } from "@foss-earth/images";
import type { SceneFileReport, ValidatedScene } from "@foss-earth/scenes";
export type { SceneFileReport } from "@foss-earth/scenes";
export interface SceneCheckSummary {
  id: string; revision: string; title: string; manifestBytes: number;
  panoramas: number; unsupported: number; assets: number; groups: number; links: number;
  files: number; mediaBytes: number; largestFile: SceneFileReport["largestFile"];
  sheets: number; sheetCubes: number; sheetLowestPsnrDb: number | null;
}
export interface SceneCheckReport {
  manifest: string; baseUrl: string; ok: boolean;
  errors: readonly ImageDiagnostic[]; warnings: readonly ImageDiagnostic[]; problems: readonly ImageDiagnostic[];
  summary: SceneCheckSummary | null;
}
export function builtInSceneHooks(): readonly RepresentationHooks[];
export function localSceneReader(folder: string, baseUrl: string | URL): { outside: Set<string>; read(url: string): Uint8Array | null };
export function checkSceneFiles(scene: ValidatedScene, read: (url: string) => Uint8Array | null, representations?: readonly RepresentationHooks[]): SceneFileReport;
export function checkSceneManifest(manifestPath: string, options?: { baseUrl?: string | URL }): SceneCheckReport;
