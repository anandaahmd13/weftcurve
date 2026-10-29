"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowDownUp, ArrowLeft, ArrowRight, ArrowUpRight, Check, Clock3, Info, Play, RefreshCw, ShieldAlert } from "lucide-react";
import type { Activity, Project } from "@/domain/types";
import { useApp } from "./app-provider";
import { CopyButton, Dialog, FeeDetails, InlineError, LoadingState, ModeBadge, ProjectStatus, Spinner, TokenAvatar, dateTime, humanRaw, inputUnits, modeLabels, projectRecipients, shortAddress, units } from "./ui";
import { signAndSendDevnet } from "./devnet-wallet";

const activityLabels: Record<Activity["type"], string> = { buy: "Token purchase", sell: "Token sale", distribution: "Reward epoch", claim: "Claim requested", payout: "Payout completed", launch: "Token launched", migration: "Pool migration", cto_trigger: "CTO rule activated" };

function TradePanel({ project }: { project: Project }) {
  const { state, mutate, setIdentityOpen, notify } = useApp();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decimals = side === "buy" ? 9 : 6;
  const raw = humanRaw(amount, decimals);
  const balance = side === "buy" ? state?.balance || "0" : state?.holdings[project.id] || "0";
  const insufficient = raw !== null && raw > BigInt(balance);
  const blocked = project.status === "migration_pending" || state?.capabilities.trade === false;
  const review = (event: FormEvent) => { event.preventDefault(); setError(null); if (!state?.wallet) { setIdentityOpen(true); return; } if (!raw || raw <= 0n || insufficient || blocked) return; setReviewOpen(true); };
  const trade = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (project.network === "devnet") {
        if (!state?.wallet) throw new Error("Sign in with the same devnet wallet before trading.");
        const prepared = await mutate<{ requestId: string; transactionBase64: string }>("/api/devnet/trade", { projectId: project.id, side, amount: amount.trim().replace(",", "."), slippageBps: 100 });
        await signAndSendDevnet(prepared.transactionBase64, state.wallet);
        await mutate("/api/devnet/sync", { projectId: project.id });
        notify(`Devnet ${side === "buy" ? "purchase" : "sale"} finalized. Balances were synchronized from the chain.`);
      } else {
        await mutate(`/api/projects/${encodeURIComponent(project.id)}/trade`, { side, amount: amount.trim().replace(",", ".") });
        notify(`Simulated ${side === "buy" ? "purchase" : "sale"} recorded. Your balance is up to date.`);
      }
      setReviewOpen(false);
      setAmount("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to process this trade."); }
    finally { setBusy(false); }
  };
  return <section className="panel trade-panel" aria-labelledby="trade-title"><div className="panel-heading"><h2 id="trade-title">Trade token</h2><ArrowDownUp size={18} aria-hidden="true" /></div><div className="trade-tabs" aria-label="Trade direction"><button type="button" aria-pressed={side === "buy"} className={side === "buy" ? "selected" : ""} onClick={() => { setSide("buy"); setAmount(""); setError(null); }}>Buy</button><button type="button" aria-pressed={side === "sell"} className={side === "sell" ? "selected" : ""} onClick={() => { setSide("sell"); setAmount(""); setError(null); }}>Sell</button></div>
    <form onSubmit={review}><label className="trade-amount"><span>{side === "buy" ? "You pay" : "You sell"}</span><div><input aria-label={side === "buy" ? "SOL amount to spend" : `${project.symbol} amount to sell`} inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(event) => { setAmount(event.target.value); setError(null); }} required /><strong>{side === "buy" ? "SOL" : project.symbol}</strong></div><small>Balance: {units(balance, decimals, side === "buy" ? 4 : 2)} {side === "buy" ? "SOL" : project.symbol}</small></label>
      <div className="amount-presets">{(side === "buy" ? ["0.1", "0.5", "1"] : ["25", "50", "100"]).map((value) => <button type="button" key={value} onClick={() => setAmount(side === "buy" ? value : inputUnits((BigInt(balance) * BigInt(value) / 100n).toString(), 6))}>{side === "buy" ? `${value} SOL` : `${value}%`}</button>)}</div>
      {amount && raw === null && <InlineError>Enter a positive number with no more than {decimals} decimal places.</InlineError>}{insufficient && <InlineError>Insufficient test balance.</InlineError>}
      <dl className="definition-list trade-details"><div><dt>Trading fee</dt><dd>0.50%</dd></div><div><dt>Environment</dt><dd>{project.network === "devnet" ? "Solana Devnet" : "Local simulator"}</dd></div></dl><div className="trade-disclaimer"><Info size={15} /><p>The server calculates your output at execution. The simulator has no guaranteed quote or slippage protection.</p></div>
      {project.status === "migration_pending" && <InlineError>The curve is complete. Finish migration before trading again.</InlineError>}{state?.capabilities.trade === false && <InlineError>{state.capabilities.reason || "Trading is unavailable."}</InlineError>}{project.network === "devnet" && state?.capabilities.trade && <div className="trade-disclaimer"><Info size={15} /><p>Devnet quotes expire after 30 seconds. Your wallet signs the reviewed transaction; only finalized transactions are synchronized.</p></div>}{error && !reviewOpen && <InlineError>{error}</InlineError>}
      {!state?.wallet ? <button type="button" className="button button-primary button-full" onClick={() => setIdentityOpen(true)}>{project.network === "devnet" ? "Log in with wallet" : "Choose identity"}<ArrowRight size={17} /></button> : <button className="button button-primary button-full" type="submit" disabled={!raw || raw <= 0n || insufficient || blocked}>{side === "buy" ? "Review purchase" : "Review sale"}<ArrowRight size={17} /></button>}
    </form><p className="trade-caption">{project.network === "devnet" ? "Devnet test funds only." : "No real funds are used."}</p>
    <Dialog open={reviewOpen} onClose={() => setReviewOpen(false)} title={side === "buy" ? "Review purchase" : "Review sale"} busy={busy}><div className="review-token"><TokenAvatar project={project} /><div><strong>{project.name}</strong><span>{project.symbol}</span></div></div><dl className="definition-list review-summary"><div><dt>{side === "buy" ? "Amount to pay" : "Amount to sell"}</dt><dd>{raw ? units(raw.toString(), decimals, decimals) : "0"} {side === "buy" ? "SOL" : project.symbol}</dd></div><div><dt>Trading fee</dt><dd>0.50%</dd></div><div><dt>Identity</dt><dd>{state?.walletLabel || "Simulation"}</dd></div></dl><div className="notice-box"><Info size={18} /><p>This is a simulated execution, not an on-chain quote. Output is calculated at execution and is not guaranteed. This simulator has no minimum-output or slippage guard.</p></div>{error && <InlineError>{error}</InlineError>}<div className="dialog-actions"><button className="button button-secondary" disabled={busy} onClick={() => setReviewOpen(false)}>Cancel</button><button className="button button-primary" disabled={busy} onClick={() => void trade()}>{busy ? <Spinner /> : <>Confirm simulation<Check size={17} /></>}</button></div></Dialog>
  </section>;
}

