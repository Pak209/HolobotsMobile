import { Container, Sprite } from "pixi.js";

import { createPilotSheet, createShadowTexture, PILOT_PALETTE } from "./characters/tempSheets";
import { DIRECTION_VECTORS, TILE_SIZE, type Direction } from "./TileTypes";
import type { TileMap } from "./TileMap";
import { resolveMoveIntent } from "./characters/movement";

export interface PlayerSpawn { x: number; y: number }

export class Player {
  readonly sprite = new Container();
  readonly movementSpeed: number;
  gridX: number; gridY: number; pixelX: number; pixelY: number;
  targetPixelX: number; targetPixelY: number; direction: Direction;
  private readonly body: Sprite;
  private readonly sheet = createPilotSheet(PILOT_PALETTE);
  private animationTime = 0;
  private turnStartedAt: number | null = null;

  constructor(spawn: PlayerSpawn, movementSpeed = 180) {
    this.gridX = spawn.x; this.gridY = spawn.y;
    this.pixelX = this.targetPixelX = spawn.x * TILE_SIZE;
    this.pixelY = this.targetPixelY = spawn.y * TILE_SIZE;
    this.direction = "down"; this.movementSpeed = movementSpeed;
    const shadow = new Sprite(createShadowTexture()); shadow.anchor.set(0.5, 1); shadow.position.set(16, 31);
    this.body = new Sprite(this.sheet.frames.down.idle); this.body.anchor.set(0.5, 1); this.body.position.set(16, 32);
    this.sprite.addChild(shadow, this.body); this.syncSprite();
  }

  get isMoving() { return this.pixelX !== this.targetPixelX || this.pixelY !== this.targetPixelY; }

  update(deltaSeconds: number): void {
    this.pixelX = moveToward(this.pixelX, this.targetPixelX, this.movementSpeed * deltaSeconds);
    this.pixelY = moveToward(this.pixelY, this.targetPixelY, this.movementSpeed * deltaSeconds);
    this.animationTime = this.isMoving ? this.animationTime + deltaSeconds : 0;
    const frames = this.sheet.frames[this.direction];
    this.body.texture = this.isMoving ? frames.walk[Math.floor(this.animationTime * 8) % frames.walk.length] : frames.idle;
    this.syncSprite();
  }

  tryMove(direction: Direction, tileMap: TileMap, nowMs = performance.now()): boolean {
    if (this.isMoving) return false;
    const intent = resolveMoveIntent({ facing: this.direction, turnStartedAt: this.turnStartedAt }, direction, nowMs);
    if (intent.kind === "turn") {
      this.face(direction); this.turnStartedAt = nowMs; return false;
    }
    if (intent.kind === "wait") return false;
    this.turnStartedAt = null;
    const next = DIRECTION_VECTORS[direction]; const nextX = this.gridX + next.x; const nextY = this.gridY + next.y;
    if (!tileMap.isWalkable(nextX, nextY)) return false;
    this.gridX = nextX; this.gridY = nextY;
    this.targetPixelX = nextX * TILE_SIZE; this.targetPixelY = nextY * TILE_SIZE;
    return true;
  }

  getFacingTile() {
    const vector = DIRECTION_VECTORS[this.direction];
    return { x: this.gridX + vector.x, y: this.gridY + vector.y };
  }

  face(direction: Direction): void {
    this.direction = direction;
    this.turnStartedAt = null;
    if (!this.isMoving) this.body.texture = this.sheet.frames[direction].idle;
  }

  moveTo(x: number, y: number, direction: Direction): void {
    this.gridX = x; this.gridY = y; this.direction = direction;
    this.pixelX = this.targetPixelX = x * TILE_SIZE; this.pixelY = this.targetPixelY = y * TILE_SIZE;
    this.animationTime = 0; this.turnStartedAt = null; this.body.texture = this.sheet.frames[direction].idle; this.syncSprite();
  }

  destroy(): void { this.sprite.destroy(); }
  private syncSprite() { this.sprite.position.set(this.pixelX, this.pixelY); }
}

const moveToward = (current: number, target: number, step: number) =>
  Math.abs(target - current) <= step ? target : current + Math.sign(target - current) * step;
