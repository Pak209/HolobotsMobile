import { Graphics } from "pixi.js";

import { DIRECTION_VECTORS, TILE_SIZE, type Direction } from "./TileTypes";
import type { TileMap } from "./TileMap";

export interface PlayerSpawn {
  x: number;
  y: number;
}

export class Player {
  readonly sprite: Graphics;
  readonly movementSpeed: number;

  gridX: number;
  gridY: number;
  pixelX: number;
  pixelY: number;
  targetPixelX: number;
  targetPixelY: number;
  direction: Direction;

  constructor(spawn: PlayerSpawn, movementSpeed = 180) {
    this.gridX = spawn.x;
    this.gridY = spawn.y;
    this.pixelX = spawn.x * TILE_SIZE;
    this.pixelY = spawn.y * TILE_SIZE;
    this.targetPixelX = this.pixelX;
    this.targetPixelY = this.pixelY;
    this.direction = "down";
    this.movementSpeed = movementSpeed;

    this.sprite = new Graphics();
    this.draw();
    this.syncSprite();
  }

  get isMoving(): boolean {
    return this.pixelX !== this.targetPixelX || this.pixelY !== this.targetPixelY;
  }

  update(deltaSeconds: number): void {
    this.pixelX = moveToward(this.pixelX, this.targetPixelX, this.movementSpeed * deltaSeconds);
    this.pixelY = moveToward(this.pixelY, this.targetPixelY, this.movementSpeed * deltaSeconds);
    this.syncSprite();
  }

  tryMove(direction: Direction, tileMap: TileMap): boolean {
    this.direction = direction;

    if (this.isMoving) {
      return false;
    }

    const next = DIRECTION_VECTORS[direction];
    const nextX = this.gridX + next.x;
    const nextY = this.gridY + next.y;

    if (!tileMap.isWalkable(nextX, nextY)) {
      return false;
    }

    this.gridX = nextX;
    this.gridY = nextY;
    this.targetPixelX = nextX * TILE_SIZE;
    this.targetPixelY = nextY * TILE_SIZE;

    return true;
  }

  getFacingTile(): { x: number; y: number } {
    const vector = DIRECTION_VECTORS[this.direction];
    return {
      x: this.gridX + vector.x,
      y: this.gridY + vector.y,
    };
  }

  destroy(): void {
    this.sprite.destroy();
  }

  private draw(): void {
    this.sprite.clear();
    this.sprite.rect(4, 4, TILE_SIZE - 8, TILE_SIZE - 8).fill(0xffd54a);
  }

  private syncSprite(): void {
    this.sprite.position.set(this.pixelX, this.pixelY);
  }
}

const moveToward = (current: number, target: number, step: number): number => {
  if (current === target) {
    return current;
  }

  if (Math.abs(target - current) <= step) {
    return target;
  }

  return current + Math.sign(target - current) * step;
};
