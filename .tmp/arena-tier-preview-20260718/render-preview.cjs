const path = require("node:path");
const sharp = require("sharp");

const root = __dirname;
const width = 780;
const height = 540;

const tiers = [
  { id: "rookie", name1: "ROOKIE", name2: "CIRCUIT", level: 12, fee: 50, accent: "#58ef2a", x: 15, y: 44 },
  { id: "challenger", name1: "CHALLENGER", name2: "RING", level: 24, fee: 100, accent: "#20bfff", x: 198, y: 44 },
  { id: "elite", name1: "ELITE", name2: "GAUNTLET", level: 36, fee: 150, accent: "#b34cff", x: 15, y: 142 },
  { id: "legend", name1: "LEGEND", name2: "ARENA", level: 45, fee: 225, accent: "#ffc21c", x: 198, y: 142 },
];

function frame(tier, selected) {
  return `
    <g transform="translate(${tier.x} ${tier.y}) scale(1.0057 1.0833)">
      <path d="M12 2 H162 L174 14 V69 L161 82 H12 L2 72 V14 Z"
        fill="#05080a" stroke="${tier.accent}" stroke-linejoin="miter"
        stroke-width="${selected ? 3.5 : 2.5}"/>
      <path d="M15 7 H157 L168 18 V35 M168 49 V66 L157 77 H119 M70 77 H16 L8 69 V50 M8 34 V17 L17 8"
        fill="none" stroke="${tier.accent}" stroke-opacity="${selected ? 0.76 : 0.38}" stroke-width="1"/>
      <path d="M13 2 H43 L37 8 H18 L8 18 V32 M143 2 H161 L174 15 V29"
        fill="none" stroke="${tier.accent}" stroke-width="${selected ? 4 : 3}"/>
      <path d="M2 57 V71 L12 82 H32 M136 82 H161 L174 69 V55"
        fill="none" stroke="${tier.accent}" stroke-opacity=".9" stroke-width="2"/>
      <path d="M18 12 H66 M71 12 H92 M114 72 H143 M148 72 H159"
        fill="none" stroke="${tier.accent}" stroke-opacity=".34" stroke-width="1"/>
      <path d="M19 78 H31 L38 72 H50 M130 78 H141 L148 72 H160"
        fill="none" stroke="${tier.accent}" stroke-opacity="${selected ? 1 : 0.62}" stroke-width="2.5"/>
      ${selected ? `<path d="M16 5 H159 L171 17 V68 L158 79 H15 L5 69 V16 Z"
        fill="none" stroke="${tier.accent}" stroke-opacity=".22" stroke-width="5"/>` : ""}
    </g>
  `;
}

function copy(tier) {
  const x = tier.x + 82;
  const nameSize = tier.id === "challenger" ? 10.5 : 12;
  return `
    <text x="${x}" y="${tier.y + 28}" fill="#ffffff"
      font-family="Arial Black, Arial, sans-serif" font-size="${nameSize}" font-weight="900">${tier.name1}</text>
    <text x="${x}" y="${tier.y + 41}" fill="#ffffff"
      font-family="Arial Black, Arial, sans-serif" font-size="${nameSize}" font-weight="900">${tier.name2}</text>
    <text x="${x}" y="${tier.y + 60}" fill="#96999e"
      font-family="Arial, sans-serif" font-size="10.5" font-weight="900">LV ${tier.level}</text>
    <text x="${x}" y="${tier.y + 76}" fill="#ffd518"
      font-family="Arial, sans-serif" font-size="10.5" font-weight="900">${tier.fee} Holos</text>
  `;
}

const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 780 540">
    <rect width="780" height="540" fill="#111111"/>
    <g transform="scale(2)">
      <rect width="390" height="270" fill="#f4c900"/>
      <text x="15" y="27" fill="#080908" font-family="Arial Black, Arial, sans-serif"
        font-size="13" font-weight="900" letter-spacing=".5">ARENA TIERS</text>
      <path d="M106 23 H375" stroke="#080908" stroke-opacity=".25" stroke-width="2"/>
      ${tiers.map((tier, index) => frame(tier, index === 0)).join("")}
      ${tiers.map(copy).join("")}
      <text x="373" y="252" text-anchor="end" fill="#050606" fill-opacity=".58"
        font-family="Arial, sans-serif" font-size="9" font-weight="900" letter-spacing=".85">
        TAP A TIER TO PREVIEW SELECTION
      </text>
    </g>
  </svg>
`;

async function render() {
  const composites = [];

  for (const tier of tiers) {
    const icon = await sharp(path.join(root, "public", "arena-tiers", `${tier.id}-tier.png`))
      .resize(152, 152, { fit: "contain" })
      .png()
      .toBuffer();

    composites.push({
      input: icon,
      left: (tier.x + 4) * 2,
      top: (tier.y + 7) * 2,
    });
  }

  await sharp(Buffer.from(svg))
    .composite(composites)
    .png()
    .toFile(path.join(root, "arena-tiers-preview.png"));
}

render().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
