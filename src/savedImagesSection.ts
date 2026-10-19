import type { MediaStore, MediaStoreSnapshot } from "@foss-earth/images";
import type { createHelpTooltip, createIconButton } from "@foss-earth/ui/browser";

export type SavedImagesSource = Pick<MediaStore, "inspect" | "clear">;
export interface SavedImagesSectionOptions {
  document: Document;
  source: SavedImagesSource;
  /** The host shared visible refresh authority; it owns cadence and timer policy. */
  refresh: { subscribe(listener: () => void): () => void };
  /** Named host-visible Scenes/Saved policy, count; legacy composition used 60. */
  maxListedGroups(): number;
  /** UI's ? and icon actions. */
  createHelpTooltip: typeof createHelpTooltip;
  createIconButton: typeof createIconButton;
}

export interface SavedImagesSectionHandle {
  element: HTMLElement;
  destroy(): void;
}

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function paragraph(document: Document, text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = "foss-earth-choices__note";
  element.textContent = text;
  return element;
}

/** "412 files (5.2 MB)". */
const counted = (tally: { files: number; bytes: number }): string => `${tally.files} ${tally.files === 1 ? "file" : "files"} (${size(tally.bytes)})`;

/**
 * Scenes → Saved images: the scene images the app keeps between visits, what
 * this visit took from them instead of the network, and a way to clear them.
 * Laid out as the map's saved tiles are (mapCacheSection.ts).
 */
