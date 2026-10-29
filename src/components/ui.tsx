"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Check, CircleAlert, LoaderCircle, X } from "lucide-react";
import type { Project, RewardMode, RewardRecipient } from "@/domain/types";

/** `legacy_split` preserves records created before Mogz-style destinations. */
export type FeeDestinationMode = RewardMode;
export type { RewardRecipient };

export const feeDestinationModes = ["creator", "holders", "king_of_hill", "underwater", "share", "cto_on_creator_sell"] as const;
export const modeLabels: Record<string, string> = {
  creator: "Creator",
  holders: "Holders",
  king_of_hill: "King of the Hill",
  underwater: "Underwater Holders",
  share: "Share with Wallets / Charities",
  cto_on_creator_sell: "CTO on creator sell",
  legacy_split: "Legacy Split",
};
export const modeDescriptions: Record<string, string> = {
  creator: "Route the full destination share to the token creator.",
  holders: "Distribute the full destination share among eligible holders.",
  king_of_hill: "Route the full destination share to the current eligible King.",
  underwater: "Distribute the full destination share among eligible underwater holders.",
  share: "Divide the destination share among wallets and up to five simulator charities.",
  cto_on_creator_sell: "Keep destination fees with the creator until their first platform sale; then permanently route future destination fees to eligible holders.",
  legacy_split: "Legacy creator and holder split.",
};

export function projectRecipients(project: Project): RewardRecipient[] {
  const recipients = (project as Project & { recipients?: unknown }).recipients;
  if (!Array.isArray(recipients)) return [];
  return recipients.filter((recipient): recipient is RewardRecipient => Boolean(
    recipient && typeof recipient === "object" &&
    typeof (recipient as RewardRecipient).id === "string" &&
    typeof (recipient as RewardRecipient).label === "string" &&
    ((recipient as RewardRecipient).kind === "wallet" || (recipient as RewardRecipient).kind === "charity") &&
    typeof (recipient as RewardRecipient).wallet === "string" &&
    typeof (recipient as RewardRecipient).shareBps === "number",
  ));
}

export function recipientShareLabel(recipients: RewardRecipient[], wallet: string | null): string {
  const recipient = recipients.find((item) => item.wallet === wallet);
  return recipient ? `${recipient.label} share` : "Shared recipient";
}

