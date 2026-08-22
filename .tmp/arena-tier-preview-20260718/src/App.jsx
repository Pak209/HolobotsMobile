import { useState } from "react";

const tiers = [
  { id: "rookie", name: ["ROOKIE", "CIRCUIT"], level: 12, fee: 50, accent: "#58ef2a" },
  { id: "challenger", name: ["CHALLENGER", "RING"], level: 24, fee: 100, accent: "#20bfff" },
  { id: "elite", name: ["ELITE", "GAUNTLET"], level: 36, fee: 150, accent: "#b34cff" },
  { id: "legend", name: ["LEGEND", "ARENA"], level: 45, fee: 225, accent: "#ffc21c" },
];

function TierOutline({ accent, selected }) {
  return (
    <svg aria-hidden="true" className="tier-outline" preserveAspectRatio="none" viewBox="0 0 176 84">
      <path
        d="M12 2 H162 L174 14 V69 L161 82 H12 L2 72 V14 Z"
        fill="#05080a"
        stroke={accent}
        strokeLinejoin="miter"
        strokeWidth={selected ? 3.5 : 2.5}
      />
      <path
        d="M15 7 H157 L168 18 V35 M168 49 V66 L157 77 H119 M70 77 H16 L8 69 V50 M8 34 V17 L17 8"
        fill="none"
        stroke={accent}
        strokeOpacity={selected ? 0.76 : 0.38}
      />
      <path
        d="M13 2 H43 L37 8 H18 L8 18 V32 M143 2 H161 L174 15 V29"
        fill="none"
        stroke={accent}
        strokeWidth={selected ? 4 : 3}
      />
      <path
        d="M2 57 V71 L12 82 H32 M136 82 H161 L174 69 V55"
        fill="none"
        stroke={accent}
        strokeOpacity=".9"
        strokeWidth="2"
      />
      <path
        d="M18 12 H66 M71 12 H92 M114 72 H143 M148 72 H159"
        fill="none"
        stroke={accent}
        strokeOpacity=".34"
      />
      <path
        d="M19 78 H31 L38 72 H50 M130 78 H141 L148 72 H160"
        fill="none"
        stroke={accent}
        strokeOpacity={selected ? 1 : 0.62}
        strokeWidth="2.5"
      />
      {selected ? (
        <path
          d="M16 5 H159 L171 17 V68 L158 79 H15 L5 69 V16 Z"
          fill="none"
          stroke={accent}
          strokeOpacity=".22"
          strokeWidth="5"
        />
      ) : null}
    </svg>
  );
}

function ArenaTierCard({ tier, selected, onSelect }) {
  return (
    <button
      aria-pressed={selected}
      className={`tier-card ${selected ? "is-selected" : ""}`}
      data-tier={tier.id}
      onClick={onSelect}
      style={{ "--accent": tier.accent }}
      type="button"
    >
      <TierOutline accent={tier.accent} selected={selected} />
      <img alt="" className="tier-icon" src={`/arena-tiers/${tier.id}-tier.png`} />
      <span className="tier-copy">
        <strong className="tier-name">
          {tier.name[0]}
          <br />
          {tier.name[1]}
        </strong>
        <span className="tier-level">LV {tier.level}</span>
        <span className="tier-fee">{tier.fee} Holos</span>
      </span>
    </button>
  );
}

export function App() {
  const [selectedTier, setSelectedTier] = useState("rookie");

  return (
    <main className="mobile-prototype">
      <section className="arena-panel">
        <div className="section-heading">
          <span>ARENA TIERS</span>
          <span className="section-rule" />
        </div>
        <div className="tier-grid">
          {tiers.map((tier) => (
            <ArenaTierCard
              key={tier.id}
              onSelect={() => setSelectedTier(tier.id)}
              selected={selectedTier === tier.id}
              tier={tier}
            />
          ))}
        </div>
        <p className="preview-note">TAP A TIER TO PREVIEW SELECTION</p>
      </section>
    </main>
  );
}
