import type { OverworldScene } from "../OverworldScene";
import type { Direction } from "../TileTypes";

export type ControlRect = { x: number; y: number; w: number; h: number };
export type DpadLayout = Record<Direction | "action", ControlRect>;

const SIZE = 50;
const OFFSETS = {
  up: { left: 62, bottom: 112 }, down: { left: 62, bottom: 8 },
  left: { left: 10, bottom: 60 }, right: { left: 114, bottom: 60 },
  action: { right: 18, bottom: 28 },
} as const;

export const computeDpadLayout = (
  insets: { left: number; right: number; bottom: number },
  viewport: { width: number; height: number },
): DpadLayout => {
  const fromLeft = (left: number, bottom: number): ControlRect => ({
    x: insets.left + left,
    y: viewport.height - insets.bottom - bottom - SIZE,
    w: SIZE,
    h: SIZE,
  });
  return {
    up: fromLeft(OFFSETS.up.left, OFFSETS.up.bottom),
    down: fromLeft(OFFSETS.down.left, OFFSETS.down.bottom),
    left: fromLeft(OFFSETS.left.left, OFFSETS.left.bottom),
    right: fromLeft(OFFSETS.right.left, OFFSETS.right.bottom),
    action: {
      x: viewport.width - insets.right - OFFSETS.action.right - SIZE,
      y: viewport.height - insets.bottom - OFFSETS.action.bottom - SIZE,
      w: SIZE,
      h: SIZE,
    },
  };
};

const prevent = (event: Event) => event.preventDefault();

const wireButton = (
  el: HTMLButtonElement,
  onDown: (source: "pointer" | "touch", id: number) => void,
  onUp?: (source: "pointer" | "touch", id: number) => void,
  capturePointer = false,
) => {
  let sawPointerDown = false;
  let touchFallbackFired = false;
  el.onpointerdown = (event) => {
    event.preventDefault();
    sawPointerDown = true;
    // onDown BEFORE capture: WKWebView can throw on setPointerCapture, and the
    // touch fallback is already disarmed by sawPointerDown — a capture failure
    // must never swallow the press itself.
    if (!touchFallbackFired) onDown("pointer", event.pointerId);
    if (capturePointer) {
      try { el.setPointerCapture(event.pointerId); } catch { /* releases still arrive via pointerup/touchend */ }
    }
  };
  const releasePointer = (event: PointerEvent) => onUp?.("pointer", event.pointerId);
  el.onpointerup = el.onpointercancel = el.onpointerleave = releasePointer;
  el.addEventListener("touchstart", (event) => {
    event.preventDefault();
    if (!sawPointerDown) {
      touchFallbackFired = true;
      for (const touch of event.changedTouches) onDown("touch", touch.identifier);
    }
  }, { passive: false });
  const releaseTouch = (event: TouchEvent) => {
    for (const touch of event.changedTouches) onUp?.("touch", touch.identifier);
    sawPointerDown = false;
    touchFallbackFired = false;
  };
  el.addEventListener("touchend", releaseTouch, { passive: false });
  el.addEventListener("touchcancel", releaseTouch, { passive: false });
};

export const mountDPad = (container: HTMLElement, scene: OverworldScene, onFirstPress: () => void) => {
  const root = document.createElement("div");
  const held = new Map<string, Direction>();
  let pressed = false;
  root.style.cssText = "position:fixed;inset:0;z-index:20;pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none";
  const base = "position:fixed;width:50px;height:50px;background:rgba(5,6,6,.55);color:#fef1e0;border:1.5px solid rgba(23,217,255,.85);border-radius:0;font:bold 20px monospace;backdrop-filter:blur(2px);pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;z-index:20";
  const layout = computeDpadLayout({ left: 0, right: 0, bottom: 0 }, { width: window.innerWidth, height: window.innerHeight });
  const first = () => { if (!pressed) { pressed = true; onFirstPress(); } };
  const release = (source: "pointer" | "touch", id: number) => {
    const key = `${source}:${id}`; const active = held.get(key); held.delete(key);
    if (active && ![...held.values()].includes(active)) scene.setDirectionHeld(active, false);
  };
  for (const direction of ["up", "down", "left", "right"] as Direction[]) {
    const button = document.createElement("button");
    button.textContent = { up: "▲", down: "▼", left: "◀", right: "▶" }[direction];
    button.setAttribute("aria-label", `Move ${direction}`);
    const rect = layout[direction];
    const bottom = window.innerHeight - rect.y - rect.h;
    button.style.cssText = `${base};left:calc(env(safe-area-inset-left,0px) + ${rect.x}px);bottom:calc(env(safe-area-inset-bottom,0px) + ${bottom}px)`;
    wireButton(button, (source, id) => {
      first(); held.set(`${source}:${id}`, direction); scene.setDirectionHeld(direction, true);
    }, release, true);
    root.appendChild(button);
  }
  const action = document.createElement("button");
  action.textContent = "A"; action.setAttribute("aria-label", "Interact");
  const actionRight = window.innerWidth - layout.action.x - layout.action.w;
  const actionBottom = window.innerHeight - layout.action.y - layout.action.h;
  action.style.cssText = `${base};right:calc(env(safe-area-inset-right,0px) + ${actionRight}px);bottom:calc(env(safe-area-inset-bottom,0px) + ${actionBottom}px);border-color:#f0bf14`;
  wireButton(action, () => { first(); scene.pressInteract(); });
  root.addEventListener("touchstart", prevent, { passive: false });
  root.addEventListener("touchmove", prevent, { passive: false });
  root.addEventListener("contextmenu", prevent);
  root.appendChild(action); container.appendChild(root);
  return {
    destroy: () => { held.forEach((direction) => scene.setDirectionHeld(direction, false)); root.remove(); },
    setHidden: (hidden: boolean) => {
      if (hidden) held.forEach((direction) => scene.setDirectionHeld(direction, false));
      root.style.opacity = hidden ? "0" : "1";
      root.style.pointerEvents = "none";
      root.style.display = hidden ? "none" : "block";
    },
  };
};
