"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ImagePlus, Info, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import type { Project } from "@/domain/types";
import { useApp } from "./app-provider";
import { Dialog, FeeDetails, InlineError, ModeBadge, Spinner, TokenAvatar, feeDestinationModes, modeDescriptions, modeLabels, type FeeDestinationMode, type RewardRecipient } from "./ui";
import { signAndSendDevnet } from "./devnet-wallet";

type LaunchMode = Exclude<FeeDestinationMode, "split" | "legacy_split">;
type CharityName = "Open Source Collective" | "Community Food Bank" | "Ocean Cleanup Fund";

const charityDestinations: Record<CharityName, string> = {
  "Open Source Collective": "simulator:open-source-collective",
  "Community Food Bank": "simulator:community-food-bank",
  "Ocean Cleanup Fund": "simulator:ocean-cleanup-fund",
};
const charityNames = Object.keys(charityDestinations) as CharityName[];
const simulatorWalletPresets = [
  { label: "Demo creator", wallet: "sim:creator" },
  { label: "Holder A", wallet: "sim:holder-a" },
  { label: "Holder B", wallet: "sim:holder-b" },
] as const;

function equalShares(count: number) {
  const share = Math.floor(10000 / count);
  return Array.from({ length: count }, (_, index) => share + (index < 10000 % count ? 1 : 0));
}

function newWalletRecipient(index: number, shareBps = 10000): RewardRecipient {
  return { id: crypto.randomUUID(), label: `Wallet ${index + 1}`, kind: "wallet", wallet: "", shareBps };
}

function recipientTotal(recipients: RewardRecipient[]) {
  return recipients.reduce((total, recipient) => total + recipient.shareBps, 0);
}

function isWalletAddress(value: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}

