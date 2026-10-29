"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Clock3, RefreshCw, ShieldAlert, Wallet } from "lucide-react";
import type { Claim, Project, RewardBalance } from "@/domain/types";
import { useApp } from "./app-provider";
import { CopyButton, Dialog, EmptyState, InlineError, LoadingState, ModeBadge, ProjectLink, Spinner, dateTime, projectRecipients, recipientShareLabel, shortAddress, units } from "./ui";

const claimStatus: Record<Claim["status"], string> = { reserved: "Waiting for worker", submitted: "Being sent", finalized: "Complete", review: "Needs review" };
const sum = (rows: RewardBalance[], key: "available" | "reserved" | "paid") => rows.reduce((total, item) => total + BigInt(item[key]), 0n).toString();

function distributionLabel(project: Project, wallet: string | null) {
  if (project.mode === "creator") return "Creator destination";
  if (project.mode === "holders") return "Holder destination";
  if (project.mode === "king_of_hill") return "King of the Hill destination";
  if (project.mode === "underwater") return "Underwater holder destination";
  if (project.mode === "share") return recipientShareLabel(projectRecipients(project), wallet);
  if (project.mode === "cto_on_creator_sell") return project.ctoActive ? "CTO holder rewards" : "CTO creator destination";
  return wallet === project.creator ? "Creator share" : "Holder share";
}

