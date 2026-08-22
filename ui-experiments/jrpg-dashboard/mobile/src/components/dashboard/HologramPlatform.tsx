import { Ellipse, G, Line, Path } from "@/components/FigmaSvg";

type HologramPlatformProps = {
  centerX: number;
  centerY: number;
};

export function HologramPlatform({ centerX, centerY }: HologramPlatformProps) {
  const radialLines = Array.from({ length: 12 }, (_, index) => {
    const angle = (index * Math.PI) / 6;
    const innerX = centerX + Math.cos(angle) * 128;
    const innerY = centerY + Math.sin(angle) * 28;
    const outerX = centerX + Math.cos(angle) * 345;
    const outerY = centerY + Math.sin(angle) * 94;

    return <Line key={index} x1={innerX} y1={innerY} x2={outerX} y2={outerY} stroke="#ff8a00" strokeWidth={3} opacity={0.22} />;
  });

  return (
    <G opacity={0.96}>
      <Ellipse cx={centerX} cy={centerY + 8} rx={420} ry={120} fill="#471300" fillOpacity={0.2} />
      {radialLines}
      <Ellipse cx={centerX} cy={centerY} rx={350} ry={96} fill="none" stroke="#ff6a00" strokeWidth={34} opacity={0.1} />
      <Ellipse cx={centerX} cy={centerY} rx={350} ry={96} fill="none" stroke="#ff8a00" strokeWidth={16} strokeDasharray="150 22 46 18" />
      <Ellipse cx={centerX} cy={centerY} rx={302} ry={78} fill="#ff7100" fillOpacity={0.11} stroke="#ffd026" strokeWidth={28} opacity={0.22} />
      <Ellipse cx={centerX} cy={centerY} rx={302} ry={78} fill="none" stroke="#ffd026" strokeWidth={10} strokeDasharray="170 16 54 20" />
      <Ellipse cx={centerX} cy={centerY} rx={246} ry={58} fill="#ff9a00" fillOpacity={0.1} stroke="#ff7a00" strokeWidth={6} />
      <Ellipse cx={centerX} cy={centerY} rx={168} ry={35} fill="#ffd43b" fillOpacity={0.14} stroke="#ffe16a" strokeWidth={5} strokeDasharray="78 12" />
      <Path d={`M ${centerX - 300} ${centerY + 49} H ${centerX - 216} L ${centerX - 192} ${centerY + 66} H ${centerX - 88}`} fill="none" stroke="#ff9b00" strokeWidth={5} />
      <Path d={`M ${centerX + 84} ${centerY - 65} H ${centerX + 194} L ${centerX + 222} ${centerY - 49} H ${centerX + 316}`} fill="none" stroke="#ffb000" strokeWidth={5} />
      <Line x1={centerX - 338} y1={centerY} x2={centerX + 338} y2={centerY} stroke="#ffad00" strokeWidth={4} opacity={0.5} />
      <Line x1={centerX} y1={centerY - 88} x2={centerX} y2={centerY + 88} stroke="#ff8a00" strokeWidth={4} opacity={0.38} />
      <Ellipse cx={centerX} cy={centerY} rx={92} ry={18} fill="#fff08a" fillOpacity={0.22} />
    </G>
  );
}
