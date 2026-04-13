import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";

import {
  createDefaultBuildingCallbacks,
  triggerBuildingEvent,
  type BuildingCallbacks,
} from "./Interactions";
import { Player } from "./Player";
import { TileMap, type BuildingPlacement } from "./TileMap";
import { TILE_COLORS, TILE_SIZE, type Direction } from "./TileTypes";

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

export interface OverworldSceneOptions {
  mountNode: HTMLElement;
  width?: number;
  height?: number;
  callbacks?: Partial<BuildingCallbacks>;
}

export class OverworldScene {
  readonly app: Application;
  readonly tileMap: TileMap;
  readonly player: Player;

  private readonly mountNode: HTMLElement;
  private readonly world: Container;
  private readonly hud: Container;
  private readonly interactionLabel: Text;
  private readonly keyState = new Set<string>();
  private callbacks: BuildingCallbacks;

  private resizeTarget?: ResizeTarget;
  private lastInteractionPressed = false;
  private destroyed = false;

  private constructor(app: Application, options: OverworldSceneOptions) {
    this.app = app;
    this.mountNode = options.mountNode;
    this.tileMap = new TileMap();
    this.player = new Player({ x: 10, y: 10 });
    this.callbacks = {
      ...createDefaultBuildingCallbacks(),
      ...options.callbacks,
    };

    this.world = new Container();
    this.hud = new Container();
    this.interactionLabel = new Text({
      style: new TextStyle({
        fill: 0xffffff,
        fontFamily: "monospace",
        fontSize: 14,
        stroke: { color: 0x000000, width: 3 },
      }),
    });

    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.hud);

    this.buildMapGraphics();

    this.world.addChild(this.player.sprite);

    this.interactionLabel.position.set(12, 12);
    this.hud.addChild(this.interactionLabel);

    this.app.ticker.add(this.update);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

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

    return new OverworldScene(app, options);
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

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.app.ticker.remove(this.update);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
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
    const groundLayer = new Container();
    const decorLayer = new Container();
    const buildingLayer = new Container();

    for (let y = 0; y < this.tileMap.height; y += 1) {
      for (let x = 0; x < this.tileMap.width; x += 1) {
        const tile = this.tileMap.tiles[y][x];
        const tileGraphic = this.drawTile(tile.type, x, y);

        tileGraphic.position.set(x * TILE_SIZE, y * TILE_SIZE);
        groundLayer.addChild(tileGraphic);

        if (tile.event && tile.type === "path") {
          const entrance = this.drawEntranceMarker();
          entrance.position.set(x * TILE_SIZE, y * TILE_SIZE);
          decorLayer.addChild(entrance);
        }
      }
    }

    this.addDecor(decorLayer);
    this.addCentralBeacon(decorLayer);

    for (const building of this.tileMap.getBuildingPlacements()) {
      const buildingGraphic = this.drawBuilding(building);
      buildingGraphic.position.set(building.x * TILE_SIZE, building.y * TILE_SIZE);
      buildingLayer.addChild(buildingGraphic);
    }