export function createSavedImagesSection(options: SavedImagesSectionOptions): SavedImagesSectionHandle {
  const { document, source } = options;
  const element = document.createElement("div");
  element.className = "foss-earth-map-cache-section foss-earth-saved-images-section";
  element.setAttribute("aria-label", "Saved images");
  // "3 files of 2 images · 1.5 MB of 128 MB ▭ 🗑 ?" in one row; how files are kept, behind ?.
  const row = document.createElement("div");
  row.className = "foss-earth-choices foss-earth-map-cache-section__row";
  const summary = document.createElement("span");
  summary.className = "foss-earth-choices__note";
  summary.textContent = "Reading saved images…";
  const usage = document.createElement("progress");
  usage.setAttribute("aria-label", "Saved image storage used");
  usage.max = 1;
  usage.value = 0;
  const visit = paragraph(document, "");
  const availability = paragraph(document, "");
  availability.hidden = true;
  const kept = document.createElement("details");
  const keptTitle = document.createElement("summary");
  const keptList = document.createElement("ul");
  kept.append(keptTitle, keptList);
  const clear = options.createIconButton(document, { icon: "trash", label: "Clear saved images" });
  const help = options.createHelpTooltip({ label: "Explain saved images", content: paragraph(document, "Each file is kept under its image's revision in the scene, so it is downloaded once: a later visit, a reload, or a look back at part of a 360 image reads it from here. An image the scene has changed gets a new revision and is downloaded again; the old files go when room is needed. The browser's own cache is separate, and this page cannot list or clear it.") });
  row.append(summary, usage, clear, help.element);
  const status = paragraph(document, "");
  status.setAttribute("role", "status");
  element.append(row, visit, availability, kept, status);

  let snapshot: MediaStoreSnapshot | null = null;
  let disposed = false;
  let clearing = false;
  let revision = 0;

  const render = (): void => {
    summary.textContent = snapshot ? `${snapshot.files} ${snapshot.files === 1 ? "file" : "files"} of ${snapshot.groups.length} ${snapshot.groups.length === 1 ? "image" : "images"} · ${size(snapshot.bytes)} of ${size(snapshot.maxBytes)}` : "Reading saved images…";
    usage.max = snapshot?.maxBytes || 1;
    usage.value = snapshot?.bytes ?? 0;
    visit.hidden = !snapshot?.available;
    visit.textContent = snapshot ? `This visit: ${counted(snapshot.reused)} reused · ${counted(snapshot.added)} added` : "";
    const trouble = !snapshot ? null : !snapshot.available
      ? "This browser session has no storage for images, so each visit downloads them again; the browser's own cache still applies."
      : snapshot.problem ?? (snapshot.maxBytes <= 0 ? "Nothing is kept: the limit above is 0." : null);
    availability.hidden = trouble === null;
    availability.textContent = trouble ?? "";
    kept.hidden = !snapshot || snapshot.groups.length === 0;
    keptTitle.textContent = `What is kept, most recently used first`;
    const limit = options.maxListedGroups();
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("Saved images maxListedGroups must be a nonnegative whole count.");
    keptList.replaceChildren(...(snapshot?.groups ?? []).slice(0, limit).map(group => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.className = "foss-earth-map-cache__tile";
      name.textContent = group.label;
      const meta = document.createElement("small");
      meta.textContent = `${group.files} ${group.files === 1 ? "file" : "files"} · ${size(group.bytes)} · used ${new Date(group.used).toLocaleString()}`;
      item.append(name, meta);
      return item;
    }));
    if (snapshot && snapshot.groups.length > limit) keptList.append(Object.assign(document.createElement("li"), { textContent: `And ${snapshot.groups.length - limit} more.` }));
    clear.disabled = clearing || !snapshot?.available || snapshot.files === 0;
    const action = clearing ? "Clearing saved images" : "Clear saved images";
    if (clear.getAttribute("aria-label") !== action) { clear.setAttribute("aria-label", action); clear.title = action; }
  };

  const refresh = (): void => {
    if (disposed || clearing) return;
    const current = ++revision;
    void (async () => {
      try {
        const value = await source.inspect();
        if (disposed || current !== revision) return;
        snapshot = value;
        render();
      } catch {
        if (disposed || current !== revision) return;
        status.textContent = "Could not read the saved images. Scenes still load.";
      }
    })();
  };
  const onClear = (): void => {
    if (disposed || clearing || !snapshot?.available || snapshot.files === 0) return;
    const current = ++revision;
    clearing = true;
    try { render(); }
    catch {
      clearing = false;
      status.textContent = "Could not read the saved images. Scenes still load.";
      return;
    }
    void (async () => {
      let cleared = false;
      try {
        await source.clear();
        if (disposed || current !== revision) return;
        cleared = true;
        const value = await source.inspect();
        if (disposed || current !== revision) return;
        snapshot = value;
        status.textContent = "Saved images cleared. Images already on screen stay; they are downloaded again when next needed.";
      } catch {
        if (disposed || current !== revision) return;
        status.textContent = cleared
          ? "Saved images cleared, but could not read the saved images. Scenes still load."
          : "Could not clear the saved images. Check the browser's site storage settings.";
      } finally {
        if (!disposed && current === revision) {
          clearing = false;
          try { render(); } catch { status.textContent = "Could not read the saved images. Scenes still load."; }
        }
      }
    })();
  };
  clear.addEventListener("click", onClear);
  render();
  refresh();
  // The shared host authority owns cadence; closed sections ask for no reads.
  const onRefresh = (): void => {
    if (disposed) return;
    if (element.isConnected && element.closest("details")?.open !== false) refresh();
  };
  let stopRefresh: () => void;
  try { stopRefresh = options.refresh.subscribe(onRefresh); }
  catch (error) {
    disposed = true;
    revision++;
    const failures: unknown[] = [error];
    for (const release of [() => clear.removeEventListener("click", onClear), () => help.destroy(), () => element.remove()]) {
      try { release(); } catch (cleanup) { failures.push(cleanup); }
    }
    throw new AggregateError(failures, "Saved images refresh subscription failed.");
  }

  return {
    element,
    destroy() {
      if (disposed) return;
      disposed = true;
      revision++;
      snapshot = null;
      const failures: unknown[] = [];
      for (const release of [stopRefresh, () => clear.removeEventListener("click", onClear), () => help.destroy(), () => element.remove()]) {
        try { release(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, "Saved images section cleanup failed.");
    },
  };
}
