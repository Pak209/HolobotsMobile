import { onBridgeActivity, type BridgeActivity } from "../bridge/storyBridge";
import type { HandshakeState } from "../bridge/handshake";

export type DebugHud = {
  setHandshake(state: HandshakeState): void;
  notePressInteract(): void;
  destroy(): void;
};

export const mountDebugHud = (container: HTMLElement): DebugHud | undefined => {
  if (new URLSearchParams(window.location.search).get("debug") !== "1") return undefined;
  const element = document.createElement("div");
  element.id = "holocity-debug-hud";
  element.style.cssText = "position:fixed;left:50%;top:max(calc(env(safe-area-inset-top,0px) + 44px),56px);transform:translateX(-50%);z-index:31;pointer-events:none;white-space:pre;padding:6px 8px;background:rgba(5,6,6,.7);color:#17d9ff;border:1px solid rgba(23,217,255,.7);font:10px monospace;text-align:left;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:none";
  container.appendChild(element);
  let handshake: HandshakeState = "connecting";
  let touch = "none";
  let press = "never";
  let bridge = "none";
  const render = () => { element.textContent = `handshake: ${handshake}\ntouch: ${touch}\npressInteract: ${press}\nbridge: ${bridge}`; };
  const onTouch = (event: TouchEvent) => {
    const point = event.changedTouches[0];
    const target = event.target instanceof Element
      ? `${event.target.tagName.toLowerCase()}${event.target.id ? `#${event.target.id}` : ""}${event.target.className ? `.${String(event.target.className).trim().replace(/\s+/g, ".")}` : ""}`
      : "unknown";
    touch = point ? `${target} @ ${Math.round(point.clientX)},${Math.round(point.clientY)}` : target;
    render();
  };
  document.addEventListener("touchstart", onTouch, { capture: true, passive: true });
  const stopBridge = onBridgeActivity((activity: BridgeActivity) => {
    bridge = activity.phase === "send"
      ? `send ${activity.type} @ ${formatTime(activity.timestamp)}`
      : `ack ${activity.type} ${activity.ok ? "ok" : activity.error ?? "error"} @ ${formatTime(activity.timestamp)}`;
    render();
  });
  render();
  return {
    setHandshake: (state) => { handshake = state; render(); },
    notePressInteract: () => { press = formatTime(Date.now()); render(); },
    destroy: () => {
      document.removeEventListener("touchstart", onTouch, true);
      stopBridge(); element.remove();
    },
  };
};

const formatTime = (timestamp: number) => new Date(timestamp).toISOString().slice(11, 23);
