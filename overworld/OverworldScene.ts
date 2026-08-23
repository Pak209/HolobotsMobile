import { Application, Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";

import {
  createDefaultBuildingCallbacks,
  triggerBuildingEvent,
  type BuildingCallbacks,
} from "./Interactions";
import { Player } from "./Player";
import { Npc } from "./Npc";
import { TileMap, getEntrancePosition } from "./TileMap";
import { TILE_SIZE, type Direction } from "./TileTypes";
import { loadTextureRegistry, type TextureRegistry } from "./assets/textureRegistry";
import {
  STORY_SUPPORTED_PROTOCOL_VERSIONS,
  hello,
  isDialogueStatePayload,
  isNativeBridgeAvailable,
  isProtocolMismatchError,
  isStoryStatePayload,
  onMessage,
  send,
} from "./bridge/storyBridge";
import { createHandshakeController, type HandshakeState } from "./bridge/handshake";
import { buildMapDescriptor } from "./bridge/mapDescriptor";
import { createTrailingThrottle } from "./bridge/throttle";
import { Companion } from "./characters/Companion";
import { AMBIENT_PALETTES, NPC_PALETTE } from "./characters/tempSheets";
import { canals, details, h3, props, terrain, wispSpawns } from "./maps/h3Plaza";
import { AMBIENT_NPCS, GUIDE } from "./maps/npcs";
import { TOWN_CANALS, TOWN_DETAILS, TOWN_PROPS, getBaseTile } from "./maps/townMap";
import { mountDPad } from "./ui/DPad";

type ResizeTarget = Pick<HTMLElement, "clientWidth" | "clientHeight">;

const MOVE_KEYS: Record<string, Direction> = {
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  w: "up",
  a: "left",
  s: "down",
  d: "right",
};
const PLAZA_CELLS = new Set(terrain.map(({ x, y }) => `${x},${y}`));
type PlayerPosition = { x: number; y: number; facing: Direction; zone: string };

export interface OverworldSceneOptions {
  mountNode: HTMLElement;
  width?: number;
  height?: number;
  callbacks?: Partial<BuildingCallbacks>;
  buildHash?: string;
}

export class OverworldScene {
  readonly app: Application;
  readonly tileMap: TileMap;
  readonly player: Player;
  readonly npc: Npc;
  readonly ambientNpcs: Npc[];
  readonly companion: Companion;

  private readonly mountNode: HTMLElement;
  private readonly world: Container;
  private readonly ground = new Container();
  private readonly groundDetail = new Container();
  private readonly canals = new Container();
  private readonly lowDecor = new Container();
  private readonly actors = new Container();
  private readonly foregroundOcclusion = new Container();
  private readonly lightingParticles = new Container();
  private readonly uiOverlay = new Container();
  private readonly textures: TextureRegistry;
  private readonly interactionLabel: Text;
  private readonly handshakeBanner: HTMLDivElement;
  private readonly keyState = new Set<string>();
  private readonly heldDirections = new Set<Direction>();
  private callbacks: BuildingCallbacks;
  private bridgeCleanup?: () => void;
  private dpad?: ReturnType<typeof mountDPad>;
  private checkpointTimer?: number;
  private dialogueTimer?: number;
  private checkpointApplied = false;
  private interactionStatus: string | null = null;
  private flags: Record<string, boolean> = {};
  private handshakeState: HandshakeState = "connecting";
  private storyStateMismatch = false;
  private dialogueOpen = false;
  private readonly handshake: ReturnType<typeof createHandshakeController>;
  private readonly playerPosThrottle: ReturnType<typeof createTrailingThrottle<PlayerPosition>>;
  private lastPlayerPosKey = "";
  private lastPlayerTile: string;
  private worldTime = 0;
  private readonly wisps: Array<{ sprite: Sprite; baseY: number; phase: number }> = [];
  private coreGlow?: { sprite: Sprite; baseScale: number };
  private interactionIndicator?: Sprite;

  private resizeTarget?: ResizeTarget;
  private lastInteractionPressed = false;
  private destroyed = false;

  private constructor(app: Application, options: OverworldSceneOptions, textures: TextureRegistry) {
    this.app = app;
    this.mountNode = options.mountNode;
    this.tileMap = new TileMap();
    const mapDescriptor = buildMapDescriptor(this.tileMap);
    this.player = new Player({ x: 28, y: 20 });
    this.npc = new Npc(this.tileMap, {
      id: GUIDE.npcId, home: { x: GUIDE.x, y: GUIDE.y }, palette: NPC_PALETTE, interactive: true,
    });
    this.ambientNpcs = AMBIENT_NPCS.map((npc) => new Npc(this.tileMap, {
      id: npc.id, home: npc.home, palette: AMBIENT_PALETTES[npc.palette], interactive: false,
    }));
    this.companion = new Companion(this.player, this.tileMap);
    this.textures = textures;
    this.lastPlayerTile = `${this.player.gridX},${this.player.gridY}`;
    this.callbacks = {
      ...createDefaultBuildingCallbacks(),
      ...options.callbacks,
    };
    this.handshakeBanner = document.createElement("div");
    this.handshakeBanner.style.cssText = "position:fixed;left:50%;top:max(calc(env(safe-area-inset-top,0px) + 16px),56px);transform:translateX(-50%);max-width:88vw;padding:10px 14px;background:#050606;color:#f0bf14;border:2px solid #f0bf14;border-radius:0;font:bold 13px monospace;letter-spacing:1.5px;text-align:center;z-index:30;pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:none";
    this.handshakeBanner.hidden = true;
    this.mountNode.appendChild(this.handshakeBanner);
    this.handshake = createHandshakeController({
      sendHello: () => hello(options.buildHash ?? "dev", mapDescriptor),
      isMismatchError: isProtocolMismatchError,
      onStateChange: this.renderHandshakeBanner,
    });
    this.playerPosThrottle = createTrailingThrottle((position: PlayerPosition) => {
      void send("PLAYER_POS", position).catch(console.warn);
    }, 150);

    this.world = new Container();
    this.actors.sortableChildren = true;
    this.interactionLabel = new Text({
      style: new TextStyle({
        fill: 0xffffff,
        fontFamily: "monospace",
        fontSize: 14,
        stroke: { color: 0x000000, width: 3 },
      }),
    });

    this.world.addChild(
      this.ground, this.groundDetail, this.canals, this.lowDecor, this.actors,
      this.foregroundOcclusion, this.lightingParticles,
    );
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.uiOverlay);

    this.buildMapGraphics();

    this.actors.addChild(this.player.sprite);
    this.actors.addChild(this.companion.sprite);
    this.actors.addChild(this.npc.sprite);
    for (const npc of this.ambientNpcs) this.actors.addChild(npc.sprite);
    this.interactionIndicator = new Sprite(this.textures.prop("data-wisp"));
    this.interactionIndicator.anchor.set(0.5);
    this.interactionIndicator.scale.set(this.textures.PROP_SCALE * 0.45);
    this.interactionIndicator.visible = false;
    this.actors.addChild(this.interactionIndicator);

    this.interactionLabel.position.set(12, 12);
    this.uiOverlay.addChild(this.interactionLabel);

    this.app.ticker.add(this.update);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.bridgeCleanup = onMessage(this.handleNativeMessage);
    this.dpad = mountDPad(this.mountNode, this, this.markDpadSeen);
    this.handshake.start();

    this.setViewport(options.width, options.height);
    this.update({ deltaMS: 0 });
  }

  static async create(options: OverworldSceneOptions): Promise<OverworldScene> {
    const app = new Application();

    await app.init({
      antialias: false,
      background: 0x1d1d1d,
      height: options.height ?? 480,
      resizeTo: options.width && options.height ? undefined : options.mountNode,
      width: options.width ?? 640,
    });

    options.mountNode.appendChild(app.canvas);

    const textures = await loadTextureRegistry();
    return new OverworldScene(app, options, textures);
  }

  resize(width?: number, height?: number): void {
    this.setViewport(width, height);
  }

  setCallbacks(callbacks?: Partial<BuildingCallbacks>): void {
    this.callbacks = {
      ...createDefaultBuildingCallbacks(),
      ...callbacks,
    };
  }

  setDirectionHeld(direction: Direction, held: boolean): void {
    held ? this.heldDirections.add(direction) : this.heldDirections.delete(direction);
  }

  pressInteract(): void { this.interact(); }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.app.ticker.remove(this.update);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.handshake.dispose();
    this.playerPosThrottle.dispose();
    this.handshakeBanner.remove();
    this.bridgeCleanup?.();
    this.dpad?.destroy();
    if (this.checkpointTimer) window.clearTimeout(this.checkpointTimer);
    if (this.dialogueTimer) window.clearTimeout(this.dialogueTimer);
    this.player.destroy();
    this.app.destroy(true, { children: true, texture: true });
  }

  private setViewport(width?: number, height?: number): void {
    if (width && height) {
      this.app.renderer.resize(width, height);
      this.resizeTarget = { clientWidth: width, clientHeight: height };
      return;
    }

    this.resizeTarget = this.mountNode;
  }

  private buildMapGraphics(): void {
    for (let y = 0; y < this.tileMap.height; y += 1) {
      for (let x = 0; x < this.tileMap.width; x += 1) {
        const tile = this.tileMap.tiles[y][x];
        this.ground.addChild(this.makeTileSprite(getBaseTile(x, y), x, y));

        if (tile.event && tile.type === "path") {
          const entrance = this.drawEntranceMarker();
          entrance.position.set(x * TILE_SIZE, y * TILE_SIZE);
          this.lowDecor.addChild(entrance);
        }
      }
    }

    for (const item of terrain) this.ground.addChild(this.makeTileSprite(item.tile, item.x, item.y));
    for (const item of TOWN_DETAILS) this.groundDetail.addChild(this.makeTileSprite(item.tile, item.x, item.y, item.rotation));
    for (const item of details) this.groundDetail.addChild(this.makeTileSprite(item.tile, item.x, item.y, item.rotation));
    for (const item of TOWN_CANALS) this.canals.addChild(this.makeTileSprite(item.tile, item.x, item.y, item.rotation));
    for (const item of canals) this.canals.addChild(this.makeTileSprite(item.tile, item.x, item.y, item.rotation));

    for (const item of TOWN_PROPS) this.actors.addChild(this.makePropSprite(item.name, item.x, item.y));

    for (const item of props) {
      const sprite = this.makePropSprite(item.name, item.x, item.y, item.offsetX, item.offsetY);
      if (item.layer === "lowDecor") this.lowDecor.addChild(sprite);
      else if (item.layer === "foregroundOcclusion") this.foregroundOcclusion.addChild(sprite);
      else this.actors.addChild(sprite);
    }

    const buildingAssets = {
      arena: "arena-colosseum", gacha: "gacha-shrine", trainingLab: "holobot-workshop",
      pvpTerminal: "transit-gate", h3Core: "h3-core-sanctuary",
    } as const;
    for (const building of this.tileMap.getBuildingPlacements()) {
      const sprite = new Sprite(this.textures.building(buildingAssets[building.event.id]));
      sprite.anchor.set(0.5, 1);
      sprite.scale.set(this.textures.PROP_SCALE);
      sprite.position.set((building.x + building.width / 2) * TILE_SIZE, (building.y + building.height) * TILE_SIZE);
      sprite.zIndex = sprite.y;
      this.actors.addChild(sprite);
    }

    for (const [id, name] of [["arena", "pad-target-round"], ["gacha", "lantern-gold"],
      ["trainingLab", "lantern-cyan-tall"], ["pvpTerminal", "terminal-holo"], ["h3Core", "path-cyan-node-round"]] as const) {
      const building = this.tileMap.getBuildingPlacements().find((item) => item.event.id === id)!;
      const entrance = getEntrancePosition(id);
      const marker = name.startsWith("path-")
        ? this.makeTileSprite(name, entrance.x, entrance.y)
        : this.makePropSprite(name, entrance.x, entrance.y);
      marker.zIndex = (building.y + building.height + 0.1) * TILE_SIZE;
      this.lowDecor.addChild(marker);
    }

    wispSpawns.forEach(([x, y], index) => {
      const sprite = this.makePropSprite("data-wisp", x, y);
      sprite.scale.set(this.textures.PROP_SCALE * 0.65);
      sprite.alpha = 0.6;
      this.lightingParticles.addChild(sprite);
      this.wisps.push({ sprite, baseY: sprite.y, phase: index * 0.9 });
    });
    const glow = this.makePropSprite("data-wisp", h3.originX + 1.5, h3.originY, 0, -30);
    glow.scale.set(this.textures.PROP_SCALE * 0.9);
    this.lightingParticles.addChild(glow);
    this.coreGlow = { sprite: glow, baseScale: glow.scale.x };
  }

  private makeTileSprite(name: string, x: number, y: number, rotation = 0): Sprite {
    const sprite = new Sprite(this.textures.tile(name));
    sprite.anchor.set(0.5);
    sprite.width = TILE_SIZE;
    sprite.height = TILE_SIZE;
    sprite.position.set((x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE);
    sprite.angle = rotation;
    return sprite;
  }

  private makePropSprite(name: string, x: number, y: number, offsetX = 0, offsetY = 0): Sprite {
    const sprite = new Sprite(this.textures.prop(name));
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(this.textures.PROP_SCALE);
    sprite.position.set((x + 0.5) * TILE_SIZE + offsetX, (y + 1) * TILE_SIZE + offsetY);
    sprite.zIndex = sprite.y;
    return sprite;
  }

  private drawEntranceMarker(): Container {
    const marker = new Container();
    const plate = new Graphics();
    const glow = new Graphics();

    glow.roundRect(6, 21, TILE_SIZE - 12, 6, 3).fill(0x30ecff);
    glow.alpha = 0.35;
    plate.roundRect(9, 22, TILE_SIZE - 18, 4, 2).fill(0xb4fbff);
    plate.roundRect(12, 8, TILE_SIZE - 24, 8, 3).fill(0xffd564);
    plate.rect(14, 10, TILE_SIZE - 28, 4).fill(0xfff6ae);

    marker.addChild(glow);
    marker.addChild(plate);

    return marker;
  }

  private update = (ticker: { deltaMS: number }): void => {
    const deltaSeconds = ticker.deltaMS / 1000;

    this.worldTime += deltaSeconds;

    this.handleMovementInput();
    this.handleInteractionInput();
    this.player.update(deltaSeconds);
    this.player.sprite.zIndex = this.player.pixelY + TILE_SIZE;
    this.companion.update(this.player, this.tileMap, deltaSeconds, performance.now());
    this.npc.update(deltaSeconds, this.tileMap, this.player, this.dialogueOpen);
    for (const npc of this.ambientNpcs) npc.update(deltaSeconds, this.tileMap, this.player, this.dialogueOpen);
    const adjacentNpc = Math.abs(this.player.gridX - this.npc.gridX) + Math.abs(this.player.gridY - this.npc.gridY) === 1;
    if (adjacentNpc) this.npc.facePlayer(this.player);
    if (this.interactionIndicator) {
      const facing = this.player.getFacingTile();
      this.interactionIndicator.visible = !this.dialogueOpen && !this.npc.isMoving
        && facing.x === this.npc.gridX && facing.y === this.npc.gridY;
      this.interactionIndicator.position.set(this.npc.sprite.x + TILE_SIZE / 2, this.npc.sprite.y - 12 + Math.sin(this.worldTime * 3) * 2);
      this.interactionIndicator.zIndex = this.npc.sprite.zIndex + 1;
    }
    for (const wisp of this.wisps) {
      wisp.sprite.y = wisp.baseY + Math.sin(this.worldTime * 1.8 + wisp.phase) * 4;
      wisp.sprite.alpha = 0.48 + Math.sin(this.worldTime * 2.1 + wisp.phase) * 0.2;
    }
    if (this.coreGlow) {
      const pulse = 1 + Math.sin(this.worldTime * 2.2) * 0.09;
      this.coreGlow.sprite.scale.set(this.coreGlow.baseScale * pulse);
      this.coreGlow.sprite.alpha = 0.58 + Math.sin(this.worldTime * 2.2) * 0.16;
    }
    this.reportPlayerPosition();
    this.updateInteractionHint();
    this.updateCamera();
  };

  private handleMovementInput(): void {
    if (this.dialogueOpen || this.player.isMoving || this.handshakeState === "mismatch") {
      return;
    }

    const movementPriority: Direction[] = ["up", "down", "left", "right"];

    for (const direction of movementPriority) {
      if (this.isDirectionPressed(direction)) {
        if (this.player.tryMove(direction, this.tileMap)) this.queueCheckpoint();
        return;
      }
    }
  }

  private handleInteractionInput(): void {
    const interactionPressed = this.keyState.has("e");

    if (!interactionPressed || this.lastInteractionPressed) {
      this.lastInteractionPressed = interactionPressed;
      return;
    }

    this.interact();

    this.lastInteractionPressed = interactionPressed;
  }

  private updateInteractionHint(): void {
    if (this.handshakeState === "mismatch") return;
    if (this.dialogueOpen) { this.interactionLabel.text = ""; return; }
    if (this.interactionStatus) { this.interactionLabel.text = this.interactionStatus; return; }
    const facingTile = this.player.getFacingTile();
    const interactionTile = this.tileMap.getInteractionTile(facingTile.x, facingTile.y);
    const facingGuide = !this.npc.isMoving && facingTile.x === this.npc.gridX && facingTile.y === this.npc.gridY;
    this.interactionLabel.text = facingGuide
      ? `Press A: ${this.flags["npc.guide.met"] ? "Guide ✓" : "Guide"}`
      : interactionTile?.event ? `Press A: ${interactionTile.event.label}` : "";
  }

  private updateCamera(): void {
    const viewportWidth = this.resizeTarget?.clientWidth ?? this.app.screen.width;
    const viewportHeight = this.resizeTarget?.clientHeight ?? this.app.screen.height;
    const playerCenterX = this.player.pixelX + TILE_SIZE / 2;
    const playerCenterY = this.player.pixelY + TILE_SIZE / 2;
    const minX = Math.min(0, viewportWidth - this.tileMap.pixelWidth);
    const minY = Math.min(0, viewportHeight - this.tileMap.pixelHeight);
    const desiredX = viewportWidth / 2 - playerCenterX;
    const desiredY = viewportHeight / 2 - playerCenterY;

    this.world.position.set(
      viewportWidth >= this.tileMap.pixelWidth ? (viewportWidth - this.tileMap.pixelWidth) / 2 : clamp(desiredX, minX, 0),
      viewportHeight >= this.tileMap.pixelHeight ? (viewportHeight - this.tileMap.pixelHeight) / 2 : clamp(desiredY, minY, 0),
    );
  }

  private isDirectionPressed(direction: Direction): boolean {
    return this.heldDirections.has(direction) || Object.entries(MOVE_KEYS).some(
      ([key, mappedDirection]) => mappedDirection === direction && this.keyState.has(key),
    );
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();

    if (MOVE_KEYS[key] || key === "e") {
      event.preventDefault();
    }

    this.keyState.add(key);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keyState.delete(event.key.toLowerCase());
  };

  private interact(): void {
    if (this.dialogueOpen || this.handshakeState === "mismatch") return;
    const facing = this.player.getFacingTile();
    if (!this.npc.isMoving && facing.x === this.npc.gridX && facing.y === this.npc.gridY) {
      this.interactionStatus = "Talking…";
      void send("TALK_NPC", { npcId: GUIDE.npcId }).finally(() => { this.interactionStatus = null; });
      return;
    }
    const tile = this.tileMap.getInteractionTile(facing.x, facing.y);
    if (!tile?.event) return;
    if (isNativeBridgeAvailable()) {
      void send("ENTER_BUILDING", { buildingId: tile.event.id }).catch(console.warn);
    } else {
      void send("ENTER_BUILDING", { buildingId: tile.event.id });
      triggerBuildingEvent(tile.event, this.callbacks);
    }
  }

  private queueCheckpoint(): void {
    const tile = `${this.player.gridX},${this.player.gridY}`;
    if (tile === this.lastPlayerTile) return;
    this.lastPlayerTile = tile;
    if (this.checkpointTimer) window.clearTimeout(this.checkpointTimer);
    this.checkpointTimer = window.setTimeout(() => {
      void send("SAVE_CHECKPOINT", {
        mapId: "hangar-town", x: this.player.gridX, y: this.player.gridY, facing: this.player.direction,
      }).catch(console.warn);
    }, 2000);
  }

  private reportPlayerPosition(): void {
    if (this.handshakeState === "mismatch") return;
    const key = `${this.player.gridX},${this.player.gridY},${this.player.direction}`;
    if (key === this.lastPlayerPosKey) return;
    this.lastPlayerPosKey = key;
    this.playerPosThrottle.push({
      x: this.player.gridX,
      y: this.player.gridY,
      facing: this.player.direction,
      zone: PLAZA_CELLS.has(`${this.player.gridX},${this.player.gridY}`) ? "H3 Plaza" : "Hangar District",
    });
  }

  private markDpadSeen = (): void => {
    if (this.flags["ui.dpad_seen"]) return;
    this.flags["ui.dpad_seen"] = true;
    void send("SET_STORY_FLAG", { flag: "ui.dpad_seen", value: true }).catch(console.warn);
  };

  private handleNativeMessage = (message: { type: string; payload: Record<string, unknown> }): void => {
    if (message.type === "DIALOGUE_STATE") {
      if (isDialogueStatePayload(message.payload) && message.payload.npcId === GUIDE.npcId) {
        this.setDialogueOpen(message.payload.open);
      }
      return;
    }
    if (message.type !== "STORY_STATE") return;
    const state = message.payload;
    if (!isStoryStatePayload(state)) return;
    if (!STORY_SUPPORTED_PROTOCOL_VERSIONS.includes(state.protocolVersion as 1 | 2)) {
      this.storyStateMismatch = true;
      this.renderHandshakeBanner("mismatch", { attempt: 0, error: "PROTOCOL_MISMATCH" });
      return;
    }
    this.flags = state.flags && typeof state.flags === "object" ? state.flags : {};
    this.npc.setMet(this.flags["npc.guide.met"] === true);
    const point = state.checkpoint;
    if (!this.checkpointApplied) {
      this.checkpointApplied = true;
      if (point?.mapId === "hangar-town" && this.tileMap.isWithinBounds(point.x, point.y)
        && this.tileMap.isWalkable(point.x, point.y)) {
        this.player.moveTo(point.x, point.y, point.facing);
        this.companion.snapBehind(this.player, this.tileMap);
        this.lastPlayerTile = `${point.x},${point.y}`;
      }
    }
  };

  private setDialogueOpen(open: boolean): void {
    this.dialogueOpen = open;
    this.dpad?.setHidden(open);
    this.heldDirections.clear();
    if (open) this.keyState.clear();
    if (this.dialogueTimer) window.clearTimeout(this.dialogueTimer);
    this.dialogueTimer = undefined;
    if (open) this.dialogueTimer = window.setTimeout(() => this.setDialogueOpen(false), 90_000);
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") this.handshake.resume();
  };

  private renderHandshakeBanner = (
    state: HandshakeState,
    detail?: { attempt: number; error?: string },
  ): void => {
    if (this.storyStateMismatch && state !== "mismatch") return;
    this.handshakeState = state;
    if (state === "mismatch") this.lastPlayerPosKey = "";
    this.handshakeBanner.style.borderColor = state === "mismatch" ? "#ff4d39" : "#f0bf14";
    if (state === "connected" || (state === "connecting" && (detail?.attempt ?? 1) <= 1)) {
      this.handshakeBanner.hidden = true;
      return;
    }
    this.handshakeBanner.hidden = false;
    this.handshakeBanner.textContent = state === "mismatch"
      ? "STORY MODE UPDATE REQUIRED — protocol mismatch"
      : state === "reconnecting"
        ? `RECONNECTING… (attempt ${detail?.attempt ?? 1})`
        : "CONNECTING…";
  };
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
