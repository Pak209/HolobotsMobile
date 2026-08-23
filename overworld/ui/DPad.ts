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
  root.style.cssText = "position:fixed;inset:0;z-index:20;pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none";
  const base = "position:fixed;width:50px;height:50px;background:rgba(5,6,6,.55);color:#fef1e0;border:1.5px solid rgba(23,217,255,.85);border-radius:0;font:bold 20px monospace;backdrop-filter:blur(2px);pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;z-index:20";
  const positions: Record<Direction, string> = {
    up: "left:calc(env(safe-area-inset-left,0px) + 62px);bottom:calc(env(safe-area-inset-bottom,0px) + 112px)",
    down: "left:calc(env(safe-area-inset-left,0px) + 62px);bottom:calc(env(safe-area-inset-bottom,0px) + 8px)",
    left: "left:calc(env(safe-area-inset-left,0px) + 10px);bottom:calc(env(safe-area-inset-bottom,0px) + 60px)",
    right: "left:calc(env(safe-area-inset-left,0px) + 114px);bottom:calc(env(safe-area-inset-bottom,0px) + 60px)",
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
  action.style.cssText = `${base};right:calc(env(safe-area-inset-right,0px) + 18px);bottom:calc(env(safe-area-inset-bottom,0px) + 28px);border-color:#f0bf14`;
  action.onpointerdown = (event) => { event.preventDefault(); first(); scene.pressInteract(); };
  bindTouchStart(action);
  bindTouchStart(root);
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
