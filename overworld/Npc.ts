import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { TILE_SIZE } from "./TileTypes";
import { GUIDE } from "./maps/npcs";

export class Npc {
  readonly sprite = new Container();
  private readonly label: Text;

  constructor() {
    const body = new Graphics();
    body.rect(4, -12, 24, 44).fill(0x050606);
    body.rect(7, -9, 18, 8).fill(0xf0bf14);
    body.rect(9, 2, 14, 22).fill(0xf0bf14);
    this.label = new Text({ text: "Guide", style: new TextStyle({ fill: 0xfef1e0, fontFamily: "monospace", fontSize: 11 }) });
    this.label.anchor.set(0.5, 1);
    this.label.position.set(TILE_SIZE / 2, -14);
    this.sprite.position.set(GUIDE.x * TILE_SIZE, GUIDE.y * TILE_SIZE);
    this.sprite.addChild(body, this.label);
  }

  setMet(met: boolean) { this.label.text = met ? "Guide ✓" : "Guide"; }
}
