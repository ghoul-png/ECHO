"use client";

import { useState } from "react";

export default function Home() {
  const [started, setStarted] = useState(false);

  return (
    <main className="min-h-screen bg-[#08090d] text-white">
      {!started ? (
        <section className="flex min-h-screen flex-col items-center justify-center px-6">
          <div className="mb-6 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/60">
            Persistent AI Memory
          </div>

          <h1 className="text-center text-6xl font-semibold tracking-tight sm:text-8xl">
            ECHO
          </h1>

          <p className="mt-5 text-center text-xl text-white/50 sm:text-2xl">
            The AI that remembers why.
          </p>

          <p className="mt-4 max-w-xl text-center text-sm leading-6 text-white/35">
            An assistant that remembers your decisions, understands what
            changed, and knows when yesterday&apos;s truth is no longer today&apos;s.
          </p>

          <button
            onClick={() => setStarted(true)}
            className="mt-10 rounded-xl bg-white px-7 py-3.5 text-sm font-medium text-black transition hover:bg-white/85"
          >
            Start a conversation
          </button>

          <div className="mt-16 flex gap-8 text-xs text-white/25">
            <span>Persistent memory</span>
            <span>Contradiction detection</span>
            <span>Memory provenance</span>
          </div>
        </section>
      ) : (
        <ChatScreen />
      )}
    </main>
  );
}

function ChatScreen() {
  const [message, setMessage] = useState("");

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-72 border-r border-white/10 bg-[#0b0c11] p-5 md:block">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">ECHO</h2>

          <div className="h-2 w-2 rounded-full bg-emerald-400" />
        </div>

        <button className="mt-8 w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-white/70 transition hover:bg-white/10">
          + New conversation
        </button>

        <div className="mt-10">
          <p className="text-xs font-medium uppercase tracking-wider text-white/30">
            Memory
          </p>

          <div className="mt-4 space-y-2">
            <MemoryItem
              title="Active memories"
              value="24"
            />

            <MemoryItem
              title="Superseded"
              value="7"
            />

            <MemoryItem
              title="Archived"
              value="3"
            />
          </div>
        </div>

        <div className="mt-10">
          <p className="text-xs font-medium uppercase tracking-wider text-white/30">
            Recent decisions
          </p>

          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-white/5 p-3">
              <p className="text-sm text-white/70">
                Frontend framework
              </p>
              <p className="mt-1 text-xs text-white/30">
                React → Vue
              </p>
            </div>

            <div className="rounded-lg border border-white/5 p-3">
              <p className="text-sm text-white/70">
                Database
              </p>
              <p className="mt-1 text-xs text-white/30">
                Supabase
              </p>
            </div>
          </div>
        </div>
      </aside>

      <section className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-white/10 px-6">
          <div>
            <p className="text-sm font-medium">Conversation</p>
            <p className="text-xs text-white/30">
              ECHO remembers this conversation
            </p>
          </div>

          <button className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/50 hover:bg-white/5">
            Memory timeline
          </button>
        </header>

        <div className="flex flex-1 flex-col items-center px-5">
          <div className="w-full max-w-3xl flex-1 py-12">
            <div className="mb-10">
              <p className="text-xs uppercase tracking-wider text-white/25">
                ECHO
              </p>

              <h1 className="mt-2 text-2xl font-medium">
                What should we remember?
              </h1>

              <p className="mt-2 text-sm text-white/35">
                Ask about your projects, decisions, preferences, or anything
                ECHO has learned over time.
              </p>
            </div>

            <div className="space-y-6">
              <div className="ml-auto max-w-xl rounded-2xl bg-white/10 px-5 py-4">
                <p className="text-sm leading-6 text-white/80">
                  Why did we choose Supabase for this project?
                </p>
              </div>

              <div className="max-w-xl">
                <p className="text-sm leading-7 text-white/70">
                  You chose Supabase because you wanted PostgreSQL, vector
                  search, and persistent memory in one backend.
                </p>

                <button className="mt-4 text-xs text-white/40 underline underline-offset-4 transition hover:text-white/70">
                  Why do you know this?
                </button>
              </div>
            </div>
          </div>

          <div className="w-full max-w-3xl pb-7">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-2">
              <div className="flex items-end gap-2">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Ask ECHO anything..."
                  rows={1}
                  className="min-h-12 flex-1 resize-none bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-white/25"
                />

                <button
                  disabled={!message.trim()}
                  className="rounded-xl bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-20"
                >
                  Send
                </button>
              </div>
            </div>

            <p className="mt-3 text-center text-[11px] text-white/20">
              ECHO can make mistakes. Check important memories.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function MemoryItem({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg px-3 py-2 transition hover:bg-white/5">
      <span className="text-sm text-white/50">{title}</span>
      <span className="text-xs text-white/25">{value}</span>
    </div>
  );
}