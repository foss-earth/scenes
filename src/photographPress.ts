/** A short press enters; a stationary half-second hold toggles the preview. */
export function bindPhotographPress(element: HTMLElement, options: {
  onTap(): void;
  onHold(): void;
  isMoving?(): boolean;
}): () => void {
  const view = element.ownerDocument.defaultView;
  if (!view) return () => {};
  let timer: number | null = null;
  let down: { id: number; x: number; y: number } | null = null;
  let consumed = false;
  const clear = (): void => { if (timer !== null) view.clearTimeout(timer); timer = null; };
  const cancel = (): void => { clear(); down = null; consumed = true; };
  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (down) { cancel(); return; }
    consumed = options.isMoving?.() ?? false;
    down = { id: event.pointerId, x: event.clientX, y: event.clientY };
    clear();
    timer = view.setTimeout(() => {
      timer = null;
      consumed = true;
      options.onHold();
    }, 500);
  };
  const onMove = (event: PointerEvent): void => {
    if (down && event.pointerId === down.id && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) cancel();
  };
  const onOtherDown = (event: PointerEvent): void => { if (down && event.pointerId !== down.id) cancel(); };
  const onCancel = (): void => { if (down) cancel(); };
  const onUp = (): void => { clear(); down = null; };
  const onClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (consumed) { consumed = false; return; }
    options.onTap();
  };
  const onContext = (event: Event): void => { event.preventDefault(); };
  element.addEventListener("pointerdown", onDown);
  view.addEventListener("pointermove", onMove);
  view.addEventListener("pointerdown", onOtherDown);
  // Watch release outside the element without capturing away native layer dragging.
  view.addEventListener("pointerup", onUp);
  view.addEventListener("pointercancel", onCancel);
  element.addEventListener("click", onClick, true);
  element.addEventListener("dragstart", cancel);
  element.addEventListener("wheel", cancel, { passive: true });
  element.addEventListener("contextmenu", onContext);
  return () => {
    clear();
    element.removeEventListener("pointerdown", onDown);
    view.removeEventListener("pointermove", onMove);
    view.removeEventListener("pointerdown", onOtherDown);
    view.removeEventListener("pointerup", onUp);
    view.removeEventListener("pointercancel", onCancel);
    element.removeEventListener("click", onClick, true);
    element.removeEventListener("dragstart", cancel);
    element.removeEventListener("wheel", cancel);
    element.removeEventListener("contextmenu", onContext);
  };
}