export function LaunchScreen() {
  const { state, loading, mutate, refresh, setIdentityOpen, notify } = useApp();
  const router = useRouter();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [mode, setMode] = useState<LaunchMode>("creator");
  const [recipients, setRecipients] = useState<RewardRecipient[]>([newWalletRecipient(0)]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const devnet = state?.network === "devnet";
  const [submittedIntent, setSubmittedIntent] = useState<string | null>(null);
  const disabledReason = state?.capabilities.launch === false ? state.capabilities.reason || "Launch is unavailable in this environment." : null;
  const shareTotal = recipientTotal(recipients);
  const charityCount = recipients.filter((recipient) => recipient.kind === "charity").length;
  const shareRecipientsValid = recipients.length >= 1 && charityCount <= 5 && shareTotal === 10000 && recipients.every((recipient) => recipient.kind === "charity" || (!devnet && simulatorWalletPresets.some((preset) => preset.wallet === recipient.wallet)) || isWalletAddress(recipient.wallet));

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageError(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 200000) {
      setImageError("Choose a PNG, JPEG, or WebP file no larger than 200 KB.");
      event.target.value = "";
      return;
    }
    setImageLoading(true);
    const reader = new FileReader();
    reader.onload = () => { setImage(String(reader.result)); setImageLoading(false); };
    reader.onerror = () => { setImageError("Unable to read this image. Choose another file."); setImageLoading(false); };
    reader.readAsDataURL(file);
  };

  const changeMode = (nextMode: LaunchMode) => {
    if (devnet && nextMode !== "creator") return;
    setMode(nextMode);
    setAcknowledged(false);
    setError(null);
  };
  const updateRecipient = (id: string, update: Partial<RewardRecipient>) => {
    setRecipients((current) => current.map((recipient) => recipient.id === id ? { ...recipient, ...update } : recipient));
    setAcknowledged(false);
  };
  const changeRecipientKind = (id: string, kind: RewardRecipient["kind"]) => {
    setRecipients((current) => current.map((recipient) => {
      if (recipient.id !== id) return recipient;
      if (kind === "charity") return { ...recipient, kind, label: charityNames[0], wallet: charityDestinations[charityNames[0]] };
      return { ...recipient, kind, label: `Wallet ${current.findIndex((item) => item.id === id) + 1}`, wallet: "" };
    }));
    setAcknowledged(false);
  };
  const chooseCharity = (id: string, name: CharityName) => updateRecipient(id, { label: name, wallet: charityDestinations[name] });
  const addRecipient = () => {
    setRecipients((current) => {
      const charityCount = current.filter((recipient) => recipient.kind === "charity").length;
      if (charityCount >= 5) return current;
      const next = [...current, newWalletRecipient(current.length, 0)];
      const shares = equalShares(next.length);
      return next.map((recipient, index) => ({ ...recipient, shareBps: shares[index] }));
    });
    setAcknowledged(false);
  };
  const removeRecipient = (id: string) => {
    setRecipients((current) => {
      if (current.length <= 1) return current;
      const next = current.filter((recipient) => recipient.id !== id);
      const shares = equalShares(next.length);
      return next.map((recipient, index) => ({ ...recipient, shareBps: shares[index] }));
    });
    setAcknowledged(false);
  };

  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!state?.wallet) { setIdentityOpen(true); return; }
    if (!acknowledged || disabledReason || (devnet && mode !== "creator") || !name.trim() || !symbol.trim() || (mode === "share" && !shareRecipientsValid)) return;
    setReviewOpen(true);
  };

  const launch = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { name: name.trim(), symbol: symbol.trim().toUpperCase(), description: description.trim(), image, mode, holderShareBps: 0, recipients: mode === "share" ? recipients : [] };
      let result: { project: Project };
      if (devnet) {
        if (!state?.wallet || !state.capabilities.launch) throw new Error("Devnet launch is unavailable.");
        let intentId = submittedIntent;
        if (!intentId) {
          const prepared = await mutate<{ intentId: string; transactionBase64: string }>("/api/devnet/launch", payload);
          intentId = prepared.intentId;
          await signAndSendDevnet(prepared.transactionBase64, state.wallet);
          setSubmittedIntent(prepared.intentId);
        }
        result = await mutate<{ project: Project }>("/api/devnet/launch/confirm", { intentId });
      } else result = await mutate<{ project: Project }>("/api/projects", payload);
      await refresh();
      setReviewOpen(false);
      notify(devnet ? `${result.project.name} verified on Solana devnet.` : `${result.project.name} launched in the simulator. No on-chain transaction was made.`);
      router.push(`/token/${encodeURIComponent(result.project.mint)}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to launch this token."); }
    finally { setBusy(false); }
  };

  const preview = { name: name.trim() || "Your token name", symbol: symbol.trim() || "TOKEN", image };
  const modeNotice = mode === "creator" ? "Creator mode routes the full destination share to the creator." : mode === "holders" ? "Holders mode distributes the full destination share among eligible holders at each epoch." : mode === "king_of_hill" ? "King of the Hill uses the largest single eligible buy. A sell invalidates eligibility, and the earliest buy breaks ties. The simulator tracks sales; transfer activity is not simulated." : mode === "underwater" ? "Underwater Holders distributes to holders whose current average entry is above current price. Transfer-only balances are excluded because transfers alone do not establish entry. Eligibility can change." : mode === "cto_on_creator_sell" ? "CTO starts with the creator. If the original creator sells through this simulator, it permanently routes future destination fees to eligible holders. Earlier accrued rewards remain with the creator." : "Share mode uses the exact recipient percentages below.";
  const devnetDistributionNotice = "Simulator-only until verified distribution infrastructure is enabled.";
  return <>
    <Link className="back-link" href="/"><ArrowLeft size={15} />Back to Explore</Link>
    <header className="page-heading"><div><h1>Start with your idea.</h1><p>Create a token. Choose where its destination fee goes.</p></div><span className="context-label">{devnet ? "Launch on devnet" : "Launch in the simulator"}</span></header>
    <div className="launch-layout">
      <form className="launch-form" onSubmit={review}>
        <section className="form-section" aria-labelledby="identity-title"><div className="form-section-heading"><h2 id="identity-title">Token identity</h2><p>A name your community can make its own.</p></div>
          <div className="image-upload-row"><button className={`image-upload ${image ? "image-upload-filled" : ""}`} type="button" onClick={() => fileInput.current?.click()} aria-label={image ? "Change token image" : "Upload token image"} disabled={imageLoading}>{image ? <TokenAvatar project={preview} large /> : <ImagePlus size={25} />}</button><div><strong>Token image <span className="optional-label">optional</span></strong><p className="fine-print">PNG, JPEG, or WebP. Maximum 200 KB.</p><div className="upload-actions"><button type="button" className="text-button" onClick={() => fileInput.current?.click()} disabled={imageLoading}>{imageLoading ? "Reading image…" : image ? "Change image" : "Choose file"}<ArrowRight size={14} /></button>{image && <button className="text-button muted" type="button" onClick={() => { setImage(null); if (fileInput.current) fileInput.current.value = ""; }}><X size={14} />Remove</button>}</div></div><input ref={fileInput} type="file" className="sr-only" tabIndex={-1} accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadImage(event)} aria-label="Token image file" /></div>
          {imageError && <InlineError>{imageError}</InlineError>}
          <div className="field-pair"><label className="field"><span>Token name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Common Ground" required maxLength={32} autoComplete="off" /><small>{name.length}/32 characters</small></label><label className="field"><span>Symbol</span><div className="input-prefix"><span>$</span><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="GROUND" required pattern="[A-Za-z0-9]{2,10}" minLength={2} maxLength={10} autoComplete="off" title="2–10 letters or numbers, without spaces" /></div><small>2–10 letters or numbers</small></label></div>
          <label className="field"><span>Description <span className="optional-label">optional</span></span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={500} placeholder="Share the idea and community behind your token." /><small>{description.length}/500 characters</small></label>
        </section>

        <section className="form-section" aria-labelledby="mode-title"><div className="form-section-heading"><h2 id="mode-title">Fee destination</h2><p>Choose who receives the 0.30% destination share.</p></div><label className="field mode-select-field"><span>Destination mode</span><select value={mode} onChange={(event) => changeMode(event.target.value as LaunchMode)}>{feeDestinationModes.map((value) => <option key={value} value={value} disabled={devnet && value !== "creator"}>{modeLabels[value]}{devnet && value !== "creator" ? " — Simulator-only" : ""}</option>)}</select><small>{devnet && mode !== "creator" ? devnetDistributionNotice : modeDescriptions[mode]}</small></label>
          <div className="mode-disclosure"><Info size={17} aria-hidden="true" /><p>{devnet && mode !== "creator" ? devnetDistributionNotice : modeNotice}</p></div>
          {mode === "share" && <div className="recipient-editor" aria-labelledby="recipient-title"><div className="recipient-editor-heading"><div><h3 id="recipient-title">Recipients</h3><p>Set wallet recipients and up to five simulated charities. Percentages must total exactly 100%.</p></div><strong className={shareTotal === 10000 ? "recipient-total-valid" : "recipient-total-invalid"}>Total {shareTotal / 100}%</strong></div>
            <div className="recipient-list">{recipients.map((recipient, index) => <div className="recipient-row" key={recipient.id}><div className="recipient-row-heading"><strong>Recipient {index + 1}</strong><button type="button" className="text-button recipient-remove" onClick={() => removeRecipient(recipient.id)} disabled={recipients.length === 1} aria-label={`Remove recipient ${index + 1}`}><Trash2 size={14} />Remove</button></div><div className="recipient-fields"><label className="field"><span>Destination</span><select value={recipient.kind} onChange={(event) => changeRecipientKind(recipient.id, event.target.value as RewardRecipient["kind"])}><option value="wallet">Wallet</option>{!devnet && <option value="charity" disabled={charityCount >= 5 && recipient.kind !== "charity"}>Simulator charity</option>}</select></label>{recipient.kind === "wallet" ? <label className="field"><span>Wallet address</span><input list={!devnet ? "simulator-wallet-presets" : undefined} value={recipient.wallet} onChange={(event) => updateRecipient(recipient.id, { wallet: event.target.value })} placeholder={devnet ? "Solana wallet address" : "Solana address or simulator identity"} autoComplete="off" spellCheck={false} /><small>{recipient.wallet && !isWalletAddress(recipient.wallet) && !(!devnet && simulatorWalletPresets.some((preset) => preset.wallet === recipient.wallet)) ? "Enter a 32–44 character Solana address." : "Recipient receives the selected percentage."}</small></label> : <label className="field"><span>Simulator charity</span><select value={recipient.label} onChange={(event) => chooseCharity(recipient.id, event.target.value as CharityName)}>{charityNames.map((charity) => <option value={charity} key={charity}>{charity}</option>)}</select><small>Simulator-only entry. Not an externally verified recipient.</small></label>}<label className="field recipient-percent"><span>Percentage</span><div className="percentage-input"><input type="number" min="0.01" max="100" step="0.01" inputMode="decimal" value={recipient.shareBps / 100} onChange={(event) => updateRecipient(recipient.id, { shareBps: Math.max(0, Math.min(10000, Math.round(Number(event.target.value || 0) * 100))) })} /><span>%</span></div></label></div></div>)}</div>
            <div className="recipient-editor-actions"><button type="button" className="button button-secondary button-small" onClick={addRecipient} disabled={charityCount >= 5}><Plus size={15} />Add recipient</button><p className="fine-print">Charity donations are simulated. No external organization is contacted or verified.</p></div>
            {!devnet && <datalist id="simulator-wallet-presets">{simulatorWalletPresets.map((preset) => <option key={preset.wallet} value={preset.wallet}>{preset.label}</option>)}</datalist>}
            {shareTotal !== 10000 && <InlineError>Recipient percentages must add up to exactly 100%.</InlineError>}
            {recipients.some((recipient) => recipient.kind === "wallet" && recipient.wallet && !isWalletAddress(recipient.wallet) && !(!devnet && simulatorWalletPresets.some((preset) => preset.wallet === recipient.wallet))) && <InlineError>Each wallet recipient needs a valid Solana address or simulator identity.</InlineError>}
          </div>}
        </section>

        <section className="form-section disclosure-section" aria-labelledby="custody-title"><div className="form-section-heading"><h2 id="custody-title">Before you launch</h2></div><div className="disclosure-copy"><ShieldAlert size={20} aria-hidden="true" /><div><p>{modeNotice}</p><p>{mode === "share" ? "Wallet recipients are supplied by you. Charity options only model simulator destinations; they do not verify, endorse, or contact an external organization." : "The platform holds collector authority and custody of unpaid rewards. Holder-style destinations are evaluated using the distribution rules at an epoch."}</p><p>Collector authority is not limited to fees. On devnet, pool creator rights can include surplus and creator transfers. This is not a fee-only permission.</p><p>The selected destination cannot be changed through this app after launch. This is an application rule, not a guarantee of on-chain immutability.</p></div></div><label className="checkbox-field"><input type="checkbox" required checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I understand the fee destination, platform custody, and authority described above. {devnet ? "This uses devnet test funds only." : "This is a simulation with no real funds."}</span></label></section>
        {disabledReason && <InlineError>{disabledReason}</InlineError>}
        {error && !reviewOpen && <InlineError>{error}</InlineError>}
        <div className="form-actions"><p className="fine-print">No additional platform launch fee.</p>{!state?.wallet ? <button type="button" className="button button-primary" onClick={() => setIdentityOpen(true)} disabled={loading}>{devnet ? "Log in with wallet" : "Choose identity"}<ArrowRight size={17} /></button> : <button type="submit" className="button button-primary" disabled={loading || !acknowledged || imageLoading || Boolean(disabledReason) || (devnet && mode !== "creator") || (mode === "share" && !shareRecipientsValid)}>Review token<ArrowRight size={17} /></button>}</div>
      </form>

      <aside className="launch-aside"><section className="panel preview-panel"><h2>Token preview</h2><div className="token-preview"><TokenAvatar project={preview} large /><div><h3>{preview.name}</h3><span>${preview.symbol}</span></div></div>{description && <p className="preview-description">{description}</p>}<ModeBadge mode={mode} /><dl className="definition-list preview-facts"><div><dt>Network</dt><dd>{devnet ? "Solana Devnet" : "Local simulator"}</dd></div><div><dt>Supply</dt><dd>1 billion tokens</dd></div><div><dt>Decimals</dt><dd>6</dd></div><div><dt>Quote asset</dt><dd>SOL</dd></div><div><dt>Migration threshold</dt><dd>1 SOL</dd></div></dl></section><section className="panel"><h2>Fee breakdown</h2><FeeDetails mode={mode} recipients={mode === "share" ? recipients : []} /><div className="aside-note"><Info size={16} /><p>Destination rules are evaluated from collected fees. No return is fixed or promised.</p></div></section></aside>
    </div>
    <Dialog open={reviewOpen} onClose={() => setReviewOpen(false)} title="Review your launch" wide busy={busy}><div className="review-token"><TokenAvatar project={preview} /><div><strong>{preview.name}</strong><span>${preview.symbol}</span></div><ModeBadge mode={mode} /></div><p className="dialog-intro">Your token will be created {devnet ? "on Solana devnet" : "in the local simulator"}. These settings cannot be changed through the app.</p><FeeDetails mode={mode} recipients={mode === "share" ? recipients : []} compact /><div className="notice-box"><ShieldAlert size={18} /><p>{modeNotice} The platform controls collector authority, including rights beyond fees. {mode === "share" && !devnet ? "Simulator charities are not contacted or verified. " : ""}{devnet ? "Your wallet will ask you to sign a devnet transaction." : "No on-chain transaction will be made."}</p></div>{error && <InlineError>{error}</InlineError>}<div className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setReviewOpen(false)} disabled={busy || Boolean(submittedIntent)}>Back to edit</button><button type="button" className="button button-primary" onClick={() => void launch()} disabled={busy}>{busy ? <Spinner label="Processing launch…" /> : <>{submittedIntent ? "Check launch status" : devnet ? "Sign devnet launch" : "Launch in simulator"}<Check size={17} /></>}</button></div></Dialog>
  </>;
}
