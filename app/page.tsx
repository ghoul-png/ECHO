"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Database, GitBranch, History, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { NeuralBackdrop } from "../components/neural-backdrop";
import { MemoryGraph } from "../components/memory-graph";
import { DecisionTimeline } from "../components/decision-timeline";
import { MemoryAudit } from "../components/memory-audit";
import type { Memory } from "../lib/types";

type Scene = "boot" | "init" | "reveal" | "paths" | "graph" | "timeline" | "ask" | "add" | "audit" | "app";
type ChatMessage = { role: "user" | "echo"; text: string; learned?: boolean };

const demoSeed: Memory[] = [
  { id: "mem-react", user_id: "demo-user-01", project_id: "echo-demo", type: "decision", content: "Use React for the frontend.", topic: "frontend_framework", value: "React", reason: "Team familiarity at the start of the build.", status: "SUPERSEDED", confidence: .91, importance: .84, created_at: "2026-09-10T10:00:00Z", valid_from: "2026-09-10T10:00:00Z", valid_until: "2026-09-14T14:00:00Z", superseded_by: "mem-vue", change_reason: "Team reassessed frontend fit." },
  { id: "mem-vue", user_id: "demo-user-01", project_id: "echo-demo", type: "decision", content: "Use Vue for the frontend.", topic: "frontend_framework", value: "Vue", reason: "Better perceived developer experience after reassessment.", status: "ACTIVE", confidence: .96, importance: .9, created_at: "2026-09-14T15:20:00Z", valid_from: "2026-09-14T15:20:00Z" },
  { id: "mem-db", user_id: "demo-user-01", project_id: "echo-demo", type: "decision", content: "PostgreSQL is the project database.", topic: "database", value: "PostgreSQL", reason: "Team knows SQL and Supabase integration is fast.", status: "ACTIVE", confidence: .95, importance: .95, created_at: "2026-09-15T08:30:00Z", valid_from: "2026-09-15T08:30:00Z" },
  { id: "mem-constraint", user_id: "demo-user-01", project_id: "echo-demo", type: "constraint", content: "The team has a 24-hour hackathon build window.", topic: "build_window", value: "24 hours", reason: "Hackathon constraint.", status: "ACTIVE", confidence: .99, importance: .78, created_at: "2026-09-15T07:00:00Z", valid_from: "2026-09-15T07:00:00Z" },
];

