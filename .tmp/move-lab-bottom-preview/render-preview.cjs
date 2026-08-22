const path = require("node:path");
const sharp = require("sharp");

const root = __dirname;
const project = path.resolve(root, "../..");
const strikeIcon = path.join(project, "mobile/assets/game/arena-moves/strike.png");

const moves = [
  { name: "QUICK JAB", description: "Reliable chip damage with fast recovery.", cost: 1, damage: 9 },
  { name: "BACKHAND", description: "Cheap pressure that keeps the opponent guessing.", cost: 1, damage: 8 },
  { name: "SNAP SHOT", description: "Fast strike that builds special meter.", cost: 1, damage: 9 },
  { name: "CORNER PRESSURE", description: "Forces a response with solid damage.", cost: 2, damage: 12 },
  { name: "ARMOR PIERCE", description: "Heavy strike that punches through guard.", cost: 3, damage: 15 },
];

function pips(x, y, filled = 0, count = 3, scale = 1) {
  return Array.from({ length: count }, (_, index) => `
    <rect x="${x + index * 28 * scale}" y="${y}" width="${22 * scale}" height="${8 * scale}"
      fill="${index < filled ? "#ff453f" : "#303239"}"/>
  `).join("");
}

function moveRow(move, index) {
  const y = 580 + index * 98;
  return `
    <path d="M34 ${y} H746 L758 ${y + 12} V${y + 82} L746 ${y + 94} H34 L22 ${y + 82} V${y + 12} Z"
      fill="#07080a"/>
    <path d="M34 ${y} H246 M260 ${y} H746 L758 ${y + 12} V${y + 34}
      M758 ${y + 48} V${y + 82} L746 ${y + 94} H584 M568 ${y + 94} H34
      L22 ${y + 82} V${y + 62} M22 ${y + 48} V${y + 12} Z"
      fill="none" stroke="#ff453f" stroke-width="2"/>
    <path d="M742 ${y + 38} H758 M742 ${y + 44} H758"
      fill="none" stroke="#ffc51b" stroke-width="1"/>
    <rect x="36" y="${y + 15}" width="66" height="66" fill="#050606" stroke="#ff453f" stroke-width="2"/>
    <text x="40" y="${y + 27}" fill="#ff453f" fill-opacity=".72"
      font-family="Arial, sans-serif" font-size="8" font-weight="900">${String(index + 1).padStart(2, "0")}</text>
    <text x="122" y="${y + 30}" fill="#ffffff" font-family="Arial Black, Arial, sans-serif"
      font-size="19" font-weight="900">${move.name}</text>
    <text x="122" y="${y + 53}" fill="#b9bcc3" font-family="Arial, sans-serif"
      font-size="14">${move.description}</text>
    <text x="122" y="${y + 78}" fill="#777e8b" font-family="Arial, sans-serif"
      font-size="10" font-weight="900" letter-spacing=".5">COST</text>
    <text x="158" y="${y + 78}" fill="#ffffff" font-family="Arial, sans-serif"
      font-size="12" font-weight="900">${move.cost}</text>
    <path d="M178 ${y + 67} V${y + 82}" stroke="#3f444e"/>
    <text x="190" y="${y + 78}" fill="#777e8b" font-family="Arial, sans-serif"
      font-size="10" font-weight="900" letter-spacing=".5">RANK</text>
    <text x="228" y="${y + 78}" fill="#ff453f" font-family="Arial, sans-serif"
      font-size="12" font-weight="900">0</text>
    <path d="M250 ${y + 67} V${y + 82}" stroke="#3f444e"/>
    <text x="262" y="${y + 78}" fill="#777e8b" font-family="Arial, sans-serif"
      font-size="10" font-weight="900" letter-spacing=".5">TYPE</text>
    <text x="296" y="${y + 78}" fill="#ffffff" font-family="Arial, sans-serif"
      font-size="12" font-weight="900">PHYSICAL</text>
    ${pips(374, y + 71, 0, 3, 0.66)}
    <path d="M678 ${y + 18} H742 L750 ${y + 26} V${y + 69} L742 ${y + 77} H678 L670 ${y + 69} V${y + 26} Z"
      fill="#0a0b0e" stroke="#ffc51b" stroke-width="2"/>
    <text x="710" y="${y + 55}" text-anchor="middle" fill="#ffc51b"
      font-family="Arial Black, Arial, sans-serif" font-size="15" font-weight="900">EQUIP</text>
  `;
}

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="780" height="1130" viewBox="0 0 780 1130">
  <rect width="780" height="1130" fill="#f4c900"/>

  <path d="M30 20 H750 L770 40 V452 L750 472 H30 L10 452 V40 Z"
    fill="#030405" stroke="#ff453f" stroke-width="3"/>
  <path d="M42 31 H244 L230 48 H44 M656 32 H735 L756 53 V118 M24 367 V438 L42 456 H118 M658 456 H738 L756 438 V372"
    fill="none" stroke="#ff453f" stroke-opacity=".55" stroke-width="2"/>
  <path d="M34 456 H104 L116 444 H182 M598 456 H670 L682 444 H744"
    fill="none" stroke="#ffc51b" stroke-opacity=".72" stroke-width="3"/>
  <path d="M30 20 H274 L250 55 H30 Z" fill="#0b0b0b" stroke="#ff453f" stroke-width="1"/>
  <text x="42" y="45" fill="#ff453f" font-family="Arial Black, Arial, sans-serif"
    font-size="19" font-weight="900">STRIKE</text>

  <rect x="28" y="74" width="214" height="214" fill="#050606" stroke="#ff453f" stroke-width="2"/>
  <circle cx="135" cy="181" r="88" fill="none" stroke="#ff453f" stroke-opacity=".3" stroke-width="2"/>
  <circle cx="135" cy="181" r="70" fill="none" stroke="#ff453f" stroke-opacity=".2" stroke-width="2"/>
  <path d="M135 82 V104 M135 258 V280 M36 181 H58 M212 181 H234"
    stroke="#ff453f" stroke-opacity=".65" stroke-width="2"/>

  <text x="274" y="54" fill="#7d838f" font-family="Arial, sans-serif"
    font-size="10" font-weight="900" letter-spacing="1">COMBAT KIT // SLOT 01 // IMPACT</text>
  <text x="274" y="86" fill="#ffffff" font-family="Arial Black, Arial, sans-serif"
    font-size="31" font-weight="900">TEMPO THRUST</text>
  <path d="M665 50 H742 L750 58 V89 L742 97 H665 L657 89 V58 Z"
    fill="#08090b" stroke="#ff453f" stroke-width="2"/>
  <text x="704" y="78" text-anchor="middle" fill="#ff453f"
    font-family="Arial Black, Arial, sans-serif" font-size="13" font-weight="900">EQUIPPED</text>

  <text x="274" y="122" fill="#ff453f" font-family="Arial, sans-serif"
    font-size="17" font-weight="900">RANK 0 / 3</text>
  ${pips(402, 109, 0, 3, 1.2)}

  <path d="M274 144 H402 M416 144 H606 M620 144 H748
    M274 213 H386 M400 213 H624 M638 213 H748" stroke="#343840" stroke-width="2"/>
  <path d="M432 144 V213 M590 144 V213" stroke="#343840" stroke-width="2"/>
  <text x="294" y="168" fill="#8e939d" font-family="Arial, sans-serif" font-size="13">COST</text>
  <text x="294" y="196" fill="#ffffff" font-family="Arial, sans-serif" font-size="19" font-weight="900">2</text>
  <text x="455" y="168" fill="#8e939d" font-family="Arial, sans-serif" font-size="13">TYPE</text>
  <text x="455" y="196" fill="#ffffff" font-family="Arial, sans-serif" font-size="17" font-weight="900">PHYSICAL</text>
  <text x="614" y="168" fill="#8e939d" font-family="Arial, sans-serif" font-size="13">SPD</text>
  <text x="614" y="196" fill="#ffffff" font-family="Arial, sans-serif" font-size="19" font-weight="900">1.00</text>

  <path d="M274 226 V278" stroke="#343840" stroke-width="3"/>
  <text x="286" y="241" fill="#ff453f" font-family="Arial, sans-serif"
    font-size="10" font-weight="900" letter-spacing="1">TACTICAL PROFILE</text>
  <text x="286" y="260" fill="#c5c7cc" font-family="Arial, sans-serif" font-size="15">
    <tspan x="286" dy="0">Tier 2 strike: solid output with quick recovery.</tspan>
    <tspan x="286" dy="21">Tap Upgrade to inspect the next-rank changes.</tspan>
  </text>

  <path d="M30 306 H267 V364 H20 V316 Z" fill="#ffc51b" stroke="#ffe678"/>
  <path d="M267 306 H514 V364 H267 Z" fill="#121109" stroke="#514719"/>
  <path d="M514 306 H750 L760 316 V364 H514 Z" fill="#121109" stroke="#514719"/>
  <path d="M42 310 H116 M338 310 H414 M642 310 H724"
    stroke="#ff453f" stroke-opacity=".42" stroke-width="1"/>
  <text x="143" y="342" text-anchor="middle" fill="#050606" font-family="Arial Black, Arial, sans-serif"
    font-size="17" font-weight="900">DETAILS</text>
  <rect x="124" y="356" width="38" height="3" fill="#ff453f"/>
  <text x="390" y="342" text-anchor="middle" fill="#ffc51b" font-family="Arial Black, Arial, sans-serif"
    font-size="17" font-weight="900">UPGRADE</text>
  <text x="637" y="342" text-anchor="middle" fill="#ffc51b" font-family="Arial Black, Arial, sans-serif"
    font-size="17" font-weight="900">AVAILABLE</text>

  <path d="M44 383 H370 L384 397 V441 L370 455 H44 L30 441 V397 Z"
    fill="#ffc51b" stroke="#ffe678" stroke-width="2"/>
  <path d="M410 383 H736 L750 397 V441 L736 455 H410 L396 441 V397 Z"
    fill="#0a0b0e" stroke="#5b606b" stroke-width="2"/>
  <path d="M54 388 H162 M618 450 H722" stroke="#fff2a0" stroke-opacity=".75" stroke-width="2"/>
  <path d="M420 388 H530 M644 450 H728" stroke="#ff453f" stroke-opacity=".72" stroke-width="1"/>
  <text x="207" y="417" text-anchor="middle" fill="#050606" font-family="Arial Black, Arial, sans-serif"
    font-size="21" font-weight="900">UPGRADE</text>
  <text x="207" y="439" text-anchor="middle" fill="#302600" font-family="Arial, sans-serif"
    font-size="13" font-weight="900">25 SP • 80 AVAILABLE</text>
  <text x="573" y="417" text-anchor="middle" fill="#ffffff" font-family="Arial Black, Arial, sans-serif"
    font-size="21" font-weight="900">PREVIEW</text>
  <text x="573" y="439" text-anchor="middle" fill="#8e939d" font-family="Arial, sans-serif"
    font-size="13" font-weight="900">MOVE DETAILS</text>

  <path d="M30 498 H750 L770 518 V1100 L750 1120 H30 L10 1100 V518 Z"
    fill="#030405" stroke="#ff453f" stroke-width="3"/>
  <path d="M42 510 H252 L238 527 H42 M664 510 H738 L756 528 V594 M24 1030 V1090 L42 1107 H112 M664 1107 H738 L756 1089 V1032"
    fill="none" stroke="#ff453f" stroke-opacity=".5" stroke-width="2"/>
  <path d="M32 1105 H110 L122 1093 H188 M592 1105 H670 L682 1093 H744"
    fill="none" stroke="#ffc51b" stroke-opacity=".7" stroke-width="3"/>
  <text x="32" y="545" fill="#ff453f" font-family="Arial Black, Arial, sans-serif"
    font-size="20" font-weight="900">AVAILABLE STRIKE MOVES</text>
  <rect x="472" y="520" width="42" height="39" fill="#08090b" stroke="#ff453f"/>
  <text x="493" y="545" text-anchor="middle" fill="#ff453f" font-family="Arial, sans-serif"
    font-size="13" font-weight="900">05</text>

  <rect x="528" y="517" width="150" height="47" fill="#0a0b0e" stroke="#454952" stroke-width="2"/>
  <text x="603" y="547" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif"
    font-size="14" font-weight="900">FILTER: ALL</text>
  <rect x="690" y="517" width="66" height="47" fill="#0a0b0e" stroke="#454952" stroke-width="2"/>
  <text x="723" y="547" text-anchor="middle" fill="#ffc51b" font-family="Arial, sans-serif"
    font-size="13" font-weight="900">A–Z</text>

  ${moves.map(moveRow).join("")}
</svg>`;

async function render() {
  const largeIcon = await sharp(strikeIcon).resize(204, 204, { fit: "contain" }).png().toBuffer();
  const smallIcon = await sharp(strikeIcon).resize(60, 60, { fit: "contain" }).png().toBuffer();

  await sharp(Buffer.from(svg))
    .composite([
      { input: largeIcon, left: 33, top: 79 },
      ...moves.map((_, index) => ({
        input: smallIcon,
        left: 39,
        top: 599 + index * 98,
      })),
    ])
    .png()
    .toFile(path.join(root, "move-lab-bottom-sections-preview.png"));
}

render().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
