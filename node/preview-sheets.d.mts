import type { AddPreviewSheetsOptions, PreparationDocument } from "@foss-earth/preview-sheets/preparation";
export function buildScenePreviewSheets(manifestPath: string, options?: Pick<AddPreviewSheetsOptions, "faceSize" | "quality" | "maxPixels">): {
  document: PreparationDocument;
  files: readonly { url: string; bytes: Uint8Array }[];
  cubes: number;
};
