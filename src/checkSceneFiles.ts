/** A scene's declared media checked using supplied representation and extension owners. */
import { checkImage, type ImageFile, type ImageRepresentation, type RepresentationHooks } from "@foss-earth/images";
import type { SceneDiagnostic, ValidatedScene } from "./format.js";

export interface SceneFileReport {
  problems: SceneDiagnostic[];
  /** Shared files count once per declaration, preserving the original publication report. */
  files: number;
  bytes: number;
  largestFile: { url: string; bytes: number } | null;
}

export interface SceneDeclaredFile extends ImageFile {
  /** Owner-authored suffix such as `.url`, `.faces.px` or `.tiles[address]`. */
  fieldPath?: string;
  /** Opaque owner group ID, used for an additional encoded-byte total. */
  group?: string;
}

export interface SceneFileGroup {
  id: string;
  fieldPath: string;
  encodedBytes: number;
  /** Owner-authored report wording, for example `level 0's tiles`. */
  filesLabel?: string;
}

export interface SceneRepresentationFileHook<R extends ImageRepresentation = ImageRepresentation>
  extends Pick<RepresentationHooks<R>, "projection" | "filePath"> {
  files(record: R): Iterable<SceneDeclaredFile>;
  groups?(record: R): Iterable<SceneFileGroup>;
}

export interface SceneExtensionFile {
  /** Complete authored path supplied by the extension owner. */
  path: string;
  file: ImageFile;
  encodedBytes: number;
}

export interface SceneFileCheckOptions<R extends ImageRepresentation = ImageRepresentation> {
  representations: readonly SceneRepresentationFileHook<R>[];
  extensionFiles?(scene: ValidatedScene<R>): Iterable<SceneExtensionFile>;
}

/**
 * Reading belongs to the caller. This pure function creates no requests,
 * decoder, device, DOM or filesystem access. Leaf layout and optional extension
 * structures stay in their supplied hooks; Scenes owns traversal and reporting.
 */
export function checkSceneFiles<R extends ImageRepresentation>(
  scene: ValidatedScene<R>,
  read: (url: string) => Uint8Array | null,
  options: SceneFileCheckOptions<R>,
): SceneFileReport {
  const report: SceneFileReport = { problems: [], files: 0, bytes: 0, largestFile: null };
  const checkFile = (declared: ImageFile, path: string): number | null => {
    const bytes = read(declared.url);
    if (!bytes) {
      report.problems.push({ path, message: `${declared.url} does not exist` });
      return null;
    }
    report.files++;
    report.bytes += bytes.length;
    if (!report.largestFile || bytes.length > report.largestFile.bytes) report.largestFile = { url: declared.url, bytes: bytes.length };
    const problem = checkImage(bytes, declared, null);
    if (problem) report.problems.push({ path, message: `${declared.url} ${problem}` });
    return bytes.length;
  };
  for (const extension of options.extensionFiles?.(scene) ?? []) {
    const bytes = checkFile(extension.file, `${extension.path}.url`);
    if (bytes !== null && bytes !== extension.encodedBytes) {
      report.problems.push({ path: `${extension.path}.encodedBytes`, message: `declares ${extension.encodedBytes} bytes; the file holds ${bytes}` });
    }
  }
  for (const asset of scene.assets.values()) for (const representation of asset.representations) {
    const hook = options.representations.find(entry => entry.projection === representation.projection);
    if (!hook) throw new Error(`Missing public file hook for ${representation.projection}.`);
    const path = `$.assets[${asset.id}].representations[${representation.id}]`;
    const totals = new Map<string, number>();
    let total = 0;
    let complete = true;
    let index = 0;
    for (const declared of hook.files(representation)) {
      const suffix = declared.fieldPath ?? hook.filePath?.(representation, declared, index) ?? `.files[${declared.url}]`;
      index++;
      const bytes = checkFile(declared, `${path}${suffix}`);
      if (bytes === null) { complete = false; continue; }
      total += bytes;
      if (declared.group !== undefined) totals.set(declared.group, (totals.get(declared.group) ?? 0) + bytes);
    }
    if (complete && total !== representation.encodedBytes) {
      report.problems.push({ path: `${path}.encodedBytes`, message: `declares ${representation.encodedBytes} bytes; the files hold ${total}` });
    }
    if (complete) for (const group of hook.groups?.(representation) ?? []) {
      const bytes = totals.get(group.id) ?? 0;
      if (bytes !== group.encodedBytes) {
        // The owner supplies a complete description of the grouping, including its label.
        report.problems.push({ path: `${path}${group.fieldPath}`, message: `declares ${group.encodedBytes} bytes; ${group.filesLabel ?? `${group.id}'s files`} hold ${bytes}` });
      }
    }
  }
  return report;
}
