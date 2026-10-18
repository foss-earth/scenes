import { createPreviewBackends, type PreviewBackendLoader, type PreviewOcclusion } from "./previewBackend.js";
export type { PreviewBackend, PreviewBackendLoader, PreviewSurface, PreviewCover, PreviewOcclusion } from "./previewBackend.js";
import { createScenePanelStore } from "./panelState.js";
import { bindPhotographPress } from "./photographPress.js";
import type { SceneController, SceneControllerState } from "./controller.js";
import type { SceneEntryStatus, SceneLayerStatus, ScenePreviewFace, SceneStatus } from "./ports.js";
import { SCENES_TAB } from "./catalogue.js";
import { createPreviewStill, clampMiniLook, type PreviewStill, createMiniViewer, DEFAULT_MINI_NAVIGATION, type MiniInput, type MiniNavigation, type MiniViewer } from "./miniViewer.js";
export interface ScenePanelElement { element: HTMLElement; destroy(): void }
export interface ScenePanelSection { id: string; title: string; element: HTMLElement; defaultOpen: boolean }
/** Existing shared UI/settings authority supplied by the application. */
export interface ScenesPanelUi {
  parameterSection(options: { tab: "scenes"; section: "content" | "credits"; main: HTMLElement; showAll: boolean }): ScenePanelElement;
  sections(sections: readonly ScenePanelSection[]): ScenePanelElement;
}
/** Local corrections to which photographs belong in which panoramas layer, plus their export. */
export interface SceneLayerArrangement {
  count(): number;
  note(): string;
  exportDocument(): { text: string; filename: string; disclosures: readonly string[] };
  reset(): void;
  subscribe(listener: () => void): () => void;
}
export type SceneOpeningMode = "enter" | "last" | "image" | "fixed";
export interface SceneOpeningLook { headingDeg: number; pitchDeg: number; verticalFovDeg: number }
/** How a photograph opens. The host owns the setting and the remembered looks. */
export interface SceneOpening {
  mode(): SceneOpeningMode;
  setMode(mode: SceneOpeningMode): void;
  lookUp(): void;
  lookFor(id: string): SceneOpeningLook | null;
  remember(id: string, look: SceneOpeningLook): void;
  subscribe?(listener: () => void): () => void;
}
/** Live gains shared with the full panorama viewer. */
export interface SceneLookControl {
  input?: MiniInput;
  swipeSensitivity?(): number;
  inertiaHalfLifeMs?(): number;
  reducedMotion?(): boolean;
  dragSensitivity(): number;
  zoomPerNotch(): number;
  pinchGain(): number;
  pitchRange(): { min: number; max: number };
  fovRange(): { min: number; max: number };
}
/** The scenes panel, which a host tells when its tab opens and closes. */
export interface ScenesPanel extends ScenePanelElement {
  /**
   * Whether the panel is on screen. While it is not, it keeps its saved state but does not rebuild its list on
   * each change of the scene, which during loading is many times a second; it rebuilds once when shown again.
   */
  setShown(shown: boolean): void;
}
export interface ScenesPanelContribution extends ScenePanelElement {
  /** Scene editing and settings supplied by the host and image owners. */
  section: "links" | "appearance" | "motion" | "loading" | "tiles" | "saved";
  title: string;
}
const PHASE_TEXT: Record<SceneStatus["phase"], string> = { overview: "Overview", preparing: "Preparing", entering: "Entering", immersive: "Inside a panorama", exiting: "Leaving", disposed: "Closed" };
function entryState(entry: SceneEntryStatus, status: SceneStatus): string {
  if (!entry.supported) return "Not shown here";
  if (status.active === entry.id) return "Entered";
  if (status.target === entry.id) return PHASE_TEXT[status.phase];
  if (entry.preview === "failed") return "Preview unavailable";
  if (entry.preview === "idle") return "Preview queued";
  if (entry.preview === "loading") return "Loading preview";
  if (entry.placement === "pending") return "Preview ready · waiting for the ground";
  return entry.placement === "unavailable" ? "Placement unavailable" : "Ready";
}
function readyMark(entry: SceneEntryStatus): boolean {
  return entry.supported && entry.preview === "ready";
}
function checkMark(document: Document): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3.2 8.4 6.4 11.6 12.8 4.4");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2.2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}
function safePictureUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
function previewPicture(document: Document, face: ScenePreviewFace): HTMLElement | null {
  const href = safePictureUrl(face.url);
  if (!href || face.size < 1 || face.sheetWidth < face.size || face.sheetHeight < face.size) return null;
  const node = document.createElement("span");
  node.className = "foss-earth-scene-entry__picture";
  node.setAttribute("aria-hidden", "true");
  const shown = 88;
  const scale = shown / face.size;
  node.style.backgroundImage = `url("${href.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}")`;
  node.style.backgroundPosition = `${Math.round(-face.x * scale)}px ${Math.round(-face.y * scale)}px`;
  node.style.backgroundSize = `${Math.round(face.sheetWidth * scale)}px ${Math.round(face.sheetHeight * scale)}px`;
  return node;
}
/** Scenes owns Content/Credits; other owners supply their settings at their existing homes. */
export function createScenesPanel(options: { document: Document; controller: SceneController; ui: ScenesPanelUi; contributions?: readonly ScenesPanelContribution[]; layerArrangement?: SceneLayerArrangement; opening?: SceneOpening; look?: SceneLookControl; previewBackend?: PreviewBackendLoader; externalLinkIcon?(document: Document): HTMLElement | SVGElement;
  /** Whether the panel starts on screen; true when absent. A host that passes false calls setShown when it opens. */
  shown?: boolean }): ScenesPanel {
  // Validate before listening or storing, so a rejected panel leaves nothing behind.
  const contributions = options.contributions ?? [], seen = new Set<string>();
  for (const contribution of contributions) { if (seen.has(contribution.section)) throw new Error("Scenes section contributions require unique existing homes."); seen.add(contribution.section); }
  const { document, controller } = options;
  const previewBackend = createPreviewBackends({ loadGpu: options.previewBackend });
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const row = (heading?: string): HTMLDivElement => { const node = el("div", "foss-earth-choices"); if (heading) node.append(el("div", "foss-earth-choices__heading", heading)); return node; };
  const note = (text: string): HTMLParagraphElement => el("p", "foss-earth-choices__note", text);
  const button = (label: string, action: () => void, title?: string): HTMLButtonElement => { const node = el("button", "foss-earth-choice foss-earth-scene-button", label); node.type = "button"; if (title) node.title = title; node.addEventListener("click", action); return node; };
  const content = el("div", "foss-earth-choice-panel foss-earth-scenes"), loadRow = row("Load scene"), urlField = el("input", "foss-earth-scene-url");
  urlField.type = "url"; urlField.placeholder = "https://…/scene.json"; urlField.setAttribute("aria-label", "Scene manifest URL");
  const load = (): void => { if (urlField.value.trim()) void controller.load(urlField.value); };
  urlField.addEventListener("keydown", event => { if (event.key === "Enter") load(); });
  loadRow.append(urlField, button("Load", load));
  const offeredRow = row("Scenes");
  for (const offered of controller.examples) offeredRow.append(button(offered.title, () => { void controller.load(offered.id, { exampleId: true }); }, offered.description));
  const messages = row(), credits = row();
  let sceneBlock = el("div", "foss-earth-choice-panel");
  content.append(loadRow, offeredRow, messages, sceneBlock);
  const view = document.defaultView;
  let storage: Storage | null = null;
  try { storage = view?.localStorage ?? null; } catch { /* Storage is optional. */ }
  const savedPanel = createScenePanelStore({ storage, key: `foss-earth.scene-panel.v1:${view?.location.pathname ?? "/"}`,
    schedule(run, ms) { const timer = view?.setTimeout(run, ms); return { cancel() { if (timer !== undefined) view?.clearTimeout(timer); } }; },
  });
  const savePanel = (): void => {
    const status = controller.state().status;
    const id = status?.sceneId;
    if (!id || previewScope !== `${id}:${status.generation}`) return;
    const looks = Object.fromEntries([...previews].map(([id, state]) => [id, { ...state.look }]));
    const layers: Record<string, boolean> = Object.create(null);
    const collect = (items: SceneStatus["layers"]): void => {
      for (const layer of items) { layers[layer.id] = layer.visible; collect(layer.layers); }
    };
    collect(status.layers);
    savedPanel.set(id, { grouping, expanded: [...expandedIds], active: expandedId, looks, layers });
  };
  const flushPanel = (): void => { savePanel(); savedPanel.flush(); };
  view?.addEventListener("pagehide", flushPanel);
  const onHidden = (): void => { if (document.hidden) flushPanel(); };
  document.addEventListener("visibilitychange", onHidden);
  let grouping: "layers" | "stops" = "layers";
  let expandedId: string | null = null;
  const expandedIds = new Set<string>();
  let miniFaceKey: string | null = null;
  let mini: MiniViewer | null = null;
  const previews = new Map<string, { look: SceneOpeningLook; still: PreviewStill | null; faceKey: string | null }>();
  let previewScope: string | null = null;
  let updatingOpening = false;
  let restoringLayers = false;
  const covers = new Map<string, PreviewOcclusion>();
  const indicators = new Map<string, { state: string; until: number }>();
  let indicatorTimer: number | undefined;
  const measureCovers = (): void => {
    for (const card of sceneBlock.querySelectorAll<HTMLElement>(".foss-earth-scene-card.is-expanded")) {
      const id = card.dataset.sphere!, frame = card.querySelector<HTMLElement>(".foss-earth-scene-entry__frame")!;
      const bounds = frame.getBoundingClientRect();
      if (!(bounds.width > 0 && bounds.height > 0)) continue;
      const occlusion: { x: number; y: number; width: number; height: number; radius: number }[] = [];
      for (const selector of [".foss-earth-scene-entry__title", ".foss-earth-scene-entry__mark:not([hidden])"]) {
        const element = card.querySelector<HTMLElement>(selector);
        if (!element) continue;
        const box = element.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) occlusion.push({ x: (box.left - bounds.left) / bounds.width, y: (box.top - bounds.top) / bounds.height,
          width: box.width / bounds.width, height: box.height / bounds.height, radius: selector.includes("mark") ? Math.min(box.width, box.height) / 2 / bounds.width : 0 });
      }
      covers.set(id, occlusion);
      previews.get(id)?.still?.setOcclusion?.(occlusion);
    }
    mini?.fit();
  };
  const coverObserver = view?.ResizeObserver ? new view.ResizeObserver(measureCovers) : null;
  const updateIndicators = (): void => {
    if (indicatorTimer !== undefined) view?.clearTimeout(indicatorTimer);
    indicatorTimer = undefined;
    let next = Infinity;
    const now = view?.performance.now() ?? 0;
    for (const card of sceneBlock.querySelectorAll<HTMLElement>(".foss-earth-scene-card.is-expanded")) {
      const mark = card.querySelector<HTMLElement>(".foss-earth-scene-entry__mark");
      if (!mark) continue;
      const id = card.dataset.sphere!, state = mark.dataset.state!;
      let indicator = indicators.get(id);
      if (!indicator || indicator.state !== state) { indicator = { state, until: now + 2000 }; indicators.set(id, indicator); }
      mark.hidden = now >= indicator.until;
      card.classList.toggle("is-indicator-hidden", mark.hidden);
      if (!mark.hidden) next = Math.min(next, indicator.until - now);
    }
    measureCovers();
    if (next < Infinity && view) indicatorTimer = view.setTimeout(updateIndicators, Math.max(1, Math.ceil(next)));
  };
  const previewState = (id: string) => {
    let state = previews.get(id);
    if (!state) {
      const look = clampMiniLook(options.opening?.lookFor(id) ?? { headingDeg: 0, pitchDeg: 0, verticalFovDeg: 90 }, navigation());
      state = { look, still: null, faceKey: null };
      previews.set(id, state);
    }
    return state;
  };
  const retireMini = (): void => { const previous = mini; mini = null; previous?.destroy(); };
  const clearPreviews = (): void => { covers.clear(); indicators.clear(); retireMini(); for (const state of previews.values()) state.still?.destroy(); previews.clear(); };
  let pressBindings: (() => void)[] = [];
  const togglePreview = (id: string): void => {
    if (expandedIds.has(id)) {
      expandedIds.delete(id);
      if (expandedId === id) expandedId = null;
    } else { expandedIds.add(id); expandedId = id; }
    lastRendered = undefined;
    paint(controller.state());
  };
  const enterImage = (id: string): void => {
    expandedId = null;
    lastRendered = undefined;
    paint(controller.state());
    void controller.handle()?.enter(id);
  };
  let lastRendered: string | undefined;
  const navigation = (): MiniNavigation => {
    const look = options.look;
    if (!look) return DEFAULT_MINI_NAVIGATION;
    const pitch = look.pitchRange();
    const fov = look.fovRange();
    return { swipeSensitivity: look.swipeSensitivity?.(), inertiaHalfLifeMs: look.inertiaHalfLifeMs?.(), reducedMotion: look.reducedMotion?.(), dragSensitivity: look.dragSensitivity(), zoomPerNotch: look.zoomPerNotch(), pinchGain: look.pinchGain(), pitch, fov };
  };
  function placeMini(status: SceneStatus | null): void {
    const entry = expandedId ? status?.entries.find(item => item.id === expandedId) : undefined;
    const slot = [...sceneBlock.querySelectorAll<HTMLElement>(".foss-earth-scene-card")].find(card => card.dataset.sphere === expandedId)?.querySelector<HTMLElement>(".foss-earth-scene-entry__viewer");
    const face = entry?.previewFace;
    if (!entry || !slot || face?.originX == null || !face.url) { retireMini(); return; }
    let previousLook: SceneOpeningLook | null = mini?.id === entry.id ? mini.getLook() : previewState(entry.id).look;
    const faceKey = JSON.stringify(face);
    if (mini?.id === entry.id && miniFaceKey === faceKey) {
      if (mini.frame.parentElement === slot) return;
      // A state-preserving DOM move keeps the iframe document and ongoing gesture.
      const target = slot as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
      if (target.moveBefore) { target.moveBefore(mini.frame, null); mini.fit(); return; }
      previousLook = mini.getLook();
    }
    retireMini();
    miniFaceKey = faceKey;
    const id = entry.id;
    mini = createMiniViewer({
      document, id, face, backend: previewBackend, occlusion: () => covers.get(id) ?? [], input: options.look?.input, look: previousLook ?? options.opening?.lookFor(id) ?? null, navigation,
      onLook: look => {
        const state = previewState(id);
        state.look = { ...look };
        if (mini?.id !== id) state.still?.setLook(look);
        options.opening?.remember(id, look);
        savePanel();
      },
      onTap: () => enterImage(id),
      onHold: () => togglePreview(id),
    });
    slot.append(mini.frame);
  }
  function renderMessages(state: SceneControllerState): void {
    messages.replaceChildren(); if (state.loading) messages.append(note(`Loading ${state.loading}…`));
    for (const error of state.errors.slice(0, 12)) messages.append(note(`${error.path}: ${error.message}`));
    if (state.errors.length > 12) messages.append(note(`and ${state.errors.length - 12} more problems.`));
  }
  /** Takes up the saved state of a newly loaded scene. False, with nothing kept, when no scene is loaded. */
  function adoptScope(status: SceneStatus | null): status is SceneStatus {
    if (!status || status.phase === "disposed") { clearPreviews(); previewScope = null; expandedId = null; expandedIds.clear(); return false; }
    const scope = `${status.sceneId}:${status.generation}`;
    if (scope === previewScope) return true;
    clearPreviews(); previewScope = scope;
    const saved = savedPanel.get(status.sceneId);
    expandedIds.clear(); expandedId = null;
    if (saved) {
      grouping = saved.grouping;
      for (const id of saved.expanded) if (status.entries.some(entry => entry.id === id)) expandedIds.add(id);
      expandedId = saved.active && expandedIds.has(saved.active) ? saved.active : null;
      for (const [id, look] of Object.entries(saved.looks)) if (status.entries.some(entry => entry.id === id)) previews.set(id, { look: clampMiniLook(look, navigation()), still: null, faceKey: null });
    }
    return true;
  }
  function renderScene(status: SceneStatus | null): void {
    for (const off of pressBindings) off();
    pressBindings = [];
    coverObserver?.disconnect();
    const active = document.activeElement;
    const focused = active?.tagName === "BUTTON" && sceneBlock.contains(active) ? (active as HTMLButtonElement).dataset.sphere : undefined;
    const previousBlock = sceneBlock;
    sceneBlock = el("div", "foss-earth-choice-panel");
    previousBlock.after(sceneBlock);
    credits.replaceChildren();
    if (!adoptScope(status)) { sceneBlock.append(note("No scene is loaded.")); credits.append(note("Nothing from a scene is on screen.")); previousBlock.remove(); return; }
    for (const [id, preview] of previews) {
      if (!expandedIds.has(id)) { preview.still?.destroy(); preview.still = null; preview.faceKey = null; }
    }
    const heading = row(status.title); heading.append(note(`${PHASE_TEXT[status.phase]}. ${status.entries.length} ${status.entries.length === 1 ? "entity" : "entities"}, revision ${status.revision}.`));
    const supported = status.entries.filter(entry => entry.supported), ready = supported.filter(entry => entry.preview === "ready").length, failed = supported.filter(entry => entry.preview === "failed").length;
    if (supported.length) heading.append(note(`${ready} of ${supported.length} panorama previews ready${failed ? `; ${failed} unavailable` : ""}. Panoramas appear as each preview arrives. Larger images load when you enter a panorama.`));
    if (!status.renderingAvailable) heading.append(note(status.unavailableReason ?? "Panoramas cannot be drawn here."));
    if (status.overview === "pending") { heading.append(note("The overview waits for the map to show the ground at the scene's place.")); heading.append(button("Go to the scene", () => { void controller.handle()?.showOverview(); })); }
    else if (status.overview === "applied" && status.phase === "overview") heading.append(button("Back to the scene's view", () => { void controller.handle()?.showOverview(); }));
    heading.append(button("Unload", () => controller.unload(), "Removes the scene and everything it loaded.")); if (status.lastError) heading.append(note(status.lastError)); sceneBlock.append(heading);
    const arranged = options.layerArrangement;
    const placed = new Set<string>();
    let dragging: { entityId: string; sourceLayerId: string } | null = null;
    const showPhotographs = status.entries.some(entry => entry.supported);
    if (showPhotographs) {
      const tools = row();
      tools.classList.add("foss-earth-scene-tools");
      const groupBy = el("div", "foss-earth-scene-tools__group");
      groupBy.append(el("span", "foss-earth-scene-tools__label", "Group"));
      for (const [id, label] of [["layers", "Indoor and outdoor"], ["stops", "Tour stops"]] as const) {
        const choice = button(label, () => { grouping = id; lastRendered = undefined; paint(controller.state()); });
        choice.setAttribute("aria-pressed", String(grouping === id));
        groupBy.append(choice);
      }
      tools.append(groupBy);
      const opening = options.opening;
      if (opening) {
        const openBy = el("div", "foss-earth-scene-tools__group");
        openBy.append(el("span", "foss-earth-scene-tools__label", "Opening view"));
        for (const [id, label] of [["enter", "On entering"], ["last", "Last view"], ["image", "Each photograph"], ["fixed", "One position"]] as const) {
          const choice = button(label, () => opening.setMode(id));
          choice.setAttribute("aria-pressed", String(opening.mode() === id));
          openBy.append(choice);
        }
        openBy.append(button("Look up", () => {
          updatingOpening = true;
          try { opening.lookUp(); } finally { updatingOpening = false; }
          applyOpening();
        }, "Open every photograph looking up"));
        tools.append(openBy);
      }
      sceneBlock.append(tools);
    }
    const entryItem = (entry: SceneEntryStatus, sourceLayerId: string | null): HTMLDivElement => {
      const expanded = expandedIds.has(entry.id);
      const item = el("div", `foss-earth-scene-card${expanded ? " is-expanded" : ""}`);
      item.dataset.sphere = entry.id;
      item.addEventListener("pointerenter", () => {
        if (!expandedIds.has(entry.id) || expandedId === entry.id) return;
        expandedId = entry.id;
        lastRendered = undefined;
        paint(controller.state());
      });
      const frame = el("div", "foss-earth-scene-entry__frame");
      const picture = expanded && entry.previewFace ? previewPicture(document, entry.previewFace) : null;
      if (picture && entry.previewFace?.originX != null) {
        const state = previewState(entry.id);
        const faceKey = JSON.stringify(entry.previewFace);
        if (!state.still || state.faceKey !== faceKey) {
          state.still?.destroy();
          state.still = createPreviewStill({ document, backend: previewBackend, id: entry.id, face: entry.previewFace, look: state.look });
          state.faceKey = faceKey;
        }
        picture.append(state.still.canvas);
      }
      const enter = (): void => {
        if (item.dataset.dragged === "true") { delete item.dataset.dragged; return; }
        if (entry.supported && status.renderingAvailable) enterImage(entry.id);
      };
      const open = button(picture ? "" : entry.title, () => {}, `Enter ${entry.title}; hold to ${expanded ? "collapse" : "expand"} preview`);
      pressBindings.push(bindPhotographPress(open, { onTap: enter, onHold: () => togglePreview(entry.id) }));
      open.classList.add("foss-earth-scene-entry__open");
      open.dataset.sphere = entry.id;
      open.setAttribute("aria-expanded", String(expanded));
      if (picture) { open.append(picture); open.setAttribute("aria-label", entry.title); }
      else open.setAttribute("aria-label", entry.title);
      const mark = el("span", "foss-earth-scene-entry__mark");
      mark.dataset.state = readyMark(entry) ? "ready" : "loading";
      mark.setAttribute("role", "img");
      mark.setAttribute("aria-label", entryState(entry, status));
      if (readyMark(entry)) mark.append(checkMark(document));
      frame.append(open);
      if (expanded) frame.append(mark);
      if (expanded && expandedId === entry.id && entry.previewFace?.originX != null) frame.append(el("div", "foss-earth-scene-entry__viewer"));
      if (expanded) {
        const title = button(entry.title, () => {}, `Enter ${entry.title}; hold to collapse preview`);
        pressBindings.push(bindPhotographPress(title, { onTap: enter, onHold: () => togglePreview(entry.id) }));
        title.classList.add("foss-earth-scene-entry__title");
        title.dataset.sphere = entry.id;
        title.disabled = !entry.supported || !status.renderingAvailable || status.active === entry.id;
        frame.append(title);
      }
      item.append(frame);
      if (arranged && sourceLayerId && grouping === "layers") {
        item.draggable = true;
        open.draggable = true;
        item.title = "Drag onto Indoor or Outdoor";
        item.addEventListener("dragstart", event => {
          item.dataset.dragged = "true";
          dragging = { entityId: entry.id, sourceLayerId };
          event.dataTransfer?.setData("text/plain", entry.id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          event.stopPropagation();
        });
        item.addEventListener("dragend", () => { dragging = null; clearDrop(); document.defaultView?.setTimeout(() => { delete item.dataset.dragged; }, 0); });
      }
      return item;
    };
    const clearDrop = (): void => { for (const node of sceneBlock.querySelectorAll(".is-drop")) node.classList.remove("is-drop"); };
    const panoramasUnder = (layer: SceneLayerStatus): SceneLayerStatus[] => layer.kind === "panoramas" ? [layer] : layer.layers.flatMap(panoramasUnder);
    const acceptDrop = (event: DragEvent, targetLayerId: string | null): void => {
      if (!arranged || !dragging || !targetLayerId) return;
      event.preventDefault();
      event.stopPropagation();
      const entityId = dragging.entityId;
      dragging = null;
      clearDrop();
      controller.handle()?.movePanorama(entityId, targetLayerId);
    };
    const groupHeading = (title: HTMLElement, members: readonly string[], name: string): HTMLElement => {
      const header = el("div", "foss-earth-scene-group-heading");
      header.append(title);
      const ids = [...new Set(members)].filter(id => supported.some(entry => entry.id === id));
      if (ids.length) {
        const all = ids.every(id => expandedIds.has(id));
        const toggle = button(all ? "Minimize all" : "Maximize all", () => {
          for (const id of ids) { if (all) expandedIds.delete(id); else expandedIds.add(id); }
          if (all && expandedId && ids.includes(expandedId)) expandedId = null;
          if (!all) expandedId = ids[0];
          lastRendered = undefined;
          paint(controller.state());
        });
        toggle.classList.add("foss-earth-scene-group-toggle");
        toggle.setAttribute("aria-label", `${all ? "Minimize" : "Maximize"} all in ${name}`);
        header.append(toggle);
      }
      return header;
    };
    if (status.layers.length) {
      const layers = row("Map layers");
      const renderLayers = (items: SceneStatus["layers"], container: HTMLElement, parent?: string): void => {
        for (const layer of items) {
          const destination = layer.kind === "panoramas" ? layer.id : panoramasUnder(layer).length === 1 ? panoramasUnder(layer)[0].id : null;
          const label = el("label", "foss-earth-scene-layer");
          const group = el("div", "foss-earth-scene-layer-group");
          group.dataset.layer = layer.id;
          group.setAttribute("role", "group");
          group.setAttribute("aria-label", parent ? `${parent}, ${layer.title}` : layer.title);
          const box = el("input");
          box.type = "checkbox";
          box.checked = layer.visible;
          box.disabled = !layer.enabled;
          box.setAttribute("aria-label", parent ? `${parent}, ${layer.title}` : layer.title);
          box.addEventListener("change", () => { controller.handle()?.setLayerVisible(layer.id, box.checked); });
          label.append(box, el("span", undefined, layer.title));
          if (layer.kind === "features") label.title = "This layer's lines stay with the scene. The map does not draw them yet.";
          if (arranged && destination) {
            label.addEventListener("dragover", event => { if (!dragging) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; label.classList.add("is-drop"); });
            label.addEventListener("dragleave", event => { if (event.relatedTarget instanceof Node && label.contains(event.relatedTarget)) return; label.classList.remove("is-drop"); });
            label.addEventListener("drop", event => acceptDrop(event, destination));
          }
          const groupMembers = panoramasUnder(layer).flatMap(item => item.members);
          group.append(grouping === "layers" ? groupHeading(label, groupMembers, layer.title) : label);
          if (grouping === "layers" && layer.kind === "panoramas") {
            const members = el("div", "foss-earth-scene-layer-members");
            members.setAttribute("aria-label", `${parent ? `${parent}, ` : ""}${layer.title} photographs`);
            for (const id of layer.members) {
              if (placed.has(id)) continue;
              placed.add(id);
              const entry = status.entries.find(item => item.id === id);
              members.append(entry ? entryItem(entry, layer.id) : note(id));
            }
            if (arranged) {
              if (!layer.members.length) members.append(note("Drop a photograph here"));
              members.addEventListener("dragover", event => { if (!dragging) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; members.classList.add("is-drop"); });
              members.addEventListener("dragleave", event => { if (event.relatedTarget instanceof Node && members.contains(event.relatedTarget)) return; members.classList.remove("is-drop"); });
              members.addEventListener("drop", event => acceptDrop(event, layer.id));
            }
            group.append(members);
          }
          renderLayers(layer.layers, group, layer.title);
          container.append(group);
        }
      };
      renderLayers(status.layers, layers);
      if (arranged) {
        const actions = el("div", "foss-earth-scene-layer-actions");
        const arrangementNote = note(arranged.count() ? arranged.note() : "Drag a photograph onto Indoor or Outdoor. Download keeps a copy, as a place or orientation export does.");
        actions.append(arrangementNote);
        const reveal = el("pre", "foss-earth-scene-layer-export");
        reveal.hidden = true;
        const prepare = (): { text: string; filename: string; disclosures: readonly string[] } | null => arranged.exportDocument();
        const show = (text: string, message: string): void => { reveal.hidden = false; reveal.textContent = text; arrangementNote.textContent = message; };
        const download = button("Download", () => {
          const prepared = prepare(); if (!prepared) return;
          const view = document.defaultView; if (!view) return;
          const url = view.URL.createObjectURL(new Blob([prepared.text], { type: "application/json" }));
          const link = el("a"); link.href = url; link.download = prepared.filename; link.hidden = true;
          document.body.append(link); link.click(); link.remove();
          view.setTimeout(() => view.URL.revokeObjectURL(url), 1500);
          const extra = prepared.disclosures.length ? ` ${prepared.disclosures.join(" ")}` : "";
          arrangementNote.textContent = `Download requested for ${prepared.filename}.${extra}`;
        }, "Saves the layer corrections as a file");
        const copy = button("Copy JSON", () => {
          const prepared = prepare(); if (!prepared) return;
          const write = document.defaultView?.navigator.clipboard?.writeText(prepared.text);
          if (!write) { show(prepared.text, `Copy failed. Select the JSON below and keep ${prepared.filename}.`); return; }
          void write.then(() => { reveal.hidden = true; arrangementNote.textContent = `Copied ${prepared.filename}.`; }, () => show(prepared.text, `Copy failed. Select the JSON below and keep ${prepared.filename}.`));
        });
        const reset = button("Reset layers", () => arranged.reset(), "Puts every photograph back in its published layer");
        reset.disabled = arranged.count() === 0;
        download.disabled = arranged.count() === 0;
        copy.disabled = arranged.count() === 0;
        actions.append(download, copy, reset, reveal);
        layers.append(actions);
      }
      sceneBlock.append(layers);
    }
    if (grouping === "stops") {
      const seen = new Set<string>();
      for (const group of status.groups) {
        const members = group.members.filter(id => { if (seen.has(id) || !status.entries.some(entry => entry.id === id)) return false; seen.add(id); return true; });
        if (!members.length) continue;
        const groupRow = el("div", "foss-earth-scene-layer-members foss-earth-scene-stop");
        groupRow.setAttribute("role", "group");
        groupRow.setAttribute("aria-label", group.title);
        groupRow.append(groupHeading(el("div", "foss-earth-choices__heading", group.title), members, group.title));
        for (const id of members) { const entry = status.entries.find(item => item.id === id); if (entry) groupRow.append(entryItem(entry, null)); }
        sceneBlock.append(groupRow);
      }
      const loose = status.entries.filter(entry => !seen.has(entry.id));
      if (loose.length) { const list = row("Other photographs"); for (const entry of loose) list.append(entryItem(entry, null)); sceneBlock.append(list); }
    } else {
      const loose = status.entries.filter(entry => !placed.has(entry.id));
      const list = loose.length ? row(placed.size ? "Other photographs" : "Panoramas") : null;
      for (const entry of loose) list?.append(entryItem(entry, null));
      if (list) sceneBlock.append(list);
    }
    if (focused) [...sceneBlock.querySelectorAll<HTMLButtonElement>("button[data-sphere]")].find(node => node.dataset.sphere === focused)?.focus({ preventScroll: true });
    placeMini(status);
    previousBlock.remove();
    updateIndicators();
    for (const title of sceneBlock.querySelectorAll(".foss-earth-scene-entry__title")) coverObserver?.observe(title);
    if (status.warnings.length) { const warnings = row("Warnings"); for (const warning of status.warnings) warnings.append(note(`${warning.path}: ${warning.message}`)); sceneBlock.append(warnings); }
    if (!status.credits.length) credits.append(note("Nothing from this scene is on screen."));
    for (const credit of status.credits) {
      const line = note(credit.text); if (credit.license) line.append(` · ${credit.license}`);
      if (credit.url) { let url: URL | null = null; try { url = new URL(credit.url); } catch { /* Invalid unvalidated host data stays plain text. */ }
        if (url && ["https:", "http:"].includes(url.protocol) && !url.username && !url.password) { const link = el("a", undefined, "source"); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; const icon = options.externalLinkIcon?.(document); if (icon) link.append(icon); line.append(" · ", link); }
      }
      credits.append(line);
    }
  }
  const contentSection = options.ui.parameterSection({ tab: SCENES_TAB, section: "content", main: content, showAll: true });
  const creditSection = options.ui.parameterSection({ tab: SCENES_TAB, section: "credits", main: credits, showAll: false });
  const sections = options.ui.sections([
    { id: "scenes.content", title: "Content", element: contentSection.element, defaultOpen: true },
    ...(["links", "appearance", "motion", "loading", "tiles", "saved"] as const).flatMap(id => { const contribution = contributions.find(item => item.section === id); return contribution ? [{ id: `scenes.${id}`, title: contribution.title, element: contribution.element, defaultOpen: false }] : []; }),
    { id: "scenes.credits", title: "Credits", element: creditSection.element, defaultOpen: false },
  ]);
  let destroyed = false;
  let shown = options.shown ?? true;
  const paint = (state: SceneControllerState): void => {
    // Visibility setters emit synchronously. Restore all own checkboxes before
    // rendering/saving the new scene, so intermediate snapshots cannot replace
    // the user's saved preferences with the authored defaults.
    if (restoringLayers) return;
    const status = state.status;
    if (status && status.phase !== "disposed" && `${status.sceneId}:${status.generation}` !== previewScope) {
      const saved = savedPanel.get(status.sceneId)?.layers;
      const handle = controller.handle();
      if (saved && handle) {
        const restore = (items: SceneStatus["layers"]): void => {
          for (const layer of items) {
            const visible = saved[layer.id];
            if (typeof visible === "boolean" && visible !== layer.visible) handle.setLayerVisible(layer.id, visible);
            restore(layer.layers);
          }
        };
        restoringLayers = true;
        try { restore(status.layers); } finally { restoringLayers = false; }
        state = controller.state();
      }
    }
    if (!shown && !sections.element.isConnected) {
      // Off screen: keep what is saved, and rebuild when shown.
      adoptScope(state.status);
      savePanel();
      lastRendered = undefined;
      return;
    }
    renderMessages(state);
    const key = JSON.stringify(state.status ? { ...state.status, view: null, layerArrangement: options.layerArrangement?.count() ?? 0, grouping, expandedId, expandedIds: [...expandedIds], opening: options.opening?.mode() ?? null } : null);
    if (key !== lastRendered) { lastRendered = key; renderScene(state.status); savePanel(); }
  };
  const off = controller.subscribe(paint);
  const offArrangement = options.layerArrangement?.subscribe(() => { lastRendered = undefined; paint(controller.state()); });
  function applyOpening(): void {
    for (const entry of controller.state().status?.entries ?? []) {
      if (!expandedIds.has(entry.id) && !previews.has(entry.id)) continue;
      const look = options.opening?.lookFor(entry.id);
      if (!look) continue;
      const state = previewState(entry.id);
      state.look = clampMiniLook(look, navigation());
      state.still?.setLook(state.look);
      if (mini?.id === entry.id) mini.setLook(state.look);
    }
    lastRendered = undefined;
    paint(controller.state());
  }
  const offOpening = options.opening?.subscribe?.(() => { if (!updatingOpening) applyOpening(); });
  const setShown = (next: boolean): void => {
    if (shown === next) return;
    shown = next;
    if (shown && !destroyed) paint(controller.state());
  };
  return { element: sections.element, setShown, destroy() { if (destroyed) return; destroyed = true; for (const off of pressBindings) off(); pressBindings = []; flushPanel(); clearPreviews(); coverObserver?.disconnect(); if (indicatorTimer !== undefined) view?.clearTimeout(indicatorTimer); previewBackend.destroy(); savedPanel.dispose(); view?.removeEventListener("pagehide", flushPanel); document.removeEventListener("visibilitychange", onHidden); off(); offArrangement?.(); offOpening?.(); contentSection.destroy(); creditSection.destroy(); for (const contribution of contributions) contribution.destroy(); sections.destroy(); } };
}

