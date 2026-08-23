/** TEMPORARY programmatic sheets — replace with authored PNG atlas assets. */
import { Rectangle, Texture } from "pixi.js";

import type { Direction } from "../TileTypes";

export const TEMP_SHEET_NAMES = ["temp-pilot", "temp-pilot-npc", "temp-ace"] as const;

export type PilotPalette = { ink: string; dark: string; mid: string; visor: string; trim: string; skin: string };
export type CharacterSheet = {
  frames: Record<Direction, { idle: Texture; walk: Texture[] }>;
  cellW: number;
  cellH: number;
};

export const PILOT_PALETTE: PilotPalette = {
  ink: "#050606", dark: "#2a2d33", mid: "#3a3e47", visor: "#17d9ff", trim: "#f0bf14", skin: "#d9a071",
};
export const NPC_PALETTE: PilotPalette = {
  ink: "#050606", dark: "#34372d", mid: "#596044", visor: "#f0bf14", trim: "#17d9ff", skin: "#bd875f",
};

const canvasTexture = (canvas: HTMLCanvasElement) => {
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
};

const drawPilot = (ctx: CanvasRenderingContext2D, ox: number, oy: number, row: number, frame: number, p: PilotPalette) => {
  const step = frame === 1 ? -1 : frame === 2 ? 1 : 0;
  const side = row >= 2;
  ctx.fillStyle = p.ink; ctx.fillRect(ox + 8, oy + 8, 16, 13); ctx.fillRect(ox + 7, oy + 20, 18, 19);
  ctx.fillStyle = p.dark; ctx.fillRect(ox + 9, oy + 9, 14, 11); ctx.fillRect(ox + 9, oy + 21, 14, 16);
  ctx.fillStyle = p.mid; ctx.fillRect(ox + 11, oy + 23, 10, 9);
  ctx.fillStyle = p.visor;
  if (row === 1) ctx.fillRect(ox + 11, oy + 11, 10, 2);
  else if (side) ctx.fillRect(ox + (row === 2 ? 9 : 17), oy + 12, 7, 3);
  else ctx.fillRect(ox + 10, oy + 12, 12, 3);
  ctx.fillStyle = p.trim; ctx.fillRect(ox + 9, oy + 20, 14, 2); ctx.fillRect(ox + 15, oy + 23, 2, 9);
  ctx.fillStyle = p.skin; ctx.fillRect(ox + 6, oy + 24 + step, 3, 6); ctx.fillRect(ox + 23, oy + 24 - step, 3, 6);
  ctx.fillStyle = p.ink; ctx.fillRect(ox + 9, oy + 37, 6, 7 + step); ctx.fillRect(ox + 17, oy + 37, 6, 7 - step);
  ctx.fillStyle = p.dark; ctx.fillRect(ox + 10, oy + 37, 4, 5 + step); ctx.fillRect(ox + 18, oy + 37, 4, 5 - step);
};

export const createPilotSheet = (palette: PilotPalette): CharacterSheet => {
  const cellW = 32; const cellH = 48;
  const canvas = document.createElement("canvas"); canvas.width = cellW * 3; canvas.height = cellH * 4;
  const ctx = canvas.getContext("2d")!;
  for (let row = 0; row < 4; row += 1) for (let frame = 0; frame < 3; frame += 1) drawPilot(ctx, frame * cellW, row * cellH, row, frame, palette);
  const source = canvasTexture(canvas).source;
  const directions: Direction[] = ["down", "up", "left", "right"];
  const frames = {} as CharacterSheet["frames"];
  directions.forEach((direction, row) => {
    const at = (column: number) => new Texture({ source, frame: new Rectangle(column * cellW, row * cellH, cellW, cellH) });
    frames[direction] = { idle: at(0), walk: [at(1), at(2)] };
  });
  return { frames, cellW, cellH };
};

const pixelTexture = (width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  draw(canvas.getContext("2d")!); return canvasTexture(canvas);
};

export const createShadowTexture = () => pixelTexture(16, 6, (ctx) => {
  ctx.fillStyle = "rgba(5,6,6,.35)"; ctx.fillRect(3, 0, 10, 6); ctx.fillRect(1, 2, 14, 2);
});

export const createAceTextures = () => ({
  body: pixelTexture(24, 24, (ctx) => {
    ctx.fillStyle = "#050606"; ctx.fillRect(4, 5, 16, 16);
    ctx.fillStyle = "#ff2fbf"; ctx.fillRect(6, 8, 12, 11); ctx.fillRect(3, 11, 4, 7); ctx.fillRect(17, 11, 4, 7);
    ctx.fillStyle = "#fef1e0"; ctx.fillRect(9, 2, 6, 7); ctx.fillRect(7, 6, 10, 4);
    ctx.fillStyle = "#17d9ff"; ctx.fillRect(8, 10, 8, 3); ctx.fillStyle = "#f0bf14"; ctx.fillRect(10, 17, 4, 2);
  }),
  glow: pixelTexture(32, 32, (ctx) => {
    ctx.fillStyle = "rgba(23,217,255,.12)"; ctx.fillRect(4, 4, 24, 24);
    ctx.fillStyle = "rgba(23,217,255,.2)"; ctx.fillRect(8, 8, 16, 16);
    ctx.fillStyle = "rgba(23,217,255,.28)"; ctx.fillRect(12, 12, 8, 8);
  }),
});