export default function Home() {
  const [scene, setScene] = useState<Scene>("boot");
  const [progress, setProgress] = useState(0);
  const [memories, setMemories] = useState<Memory[]>(demoSeed);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(demoSeed[2]);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [askBusy, setAskBusy] = useState(false);
  const [learnPulse, setLearnPulse] = useState(false);
  const [newDecision, setNewDecision] = useState({ what: "", why: "", alternatives: "" });
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (scene !== "boot") return;
    const onKey = (event: KeyboardEvent) => { if (!event.metaKey && !event.ctrlKey && !event.altKey) setScene("init"); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [scene]);

  useEffect(() => {
    if (scene !== "init") return;
    setProgress(0); let value = 0;
    const timer = window.setInterval(() => { value += Math.round(3 + Math.random()*8); if (value >= 100) { value=100; clearInterval(timer); setTimeout(()=>setScene("reveal"),450); } setProgress(value); }, 120);
    return () => clearInterval(timer);
  }, [scene]);

  useEffect(() => {
    fetch("/api/memory?projectId=echo-demo", { cache: "no-store" }).then(r=>r.ok?r.json():null).then(payload=>{
      if (Array.isArray(payload?.memories) && payload.memories.length) { setMemories(payload.memories); setSelectedMemory(payload.memories.find((m:Memory)=>m.status === "ACTIVE") ?? payload.memories[0]); }
    }).catch(()=>{});
  }, []);

  const active = useMemo(() => memories.filter(m=>m.status === "ACTIVE"), [memories]);
  const recent = useMemo(() => [...memories].sort((a,b)=>+new Date(b.created_at)-+new Date(a.created_at)), [memories]);
  const go = (next: Scene) => { setToast(""); setScene(next); };

  const askEcho = async (preset?: string) => {
    const text=(preset??query).trim(); if(!text || askBusy)return;
    setAskBusy(true); setQuery(""); setMessages(prev=>[...prev,{role:"user",text}]);
    try {
      const response=await fetch("/api/ask",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:text,projectId:"echo-demo"})});
      const payload=await response.json(); if(!response.ok) throw new Error(payload.error||"ECHO could not answer.");
      setMessages(prev=>[...prev,{role:"echo",text:payload.answer||"I'm listening.",learned:Boolean(payload.memoryWrite?.createdMemory)}]);
      if(payload.memoryWrite?.createdMemory){const created=payload.memoryWrite.createdMemory as Memory;setMemories(prev=>[created,...prev.filter(m=>m.id!==created.id)]);setLearnPulse(true);setTimeout(()=>setLearnPulse(false),1100);}
      if(Array.isArray(payload.memories))setMemories(payload.memories);
    } catch(error){setMessages(prev=>[...prev,{role:"echo",text:error instanceof Error?error.message:"Something went wrong."}]);}
    finally{setAskBusy(false);}
  };

  const saveDecision = async () => {
    if(!newDecision.what.trim())return;
    try { const response=await fetch("/api/memory",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:"echo-demo",content:newDecision.what,reason:newDecision.why,alternatives:newDecision.alternatives})}); const payload=await response.json(); if(!response.ok)throw new Error(payload.error||"Could not store memory."); setMemories(payload.memories||memories); if(payload.createdMemory)setSelectedMemory(payload.createdMemory); setToast("The story has been updated."); setNewDecision({what:"",why:"",alternatives:""}); go("graph"); } catch(error){setToast(error instanceof Error?error.message:"Could not store memory.");}
  };

  const chatScene = <section className="scene ask-scene"><div className="chat-shell">
    <header className="chat-header"><button className="brand-button" onClick={()=>go("paths")}><span className="brand-mark">✦</span><span>ECHO</span></button><div className="chat-status"><i className="live-dot"/> MEMORY AWAKE</div><button className="icon-button" onClick={()=>go("paths")}><X size={17}/></button></header>
    <div className="chat-stage"><div className={`chat-orb ${learnPulse?"learned":""}`}><div className="orb-grid"/><div className="orb-core">E</div></div>
      <div className="chat-intro"><span className="micro">ECHO / CONVERSATION</span><h2>{messages.length?"Keep talking.":"Talk to me."}</h2><p>Your memories stay in the background. Conversation stays human.</p></div>
      <div className="chat-feed">
        {messages.length===0&&<div className="conversation-hint"><span>START NATURALLY</span><button onClick={()=>askEcho("Hi, I am Hriday.")}>“Hi, I am Hriday.”</button><button onClick={()=>askEcho("I have my PAT exam next week.")}>“I have my PAT exam next week.”</button><button onClick={()=>askEcho("Amogh is a good boy.")}>“Amogh is a good boy.”</button></div>}
        {messages.map((m,i)=><div key={i} className={`bubble-row ${m.role}`}><div className={`bubble ${m.role}`}>
          {m.role==="echo"&&<span className="bubble-label">ECHO</span>}<p>{m.text}</p>{m.learned&&<span className="learned-whisper"><span/> remembered quietly</span>}
        </div></div>)}
        {askBusy&&<div className="bubble-row echo"><div className="bubble echo typing"><span className="bubble-label">ECHO</span><div className="typing-dots"><i/><i/><i/></div></div></div>}
      </div>
      <div className="composer-wrap"><div className="composer"><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")askEcho();}} placeholder="Say something to ECHO…"/><button onClick={()=>askEcho()} disabled={askBusy||!query.trim()} aria-label="Send"><Send size={17}/></button></div><div className="composer-foot"><span>CONVERSATION MODE</span><span>MEMORY RUNS QUIETLY IN THE BACKGROUND</span></div></div>
    </div></div></section>;

  let content: ReactNode;
  switch(scene){
    case "boot": content=<section className="scene boot-scene"><div className="boot-arc arc-one"/><div className="boot-arc arc-two"/><div className="boot-top">PRESENTED BY</div><div className="dragon">DRAGON CHICKEN</div><div className="boot-side left">REMEMBER<br/>REASON<br/>EVOLVE</div><div className="boot-side right">NOT JUST<br/>MEMORY.<br/>INTELLIGENCE.</div><div className="boot-core"><div className="boot-eyebrow">MEMORY INTELLIGENCE / 01</div><h1 className="echo-word" data-text="ECHO">ECHO</h1><div className="tagline">THE ASSISTANT THAT NEVER FORGETS.<br/><span>OR DOES IT?</span></div><button className="pulse-button" onClick={()=>go("init")}><span>PRESS ANY KEY TO BEGIN</span><ArrowRight size={15}/></button></div><div className="corner-data">SYS // 7F-04<br/>MEMORY CORE READY</div></section>;break;
    case "init": content=<section className="scene init-scene" onClick={()=>progress>70&&go("reveal")}><div className="memory-vortex"><div/><div/><div/><div/><span/></div><div className="init-copy"><div>INITIALIZING YOUR MEMORY...</div><div className="progress-row"><span>00</span><div className="progress-track"><div className="progress-fill" style={{width:`${progress}%`}}/></div><span>{progress}%</span></div><small>BUILDING THE MEMORY FIELD</small></div></section>;break;
    case "reveal": content=<section className="scene reveal-scene"><div className="reveal-copy left"><div className="micro">MEMORY ENGINE ONLINE</div><h2>EVERY DECISION<br/><span>BUILDS A STORY.</span></h2></div><div className="reveal-copy right"><p>AND EVERY<br/>STORY BUILDS<br/><span>A BETTER</span><br/><span>YOU.</span></p></div><div className="fracture"><div className="fracture-core"/><div className="fracture-line l1"/><div className="fracture-line l2"/><div className="fracture-line l3"/><div className="fracture-ring"/></div><button className="explore-ring" onClick={()=>go("paths")}><span>EXPLORE</span><ArrowRight size={17}/></button></section>;break;
    case "paths": content=<section className="scene paths-scene"><div className="section-label">CHOOSE YOUR PATH</div><div className="path-grid"><button className="path-card" onClick={()=>go("timeline")}><GitBranch/><span>VIEW DECISIONS</span><small>See what changed — and why.</small><i><ArrowRight/></i></button><button className="path-card featured" onClick={()=>go("graph")}><Database/><span>EXPLORE<br/>MEMORY GRAPH</span><small>Dive into the web of your decisions.</small><i><ArrowRight/></i></button><button className="path-card" onClick={()=>go("ask")}><Sparkles/><span>ASK<br/>ECHO</span><small>Get answers from your past.</small><i><ArrowRight/></i></button></div><div className="path-footer"><button onClick={()=>go("add")} className="text-link">+ ADD MEMORY</button><button onClick={()=>go("audit")} className="text-link">MEMORY AUDIT</button><button onClick={()=>go("app")} className="text-link">OPEN CORE →</button></div></section>;break;
    case "graph": content=<section className="scene graph-scene"><div className="app-header"><div className="brand-mini"><span className="brand-mark">✦</span>ECHO</div><div>MEMORY GRAPH <span className="live">LIVE</span></div><button onClick={()=>go("paths")}><X size={18}/></button></div><div className="graph-layout"><MemoryGraph memories={memories} selected={selectedMemory} onSelect={setSelectedMemory}/><aside className="inspector">{selectedMemory?<><div className="inspector-kicker">MEMORY / {selectedMemory.id.slice(-6)}</div><h3>{selectedMemory.value||selectedMemory.content}</h3><div className={`status ${selectedMemory.status.toLowerCase()}`}>{selectedMemory.status}</div><dl><div><dt>TYPE</dt><dd>{selectedMemory.type}</dd></div><div><dt>CREATED</dt><dd>{new Date(selectedMemory.created_at).toLocaleDateString()}</dd></div><div><dt>CONFIDENCE</dt><dd>{Math.round(selectedMemory.confidence*100)}%</dd></div></dl><div className="reason-block"><span>WHY IT MATTERS</span><p>{selectedMemory.reason||"A useful piece of the user's story."}</p></div>{selectedMemory.status==="SUPERSEDED"&&<div className="superseded-box">REPLACED BY <b>{selectedMemory.superseded_by}</b><br/><small>{selectedMemory.change_reason}</small></div>}<button className="outline-btn" onClick={()=>go("timeline")}>VIEW EVOLUTION <ArrowRight size={15}/></button></>:<div className="empty-state">Select a node.</div>}</aside></div></section>;break;
    case "timeline": content=<section className="scene timeline-scene"><div className="app-header"><div>DECISION EVOLUTION</div><button onClick={()=>go("paths")}><X size={18}/></button></div><div className="timeline-intro"><span className="micro">MEMORY / CHANGE OVER TIME</span><h2>What changed.<br/><span>And why.</span></h2></div><DecisionTimeline memories={memories} onSelect={m=>{setSelectedMemory(m);go("graph")}}/><div className="timeline-actions"><button className="outline-btn" onClick={()=>go("add")}>ADD MEMORY</button><button className="primary-btn" onClick={()=>go("ask")}>ASK ABOUT THIS <ArrowRight size={15}/></button></div></section>;break;
    case "ask": content=chatScene;break;
    case "add": content=<section className="scene add-scene"><div className="add-modal"><button className="close-mini" onClick={()=>go("paths")}><X size={18}/></button><div className="section-label">FEED THE MEMORY CORE</div><h2>ADD A MEMORY</h2><p>Capture something worth carrying forward. ECHO will connect it to the story already there.</p><label>WHAT SHOULD ECHO REMEMBER?<input value={newDecision.what} onChange={e=>setNewDecision({...newDecision,what:e.target.value})} placeholder="e.g. We switched the frontend to Vue."/></label><label>WHY? <span>(OPTIONAL)</span><textarea value={newDecision.why} onChange={e=>setNewDecision({...newDecision,why:e.target.value})} placeholder="e.g. Better developer experience."/></label><label>ALTERNATIVES <span>(OPTIONAL)</span><input value={newDecision.alternatives} onChange={e=>setNewDecision({...newDecision,alternatives:e.target.value})} placeholder="e.g. React, Angular"/></label><button className="save-button" onClick={saveDecision}>ADD TO STORY <ArrowRight size={16}/></button>{toast&&<div className="toast">{toast}</div>}</div></section>;break;
    case "audit": content=<section className="scene audit-scene"><div className="app-header"><div>MEMORY AUDIT</div><button onClick={()=>go("paths")}><X size={18}/></button></div><MemoryAudit memories={memories}/></section>;break;
    default: content=<section className="scene app-scene"><aside className="side-rail"><div className="brand-mini"><span className="brand-mark">✦</span>ECHO</div><button className="active">HOME</button><button onClick={()=>go("graph")}>MEMORY GRAPH</button><button onClick={()=>go("timeline")}>EVOLUTION</button><button onClick={()=>go("ask")}>ASK ECHO</button><button onClick={()=>go("audit")}>AUDIT</button><div className="rail-bottom">DEMO USER<br/><b>HRIDAY</b></div></aside><main className="dashboard"><div className="dash-top">PROJECT MEMORY <span>ACTIVE / {active.length}</span></div><h1>Your decisions.<br/><strong>Remembered.</strong></h1><p className="dash-sub">Not just what you chose, but why you chose it — and how your thinking evolved.</p><div className="stats"><div><span>MEMORIES</span><b>{memories.length}</b></div><div><span>ACTIVE</span><b>{active.length}</b></div><div><span>SUPERSEDED</span><b>{memories.filter(m=>m.status==='SUPERSEDED').length}</b></div><div><span>MEMORY ENGINE</span><b>ON</b></div></div><div className="dash-panels"><div className="panel"><div className="panel-head">RECENT MEMORY <button onClick={()=>go("graph")}>VIEW ALL →</button></div>{recent.slice(0,5).map(m=><button key={m.id} onClick={()=>{setSelectedMemory(m);go("graph")}} className="recent-row"><span className="node-mini"/><div><b>{m.value||m.content}</b><small>{m.type.toUpperCase()} · {m.status}</small></div></button>)}</div><div className="panel panel-core" onClick={()=>go("graph")}><div className="core-visual"><div className="core-ring"/><div className="core-ring two"/><div className="core-ring three"/><div className="core-center">ECHO</div></div><span>OPEN MEMORY CORE</span></div></div></main></section>;
  }
  return <main className="echo-shell"><NeuralBackdrop scene={scene}/>{content}<div className="noise"/><div className="hud-corner tl">ECHO // MEMORY INTELLIGENCE</div><div className="hud-corner br">{scene.toUpperCase()} // 2026</div></main>;
}