    this.world.addChild(groundLayer);
    this.world.addChild(decorLayer);
    this.world.addChild(buildingLayer);
  }

  private drawTile(tileType: keyof typeof TILE_COLORS, x: number, y: number): Container {
    const tile = new Container();
    const base = new Graphics();

    base.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(TILE_COLORS[tileType]);
    tile.addChild(base);

    switch (tileType) {
      case "grass": {
        const patch = new Graphics();
        patch.rect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4).fill(0x5dbd5c);
        patch.rect(4, 4, TILE_SIZE - 8, TILE_SIZE - 8).fill(0x82db74);
        patch.rect(3 + ((x + y) % 3), 7, 6, 3).fill(0x4f9747);
        patch.rect(18, 10 + ((x * y) % 4), 5, 3).fill(0x4f9747);
        patch.rect(9, 20, 4, 2).fill(0xb2f08f);
        tile.addChild(patch);
        break;
      }
      case "path": {
        const road = new Graphics();
        road.rect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2).fill(0x7d859b);
        road.rect(3, 3, TILE_SIZE - 6, TILE_SIZE - 6).fill(0x969eb2);
        road.rect(5, 5, TILE_SIZE - 10, TILE_SIZE - 10).fill(0x8b93a6);
        road.rect(14, 4, 4, TILE_SIZE - 8).fill(0x38d9ff);
        road.rect(15, 5, 2, TILE_SIZE - 10).fill(0xa2f0ff);
        tile.addChild(road);
        break;
      }
      case "water": {
        const water = new Graphics();
        water.rect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2).fill(0x144b8b);
        water.rect(3, 3, TILE_SIZE - 6, TILE_SIZE - 6).fill(0x1e78d3);
        water.rect(4, 8, TILE_SIZE - 8, 3).fill(0x74f3ff);
        water.rect(8, 16, TILE_SIZE - 14, 2).fill(0x9ef7ff);
        tile.addChild(water);
        break;
      }
      case "wall": {
        const wall = new Graphics();
        wall.rect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2).fill(0x262d4b);
        wall.rect(4, 4, TILE_SIZE - 8, TILE_SIZE - 8).fill(0x39416b);
        wall.rect(6, 6, TILE_SIZE - 12, 6).fill(0x586289);
        wall.rect(6, 16, TILE_SIZE - 12, 4).fill(0x20253c);
        tile.addChild(wall);
        break;
      }
      case "building": {
        const pad = new Graphics();
        pad.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(0x4b5270);
        pad.rect(3, 3, TILE_SIZE - 6, TILE_SIZE - 6).fill(0x636d8f);
        tile.addChild(pad);
        break;
      }
      default:
        break;
    }

    return tile;
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

  private addDecor(layer: Container): void {
    const treePositions = [
      [4, 3],
      [5, 3],
      [14, 3],
      [15, 3],
      [3, 13],
      [6, 14],
      [12, 14],
      [13, 4],
      [16, 5],
      [17, 11],
      [2, 12],
    ];
    const lampPositions = [
      [7, 7],
      [12, 7],
      [7, 13],
      [12, 13],
      [9, 15],
      [10, 15],
      [5, 11],
      [14, 11],
    ];

    for (const [x, y] of treePositions) {
      const tree = this.drawTree();
      tree.position.set(x * TILE_SIZE, y * TILE_SIZE);
      layer.addChild(tree);
    }

    for (const [x, y] of lampPositions) {
      const lamp = this.drawLamp();
      lamp.position.set(x * TILE_SIZE, y * TILE_SIZE);
      layer.addChild(lamp);
    }
  }

  private addCentralBeacon(layer: Container): void {
    const beacon = new Container();
    const x = 8 * TILE_SIZE;
    const y = 11 * TILE_SIZE;
    const platform = new Graphics();
    const core = new Graphics();
    const label = new Text({
      text: "H3",
      style: new TextStyle({
        fill: 0xc8fdff,
        fontFamily: "monospace",
        fontSize: 26,
        fontWeight: "bold",
        stroke: { color: 0x1e78d3, width: 4 },
      }),
    });

    platform.roundRect(0, 0, 4 * TILE_SIZE, 3 * TILE_SIZE, 18).fill(0x53607f);
    platform.roundRect(10, 10, 4 * TILE_SIZE - 20, 3 * TILE_SIZE - 20, 14).fill(0x6e7c9d);
    platform.roundRect(26, 24, 4 * TILE_SIZE - 52, 3 * TILE_SIZE - 48, 12).fill(0x415071);
    core.circle(2 * TILE_SIZE, 42, 30).fill(0x22a0ff);
    core.circle(2 * TILE_SIZE, 42, 22).fill(0x5ee7ff);
    core.circle(2 * TILE_SIZE, 42, 14).fill(0xb8f8ff);

    label.anchor.set(0.5);
    label.position.set(2 * TILE_SIZE, 42);

    beacon.position.set(x, y);
    beacon.addChild(platform);
    beacon.addChild(core);
    beacon.addChild(label);
    layer.addChild(beacon);
  }

  private drawBuilding(building: BuildingPlacement): Container {
    const width = building.width * TILE_SIZE;
    const height = building.height * TILE_SIZE;
    const buildingContainer = new Container();
    const style = getBuildingStyle(building.event.id);
    const base = new Graphics();
    const body = new Graphics();
    const label = new Text({
      text: style.label,
      style: new TextStyle({
        fill: 0xf4fbff,
        fontFamily: "monospace",
        fontSize: style.fontSize,
        fontWeight: "bold",
        stroke: { color: style.accentDark, width: 5 },
      }),
    });

    base.roundRect(0, height - 18, width, 18, 10).fill(0x404962);
    base.roundRect(8, height - 28, width - 16, 14, 8).fill(0x616a87);

    body.roundRect(10, height - 54, width - 20, 34, 10).fill(style.base);
    body.roundRect(14, height - 50, width - 28, 18, 8).fill(style.baseLight);
    body.rect(14, height - 30, width - 28, 4).fill(style.accent);
    body.rect(20, height - 18, 14, 10).fill(0x22293b);
    body.rect(width - 34, height - 18, 14, 10).fill(0x22293b);

    if (style.shape === "dome") {
      body.circle(width / 2, height - 64, 34).fill(style.baseLight);
      body.circle(width / 2, height - 64, 28).fill(style.base);
      body.circle(width / 2, height - 86, 8).fill(style.accent);
      body.rect(width / 2 - 24, height - 40, 48, 10).fill(style.accent);
    } else if (style.shape === "forge") {
      body.roundRect(18, 8, width - 36, height - 36, 14).fill(style.baseLight);
      body.circle(width / 2, height - 68, 16).fill(style.accent);
      body.circle(width / 2, height - 68, 8).fill(0xf6d2ff);
      body.rect(width / 2 - 6, height - 88, 12, 24).fill(style.accentDark);
    } else if (style.shape === "lab") {
      body.roundRect(16, 12, width - 32, height - 36, 14).fill(style.baseLight);
      body.poly([
        width / 2, 8,
        width - 22, 28,
        width / 2, 46,
        22, 28,
      ]).fill(style.accent);
      body.poly([
        width / 2, 16,
        width - 34, 29,
        width / 2, 38,
        34, 29,
      ]).fill(0xdfffc0);
    } else {
      body.roundRect(24, 0, width - 48, height - 18, 18).fill(style.baseLight);
      body.roundRect(34, 12, width - 68, height - 42, 14).fill(style.base);
      body.rect(width / 2 - 10, 16, 20, height - 50).fill(style.accent);
      body.rect(width / 2 - 4, 24, 8, height - 66).fill(0xfff5d6);
    }

    const doorway = new Graphics();
    doorway.roundRect(width / 2 - 14, height - 34, 28, 24, 6).fill(0x25314f);
    doorway.roundRect(width / 2 - 10, height - 30, 20, 18, 4).fill(style.accent);
    doorway.rect(width / 2 - 7, height - 27, 14, 12).fill(0xdfffff);

    label.anchor.set(0.5);
    label.position.set(width / 2, height - 56);

    buildingContainer.addChild(base);
    buildingContainer.addChild(body);
    buildingContainer.addChild(doorway);
    buildingContainer.addChild(label);

    return buildingContainer;
  }

  private drawTree(): Container {
    const tree = new Container();
    const trunk = new Graphics();
    const leaves = new Graphics();

    trunk.rect(12, 20, 8, 10).fill(0x4c2f1f);
    leaves.circle(10, 16, 10).fill(0x2f7d39);
    leaves.circle(18, 12, 11).fill(0x3d9449);
    leaves.circle(22, 18, 9).fill(0x2f7d39);
    leaves.circle(14, 9, 8).fill(0x67c95d);

    tree.addChild(trunk);
    tree.addChild(leaves);

    return tree;
  }

  private drawLamp(): Container {
    const lamp = new Container();
    const post = new Graphics();
    const glow = new Graphics();

    post.rect(14, 8, 4, 18).fill(0x2c3347);
    post.roundRect(10, 3, 12, 8, 4).fill(0x1c2438);
    post.roundRect(12, 5, 8, 4, 2).fill(0x52dfff);
    glow.circle(16, 7, 10).fill(0x48dcff);
    glow.alpha = 0.2;

    lamp.addChild(glow);
    lamp.addChild(post);

    return lamp;
  }

  private update = (ticker: { deltaMS: number }): void => {
    const deltaSeconds = ticker.deltaMS / 1000;

    this.handleMovementInput();
    this.handleInteractionInput();
    this.player.update(deltaSeconds);
    this.updateInteractionHint();
    this.updateCamera();
  };

  private handleMovementInput(): void {
    if (this.player.isMoving) {
      return;
    }

    const movementPriority: Direction[] = ["up", "down", "left", "right"];

    for (const direction of movementPriority) {
      if (this.isDirectionPressed(direction)) {
        this.player.tryMove(direction, this.tileMap);
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

    const facingTile = this.player.getFacingTile();
    const interactionTile = this.tileMap.getInteractionTile(facingTile.x, facingTile.y);

    if (interactionTile?.event) {
      triggerBuildingEvent(interactionTile.event, this.callbacks);
    }

    this.lastInteractionPressed = interactionPressed;
  }

  private updateInteractionHint(): void {
    const facingTile = this.player.getFacingTile();
    const interactionTile = this.tileMap.getInteractionTile(facingTile.x, facingTile.y);

    this.interactionLabel.text = interactionTile?.event
      ? `Press E: ${interactionTile.event.label}`
      : "";
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
      clamp(desiredX, minX, 0),
      clamp(desiredY, minY, 0),
    );
  }

  private isDirectionPressed(direction: Direction): boolean {
    return Object.entries(MOVE_KEYS).some(
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
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

type BuildingVisualStyle = {
  label: string;
  fontSize: number;
  shape: "dome" | "forge" | "lab" | "tower";
  base: number;
  baseLight: number;
  accent: number;
  accentDark: number;
};

const getBuildingStyle = (id: BuildingPlacement["event"]["id"]): BuildingVisualStyle => {
  switch (id) {
    case "arena":
      return {
        label: "ARENA",
        fontSize: 18,
        shape: "dome",
        base: 0x2d78c8,
        baseLight: 0x5faeff,
        accent: 0x5af4ff,
        accentDark: 0x11457a,
      };
    case "deckBuilder":
      return {
        label: "CARDS",
        fontSize: 18,
        shape: "forge",
        base: 0x6d34bf,
        baseLight: 0xa46dff,
        accent: 0xff8df4,
        accentDark: 0x3b176a,
      };
    case "trainingLab":
      return {
        label: "LAB",
        fontSize: 20,
        shape: "lab",
        base: 0x2a904c,
        baseLight: 0x67d36f,
        accent: 0xb9ff69,
        accentDark: 0x1f5f33,
      };
    case "pvpTerminal":
      return {
        label: "PVP",
        fontSize: 20,
        shape: "tower",
        base: 0xa42e46,
        baseLight: 0xe55d79,
        accent: 0xff614d,
        accentDark: 0x5d1828,
      };
    default:
      return {
        label: "HUB",
        fontSize: 16,
        shape: "dome",
        base: 0x5376a4,
        baseLight: 0x7fa5d2,
        accent: 0x63d8ff,
        accentDark: 0x1f3657,
      };
  }
};