/** Link buttons at authored image directions; updates only on the supplied drawn-frame event. */
export function createSceneHotspots(options: { document: Document; controller: SceneController; container: HTMLElement }): { destroy(): void } {
  const { document, controller, container } = options, layer = document.createElement("div"); layer.className = "foss-earth-scene-hotspots"; container.append(layer);
  const buttons = new Map<string, HTMLButtonElement>(); let offFrame: (() => void) | null = null, handleSeen: unknown = null, destroyed = false;
  const place = (): void => {
    const spots = controller.handle()?.hotspots() ?? [], rect = layer.getBoundingClientRect(), seen = new Set<string>();
    for (const spot of spots) { seen.add(spot.id); let button = buttons.get(spot.id); if (!button) { button = document.createElement("button"); button.className = "foss-earth-scene-hotspot"; button.type = "button"; const id = spot.id; button.addEventListener("click", () => { void controller.handle()?.follow(id); }); buttons.set(id, button); layer.append(button); } button.textContent = spot.label; button.style.transform = `translate(${spot.x - rect.left}px, ${spot.y - rect.top}px) translate(-50%, -50%)`; }
    for (const [id, button] of buttons) if (!seen.has(id)) { button.remove(); buttons.delete(id); }
  };
  const off = controller.subscribe(() => { const handle = controller.handle(); if (handle !== handleSeen) { offFrame?.(); offFrame = handle?.onFrame(place) ?? null; handleSeen = handle; } place(); });
  return { destroy() { if (destroyed) return; destroyed = true; off(); offFrame?.(); layer.remove(); buttons.clear(); } };
}
