import type { OverworldScene } from "../OverworldScene";
import type { Direction } from "../TileTypes";

const prevent = (event: Event) => {
  event.preventDefault();
};

const bindTouchStart = (el: HTMLElement) => {
  el.addEventListener("touchstart", prevent, { passive: false });
};

export const mountDPad = (container: HTMLElement, scene: OverworldScene, onFirstPress: () => void) => {
  const root = document.createElement("div");
  const held = new Map<number, Direction>();
  let pressed = false;
  const base = "position:fixed;width:60px;height:60px;background:#050606;color:#f0bf14;border:2px solid #f0bf14;border-radius:0;font:bold 24px monospace;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;z-index:20";
  const positions: Record<Direction, string> = {
    up: "left:68px;bottom:132px", down: "left:68px;bottom:8px",
    left: "left:6px;bottom:70px", right: "left:130px;bottom:70px",
  };
  const first = () => { if (!pressed) { pressed = true; onFirstPress(); } };
  for (const direction of ["up", "down", "left", "right"] as Direction[]) {
    const button = document.createElement("button");
    button.textContent = { up: "▲", down: "▼", left: "◀", right: "▶" }[direction];
    button.setAttribute("aria-label", `Move ${direction}`);
    button.style.cssText = `${base};${positions[direction]}`;
    button.onpointerdown = (event) => {
      event.preventDefault(); first(); button.setPointerCapture(event.pointerId);
      held.set(event.pointerId, direction); scene.setDirectionHeld(direction, true);
    };
    const release = (event: PointerEvent) => {
      const active = held.get(event.pointerId); held.delete(event.pointerId);
      if (active && ![...held.values()].includes(active)) scene.setDirectionHeld(active, false);
    };
    button.onpointerup = button.onpointercancel = button.onpointerleave = release;
    bindTouchStart(button);
    root.appendChild(button);
  }
  const action = document.createElement("button");
  action.textContent = "A"; action.setAttribute("aria-label", "Interact");
  action.style.cssText = `${base};right:18px;bottom:28px;width:64px;height:64px`;
  action.onpointerdown = (event) => { event.preventDefault(); first(); scene.pressInteract(); };
  bindTouchStart(action);
  bindTouchStart(root);
  root.addEventListener("touchmove", prevent, { passive: false });
  root.addEventListener("contextmenu", prevent);
  root.appendChild(action); container.appendChild(root);
  return () => { held.forEach((direction) => scene.setDirectionHeld(direction, false)); root.remove(); };
};