function TokenActivity({ activity }: { activity: Activity[] }) {
  return <section className="panel activity-panel"><div className="panel-heading"><h2>Token activity</h2><span className="context-label">Simulation</span></div>{activity.length === 0 ? <p className="muted">No activity has been recorded yet.</p> : <ul className="activity-list">{activity.slice(0, 12).map((item) => <li key={item.id}><span className={`activity-mark ${item.type === "buy" ? "activity-buy" : ""}`}>{item.type === "buy" ? <ArrowDownUp size={15} /> : item.type === "distribution" ? <RefreshCw size={15} /> : item.type === "launch" ? <ArrowUpRight size={15} /> : <Check size={15} />}</span><div><strong>{activityLabels[item.type]}</strong><span>{shortAddress(item.wallet)} <span className="activity-separator">·</span> {dateTime(item.createdAt)}</span></div><span className="activity-amount">{["buy", "sell", "claim", "payout", "distribution"].includes(item.type) ? <>{units(item.amount, 9, 6)}<small>Simulated SOL</small></> : <small>Recorded</small>}</span></li>)}</ul>}<p className="fine-print">Local records, not proof of blockchain transactions.</p></section>;
}

function destinationRules(project: Project) {
  if (project.mode === "creator") return <><p>The token creator receives the full destination share.</p><p>The destination share is 0.30% of each trade. It does not add to the 0.50% total fee.</p></>;
  if (project.mode === "holders") return <><p>Eligible holders share the full destination share at each epoch.</p><p>The original creator is excluded. Snapshots use balances at the epoch, not time-weighted ownership. Dust and fees with no eligible holders carry forward.</p></>;
  if (project.mode === "king_of_hill") return <><p><strong>Current King status:</strong> eligibility is evaluated from recorded activity when distribution runs; no named winner is asserted here.</p><p>The largest single eligible buy wins. Any sell invalidates eligibility. Transfer activity is not simulated. If eligible buys match in size, the earliest buy wins.</p></>;
  if (project.mode === "underwater") return <><p><strong>Current Underwater status:</strong> eligibility is evaluated from current price and recorded entry data when distribution runs; no recipient is asserted here.</p><p>Eligible holders have a current average entry above current price. Transfer-only balances are excluded because transfers alone do not establish an entry. Eligibility can change as price, holdings, and entry data change.</p></>;
  if (project.mode === "share") {
    const recipients = projectRecipients(project);
    const recipientList = recipients.length > 0 ? <ul className="recipient-rule-list">{recipients.map((recipient) => <li key={recipient.id}><span>{recipient.label}</span><strong>{recipient.shareBps / 100}%</strong><small>{recipient.kind === "charity" ? "Simulator charity destination" : "Wallet destination"}</small></li>)}</ul> : <p>Recipient details are not available in this project record.</p>;
    return <><p>Recipients split the full destination share by the configured percentages.</p>{recipientList}<p>Simulator charity entries are not verified recipients and no external organization is contacted.</p></>;
  }
  if (project.mode === "cto_on_creator_sell") return <>{project.ctoActive ? <><p><strong>CTO rule is active.</strong> New destination fees route to eligible holders.</p><p>The creator’s platform sell was recorded at {project.ctoTriggeredAt ? dateTime(project.ctoTriggeredAt) : "an earlier time"}. Rewards accrued before this event remain in the creator destination.</p></> : <><p><strong>CTO rule is armed.</strong> Destination fees currently route to the creator.</p><p>If the original creator sells through this simulator, the rule activates permanently and future destination fees route to eligible holders. Transfers and off-platform sales are not monitored by the simulator.</p></>}</>;
  return <><p>{project.holderShareBps / 100}% of destination fees goes to holders; {100 - project.holderShareBps / 100}% goes to the creator.</p><p>This legacy Split configuration remains readable while fee-destination modes migrate.</p></>;
}

