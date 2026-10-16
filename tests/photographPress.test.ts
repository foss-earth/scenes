import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { bindPhotographPress } from "../src/photographPress.js";

afterEach(() => vi.useRealTimers());
it("enters on a click, holds to toggle, and never enters after holding or dragging", () => {
  vi.useFakeTimers();
  const dom = new JSDOM("<button>Photograph</button>");
  const button = dom.window.document.querySelector("button")!;
  const enter = vi.fn(), toggle = vi.fn();
  const off = bindPhotographPress(button, { onTap: enter, onHold: toggle });
  const pointer = (type: string, x = 0, id = 1) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: id, button: 0, clientX: x, clientY: 0 });
    button.dispatchEvent(event);
  };
  button.click();
  expect(enter).toHaveBeenCalledTimes(1);
  pointer("pointerdown");
  vi.advanceTimersByTime(500);
  expect(toggle).toHaveBeenCalledTimes(1);
  pointer("pointerup");
  button.click();
  expect(enter).toHaveBeenCalledTimes(1);
  pointer("pointerdown");
  pointer("pointermove", 12);
  vi.advanceTimersByTime(600);
  pointer("pointerup", 12);
  button.click();
  expect(toggle).toHaveBeenCalledTimes(1);
  expect(enter).toHaveBeenCalledTimes(1);
  off(); dom.window.close();
});
it("cancels holds on another finger, cancellation, wheel, and teardown", () => {
  vi.useFakeTimers();
  const dom = new JSDOM("<button>Photograph</button>");
  const button = dom.window.document.querySelector("button")!;
  const toggle = vi.fn();
  const off = bindPhotographPress(button, { onTap() {}, onHold: toggle });
  const down = (id: number) => {
    const event = new dom.window.Event("pointerdown", { bubbles: true });
    Object.assign(event, { pointerId: id, button: 0, clientX: 0, clientY: 0 });
    button.dispatchEvent(event);
  };
  down(1); down(2); vi.advanceTimersByTime(600);
  expect(toggle).not.toHaveBeenCalled();
  button.dispatchEvent(new dom.window.Event("pointercancel"));
  down(1); button.dispatchEvent(new dom.window.Event("wheel")); vi.advanceTimersByTime(600);
  expect(toggle).not.toHaveBeenCalled();
  down(1); off(); vi.advanceTimersByTime(600);
  expect(toggle).not.toHaveBeenCalled();
  dom.window.close();
});
