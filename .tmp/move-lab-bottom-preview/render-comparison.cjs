const path = require("node:path");
const sharp = require("sharp");

const root = __dirname;
const reference =
  "/var/folders/dp/hhhqq0ps54j6hk_gsdt8fscr0000gn/T/codex-clipboard-b99f6f9c-bb16-4a4b-bc2b-11d530c1d6ef.png";

async function render() {
  const source = await sharp(reference)
    .extract({ left: 24, top: 598, width: 805, height: 1130 })
    .resize(780, 1095)
    .png()
    .toBuffer();
  const preview = await sharp(path.join(root, "move-lab-bottom-sections-preview.png"))
    .resize(780, 1130)
    .png()
    .toBuffer();
  const labels = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1580" height="54">
      <rect width="1580" height="54" fill="#101010"/>
      <text x="20" y="35" fill="#fff" font-family="Arial" font-size="22" font-weight="700">REFERENCE</text>
      <text x="820" y="35" fill="#fff" font-family="Arial" font-size="22" font-weight="700">IMPLEMENTED COMPONENT PREVIEW</text>
    </svg>
  `);

  await sharp({
    create: { width: 1580, height: 1184, channels: 4, background: "#101010" },
  })
    .composite([
      { input: labels, left: 0, top: 0 },
      { input: source, left: 0, top: 54 },
      { input: preview, left: 800, top: 54 },
    ])
    .png()
    .toFile(path.join(root, "move-lab-bottom-sections-comparison.png"));
}

render().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
