import type { Memory } from "../lib/types";

export function MemoryAudit({ memories }: { memories: Memory[] }) {
  const active = memories.filter(m=>m.status==='ACTIVE').length;
  const superseded = memories.filter(m=>m.status==='SUPERSEDED').length;
  const expired = memories.filter(m=>m.status==='EXPIRED').length;
  const invalid = memories.filter(m=>m.status==='INVALIDATED').length;
  return <div className="audit-wrap"><div className="audit-hero"><div><div className="micro">ECHO MEMORY ENGINE</div><h2>What ECHO knows — and what it changed.</h2></div><div className="audit-spark">MEMORY CORE<br/><span>ONLINE</span></div></div><div className="audit-stats"><div><span>MEMORIES</span><b>{memories.length}</b></div><div><span>ACTIVE</span><b>{active}</b></div><div><span>SUPERSEDED</span><b>{superseded}</b></div><div><span>EXPIRED</span><b>{expired}</b></div><div><span>INVALIDATED</span><b>{invalid}</b></div></div><div className="audit-log"><div className="panel-head">RECENT MEMORY OPERATIONS</div>{[...memories].sort((a,b)=>+new Date(b.created_at)-+new Date(a.created_at)).slice(0,7).map(m=><div className="audit-row" key={m.id}><span className="audit-time">{new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span><strong>{m.status === 'SUPERSEDED' ? 'MEMORY SUPERSEDED' : 'MEMORY ACTIVE'}</strong><span>{m.content}</span><small>{m.id}</small></div>)}</div></div>
}