export function RewardsScreen() {
  const { state, loading, error: stateError, mutate, refresh, setIdentityOpen, notify } = useApp();
  const [claimProject, setClaimProject] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rewards = state?.rewards || [];
  const available = sum(rewards, "available");
  const reserved = sum(rewards, "reserved");
  const paid = sum(rewards, "paid");
  const claims = state?.claims || [];
  const pending = claims.some((claim) => claim.status === "reserved" || claim.status === "submitted");
  const selectedBalance = rewards.find((reward) => reward.projectId === claimProject?.id);

  const claim = async () => {
    if (!claimProject || busy) return;
    setBusy(true);
    setError(null);
    try {
      await mutate("/api/claims", { projectId: claimProject.id });
      await refresh();
      setClaimProject(null);
      notify("Your Claim is queued. The worker will process the simulated payout and update the status automatically.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to submit this Claim."); }
    finally { setBusy(false); }
  };
  const update = async () => { setRefreshing(true); await refresh(); setRefreshing(false); };

  return <>
    <header className="page-heading"><div><h1>Your share, recorded.</h1><p>Rewards by token. Claim when a balance becomes available.</p></div><button type="button" className="button button-secondary button-small" onClick={() => void update()} disabled={refreshing || loading}><RefreshCw size={15} />{refreshing ? "Refreshing…" : "Refresh"}</button></header>
    {loading ? <LoadingState /> : !state && stateError ? <EmptyState title="Rewards could not load">Check the server connection, then refresh your data.</EmptyState> : !state?.wallet ? <section className="panel"><EmptyState title="Start with an identity" action={<button className="button button-primary" onClick={() => setIdentityOpen(true)}>Choose a test identity<ArrowRight size={17} /></button>}>Reward balances are tied to your active identity.<br />Choose Creator, Holder A, or Holder B to continue.</EmptyState></section> : <>
      <section className="reward-balance-panel" aria-label="Simulated reward balances"><div className="reward-available"><span className="balance-label">Available to claim</span><p className="balance-value">{units(available, 9, 9)} <span>SOL</span></p><span className="balance-footnote">Simulated balance · 0.001 SOL minimum per token</span></div><dl className="reward-other-balances"><div><dt>Awaiting payout</dt><dd>{units(reserved, 9, 9)} <span>SOL</span></dd></div><div><dt>Paid</dt><dd>{units(paid, 9, 9)} <span>SOL</span></dd></div></dl><div className="reward-identity"><Wallet size={17} /><span><strong>{state.walletLabel || "Simulation identity"}</strong><small>{shortAddress(state.wallet)}</small></span><button type="button" className="text-button" onClick={() => setIdentityOpen(true)}>Switch<ArrowUpRight size={14} /></button></div></section>
      {pending && <div className="pending-notice" role="status"><Clock3 size={18} /><div><strong>Your payout is waiting for the worker.</strong><p>Status updates automatically. The local worker must be running to process the queue; no completion time is guaranteed.</p></div></div>}
      {state.capabilities.claim === false && <InlineError>{state.capabilities.reason || "Claims are unavailable in this environment."}</InlineError>}
      <section className="rewards-projects" aria-labelledby="rewards-title"><div className="section-heading"><h2 id="rewards-title">Rewards by token</h2><span className="section-note">Claims are processed one token at a time</span></div>{rewards.length === 0 ? <div className="reward-empty"><div><h3>No rewards for this identity yet.</h3><p>Trades generate fees. After an epoch runs, eligible shares appear here.</p></div><Link className="button button-secondary button-small" href="/">Explore tokens<ArrowRight size={16} /></Link></div> : <div className="table-scroll"><table className="rewards-table"><thead><tr><th>Token</th><th>Distribution</th><th className="numeric">Available</th><th className="numeric">Awaiting</th><th className="numeric">Paid</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{rewards.map((reward) => { const project = state.projects.find((item) => item.id === reward.projectId); if (!project) return null; const eligible = BigInt(reward.available) >= 1000000n; return <tr key={reward.projectId}><td><ProjectLink project={project} /></td><td><ModeBadge mode={project.mode} /><span className="table-subtext">{distributionLabel(project, state.wallet)}</span></td><td className="numeric">{units(reward.available, 9, 9)}<span className="table-subtext">SOL</span></td><td className="numeric">{units(reward.reserved, 9, 9)}<span className="table-subtext">SOL</span></td><td className="numeric">{units(reward.paid, 9, 9)}<span className="table-subtext">SOL</span></td><td><button className="button button-primary button-small" disabled={!eligible || !state.capabilities.claim} onClick={() => { setError(null); setClaimProject(project); }} title={!eligible ? "Minimum Claim is 0.001 SOL per token" : `Claim ${project.name} rewards`}>Claim<ArrowUpRight size={15} /></button>{!eligible && <span className="table-subtext">Min. 0.001 SOL</span>}</td></tr>; })}</tbody></table></div>}</section>
      <section className="claim-history" aria-labelledby="history-title"><div className="section-heading"><h2 id="history-title">Claim history</h2><span className="section-note">Simulation receipts, not on-chain signatures</span></div>{claims.length === 0 ? <div className="history-empty"><Clock3 size={19} /><span>No Claims yet. Every request and payout status appears here.</span></div> : <div className="table-scroll"><table className="history-table"><thead><tr><th>Token / time</th><th className="numeric">Amount</th><th>Status</th><th>Simulation receipt</th></tr></thead><tbody>{claims.map((item) => { const project = state.projects.find((entry) => entry.id === item.projectId); return <tr key={item.id}><td><strong>{project?.name || shortAddress(item.projectId)}</strong><span className="table-subtext">{dateTime(item.createdAt)}</span></td><td className="numeric">{units(item.amount, 9, 9)} SOL</td><td><span className={`claim-status claim-${item.status}`}><span className="status-dot" />{claimStatus[item.status]}</span>{item.status === "review" && <span className="table-subtext">Do not resubmit this Claim.</span>}</td><td>{item.signature ? <span className="receipt-cell"><span title={item.signature}>{shortAddress(item.signature)}</span><CopyButton value={item.signature} label="Copy" /></span> : <span className="muted">Not available</span>}</td></tr>; })}</tbody></table></div>}</section>
    </>}
    <section className="reward-disclosure" aria-labelledby="reward-rules"><ShieldAlert size={20} /><div><h2 id="reward-rules">Rewards are not a fixed return.</h2><p>Only fees actually received can be distributed. The platform holds unpaid balances. King of the Hill eligibility ends after a sell; transfer activity is not simulated. Underwater eligibility can change with price, holdings, and recorded entry data; transfer-only balances are excluded. CTO routes future destination fees to holders only after the original creator sells through this simulator; earlier accrued rewards are unchanged. Simulator charity selections do not contact an external organization. A simulator payout does not prove a devnet transaction.</p></div></section>
    <Dialog open={Boolean(claimProject)} onClose={() => setClaimProject(null)} title="Claim simulated rewards" busy={busy}>{claimProject && <><p className="dialog-intro">Claim the full available balance from {claimProject.name}. The server determines the amount and recipient; neither is typed manually.</p><dl className="definition-list review-summary"><div><dt>Available amount</dt><dd>{units(selectedBalance?.available, 9, 9)} SOL</dd></div><div><dt>Destination</dt><dd>{distributionLabel(claimProject, state?.wallet || null)}</dd></div><div><dt>Recipient</dt><dd>{state?.walletLabel || "Simulation identity"}</dd></div><div><dt>Network fee to recipient</dt><dd>Not deducted</dd></div></dl><div className="notice-box"><ShieldAlert size={18} /><p>Your balance is reserved first, then the worker processes the payout. No wallet signature is required in the simulator. If this needs review, do not create a replacement request.</p></div>{error && <InlineError>{error}</InlineError>}<div className="dialog-actions"><button className="button button-secondary" disabled={busy} onClick={() => setClaimProject(null)}>Cancel</button><button className="button button-primary" disabled={busy} onClick={() => void claim()}>{busy ? <Spinner label="Submitting…" /> : <>Confirm Claim<Check size={17} /></>}</button></div></>}</Dialog>
  </>;
}
