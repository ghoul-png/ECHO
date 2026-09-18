"use client";
import type { Memory } from "../lib/types";

export function DecisionTimeline({ memories, onSelect }: { memories: Memory[]; onSelect: (m: Memory)=>void }) {
  const ordered = [...memories].sort((a,b)=>+new Date(a.created_at)-+new Date(b.created_at));
  return <div className="timeline-list">{ordered.map((m,i)=><button key={m.id} className="timeline-row" onClick={()=>onSelect(m)}><div className={`timeline-node ${m.status.toLowerCase()}`}><span/></div><div className="timeline-date">{new Date(m.created_at).toLocaleDateString([], {month:"short", day:"2-digit"})}</div><div className="timeline-main"><strong>{m.value || m.content}</strong><small>Reason: {m.reason || "Memory captured from conversation."}</small></div><div className={`timeline-pill ${m.status.toLowerCase()}`}>{m.status}</div>{i < ordered.length-1 && <div className="timeline-line"/>}</button>)}</div>
}
