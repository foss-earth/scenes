// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaStoreSnapshot } from "@foss-earth/images";
import { createSavedImagesSection, type SavedImagesSectionHandle, type SavedImagesSource } from "../src/browser.js";

const sections: SavedImagesSectionHandle[] = [];
afterEach(() => { for (const section of sections.splice(0)) section.destroy(); vi.restoreAllMocks(); document.body.replaceChildren(); });
const value = (files: number, groups: MediaStoreSnapshot["groups"] = []): MediaStoreSnapshot => ({ available: true, problem: null, files, bytes: files * 1024, maxBytes: 1024 * 1024, groups, reused: { files: 0, bytes: 0 }, added: { files: 0, bytes: 0 } });
function deferred<T>() {
  let resolve: (value: T) => void = () => {}, reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
async function settle(): Promise<void> { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); }
function harness(source: SavedImagesSource, options: { document?: Document; limit?: number; stop?: () => void } = {}) {
  let tick: () => void = () => {};
  const stop = vi.fn(options.stop ?? (() => {}));
  const section = createSavedImagesSection({ document: options.document ?? document, source, maxListedGroups: () => options.limit ?? 60, refresh: { subscribe(listener) { tick = listener; return stop; } } });
  sections.push(section); return { section, tick: () => tick(), stop };
}

describe("Saved images injected lifecycle", () => {
  it("uses the supplied Document, named row bound and shared visible refresh without a local interval", async () => {
    const page = document.implementation.createHTMLDocument("host"), interval = vi.spyOn(window, "setInterval");
    const ambient = vi.spyOn(document, "createElement").mockImplementation(() => { throw new Error("Ambient Document used"); });
    const groups = [{ id: "new", label: "Most recent", files: 1, bytes: 1024, used: 20 }, { id: "old", label: "Older", files: 1, bytes: 1024, used: 10 }];
    const inspect = vi.fn(async () => value(2, groups)), h = harness({ inspect, clear: async () => {} }, { document: page, limit: 1 });
    await settle(); ambient.mockRestore();
    expect(h.section.element.ownerDocument).toBe(page); expect([...h.section.element.querySelectorAll("li span")].map(node => node.textContent)).toEqual(["Most recent"]); expect(h.section.element.textContent).toContain("And 1 more."); expect(interval).not.toHaveBeenCalled();
    const outer = page.createElement("details"); outer.append(h.section.element); page.body.append(outer); h.tick(); await settle(); expect(inspect).toHaveBeenCalledOnce();
    outer.open = true; h.tick(); await settle(); expect(inspect).toHaveBeenCalledTimes(2);
    outer.remove(); h.tick(); await settle(); expect(inspect).toHaveBeenCalledTimes(2);
  });
  it("keeps a newer inspect result and ignores an older success or error", async () => {
    const first = deferred<MediaStoreSnapshot>(), second = deferred<MediaStoreSnapshot>(), third = deferred<MediaStoreSnapshot>();
    const inspect = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise).mockResolvedValueOnce(value(2));
    const h = harness({ inspect, clear: async () => {} }); document.body.append(h.section.element); h.tick();
    second.resolve(value(1)); await settle(); first.resolve(value(99)); await settle(); expect(h.section.element.textContent).toContain("1 file of 0 images");
    h.tick(); h.tick(); await settle(); third.reject(new Error("older inspection refused")); await settle(); expect(h.section.element.textContent).toContain("2 files of 0 images"); expect(h.section.element.querySelector("[role=status]")!.textContent).toBe("");
  });
  it("invalidates a pre-clear inspect, skips repeated clear/refresh work and publishes only the post-clear snapshot", async () => {
    const old = deferred<MediaStoreSnapshot>(), cleared = deferred<void>(), next = deferred<MediaStoreSnapshot>();
    const inspect = vi.fn().mockResolvedValueOnce(value(3)).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise), clear = vi.fn(() => cleared.promise);
    const h = harness({ inspect, clear }); document.body.append(h.section.element); await settle(); h.tick();
    const button = h.section.element.querySelector("button")!; button.click(); button.dispatchEvent(new MouseEvent("click")); h.tick();
    expect(clear).toHaveBeenCalledOnce(); expect(inspect).toHaveBeenCalledTimes(2); old.resolve(value(77)); await settle(); expect(h.section.element.textContent).not.toContain("77 files");
    cleared.resolve(); await settle(); next.resolve(value(0)); await settle(); expect(h.section.element.textContent).toContain("0 files of 0 images"); expect(h.section.element.querySelector("[role=status]")!.textContent).toMatch(/^Saved images cleared\./); expect(button.disabled).toBe(true);
  });
  it("reports a post-clear inspect failure without an unhandled rejection or a stuck clearing button", async () => {
    const inspect = vi.fn().mockResolvedValueOnce(value(3)).mockRejectedValueOnce(new Error("inspection refused")), clear = vi.fn(async () => {});
    const h = harness({ inspect, clear }); document.body.append(h.section.element); await settle(); h.section.element.querySelector("button")!.click(); await settle();
    expect(h.section.element.querySelector("[role=status]")!.textContent).toMatch(/^Saved images cleared, but could not read/); expect(h.section.element.querySelector("button")!.disabled).toBe(false); expect(h.section.element.querySelector("button")!.textContent).toBe("Clear saved images");
  });
  it.each(["resolve", "reject"] as const)("makes a late clear %s and held refresh callback inert after repeated destruction", async outcome => {
    const pending = deferred<void>(), inspect = vi.fn(async () => value(3)), clear = vi.fn(() => pending.promise), h = harness({ inspect, clear });
    document.body.append(h.section.element); await settle(); const button = h.section.element.querySelector("button")!; button.click(); h.section.destroy(); h.section.destroy();
    const text = h.section.element.textContent; if (outcome === "resolve") pending.resolve(); else pending.reject(new Error("late refusal")); await settle(); h.tick(); button.dispatchEvent(new MouseEvent("click")); await settle();
    expect(inspect).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledOnce(); expect(h.stop).toHaveBeenCalledOnce(); expect(h.section.element.textContent).toBe(text); expect(h.section.element.isConnected).toBe(false);
  });
  it("detaches its element and actions despite a throwing refresh release, and ignores the held callback", async () => {
    const pending = deferred<MediaStoreSnapshot>(), inspect = vi.fn(() => pending.promise), clear = vi.fn(async () => {}), failure = new Error("host detach refused");
    const h = harness({ inspect, clear }, { stop: () => { throw failure; } }); document.body.append(h.section.element);
    expect(() => h.section.destroy()).toThrow(AggregateError); expect(h.section.element.isConnected).toBe(false); h.section.destroy(); h.tick(); pending.reject(new Error("late inspection refused")); await settle();
    expect(inspect).toHaveBeenCalledOnce(); expect(clear).not.toHaveBeenCalled(); expect(h.stop).toHaveBeenCalledOnce(); expect(h.section.element.querySelector("[role=status]")!.textContent).toBe("");
  });
});