export function units(raw: string | undefined, decimals = 9, precision = 6): string {
  try {
    const value = BigInt(raw || "0");
    const absolute = value < 0n ? -value : value;
    const base = 10n ** BigInt(decimals);
    const whole = (absolute / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const fraction = (absolute % base).toString().padStart(decimals, "0").slice(0, precision).replace(/0+$/, "");
    if (precision > 0 && absolute > 0n && absolute < base / 10n ** BigInt(Math.min(decimals, precision))) return `<0.${"0".repeat(precision - 1)}1`;
    return `${value < 0n ? "−" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
  } catch { return "—"; }
}

export function inputUnits(raw: string | undefined, decimals: number): string {
  const value = BigInt(raw || "0");
  const base = 10n ** BigInt(decimals);
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${value / base}${fraction ? `.${fraction}` : ""}`;
}

export function humanRaw(value: string, decimals: number): bigint | null {
  const normal = value.trim().replace(",", ".");
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(normal)) return null;
  const [whole, fraction = ""] = normal.split(".");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}

export function shortAddress(address: string) {
  return address.length > 22 ? `${address.slice(0, 9)}…${address.slice(-6)}` : address;
}

export function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function WeftMark({ className = "", large = false }: { className?: string; large?: boolean }) {
  return <svg className={`weft-mark ${className}`} width={large ? 96 : 30} height={large ? 96 : 30} viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M7 3v28c0 5.5 4.5 10 10 10h24M17 3v18c0 5.5 4.5 10 10 10h14M27 3v8c0 5.5 4.5 10 10 10h4" stroke="currentColor" strokeWidth="5"/><path d="M3 7h28c5.5 0 10 4.5 10 10v24M3 17h18c5.5 0 10 4.5 10 10v14M3 27h8c5.5 0 10 4.5 10 10v4" stroke="var(--ground)" strokeWidth="9"/><path d="M3 7h28c5.5 0 10 4.5 10 10v24M3 17h18c5.5 0 10 4.5 10 10v14M3 27h8c5.5 0 10 4.5 10 10v4" stroke="currentColor" strokeWidth="5"/></svg>;
}

export function TokenAvatar({ project, large = false }: { project: Pick<Project, "name" | "symbol" | "image">; large?: boolean }) {
  return <span className={`token-avatar ${large ? "token-avatar-large" : ""}`}>
    {/* Uploaded metadata is a validated, local data URL. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {project.image ? <img src={project.image} alt="" /> : <span aria-hidden="true">{project.symbol.slice(0, 2).toUpperCase() || "W"}</span>}
  </span>;
}

export function ModeBadge({ mode }: { mode: FeeDestinationMode }) {
  return <span className="mode-badge">{modeLabels[mode] || "Fee destination"}</span>;
}

export function ProjectStatus({ status }: { status: Project["status"] }) {
  const labels = { bonding: "Curve active", migration_pending: "Migration pending", graduated: "Pool active" };
  return <span className={`project-status ${status === "migration_pending" ? "status-warning" : ""}`}><span className="status-dot" />{labels[status]}</span>;
}

export function InlineError({ children }: { children: ReactNode }) {
  return <div className="inline-error" role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{children}</span></div>;
}

export function Spinner({ label = "Processing…" }: { label?: string }) {
  return <span className="pending-label"><LoaderCircle size={16} aria-hidden="true" />{label}</span>;
}

export function Dialog({ open, onClose, title, children, wide = false, busy = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (open) {
      if (!element.open) element.showModal();
      document.body.classList.add("dialog-open");
      frame = requestAnimationFrame(() => setVisible(true));
    } else {
      frame = requestAnimationFrame(() => setVisible(false));
      timer = setTimeout(() => { element.close(); document.body.classList.remove("dialog-open"); }, reduceMotion ? 100 : 240);
    }
    return () => { cancelAnimationFrame(frame); if (timer) clearTimeout(timer); };
  }, [open]);
  useEffect(() => () => document.body.classList.remove("dialog-open"), []);
  return <dialog ref={dialog} aria-labelledby={heading} aria-busy={busy} className={`dialog ${wide ? "dialog-wide" : ""} ${visible ? "dialog-visible" : ""}`} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}>
    <header className="dialog-heading"><h2 id={heading}>{title}</h2><button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={20} /></button></header>
    {children}
  </dialog>;
}

function destinationRowLabel(mode: FeeDestinationMode) {
  if (mode === "creator") return "To creator";
  if (mode === "holders") return "To eligible holders";
  if (mode === "king_of_hill") return "To current King";
  if (mode === "underwater") return "To underwater holders";
  if (mode === "share") return "To shared recipients";
  if (mode === "cto_on_creator_sell") return "Creator, then holders on creator sell";
  return "Legacy split share";
}

export function FeeDetails({ mode, holderShareBps = 0, recipients = [], compact = false }: { mode: FeeDestinationMode; holderShareBps?: number; recipients?: RewardRecipient[]; compact?: boolean }) {
  const legacyHolderShare = mode === "legacy_split" ? holderShareBps : 0;
  const percentage = (bps: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(bps / 100);
  return <div className={`fee-details ${compact ? "fee-details-compact" : ""}`}>
    <dl className="definition-list">
      <div><dt>Total trading fee</dt><dd>0.50%</dd></div>
      <div><dt>{mode === "legacy_split" ? "Legacy Split share" : "Destination share"}</dt><dd>0.30%</dd></div>
      {mode === "legacy_split" ? <><div className="definition-indent"><dt>For the creator</dt><dd>{percentage(3000 - (3000 * legacyHolderShare / 10000))}%</dd></div><div className="definition-indent"><dt>For holders</dt><dd>{percentage(3000 * legacyHolderShare / 10000)}%</dd></div></> : <div className="definition-indent"><dt>{destinationRowLabel(mode)}</dt><dd>0.30%</dd></div>}
      {mode === "share" && recipients.map((recipient) => <div className="definition-indent recipient-fee-row" key={recipient.id}><dt>{recipient.label}</dt><dd>{percentage(recipient.shareBps)}% of destination</dd></div>)}
      <div><dt>Platform</dt><dd>0.10%</dd></div>
      <div><dt>Protocol</dt><dd>0.10%</dd></div>
    </dl>
    {!compact && <p className="fine-print">The destination share does not add a fee. Rewards come from collected fees, not a fixed return. On devnet, post-migration fees follow actual LP receipts.</p>}
  </div>;
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><WeftMark large /><h2>{title}</h2><p>{children}</p>{action}</div>;
}

export function LoadingState() {
  return <div className="loading-state" role="status"><span className="loading-dot" />Loading workspace…</div>;
}

export function ProjectLink({ project }: { project: Project }) {
  return <Link className="project-identity" href={`/token/${encodeURIComponent(project.mint)}`}><TokenAvatar project={project} /><span><strong>{project.name}</strong><small>{project.symbol}</small></span><ArrowUpRight className="project-link-arrow" size={17} aria-hidden="true" /></Link>;
}

export function CopyButton({ value, label = "Copy address" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  return <><button type="button" className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setFailed(false); } catch { setFailed(true); } }}>{copied ? <><Check size={14} />Copied</> : label}</button>{failed && <span className="fine-print" role="status">Copy manually: {value}</span>}</>;
}
