import { describe, expect, it, vi } from "vitest";
import { fetchSceneManifest, resolveSceneInput, sceneManifestUrl } from "../src/browser.js";
import { baseUrl, fixtureDocument, fixtureOptions } from "./fixtures.js";
describe("injected manifest input", () => {
  it("requires explicit transport, permits programmatic JSON and omits credentials", async () => {
    expect((await resolveSceneInput(fixtureDocument(), fixtureOptions)).ok).toBe(true);
    expect(await resolveSceneInput("scene.json", fixtureOptions)).toMatchObject({ ok: false, errors: [{ message: expect.stringMatching(/transport/) }] });
    const transport = vi.fn(async () => new Response(JSON.stringify(fixtureDocument())));
    expect((await resolveSceneInput("scene.json", { ...fixtureOptions, fetch: transport })).ok).toBe(true);
    expect(transport).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ credentials: "omit" }));
  });
  it("uses the final redirect URL as the image/credit base and does not trust compressed lengths", async () => {
    const response = new Response(JSON.stringify(fixtureDocument()), { headers: { "content-length": "1", "content-encoding": "gzip" } });
    Object.defineProperty(response, "url", { value: "https://redirect.example/tour/scene.json" });
    const events: unknown[] = [], result = await resolveSceneInput("scene.json", { ...fixtureOptions, fetch: async () => response, onProgress: event => events.push(event) });
    expect(result.ok).toBe(true); if (result.ok) expect(result.scene.baseUrl).toBe("https://redirect.example/tour/scene.json");
    expect(events[0]).toMatchObject({ totalBytes: null, state: "loading" }); expect(events.at(-1)).toMatchObject({ state: "ready" });
  });
  it("cancels an oversized uncompressed stream before parsing or calling an image owner", async () => {
    const cancel = vi.fn(), validate = vi.fn(fixtureOptions.validateImageAsset);
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new TextEncoder().encode("abcdef")); }, cancel });
    const result = await resolveSceneInput(baseUrl, { ...fixtureOptions, fetch: async () => new Response(body), limits: { manifestBytes: 4 }, validateImageAsset: validate });
    expect(result).toMatchObject({ ok: false, errors: [{ message: expect.stringMatching(/limit/) }] }); expect(cancel).toHaveBeenCalledTimes(1); expect(validate).not.toHaveBeenCalled();
  });
  it("refuses credentials, local protocols, unsafe redirects and unexpected HTTP errors", async () => {
    for (const url of ["file:///local/scene.json", "https://secret@example.invalid/scene.json", "javascript:alert(1)"]) expect(() => sceneManifestUrl(url)).toThrow();
    const response = new Response("{}"), cancel = vi.spyOn(response.body!, "cancel"); Object.defineProperty(response, "url", { value: "https://secret@example.invalid/scene.json" });
    expect(await fetchSceneManifest(new URL(baseUrl), { fetch: async () => response, maxBytes: 20 })).toMatchObject({ ok: false });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await resolveSceneInput(baseUrl, { ...fixtureOptions, fetch: async () => new Response("", { status: 404 }) })).toMatchObject({ ok: false, errors: [{ message: expect.stringMatching(/404/) }] });
  });
  it("reports cancellation and closes a late transport response", async () => {
    const request = new AbortController(), response = new Response("{}"), cancel = vi.spyOn(response.body!, "cancel"); request.abort();
    const fetch = vi.fn(async () => response); expect(await resolveSceneInput(baseUrl, { ...fixtureOptions, fetch, signal: request.signal })).toMatchObject({ ok: false }); expect(fetch).not.toHaveBeenCalled();
    const late = new AbortController(); expect(await fetchSceneManifest(new URL(baseUrl), { fetch: async () => { late.abort(); return response; }, maxBytes: 20, signal: late.signal })).toMatchObject({ ok: false }); expect(cancel).toHaveBeenCalledTimes(1);
  });
});
