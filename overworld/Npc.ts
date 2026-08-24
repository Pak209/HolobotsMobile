import { Container, Sprite } from "pixi.js";

import type { Player } from "./Player";
import type { TileMap } from "./TileMap";
import { TILE_SIZE, type Direction } from "./TileTypes";
import { createPilotSheet, createShadowTexture, type CharacterSheet, type PilotPalette } from "./characters/tempSheets";
import { isWithinRadius, shouldWander } from "./characters/interaction";
import { terrain } from "./maps/h3Plaza";

const PLAZA = new Set(terrain.map(({ x, y }) => `${x},${y}`));
const MOVES: Array<{ x: number; y: number; direction: Direction }> = [
  { x: 0, y: -1, direction: "up" }, { x: 0, y: 1, direction: "down" },
  { x: -1, y: 0, direction: "left" }, { x: 1, y: 0, direction: "right" },
];

export class Npc {
  readonly sprite = new Container();
  readonly id: string;
  readonly interactive: boolean;
  readonly home: { x: number; y: number };
  gridX: number; gridY: number;
  prevGridX: number; prevGridY: number;
  private pixelX: number; private pixelY: number;
  private targetX: number; private targetY: number;
  private direction: Direction = "down";
  private readonly body: Sprite;
  private readonly sheet: CharacterSheet;
  private elapsed = 0;
  private nextWanderAt = 2.5;
  private resumeAt = 0;
  private playerWasNear = false;

  constructor(tileMap: TileMap, options: { id: string; home: { x: number; y: number }; palette: PilotPalette; interactive: boolean }) {
    this.id = options.id; this.home = options.home; this.interactive = options.interactive;
    this.gridX = options.home.x; this.gridY = options.home.y;
    this.prevGridX = this.gridX; this.prevGridY = this.gridY;
    this.pixelX = this.targetX = this.gridX * TILE_SIZE;
    this.pixelY = this.targetY = this.gridY * TILE_SIZE;
    this.sheet = createPilotSheet(options.palette);
    const shadow = new Sprite(createShadowTexture()); shadow.anchor.set(0.5, 1); shadow.position.set(16, 31);
    this.body = new Sprite(this.sheet.frames.down.idle); this.body.anchor.set(0.5, 1); this.body.position.set(16, 32);
    this.sprite.addChild(shadow, this.body); this.sprite.position.set(this.pixelX, this.pixelY);
    tileMap.setOccupant(this.id, this.gridX, this.gridY);
  }

  get isMoving() { return this.pixelX !== this.targetX || this.pixelY !== this.targetY; }

  update(deltaSeconds: number, tileMap: TileMap, player: Player, dialogueOpen: boolean): void {
    this.elapsed += deltaSeconds;
    const playerNear = this.interactive && isWithinRadius(this, player, 2);
    if (this.interactive && this.playerWasNear && !playerNear) this.resumeAt = this.elapsed + 2;
    this.playerWasNear = playerNear;
    if (playerNear && !this.isMoving) this.facePlayer(player);
    if (shouldWander({
      playerNear, dialogueOpen, isMoving: this.isMoving, elapsed: this.elapsed,
      nextWanderAt: this.nextWanderAt, resumeAt: this.resumeAt,
    })) this.chooseStep(tileMap, player);
    const wasMoving = this.isMoving;
    if (this.isMoving) {
      this.pixelX = moveToward(this.pixelX, this.targetX, 90 * deltaSeconds);
      this.pixelY = moveToward(this.pixelY, this.targetY, 90 * deltaSeconds);
      this.body.y = 32;
      this.body.texture = this.sheet.frames[this.direction].walk[Math.floor(this.elapsed * 8) % 2];
    } else {
      this.body.texture = this.sheet.frames[this.direction].idle;
      this.body.y = 32 + (Math.floor(this.elapsed * 2) % 2);
    }
    if (wasMoving && !this.isMoving) {
      tileMap.clearOccupant(this.id);
      tileMap.clearOccupant(`${this.id}:target`);
      tileMap.setOccupant(this.id, this.gridX, this.gridY);
    }
    this.sprite.position.set(this.pixelX, this.pixelY);
    this.sprite.zIndex = this.pixelY + TILE_SIZE;
  }

  facePlayer(player: Player): void {
    const dx = player.gridX - this.gridX; const dy = player.gridY - this.gridY;
    this.direction = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
    if (!this.isMoving) this.body.texture = this.sheet.frames[this.direction].idle;
  }

  setMet(_met: boolean) { /* state remains visible through the interaction hint */ }

  private chooseStep(tileMap: TileMap, player: Player): void {
    const options = MOVES.filter(({ x, y }) => {
      const nextX = this.gridX + x; const nextY = this.gridY + y;
      return Math.max(Math.abs(nextX - this.home.x), Math.abs(nextY - this.home.y)) <= 2
        && PLAZA.has(`${nextX},${nextY}`) && tileMap.isWalkable(nextX, nextY)
        && !(nextX === player.gridX && nextY === player.gridY);
    });
    this.nextWanderAt = this.elapsed + 2.5 + Math.random() * 2.5;
    const chosen = options[Math.floor(Math.random() * options.length)];
    if (!chosen) return;
    this.direction = chosen.direction;
    this.prevGridX = this.gridX; this.prevGridY = this.gridY;
    this.gridX += chosen.x; this.gridY += chosen.y;
    this.targetX = this.gridX * TILE_SIZE; this.targetY = this.gridY * TILE_SIZE;
    tileMap.setOccupant(`${this.id}:target`, this.gridX, this.gridY);
  }
}

const moveToward = (current: number, target: number, step: number) =>
  Math.abs(target - current) <= step ? target : current + Math.sign(target - current) * step;
