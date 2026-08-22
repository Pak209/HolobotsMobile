const path = require("node:path");
const sharp = require("sharp");

const root = __dirname;
const referencePath =
  "/var/folders/dp/hhhqq0ps54j6hk_gsdt8fscr0000gn/T/codex-clipboard-7d560c4b-88a0-4194-b452-4dd8720e00f2.png";

async function renderComparison() {
  const reference = await sharp(referencePath)
    .extract({ left: 8, top: 105, width: 390, height: 218 })
    .resize(780, 436)
    .png()
    .toBuffer();

  const implementation = await sharp(path.join(root, "arena-tiers-preview.png"))
    .extract({ left: 0, top: 0, width: 780, height: 500 })
    .png()
    .toBuffer();

  const label = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1580" height="54">
      <rect width="1580" height="54" fill="#101010"/>
      <text x="20" y="35" fill="#ffffff" font-family="Arial, sans-serif" font-size="22" font-weight="700">REFERENCE</text>
      <text x="820" y="35" fill="#ffffff" font-family="Arial, sans-serif" font-size="22" font-weight="700">TEMP PREVIEW</text>
    </svg>
  `);

  await sharp({
    create: {
      width: 1580,
      height: 554,
      channels: 4,
      background: "#101010",
    },
  })
    .composite([
      { input: label, left: 0, top: 0 },
      { input: reference, left: 0, top: 54 },
      { input: implementation, left: 800, top: 54 },
    ])
    .png()
    .toFile(path.join(root, "arena-tiers-comparison.png"));
}

renderComparison().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
