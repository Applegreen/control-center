"use client";

import { ArrowUpRight, AtSign, Mail, Radio } from "lucide-react";
import type { BriefCategory, DailyBriefSnapshotSection } from "@/lib/types";
import styles from "./daily-snapshot.module.css";

const labels = { industry: "Industry", mentions: "Mentions", newsletters: "Newsletters" };
const icons = { industry: Radio, mentions: AtSign, newsletters: Mail };

export function DailySnapshot({ sections, onOpen }: {
  sections: DailyBriefSnapshotSection[];
  onOpen: (category: BriefCategory) => void;
}) {
  return <div className={styles.grid}>
    {sections.map((section) => {
      const Icon = icons[section.category];
      return <section className={`${styles.section} ${styles[section.category]}`} key={section.category}>
        <div className={styles.header}>
          <span className={styles.icon}><Icon size={16} /></span>
          <div><h3>{labels[section.category]}</h3><span>Top {section.requestedCount} · {section.availableCount} available</span></div>
          <button type="button" onClick={() => onOpen(section.category)} aria-label={`Open ${labels[section.category]}`}><ArrowUpRight size={18} /></button>
        </div>
        {section.items.length ? <ol className={styles.list}>
          {section.items.map((item, index) => <li key={item.id}>
            <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
              <p>{item.summary}</p>
              <small>{item.source}</small>
            </div>
          </li>)}
        </ol> : <div className={styles.empty}>
          <b>{section.configured ? "Nothing new in this queue" : "No saved results yet"}</b>
          <p>{section.configured ? "Archived stories stay out of your brief." : "Add your sources or run the first refresh in this tab."}</p>
        </div>}
        <div className={styles.footer}>
          <span>{section.checkedAt ? `${section.stale ? "Last saved" : "Saved"} ${new Date(section.checkedAt).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}` : "Waiting for first collection"}</span>
          <button type="button" onClick={() => onOpen(section.category)}>See all <ArrowUpRight size={12} /></button>
        </div>
      </section>;
    })}
  </div>;
}
