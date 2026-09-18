"use client";

import { useEffect, useRef } from "react";

export function NeuralBackdrop({ scene }: { scene: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let w = 0, h = 0;
    const particles = Array.from({ length: 110 }, (_, i) => ({
      x: Math.random(), y: Math.random(), z: Math.random(), a: 0.2 + Math.random() * 0.8, s: 0.15 + Math.random() * 0.8, p: i * 0.13
    }));
    const resize = () => { w = canvas.width = window.innerWidth * devicePixelRatio; h = canvas.height = window.innerHeight * devicePixelRatio; canvas.style.width = "100%"; canvas.style.height = "100%"; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); w /= devicePixelRatio; h /= devicePixelRatio; };
    resize(); window.addEventListener("resize", resize);
    const tick = (t: number) => {
      ctx.clearRect(0,0,w,h);
      const cx = w*0.5, cy = h*0.52;
      const intensity = scene === "boot" ? 0.65 : scene === "reveal" ? 1.1 : 0.78;
      ctx.globalCompositeOperation = "lighter";
      for (let i=0;i<particles.length;i++) {
        const q = particles[i];
        const ang = q.p + t*0.00025*q.s;
        const radius = 90 + q.z*520 + Math.sin(t*0.0007 + i)*30;
        const x = cx + Math.cos(ang)*radius*q.x*1.65;
        const y = cy + Math.sin(ang*1.3)*radius*q.y*1.25;
        const r = 0.45 + q.z*1.4;
        ctx.fillStyle = `rgba(143,255,70,${0.04+q.a*0.16*intensity})`;
        ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
        if (i % 9 === 0) {
          ctx.strokeStyle = `rgba(143,255,70,${0.018+q.a*0.05*intensity})`; ctx.lineWidth=0.7;
          ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(cx+(x-cx)*0.35,cy+(y-cy)*0.35); ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [scene]);
  return <canvas ref={ref} className="neural-canvas" aria-hidden />;
}
