import type { SceneDiagnostic, SceneValidation } from "./format.js";
import { DEFAULT_SCENE_LIMITS, validateScene, type ValidateSceneOptions } from "./validateScene.js";

export type SceneInput = string | URL | Record<string, unknown>;
export interface SceneProgress {
  id: string; kind: "manifest" | "preview" | "image"; title: string;
  receivedBytes: number; totalBytes: number | null; state: "loading" | "ready" | "failed" | "cancelled";
}
export interface ResolveSceneInputOptions extends ValidateSceneOptions {
  /** Fetch is supplied by the host; importing this module makes no request. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
  onProgress?(progress: SceneProgress): void;
}
const errorResult = (message: string): { ok: false; errors: readonly SceneDiagnostic[] } => ({ ok: false, errors: [{ path: "$", message }] });
const cause = (error: unknown): string => error instanceof Error ? error.message : String(error);
export function sceneManifestUrl(input: string | URL, baseUrl?: string | URL | null): URL {
  const url = new URL(String(input), baseUrl ? String(baseUrl) : undefined);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("a scene URL must be http or https");
  if (url.username || url.password) throw new Error("a scene URL must not contain credentials");
  return url;
}
/** Stream limits apply to uncompressed bytes; the redirect destination is the image URL base. */
export async function fetchSceneManifest(url: URL, options: { fetch: typeof fetch; maxBytes: number; signal?: AbortSignal; onProgress?(progress: SceneProgress): void }): Promise<{ ok: true; text: string; baseUrl: string } | { ok: false; error: string }> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) throw new RangeError("The manifest byte limit must be a nonnegative whole number.");
  const safeUrl = sceneManifestUrl(url);
  let receivedBytes = 0, totalBytes: number | null = null;
  const publish = (state: SceneProgress["state"]): void => { try { options.onProgress?.({ id: safeUrl.href, kind: "manifest", title: safeUrl.href, receivedBytes, totalBytes, state }); } catch { /* A diagnostic observer does not own the transport. */ } };
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const cancelled = (): never => { throw options.signal?.reason ?? new Error("Loading was cancelled."); };
  const onAbort = (): void => { void reader?.cancel().catch(() => {}); };
  try {
    if (options.signal?.aborted) cancelled();
    publish("loading");
    const response = await options.fetch(safeUrl, { credentials: "omit", signal: options.signal });
    if (options.signal?.aborted) { void response.body?.cancel().catch(() => {}); cancelled(); }
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error(`answered ${response.status}`); }
    let baseUrl: string;
    try { baseUrl = sceneManifestUrl(response.url || safeUrl.href).href; }
    catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
    const announced = Number(response.headers.get("content-length"));
    if (announced > 0 && Number.isFinite(announced) && !response.headers.get("content-encoding")) totalBytes = announced;
    if (totalBytes !== null && totalBytes > options.maxBytes) { void response.body?.cancel().catch(() => {}); throw new Error(`announced ${totalBytes} bytes, over the ${options.maxBytes}-byte manifest limit (scene.manifestMiB)`); }
    reader = response.body?.getReader() ?? null;
    if (!reader) throw new Error("has no body");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const chunks: Uint8Array[] = [];
    for (;;) {
      const next = await reader.read();
      if (options.signal?.aborted) cancelled();
      if (next.done) break;
      receivedBytes += next.value.byteLength;
      if (receivedBytes > options.maxBytes) throw new Error(`passed the ${options.maxBytes}-byte manifest limit (scene.manifestMiB) while arriving`);
      chunks.push(next.value); publish("loading");
    }
    const bytes = new Uint8Array(receivedBytes);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    totalBytes = receivedBytes; publish("ready");
    return { ok: true, text: new TextDecoder().decode(bytes), baseUrl };
  } catch (error) {
    void reader?.cancel().catch(() => {});
    publish(options.signal?.aborted ? "cancelled" : "failed");
    return { ok: false, error: `${safeUrl.href} could not be fetched: ${cause(error)}` };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    reader?.releaseLock();
  }
}
/** Programmatic JSON needs no transport. A URL needs an explicit host transport and base. */
export async function resolveSceneInput(input: SceneInput, options: ResolveSceneInputOptions): Promise<SceneValidation> {
  if (options.signal?.aborted) return errorResult("Loading was cancelled.");
  let document: unknown = input, baseUrl = options.baseUrl;
  if (input instanceof URL || (typeof input === "string" && !input.trim().startsWith("{"))) {
    let url: URL;
    try { url = sceneManifestUrl(input as string | URL, baseUrl); }
    catch (error) { return errorResult(cause(error)); }
    if (!options.fetch) return errorResult("The host has not supplied a scene manifest transport.");
    const result = await fetchSceneManifest(url, { fetch: options.fetch, maxBytes: options.limits?.manifestBytes ?? DEFAULT_SCENE_LIMITS.manifestBytes, signal: options.signal, onProgress: options.onProgress });
    if (!result.ok) return errorResult(result.error);
    document = result.text; baseUrl = result.baseUrl;
  }
  if (options.signal?.aborted) return errorResult("Loading was cancelled.");
  try { return validateScene(document, { ...options, baseUrl }); }
  catch (error) { return errorResult(`The supplied scene/image validator failed: ${cause(error)}`); }
}
