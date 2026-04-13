import { useState } from "react";

const ARTBOARD_WIDTH = 1800;
const ARTBOARD_HEIGHT = 3200;

type Screen = "home" | "fitness";

type SvgImageProps = {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function SvgImage({ href, x, y, width, height }: SvgImageProps) {
  return (
    <image
      href={href}
      x={x}
      y={y}
      width={width}
      height={height}
      preserveAspectRatio="none"
    />
  );
}

const homeAssets = {
  backgroundBase: "https://www.figma.com/api/mcp/asset/55e85c42-e9a5-4c5d-a9f9-ca84afbbed8e",
  backgroundDetail: "https://www.figma.com/api/mcp/asset/c6c0c7fc-9fc2-45a2-9180-447851dccf8a",
  topBackground: "https://www.figma.com/api/mcp/asset/68e57c3a-0ede-47a3-951c-87a8a569703a",
  attributeChartBase: "https://www.figma.com/api/mcp/asset/96ec81bf-b317-4bef-b1b5-34a3a224866e",
  attributeChartRadar: "https://www.figma.com/api/mcp/asset/1d266c41-559a-4b85-9373-56242e00f9bc",
  attributeChartLine1: "https://www.figma.com/api/mcp/asset/1e54fef1-d833-4f2a-8b5a-876d2c390afa",
  attributeChartLine2: "https://www.figma.com/api/mcp/asset/5fe80347-60dc-4193-8fd9-46acc9c77dbe",
  attributeChartLine3: "https://www.figma.com/api/mcp/asset/1d297734-c1a1-4e5a-8007-f3d136c92ae6",
  attributeChartLine4: "https://www.figma.com/api/mcp/asset/91bc2a97-4d76-483d-ad8c-d157fc76bd14",
  attributeChartLine5: "https://www.figma.com/api/mcp/asset/c588bbd9-1571-4702-9d74-b14e07eef5ee",
  attributeChartOutline: "https://www.figma.com/api/mcp/asset/f3e4401f-f54b-4325-a69d-e0e3fcf3060d",
  attributeChartOutline2: "https://www.figma.com/api/mcp/asset/da6a9f35-7bcc-4d52-99b3-f1c6393c24f6",
  mechCardMask: "https://www.figma.com/api/mcp/asset/ecdf8bdb-dced-4a91-b5fd-e8e2050e09cd",
  mechCardFill: "https://www.figma.com/api/mcp/asset/5756c910-1284-4cdb-a6e6-3b6cfee5b2be",
  expBarTotal: "https://www.figma.com/api/mcp/asset/cefb91da-47b3-4f3c-84d9-7241f337709b",
  expBarProgress: "https://www.figma.com/api/mcp/asset/0b1d06f1-f558-4b03-bbcd-bf6ba72b1fa8",
  changeBar: "https://www.figma.com/api/mcp/asset/af11f8a3-0574-4579-ae59-48eba78b62c9",
  changeIconBack: "https://www.figma.com/api/mcp/asset/0da886b6-8815-41a2-93df-22815bd0f580",
  changeIconFront: "https://www.figma.com/api/mcp/asset/75fe1396-0d27-4212-a2b1-b9e4de04a7d5",
  abilityChipBackground1: "https://www.figma.com/api/mcp/asset/cf10313c-0070-4304-b181-8ff2a9353489",
  abilityChipDetail1: "https://www.figma.com/api/mcp/asset/d3ba72a9-fd0c-4dbd-b9f8-5930b20b86aa",
  abilityChipBackground3: "https://www.figma.com/api/mcp/asset/b477cdfc-0a84-422a-a4c0-cbb1cacf7a48",
  abilityChipDetail3: "https://www.figma.com/api/mcp/asset/4203f4b3-ea2e-4f13-9c88-ba6cfb259822",
  bottomBackground: "https://www.figma.com/api/mcp/asset/39d784f8-a309-44bb-a189-6482eb1d50ea",
  marketplaceIcon: "https://www.figma.com/api/mcp/asset/f906e3f8-48fd-4ba4-965f-5e48659bd5b6",
  syncIcon: "https://www.figma.com/api/mcp/asset/874b0a6f-6fb7-4dc7-b6a2-2f4d8fd748c9",
  inventoryIcon: "https://www.figma.com/api/mcp/asset/92074366-9482-41ee-8ae8-6c4823cc26b8",
  arenaIcon: "https://www.figma.com/api/mcp/asset/82c548af-d8d7-415e-b1b7-e8681a2c26d4",
};

const fitnessAssets = {
  backgroundBase: "https://www.figma.com/api/mcp/asset/637ba0a4-410e-445f-b4e6-96d88c3480bf",
  backgroundDesign: "https://www.figma.com/api/mcp/asset/7579e871-3df2-43e6-8287-e35204a87056",
  syncPointBar: "https://www.figma.com/api/mcp/asset/95785213-9c1d-4a2c-9195-388f5886df3c",
  syncPointAccent: "https://www.figma.com/api/mcp/asset/03dfae28-11f5-49f2-a5a1-bcbe8d2ac195",
  goalMask: "https://www.figma.com/api/mcp/asset/777383c7-89b7-4a49-a056-a0753474d402",
  goalFill: "https://www.figma.com/api/mcp/asset/01668e22-1126-4029-87b8-c20de16dc050",
  goalBarBack: "https://www.figma.com/api/mcp/asset/77a9b6f1-1610-4626-be52-8113a0e992e2",
  goalBarFill: "https://www.figma.com/api/mcp/asset/9294899d-ce24-4cf5-9148-f8e42b03af54",
  mechMask: "https://www.figma.com/api/mcp/asset/04658129-929f-4ca6-bc08-f997bfaa2fdc",
  mechFill: "https://www.figma.com/api/mcp/asset/d6bb944f-860f-42d2-b858-35b51f98d64c",
  mechExpBack: "https://www.figma.com/api/mcp/asset/0418f140-1059-4b0e-b580-7fee5622eca1",
  mechExpFill: "https://www.figma.com/api/mcp/asset/afb9ed62-a2a8-4ebb-91fc-1d03cf6477ca",
  changeBar: "https://www.figma.com/api/mcp/asset/827f0c37-6b3a-45da-9e12-923cf33d4439",
  changeIconBack: "https://www.figma.com/api/mcp/asset/155ed203-17e2-49be-8b27-427579186270",
  changeIconFront: "https://www.figma.com/api/mcp/asset/48974523-a639-4fa7-88ae-12be795512a4",
  speedometerMask: "https://www.figma.com/api/mcp/asset/eaf99a12-5446-4b13-ad78-18e368be868a",
  speedometerFill: "https://www.figma.com/api/mcp/asset/98cb9859-b1f7-491c-9711-e8fa35503875",
  speedometerNeedle: "https://www.figma.com/api/mcp/asset/cb9183c2-cc1b-43b7-9317-54c471ac5ee2",
  distanceMask: "https://www.figma.com/api/mcp/asset/8e011011-e139-4e65-b615-3173ea177fef",
  distanceFill: "https://www.figma.com/api/mcp/asset/59469577-b775-4db3-ae84-44d06d25423f",
  rewardSync: "https://www.figma.com/api/mcp/asset/cb253434-45a2-4c56-b143-3593dc152c7c",
  rewardHolos: "https://www.figma.com/api/mcp/asset/e87ab23b-53b4-4216-a42b-1343ee13c09b",
  rewardExp: "https://www.figma.com/api/mcp/asset/c10c327f-c413-4014-b717-f6bb20f393d5",
  bottomElement: "https://www.figma.com/api/mcp/asset/ac2a164b-ab1e-4fd9-8be3-6b504c8deb02",
  goButton: "https://www.figma.com/api/mcp/asset/89cab978-7481-43a5-9948-2d650f721f30",
};

function AbilityChip({
  background,
  detail,
  x,
  labelX,
}: {
  background: string;
  detail: string;
  x: number;
  labelX: number;
}) {
  return (
    <>
      <SvgImage href={background} x={x} y={2152} width={330} height={346} />
      <SvgImage href={detail} x={x + 20} y={2168} width={292} height={285} />
      <text
        x={labelX}
        y={2450.38}
        fill="#fbedda"
        fontFamily="Inter, sans-serif"
        fontSize="51.271"
        fontWeight="700"
        dominantBaseline="middle"
      >
        Lv 17
      </text>
    </>
  );
}

function HomeScreen({ onOpenFitness }: { onOpenFitness: () => void }) {
  return (
    <svg
      className="figma-svg"
      viewBox={`0 0 ${ARTBOARD_WIDTH} ${ARTBOARD_HEIGHT}`}
      aria-label="Holobots home screen"
      role="img"
    >
      <defs>
        <mask id="home-mech-card-mask" maskUnits="userSpaceOnUse" x="110.2" y="1594.375" width="704.418" height="347.163">
          <SvgImage href={homeAssets.mechCardMask} x={110.2} y={1594.375} width={704.418} height={347.163} />
        </mask>
      </defs>

      <SvgImage href={homeAssets.backgroundBase} x={0} y={0} width={1800} height={3200} />
      <SvgImage href={homeAssets.backgroundDetail} x={0} y={0} width={1800} height={3200} />

      <SvgImage href={homeAssets.topBackground} x={0} y={100} width={1800} height={409} />
      <text x={126} y={228} fill="#fef1e0" fontFamily="'Exo 2', sans-serif" fontSize="114" fontStyle="italic" fontWeight="900">
        HOLOBOTS
      </text>

      <SvgImage href={homeAssets.attributeChartBase} x={0} y={628} width={825} height={971} />
      <SvgImage href={homeAssets.attributeChartLine5} x={197.13} y={1044.5} width={231.994} height={172.255} />
      <SvgImage href={homeAssets.attributeChartLine4} x={428.14} y={774.87} width={57.474} height={272.753} />
      <SvgImage href={homeAssets.attributeChartLine3} x={194.64} y={879.49} width={235.726} height={168.518} />
      <SvgImage href={homeAssets.attributeChartOutline2} x={197.48} y={773.75} width={465} height={547.5} />
      <SvgImage href={homeAssets.attributeChartOutline} x={278.13} y={868.71} width={303.711} height={357.578} />
      <SvgImage href={homeAssets.attributeChartLine1} x={426.89} y={1046.12} width={62.472} height={284.014} />
      <SvgImage href={homeAssets.attributeChartLine2} x={427.49} y={1044.38} width={232.52} height={5} />
      <rect x={293} y={872} width={205} height={351} fill="none" stroke="#fa0606" strokeWidth={5} opacity={0.75} />
      <SvgImage href={homeAssets.attributeChartRadar} x={293} y={872} width={205} height={351} />
      <text x={109} y={851.18} fill="#fbdb01" fontFamily="Inter, sans-serif" fontSize="39.388" fontWeight="700" dominantBaseline="middle">HP</text>
      <text x={468} y={724.18} fill="#fbdb01" fontFamily="Inter, sans-serif" fontSize="40.69" fontWeight="700" dominantBaseline="middle">ATK</text>
      <text x={698} y={1068.95} fill="#fbdb01" fontFamily="Inter, sans-serif" fontSize="47.259" fontWeight="700" dominantBaseline="middle">DEF</text>
      <text x={409} y={1377.25} fill="#fbdb01" fontFamily="Inter, sans-serif" fontSize="41.667" fontWeight="700" dominantBaseline="middle">SPECIAL</text>
      <text x={26} y={1219.25} fill="#fbdb01" fontFamily="Inter, sans-serif" fontSize="41.667" fontWeight="700" dominantBaseline="middle">SPEED</text>

      <image href={homeAssets.mechCardFill} x={110.2} y={1594.375} width={704.418} height={347.163} preserveAspectRatio="none" mask="url(#home-mech-card-mask)" />
      <text x={153} y={1662} fill="#ffffff" fontFamily="Inter, sans-serif" fontSize="49.915" dominantBaseline="middle">MEcha No001</text>
      <SvgImage href={homeAssets.expBarTotal} x={140.48} y={1771.99} width={460.193} height={22.202} />
      <SvgImage href={homeAssets.expBarProgress} x={140.48} y={1771.99} width={326.979} height={22.202} />
      <text x={153} y={1742} fill="#ffffff" fontFamily="Inter, sans-serif" fontSize="24.794" fontWeight="700" dominantBaseline="middle">EXP 600/1200</text>
      <text x={141} y={1863.3} fill="#ffffff" fontFamily="Inter, sans-serif" fontSize="100.722" dominantBaseline="middle">Lv 14</text>

      <SvgImage href={homeAssets.changeBar} x={815} y={1833.75} width={862.5} height={112.5} />
      <SvgImage href={homeAssets.changeIconBack} x={1511} y={1755} width={168} height={159} />
      <SvgImage href={homeAssets.changeIconFront} x={1491} y={1735} width={218} height={211} />
      <text x={948} y={1896.25} fill="#e9dfc5" fontFamily="Inter, sans-serif" fontSize="61.523" fontWeight="700" dominantBaseline="middle">CHANGE MECHA</text>

      <AbilityChip background={homeAssets.abilityChipBackground1} detail={homeAssets.abilityChipDetail1} x={80} labelX={182} />
      <AbilityChip background={homeAssets.abilityChipBackground1} detail={homeAssets.abilityChipDetail1} x={490} labelX={592} />
      <AbilityChip background={homeAssets.abilityChipBackground3} detail={homeAssets.abilityChipDetail3} x={891} labelX={993} />

      <SvgImage href={homeAssets.bottomBackground} x={0} y={2375} width={1800} height={857} />
      <SvgImage href={homeAssets.marketplaceIcon} x={137} y={2700} width={371} height={347} />
      <SvgImage href={homeAssets.inventoryIcon} x={886} y={2715} width={388} height={364} />
      <SvgImage href={homeAssets.arenaIcon} x={1103} y={2705} width={586} height={339} />
      <text x={111} y={3104.75} fill="#ffffff" fontFamily="Bungee, sans-serif" fontSize="53.143" dominantBaseline="middle">
        MARKETPLACE
      </text>

      <foreignObject x={588} y={2705} width={275} height={318}>
        <button
          type="button"
          onClick={onOpenFitness}
          className="nav-hotspot"
          aria-label="Open Sync fitness page"
        >
          <img src={homeAssets.syncIcon} alt="" />
        </button>
      </foreignObject>
    </svg>
  );
}

function FitnessScreen({ onBack }: { onBack: () => void }) {
  return (
    <svg
      className="figma-svg"
      viewBox={`0 0 ${ARTBOARD_WIDTH} ${ARTBOARD_HEIGHT}`}
      aria-label="Holobots fitness screen"
      role="img"
    >
      <defs>
        <mask id="goal-mask" maskUnits="userSpaceOnUse" x="35" y="537" width="914" height="267">
          <SvgImage href={fitnessAssets.goalMask} x={35} y={537} width={914} height={267} />
        </mask>
        <mask id="fitness-mech-mask" maskUnits="userSpaceOnUse" x="40.2" y="850.63" width="704.418" height="347.163">
          <SvgImage href={fitnessAssets.mechMask} x={40.2} y={850.63} width={704.418} height={347.163} />
        </mask>
        <mask id="speedometer-mask" maskUnits="userSpaceOnUse" x="406" y="1265" width="954" height="954">
          <SvgImage href={fitnessAssets.speedometerMask} x={406} y={1265} width={954} height={954} />
        </mask>
        <mask id="distance-mask" maskUnits="userSpaceOnUse" x="92" y="1915" width="1639" height="385">
          <SvgImage href={fitnessAssets.distanceMask} x={92} y={1915} width={1639} height={385} />
        </mask>
      </defs>

      <SvgImage href={fitnessAssets.backgroundBase} x={0} y={0} width={1800} height={3200} />
      <SvgImage href={fitnessAssets.backgroundDesign} x={0} y={0} width={1800} height={3200} />

      <SvgImage href={fitnessAssets.syncPointBar} x={0} y={101} width={1747} height={237} />
      <SvgImage href={fitnessAssets.syncPointAccent} x={0} y={337} width={892} height={166} />
      <text x={193} y={198.04} fill="#e9dfc5" fontFamily="Inter, sans-serif" fontSize="106.012" fontWeight="700" dominantBaseline="middle">SYNC POINT</text>
      <text x={315} y={418.99} fill="#e83a2a" fontFamily="Inter, sans-serif" fontSize="105.805" fontWeight="700" dominantBaseline="middle">+135</text>

      <image href={fitnessAssets.goalFill} x={35} y={537} width={914} height={267} preserveAspectRatio="none" mask="url(#goal-mask)" />
      <SvgImage href={fitnessAssets.goalBarBack} x={0} y={0} width={1800} height={3200} />
      <SvgImage href={fitnessAssets.goalBarFill} x={90} y={686.25} width={698.125} height={80} />
      <text x={103} y={623} fill="#fff7f7" fontFamily="'Jersey 25', sans-serif" fontSize="128" dominantBaseline="middle">Time: 12/20</text>

      <image href={fitnessAssets.mechFill} x={40.2} y={850.63} width={704.418} height={347.163} preserveAspectRatio="none" mask="url(#fitness-mech-mask)" />
      <text x={72} y={921.5} fill="#ffffff" fontFamily="Inter, sans-serif" fontSize="49.915" dominantBaseline="middle">MEcha No001</text>
      <SvgImage href={fitnessAssets.mechExpBack} x={70.48} y={1028.24} width={460.193} height={22.202} />
      <SvgImage href={fitnessAssets.mechExpFill} x={70.01} y={1027.99} width={459.97} height={22.015} />
      <text x={89} y={1009} fill="#ffffff" fontFamily="Inter, sans-serif" fontSize="24.794" fontWeight="700" dominantBaseline="middle">EXP 600/1200</text>
      <text x={71} y={1119.3} fill="#ffffff" fontFamily="Inter, sans-serif" fontSize="100.722" dominantBaseline="middle">Lv 14</text>

      <SvgImage href={fitnessAssets.changeBar} x={837.5} y={1091.25} width={862.5} height={112.5} />
      <SvgImage href={fitnessAssets.changeIconBack} x={1533} y={1012} width={169} height={160} />
      <SvgImage href={fitnessAssets.changeIconFront} x={1514} y={993} width={218} height={211} />
      <text x={970} y={1153.25} fill="#e9dfc5" fontFamily="Inter, sans-serif" fontSize="61.523" fontWeight="700" dominantBaseline="middle">CHANGE MECHA</text>

      <image href={fitnessAssets.speedometerFill} x={406} y={1265} width={954} height={954} preserveAspectRatio="none" mask="url(#speedometer-mask)" />
      <SvgImage href={fitnessAssets.speedometerNeedle} x={811} y={1621} width={366} height={211} />
      <text x={729} y={1540.12} fill="#e9dfc5" fontFamily="Inter, sans-serif" fontSize="89.466" fontWeight="700" dominantBaseline="middle">9 km/h</text>
      <text x={729} y={1608} fill="#e9dfc5" fontFamily="Inter, sans-serif" fontSize="37.004" fontWeight="700" dominantBaseline="middle">Movement speed</text>

      <image href={fitnessAssets.distanceFill} x={92} y={1915} width={1639} height={385} preserveAspectRatio="none" mask="url(#distance-mask)" />
      <text x={788} y={2074.31} fill="#e9dfc5" fontFamily="Inter, sans-serif" fontSize="121.544" dominantBaseline="middle">0.900</text>
      <text x={793} y={2180.08} fill="#e9dfc5" fontFamily="Inter, sans-serif" fontSize="45.702" dominantBaseline="middle">Kilometers</text>

      <SvgImage href={fitnessAssets.bottomElement} x={0} y={2208} width={1800} height={992} />
      <SvgImage href={fitnessAssets.rewardSync} x={244} y={2429} width={116} height={131} />
      <SvgImage href={fitnessAssets.rewardHolos} x={740} y={2433} width={109} height={110} />
      <SvgImage href={fitnessAssets.rewardExp} x={1196} y={2433} width={119} height={118} />
      <text x={410} y={2494} fill="#e9dfc5" fontFamily="Inter, sans-serif" fontSize="96.929" fontWeight="700" dominantBaseline="middle">+135</text>
      <text x={882} y={2494} fill="#e9dfc5" fontFamily="Inter, sans-serif" fontSize="95.215" fontWeight="700" dominantBaseline="middle">+10</text>
      <text x={1353} y={2493.96} fill="#e9dfc5" fontFamily="Inter, sans-serif" fontSize="91.406" fontWeight="700" dominantBaseline="middle">+250</text>

      <SvgImage href={fitnessAssets.goButton} x={20} y={2606} width={1695} height={446} />
      <text x={740} y={2826.5} fill="#eeb818" fontFamily="Inter, sans-serif" fontSize="204.86" fontWeight="700" dominantBaseline="middle">GO</text>

      <foreignObject x={36} y={34} width={240} height={90}>
        <button type="button" onClick={onBack} className="back-hotspot" aria-label="Back to home">
          Back
        </button>
      </foreignObject>
    </svg>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>("home");

  return (
    <main className="figma-page" aria-label="Holobots app preview">
      <section className="figma-frame">
        {screen === "home" ? (
          <HomeScreen onOpenFitness={() => setScreen("fitness")} />
        ) : (
          <FitnessScreen onBack={() => setScreen("home")} />
        )}
      </section>
    </main>
  );
}
