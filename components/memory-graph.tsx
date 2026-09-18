"use client";
import type { Memory } from "../lib/types";

function shortLabel(m: Memory) {
  if (m.topic === "identity") return m.value || "Identity";
  if (m.value && m.value.length < 24) return m.value;
  return m.content.replace(/\.$/, "").slice(0, 22) + (m.content.length > 22 ? "…" : "");
}

export function MemoryGraph({ memories, selected, onSelect }: { memories: Memory[]; selected: Memory | null; onSelect: (m: Memory)=>void }) {
  const width = 900, height = 570, cx = 360, cy = 285;
  const visible = memories.slice(0, 9);
  const activeCenter = visible.find(m => m.status === "ACTIVE") ?? visible[0];
  const center = activeCenter;
  const others = visible.filter(m => m.id !== center?.id);
  const positions = others.map((m, i) => {
    const angle = -Math.PI / 2 + (i / Math.max(1, others.length)) * Math.PI * 2;
    const radius = i % 2 === 0 ? 178 : 215;
    return { m, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius * 0.82 };
  });
  const all = center ? [{m:center,x:cx,y:cy,center:true}, ...positions.map(p=>({...p,center:false}))] : [];

  return <div className="memory-graph">
    <div className="graph-meta"><span>LIVE MEMORY FIELD</span><span>{visible.length} NODES / {memories.filter(m=>m.status === "ACTIVE").length} ACTIVE</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Interactive memory graph">
      <defs>
        <filter id="memory-glow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <radialGradient id="core-fill"><stop offset="0" stopColor="rgba(168,255,62,.28)"/><stop offset="1" stopColor="rgba(168,255,62,0)"/></radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r="125" className="graph-aura"/>
      {center && positions.map(({m,x,y}) => {
        const superseded = m.status !== "ACTIVE";
        return <g key={`edge-${m.id}`}>
          <line x1={cx} y1={cy} x2={x} y2={y} className={`graph-edge ${superseded ? "is-old" : ""}`} />
          <circle cx={(cx+x)/2} cy={(cy+y)/2} r="2.2" className="edge-pulse" />
          <text x={(cx+x)/2} y={(cy+y)/2-8} className="edge-caption">{superseded ? "HISTORY" : "RELATES"}</text>
        </g>
      })}
      {all.map(({m,x,y,center: isCenter}) => {
        const active = m.status === "ACTIVE";
        const chosen = selected?.id === m.id;
        return <g key={m.id} onClick={()=>onSelect(m)} className={`memory-node ${chosen ? "chosen" : ""} ${active ? "active" : "old"}`}>
          {isCenter && <circle cx={x} cy={y} r="72" className="core-halo"/>}
          <circle cx={x} cy={y} r={isCenter ? 50 : 34} className="node-orbit" />
          <circle cx={x} cy={y} r={isCenter ? 15 : 8} className="node-light" filter={chosen ? "url(#memory-glow)" : undefined}/>
          <text x={x} y={y + (isCenter ? 77 : 57)} textAnchor="middle" className="node-title">{shortLabel(m)}</text>
          <text x={x} y={y + (isCenter ? 92 : 71)} textAnchor="middle" className="node-state">{m.status}</text>
        </g>;
      })}
    </svg>
    <div className="graph-legend"><span><i className="legend-dot active"/> ACTIVE</span><span><i className="legend-dot old"/> HISTORY</span><span><i className="legend-line"/> RELATION</span><span className="legend-hint">CLICK A NODE TO INSPECT</span></div>
  </div>;
}
