"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

type AppStatus = {
  id: string;
  name: string;
  description: string;
  href: string;
  ok: boolean;
  status: number;
  ms: number;
};

export function AppsPanel() {
  const [items, setItems] = useState<AppStatus[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/live/apps", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { items: AppStatus[] };
        if (!cancelled) setItems(payload.items);
      } catch {
        /* the cards still render as links without a status */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="panel reveal apps-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h3>Apps</h3>
        </div>
      </div>
      <div className="apps-grid">
        {(items || []).map((app) => (
          
            key={app.id}
            className="app-card"
            href={app.href}
            target="_blank"
            rel="noreferrer"
          >
            <span className={`app-state ${app.ok ? "state-live" : "state-down"}`}>
              <i />
              {app.ok ? "Live" : "Unreachable"}
            </span>
            <b>{app.name}</b>
            <small>{app.description}</small>
            <span className="app-open">
              Open <ExternalLink size={12} />
            </span>
          </a>
        ))}
        {!items ? <p>Checking services…</p> : null}
      </div>
    </section>
  );
}
