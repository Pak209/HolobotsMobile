import { useEffect, useRef } from "react";

import type { BuildingCallbacks } from "./Interactions";
import { OverworldScene } from "./OverworldScene";

export interface OverworldMapProps {
  width?: number;
  height?: number;
  className?: string;
  callbacks?: Partial<BuildingCallbacks>;
}

export const OverworldMap = ({
  width,
  height,
  className,
  callbacks,
}: OverworldMapProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<OverworldScene | null>(null);

  useEffect(() => {
    const root = rootRef.current;

    if (!root) {
      return;
    }

    let active = true;

    void (async () => {
      const scene = await OverworldScene.create({
        mountNode: root,
        width,
        height,
        callbacks,
      });

      sceneRef.current = scene;

      if (!active) {
        scene.destroy();
        sceneRef.current = null;
      }
    })();

    return () => {
      active = false;
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
  }, [height, width]);

  useEffect(() => {
    sceneRef.current?.setCallbacks(callbacks);
  }, [callbacks]);

  return (
    <div
      className={className}
      ref={rootRef}
      style={{
        height: height ? `${height}px` : "100%",
        overflow: "hidden",
        position: "relative",
        width: width ? `${width}px` : "100%",
      }}
    />
  );
};