export function TokenScreen({ mint }: { mint: string }) {
  const { state, loading, error: stateError, mutate, setIdentityOpen, notify } = useApp();
  const [action, setAction] = useState<"distribute" | "migrate" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = state?.projects.find((item) => item.mint === mint || item.id === mint);
  const run = async () => {
    if (!project || !action || busy) return;
    setBusy(true);
    setError(null);
    try {
      await mutate(`/api/projects/${encodeURIComponent(project.id)}/${action}`, {});
      notify(action === "distribute" ? "Simulation epoch completed. Check your balances in Rewards." : "Simulated migration recorded. The simulator pool is active.");
      setAction(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to run this simulation."); }
    finally { setBusy(false); }
  };
  if (loading) return <LoadingState />;
  if (!project) return <div className="empty-state"><h1>{stateError ? "Unable to load token" : "Token not found"}</h1><p>{stateError ? "Check your server connection and try again." : "This mint is not available in the active environment."}</p><Link className="button button-secondary" href="/">Back to Explore<ArrowRight size={17} /></Link></div>;
  const activity = state?.activity.filter((item) => item.projectId === project.id) || [];
  const recipients = projectRecipients(project);
  return <>
    <Link className="back-link" href="/"><ArrowLeft size={15} />All tokens</Link>
    <header className="token-header"><div className="token-title"><TokenAvatar project={project} large /><div><h1>{project.name}</h1><div className="token-subtitle"><span>${project.symbol}</span><ModeBadge mode={project.mode} /><ProjectStatus status={project.status} /></div></div></div><div className="mint-details"><span>{project.network === "devnet" ? "Devnet mint" : "Simulated mint"}</span><span title={project.mint}>{shortAddress(project.mint)}<CopyButton value={project.mint} label="Copy" /></span></div></header>
    <div className="token-layout"><div className="token-main"><section className="panel token-overview"><div className="panel-heading"><h2>About this token</h2><span className="context-label">{modeLabels[project.mode]} destination</span></div><p className="token-description">{project.description || "The creator has not added a description yet."}</p><dl className="token-facts"><div><dt>Creator</dt><dd title={project.creator}>{shortAddress(project.creator)}{state?.wallet === project.creator && <span className="you-label">You</span>}</dd></div><div><dt>Supply</dt><dd>{units(project.supply, 6, 0)} {project.symbol}</dd></div><div><dt>Launched</dt><dd>{dateTime(project.createdAt)}</dd></div><div><dt>Your holdings</dt><dd>{units(state?.holdings[project.id], 6, 2)} {project.symbol}</dd></div></dl></section>
      <section className="panel migration-panel"><div className="panel-heading"><h2>{project.status === "graduated" ? "Simulator pool active" : project.status === "migration_pending" ? "Ready to migrate" : "Bonding curve phase"}</h2><ProjectStatus status={project.status} /></div><p>{project.status === "graduated" ? "Local migration is complete. This is not proof of an active on-chain DAMM pool or verified LP positions." : project.status === "migration_pending" ? "The curve reached its threshold. Complete migration before the simulator pool can trade again." : "At 1 SOL in reserves, the curve awaits migration. A completed curve does not automatically mean the new pool is active."}</p><div className="migration-bottom"><span><strong>{units(project.reserve, 9, 6)} SOL</strong> current reserves<span className="migration-target">Simulation threshold: 1 SOL</span></span>{project.status === "migration_pending" && project.network === "simulator" && <button className="button button-secondary button-small" onClick={() => { if (!state?.wallet) setIdentityOpen(true); else { setError(null); setAction("migrate"); } }}>Migrate simulator pool<ArrowRight size={16} /></button>}</div></section>
      <section className="panel policy-panel"><div className="panel-heading"><h2>Distribution rules</h2><ModeBadge mode={project.mode} /></div><div className="policy-columns"><FeeDetails mode={project.mode} holderShareBps={project.holderShareBps} recipients={recipients} compact /><div className="policy-explanation">{destinationRules(project)}</div></div>{project.network === "simulator" && <div className="epoch-control"><div><strong>Test distribution when you are ready.</strong><p>Take a snapshot and distribute available fees.</p></div><button type="button" className="button button-secondary button-small" onClick={() => { if (!state?.wallet) setIdentityOpen(true); else { setError(null); setAction("distribute"); } }}><Play size={14} />Run simulation epoch</button></div>}<div className="policy-receipt"><span>Policy: {shortAddress(project.policyHash)}</span><Link className="text-button" href="/rewards">View Rewards<ArrowUpRight size={15} /></Link></div></section>
      <TokenActivity activity={activity} />
    </div><aside className="token-aside"><TradePanel project={project} /><div className="token-warning"><ShieldAlert size={17} /><p>Test tokens can lose all their value. No profit or APY is promised. Never send real funds to simulator addresses.</p></div></aside></div>
    <Dialog open={action !== null} onClose={() => setAction(null)} title={action === "migrate" ? "Simulate migration" : "Run simulation epoch"} busy={busy}><p className="dialog-intro">{action === "migrate" ? "Move the completed curve into an active pool in the simulator model. No on-chain pool will be created." : "Snapshot current distribution data and distribute available fees using this token’s destination rules."}</p><div className="notice-box"><Clock3 size={18} /><p>{action === "migrate" ? "This does not test Meteora programs, LP locks, or devnet authority." : project.mode === "king_of_hill" ? "The largest single eligible buy wins. A sell invalidates eligibility; transfer activity is not simulated. Earliest buy breaks ties." : project.mode === "underwater" ? "Underwater status can change. Transfer-only balances are excluded because transfers alone do not establish average entry." : project.mode === "cto_on_creator_sell" ? "If the original creator sells in this simulator, CTO activates permanently: later destination fees go to eligible holders. Existing accrued rewards are not rewritten." : "Fees without eligible recipients carry into the next epoch."}</p></div>{error && <InlineError>{error}</InlineError>}<div className="dialog-actions"><button className="button button-secondary" onClick={() => setAction(null)} disabled={busy}>Cancel</button><button className="button button-primary" onClick={() => void run()} disabled={busy}>{busy ? <Spinner /> : <>{action === "migrate" ? "Migrate simulator pool" : "Run epoch"}<ArrowRight size={16} /></>}</button></div></Dialog>
  </>;
}
