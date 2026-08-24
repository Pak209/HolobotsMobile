import { Container, Sprite } from "pixi.js";

import type { Player } from "../Player";
import type { TileMap } from "../TileMap";
import { TILE_SIZE } from "../TileTypes";
import { computeCompanionSpawn, sampleDelayed, type FollowPoint } from "./followPath";
import { createAceTextures, createShadowTexture } from "./tempSheets";

export class Companion {
  readonly sprite = new Container();
  private readonly shadow = new Sprite(createShadowTexture());
  private readonly glow: Sprite;
  private readonly body: Sprite;
  private readonly history: FollowPoint[] = [];
  private elapsed = 0;
  private lastPlayerX = 0;
  private lastPlayerY = 0;

  constructor(player: Player, tileMap: TileMap) {
    const textures = createAceTextures();
    this.glow = new Sprite(textures.glow); this.body = new Sprite(textures.body);
    this.glow.blendMode = "add";
    this.shadow.anchor.set(0.5, 1); this.glow.anchor.set(0.5); this.body.anchor.set(0.5, 1);
    this.shadow.position.set(16, 30); this.glow.position.set(16, 12); this.body.position.set(16, 26);
    this.sprite.addChild(this.shadow, this.glow, this.body);
    this.body.scale.set(1.25);
    this.snapBehind(player, tileMap);
  }

  update(player: Player, tileMap: TileMap, deltaSeconds: number, nowMs: number): void {
    this.elapsed += deltaSeconds;
    const teleported = Math.hypot(player.pixelX - this.lastPlayerX, player.pixelY - this.lastPlayerY) > TILE_SIZE * 1.5;
    this.lastPlayerX = player.pixelX; this.lastPlayerY = player.pixelY;
    if (teleported || Math.hypot(this.sprite.x - player.pixelX, this.sprite.y - player.pixelY) > TILE_SIZE * 2.5) this.snapBehind(player, tileMap, nowMs);
    this.history.push({ x: player.pixelX, y: player.pixelY, time: nowMs });
    while (this.history.length > 2 && this.history[1].time < nowMs - 1200) this.history.shift();
    const target = sampleDelayed(this.history, nowMs, 400);
    if (target) {
      const amount = 1 - Math.exp(-10 * deltaSeconds);
      const dx = target.x - this.sprite.x;
      this.sprite.x += dx * amount; this.sprite.y += (target.y - this.sprite.y) * amount;
      if (Math.abs(dx) > 0.1) this.body.scale.x = dx < 0 ? -1 : 1;
    }
    const bob = Math.sin(this.elapsed * Math.PI * 1.25) * 3;
    this.body.y = 26 + bob; this.glow.y = 12 + bob;
    this.shadow.scale.set(1 - Math.abs(bob) * 0.025, 1); this.glow.alpha = 0.5 + Math.sin(this.elapsed * 2.4) * 0.12;
    this.sprite.zIndex = this.sprite.y + TILE_SIZE;
  }

  snapBehind(player: Player, tileMap: TileMap, nowMs = performance.now()): void {
    const spawn = computeCompanionSpawn(player, (x, y) => tileMap.isWalkable(x, y));
    const x = spawn.x * TILE_SIZE; const y = spawn.y * TILE_SIZE;
    this.sprite.position.set(x, y); this.history.length = 0;
    this.history.push({ x, y, time: nowMs - 400 }, { x: player.pixelX, y: player.pixelY, time: nowMs });
    this.lastPlayerX = player.pixelX; this.lastPlayerY = player.pixelY;
    this.sprite.zIndex = y + TILE_SIZE;
  }
}
