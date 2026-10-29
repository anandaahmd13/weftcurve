"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ArrowUpRight, Check, DatabaseZap, FlaskConical, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import type { RewardMode } from "@/domain/types";
import { useApp } from "./app-provider";
import { LaunchLink } from "./app-shell";
import { Dialog, EmptyState, FeeDetails, InlineError, LoadingState, ModeBadge, ProjectLink, ProjectStatus, WeftMark, modeLabels, units } from "./ui";

type ExploreMode = RewardMode | "graduated";

export function ExploreScreen() {
  const { state, loading, error, setIdentityOpen, mutate, refresh, notify } = useApp();
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<ExploreMode | "all">("all");
  const [feeOpen, setFeeOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState("");
  const [busy, setBusy] = useState<"demos" | "reset" | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const loadDemos = async () => {
    if (busy) return;
    setBusy("demos"); setToolError(null);
    try {
      await mutate("/api/simulator/demos");
      await refresh();
      setToolsOpen(false);
      notify("Demo scenarios loaded: Creator, Holders, King, Underwater, Share, CTO, and Graduated.");
    } catch (cause) { setToolError(cause instanceof Error ? cause.message : "Unable to load demo scenarios."); }
    finally { setBusy(null); }
  };
  const reset = async () => {
    if (busy || resetText !== "RESET LOCAL SIMULATOR") return;
    setBusy("reset"); setToolError(null);
    try {
      await mutate("/api/simulator/reset", { confirmation: resetText });
      setResetOpen(false); setToolsOpen(false); setResetText("");
      await refresh();
      notify("Local simulator data was reset. Choose an identity to continue.");
    } catch (cause) { setToolError(cause instanceof Error ? cause.message : "Unable to reset local simulator data."); }
    finally { setBusy(null); }
  };
  const projects = useMemo(() => (state?.projects || []).filter((project) => (mode === "all" || mode === "graduated" ? mode !== "graduated" || project.status === "graduated" : project.mode === mode) && `${project.name} ${project.symbol} ${project.mint}`.toLowerCase().includes(search.toLowerCase().trim())), [state?.projects, mode, search]);
  return <>
    <section className="explore-intro" aria-labelledby="explore-title">
      <div className="intro-copy"><h1 id="explore-title">New tokens.<br />Shared possibilities.</h1><p>Launch a token, choose a fee destination, and test the flow with your community.</p><div className="intro-actions"><LaunchLink /><button type="button" className="text-button" onClick={() => setFeeOpen(true)}>How are fees distributed?<ArrowUpRight size={16} /></button>{state?.network === "simulator" && <button type="button" className="text-button" onClick={() => { setToolError(null); setToolsOpen(true); }}>Simulator tools<DatabaseZap size={16} /></button>}</div></div>
      <div className="workflow-panel"><div className="workflow-heading"><WeftMark /><span>From an idea to a community</span></div><ol className="workflow-list"><li><span className="workflow-marker">{state?.wallet ? <Check size={14} /> : <span />}</span><div><button className="workflow-action" onClick={() => setIdentityOpen(true)}>Choose a test identity<ArrowUpRight size={15} /></button><p>Creator or holder. No real wallet needed.</p></div></li><li><span className="workflow-marker"><span /></span><div><Link href="/launch" className="workflow-action">Launch on your terms<ArrowUpRight size={15} /></Link><p>Choose Creator, Holders, King of the Hill, Underwater Holders, shared recipients, or a CTO rule.</p></div></li><li><span className="workflow-marker"><span /></span><div><span className="workflow-action">Trade, distribute, then Claim</span><p>Test reward epochs and payouts locally.</p></div></li></ol></div>
    </section>

    <section className="market-section" aria-labelledby="market-title"><div className="section-heading"><div className="heading-with-count"><h2 id="market-title">Explore tokens</h2>{state && <span className="count-label">{state.projects.length}</span>}</div><span className="section-note">Quoted in SOL</span></div>
      <div className="market-toolbar"><div className="filter-tabs" aria-label="Filter tokens by destination or graduation status">{(["all", "graduated", "creator", "holders", "king_of_hill", "underwater", "share", "cto_on_creator_sell"] as const).map((value) => <button key={value} className={`filter-tab ${mode === value ? "filter-tab-active" : ""}`} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{value === "all" ? "All tokens" : value === "graduated" ? "Graduated" : modeLabels[value]}</button>)}</div><label className="search-field"><Search size={17} aria-hidden="true" /><input aria-label="Search by name, symbol, or mint" placeholder="Search name or symbol…" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X size={15} /></button>}</label></div>
      {loading ? <LoadingState /> : !state && error ? <div className="empty-state"><h2>Workspace unavailable</h2><p>Check the server connection, then try loading your data again.</p></div> : mode === "graduated" && projects.length === 0 ? <EmptyState title="No graduated tokens yet">A token appears here after its bonding curve completes and its pool reaches active status. Curve completion alone is not proof that migration succeeded.</EmptyState> : state?.projects.length === 0 ? <EmptyState title="Room for your first token" action={<LaunchLink small />}>No tokens have been launched in this simulator.<br />Start with your own idea, not a make-believe market.</EmptyState> : projects.length === 0 ? <div className="empty-state"><SlidersHorizontal size={30} aria-hidden="true" /><h2>No matching tokens</h2><p>Try another name or show all destination modes.</p><button className="button button-secondary" onClick={() => { setSearch(""); setMode("all"); }}>Clear filters</button></div> : <div className="table-scroll"><table className="project-table"><thead><tr><th>Token</th><th>Fee destination</th><th>Status / pool</th><th className="numeric">SOL reserves</th><th className="numeric">Holders</th><th><span className="sr-only">Open token</span></th></tr></thead><tbody>{projects.map((project) => <tr key={project.id}><td><ProjectLink project={project} /></td><td><ModeBadge mode={project.mode} />{project.mode === "legacy_split" && <span className="table-subtext">Legacy {project.holderShareBps / 100}% to holders</span>}</td><td><ProjectStatus status={project.status} />{project.status === "graduated" && <span className="table-subtext">Pool active</span>}</td><td className="numeric">{units(project.reserve, 9, 4)}<span className="table-subtext">Simulated SOL</span></td><td className="numeric">{project.holderCount}</td><td><Link className="icon-button" href={`/token/${encodeURIComponent(project.mint)}`} aria-label={`Open ${project.name}`}><ArrowRight size={18} /></Link></td></tr>)}</tbody></table></div>}
      <div className="market-footnote"><span><span className="status-dot" />Local simulator data. No mainnet transactions.</span><button type="button" className="text-button" onClick={() => setFeeOpen(true)}>Fees & distribution<ArrowUpRight size={14} /></button></div>
    </section>
    <section className="policy-strip" aria-labelledby="policy-title"><h2 id="policy-title">One fee.<br />Six destinations.</h2><div><p><strong>Creator</strong>, <strong>Holders</strong>, <strong>King of the Hill</strong>, <strong>Underwater Holders</strong>, <strong>Share with Wallets / Charities</strong>, or <strong>CTO on creator sell</strong>.</p><p className="fine-print">Set at launch. King eligibility ends after any sell or transfer. Underwater eligibility can change. Rewards depend on fees actually received.</p></div><button className="text-button" onClick={() => setFeeOpen(true)} aria-label="Learn about fee distribution"><ArrowUpRight size={24} /></button></section>
    <Dialog open={feeOpen} onClose={() => setFeeOpen(false)} title="Fees, made clear"><p className="dialog-intro">Each destination receives the 0.30% destination share of a 0.50% total trade fee. Destinations do not add to the fee.</p><FeeDetails mode="share" /><div className="notice-box"><p>King of the Hill uses largest eligible single buy; a sell invalidates eligibility, transfer activity is not simulated, and earliest buy breaks ties. Underwater Holders use current average entry above current price; transfer-only balances are excluded because transfers alone do not establish entry. CTO routes later destination fees to holders after the original creator sells through this simulator. Charity choices exist only in the simulator and do not contact external organizations.</p></div><div className="dialog-actions"><button className="button button-primary" onClick={() => setFeeOpen(false)}>Got it<Check size={16} /></button></div></Dialog>
    <Dialog open={toolsOpen} onClose={() => { if (!busy) setToolsOpen(false); }} title="Local simulator tools" busy={Boolean(busy)}><p className="dialog-intro">Load deterministic demo scenarios to explore each destination rule, or reset only local simulator records. Devnet records, keys, and configuration are not touched.</p><div className="notice-box"><FlaskConical size={18} /><p>Loading scenarios resets current local simulator data first, then creates one scenario each for Creator, Holders, King, Underwater, Share, CTO, and Graduated.</p></div>{toolError && <InlineError>{toolError}</InlineError>}<div className="dialog-actions"><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => { setToolsOpen(false); setToolError(null); }}>Cancel</button><button className="button button-primary" disabled={Boolean(busy)} onClick={() => void loadDemos()}>{busy === "demos" ? "Loading scenarios…" : <><DatabaseZap size={16} />Load demo scenarios</>}</button><button className="button button-danger" disabled={Boolean(busy)} onClick={() => { setToolError(null); setResetOpen(true); }}>Reset simulator<RotateCcw size={16} /></button></div></Dialog>
    <Dialog open={resetOpen} onClose={() => { if (!busy) setResetOpen(false); }} title="Reset local simulator" busy={busy === "reset"}><div className="notice-box"><AlertTriangle size={18} /><p>This permanently deletes local simulator tokens, trades, rewards, Claim records, scenarios, and local sessions. Devnet databases and configuration are not changed.</p></div><label className="field"><span>Type RESET LOCAL SIMULATOR to confirm</span><input value={resetText} onChange={(event) => setResetText(event.target.value)} autoComplete="off" spellCheck={false} /></label>{toolError && <InlineError>{toolError}</InlineError>}<div className="dialog-actions"><button className="button button-secondary" disabled={busy === "reset"} onClick={() => { setResetOpen(false); setResetText(""); }}>Cancel</button><button className="button button-danger" disabled={busy === "reset" || resetText !== "RESET LOCAL SIMULATOR"} onClick={() => void reset()}>{busy === "reset" ? "Resetting…" : "Delete local simulator data"}</button></div></Dialog>
  </>;
}
