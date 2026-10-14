import type { SceneController, SceneControllerState } from "./controller.js";
import type { SceneEntryStatus, SceneStatus } from "./ports.js";
import { SCENES_TAB } from "./catalogue.js";
export interface ScenePanelElement { element: HTMLElement; destroy(): void }
export interface ScenePanelSection { id: string; title: string; element: HTMLElement; defaultOpen: boolean }
/** Existing shared UI/settings authority supplied by the application. */
export interface ScenesPanelUi {
  parameterSection(options: { tab: "scenes"; section: "content" | "credits"; main: HTMLElement; showAll: boolean }): ScenePanelElement;
  sections(sections: readonly ScenePanelSection[]): ScenePanelElement;
}
export interface ScenesPanelContribution extends ScenePanelElement {
  /** Existing homes supplied by360, images and tiled-cubemap, in their former order. */
  section: "appearance" | "motion" | "loading" | "tiles" | "saved";
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
function details(entry: SceneEntryStatus): string[] {
  const lines: string[] = [];
  if (entry.description) lines.push(entry.description);
  if (entry.capture) { const capture = entry.capture; lines.push(`Captured at ${capture.latitudeDeg.toFixed(6)}°, ${capture.longitudeDeg.toFixed(6)}°, ${capture.heightMeters === null ? "height unknown" : `${capture.heightMeters.toFixed(1)} m above the ellipsoid`}.`); }
  if (entry.marker) {
    const marker = entry.marker;
    lines.push(`Shown ${marker.offsetM} m above ${marker.mode === "ground-relative" ? "the displayed ground" : "the capture point"}${marker.eastM || marker.northM ? `, ${marker.eastM} m east and ${marker.northM} m north of the capture` : ""}.`);
    lines.push(`Radius ${marker.radiusMeters} m${marker.authoredRadius ? ", as the scene sets it" : ", from Orbs → Orb radius"}; the orb's size on screen bounds it.`);
  }
  if (entry.previewDetail) lines.push(`Preview ${entry.previewDetail.representation}, ${Math.round(entry.previewDetail.faceTexels)} px faces${entry.previewDetail.limitation ? `: ${entry.previewDetail.limitation}` : "."}`);
  if (entry.message) lines.push(entry.message);
  return lines;
}
/** Scenes owns Content/Credits; other owners supply their settings at their existing homes. */
export function createScenesPanel(options: { document: Document; controller: SceneController; ui: ScenesPanelUi; contributions?: readonly ScenesPanelContribution[]; externalLinkIcon?(document: Document): HTMLElement | SVGElement }): ScenePanelElement {
  const { document, controller } = options;
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
  const messages = row(), sceneBlock = el("div", "foss-earth-choice-panel"), credits = row();
  content.append(loadRow, offeredRow, messages, sceneBlock);
  function renderMessages(state: SceneControllerState): void {
    messages.replaceChildren(); if (state.loading) messages.append(note(`Loading ${state.loading}…`));
    for (const error of state.errors.slice(0, 12)) messages.append(note(`${error.path}: ${error.message}`));
    if (state.errors.length > 12) messages.append(note(`and ${state.errors.length - 12} more problems.`));
  }
  function renderScene(status: SceneStatus | null): void {
    const expanded = new Set([...sceneBlock.querySelectorAll<HTMLDetailsElement>("details[open][data-sphere]")].map(node => node.dataset.sphere));
    const active = document.activeElement;
    const focused = active?.tagName === "BUTTON" && sceneBlock.contains(active) ? (active as HTMLButtonElement).dataset.sphere : undefined;
    sceneBlock.replaceChildren(); credits.replaceChildren();
    if (!status || status.phase === "disposed") { sceneBlock.append(note("No scene is loaded.")); credits.append(note("Nothing from a scene is on screen.")); return; }
    const heading = row(status.title); heading.append(note(`${PHASE_TEXT[status.phase]}. ${status.entries.length} ${status.entries.length === 1 ? "entity" : "entities"}, revision ${status.revision}.`));
    const supported = status.entries.filter(entry => entry.supported), ready = supported.filter(entry => entry.preview === "ready").length, failed = supported.filter(entry => entry.preview === "failed").length;
    if (supported.length) heading.append(note(`${ready} of ${supported.length} panorama previews ready${failed ? `; ${failed} unavailable` : ""}. Panoramas appear as each preview arrives. Larger images load when you enter a panorama.`));
    if (!status.renderingAvailable) heading.append(note(status.unavailableReason ?? "Panoramas cannot be drawn here."));
    if (status.overview === "pending") { heading.append(note("The overview waits for the map to show the ground at the scene's place.")); heading.append(button("Go to the scene", () => { void controller.handle()?.showOverview(); })); }
    else if (status.overview === "applied" && status.phase === "overview") heading.append(button("Back to the scene's view", () => { void controller.handle()?.showOverview(); }));
    heading.append(button("Unload", () => controller.unload(), "Removes the scene and everything it loaded.")); if (status.lastError) heading.append(note(status.lastError)); sceneBlock.append(heading);
    const list = row("Panoramas");
    for (const entry of status.entries) {
      const item = el("details", "foss-earth-scene-entry"), summary = el("summary", "foss-earth-scene-entry__summary"); item.dataset.sphere = entry.id; item.open = expanded.has(entry.id);
      const enter = button(entry.title, () => { void controller.handle()?.enter(entry.id); }, entry.supported ? `Enter ${entry.title}` : entry.message ?? undefined); enter.dataset.sphere = entry.id; enter.disabled = !entry.supported || !status.renderingAvailable || status.active === entry.id;
      summary.append(enter, el("span", "foss-earth-scene-entry__state", entryState(entry, status))); item.append(summary); for (const line of details(entry)) item.append(note(line)); list.append(item);
    }
    sceneBlock.append(list); if (focused) [...list.querySelectorAll<HTMLButtonElement>("button[data-sphere]")].find(node => node.dataset.sphere === focused)?.focus({ preventScroll: true });
    for (const group of status.groups) {
      const groupRow = row(group.title);
      for (const member of group.members) { const entry = status.entries.find(item => item.id === member), go = button(entry?.title ?? member, () => { void controller.handle()?.enter(member); }); go.disabled = !entry?.supported || !status.renderingAvailable; groupRow.append(go); }
      sceneBlock.append(groupRow);
    }
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
  const contributions = options.contributions ?? [], seen = new Set<string>();
  for (const contribution of contributions) { if (seen.has(contribution.section)) throw new Error("Scenes section contributions require unique existing homes."); seen.add(contribution.section); }
  const contentSection = options.ui.parameterSection({ tab: SCENES_TAB, section: "content", main: content, showAll: true });
  const creditSection = options.ui.parameterSection({ tab: SCENES_TAB, section: "credits", main: credits, showAll: false });
  const sections = options.ui.sections([
    { id: "scenes.content", title: "Content", element: contentSection.element, defaultOpen: true },
    ...(["appearance", "motion", "loading", "tiles", "saved"] as const).flatMap(id => { const contribution = contributions.find(item => item.section === id); return contribution ? [{ id: `scenes.${id}`, title: contribution.title, element: contribution.element, defaultOpen: false }] : []; }),
    { id: "scenes.credits", title: "Credits", element: creditSection.element, defaultOpen: false },
  ]);
  let lastRendered: string | undefined, destroyed = false;
  const off = controller.subscribe(state => { renderMessages(state); const key = JSON.stringify(state.status ? { ...state.status, view: null } : null); if (key !== lastRendered) { lastRendered = key; renderScene(state.status); } });
  return { element: sections.element, destroy() { if (destroyed) return; destroyed = true; off(); contentSection.destroy(); creditSection.destroy(); for (const contribution of contributions) contribution.destroy(); sections.destroy(); } };
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
