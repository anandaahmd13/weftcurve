"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, FlaskConical, LogOut, Plus, ShieldAlert, UserRound, UsersRound } from "lucide-react";
import { useApp } from "./app-provider";
import { Dialog, InlineError, Spinner, WeftMark, shortAddress, units } from "./ui";
import { connectDevnetWallet, signLoginMessage } from "./devnet-wallet";

const personas = [
  { id: "creator", name: "Creator", description: "Launch tokens and test creator rewards.", icon: UserRound },
  { id: "holder-a", name: "Holder A", description: "Buy tokens and receive holder rewards.", icon: UsersRound },
  { id: "holder-b", name: "Holder B", description: "Test how rewards are shared between holders.", icon: UsersRound },
] as const;

function IdentityDialog() {
  const { state, identityOpen, setIdentityOpen, mutate, refresh, notify } = useApp();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const select = async (persona: string) => {
    setPending(persona);
    setError(null);
    try {
      await mutate("/api/simulator/session", { persona });
      setIdentityOpen(false);
      notify("Simulation identity selected. No real wallet is connected.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to activate this identity."); }
    finally { setPending(null); }
  };
  const loginDevnet = async () => {
    setPending("devnet");
    setError(null);
    try {
      const wallet = await connectDevnetWallet();
      const challenge = await mutate<{ nonce: string; message: string }>("/api/auth/challenge", { wallet });
      const signature = await signLoginMessage(challenge.message, wallet);
      await mutate("/api/auth/verify", { nonce: challenge.nonce, signature });
      setIdentityOpen(false);
      notify("Devnet wallet session active. The login signature is not a transaction.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Wallet login was not completed."); }
    finally { setPending(null); }
  };
  const logout = async () => {
    setPending("logout");
    setError(null);
    try { await mutate("/api/auth/logout"); await refresh(); setIdentityOpen(false); notify("Session ended."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to end the session."); }
    finally { setPending(null); }
  };
  if (state?.network === "devnet") return <Dialog open={identityOpen} onClose={() => setIdentityOpen(false)} title="Devnet wallet" busy={Boolean(pending)}><p className="dialog-intro">Connect Phantom or Solflare. Login asks you to sign a readable message, never a transaction or a private key request.</p><div className="notice-box"><ShieldAlert size={18} /><p>Solana devnet only. Operations stay blocked until server configuration and capabilities are verified.</p></div>{error && <InlineError>{error}</InlineError>}<div className="dialog-actions">{state.wallet && <button className="button button-secondary" disabled={Boolean(pending)} onClick={() => void logout()}>End session</button>}<button className="button button-primary" disabled={Boolean(pending)} onClick={() => void loginDevnet()}>{pending === "devnet" ? <Spinner label="Waiting for wallet…" /> : "Log in with devnet wallet"}</button></div></Dialog>;
  return <Dialog open={identityOpen} onClose={() => setIdentityOpen(false)} title="Choose a test identity" busy={Boolean(pending)}>
    <p className="dialog-intro">Pick a role to try the full flow. Each identity starts with 10 simulated SOL; its balance then follows your activity.</p>
    <div className="persona-list">{personas.map(({ id, name, description, icon: Icon }) => <button key={id} type="button" className="persona-option" disabled={Boolean(pending)} onClick={() => void select(id)}><Icon size={21} aria-hidden="true" /><span><strong>{name}</strong><small>{description}</small></span>{pending === id ? <Spinner label="" /> : <ArrowRight size={18} aria-hidden="true" />}</button>)}</div>
    <div className="notice-box"><FlaskConical size={17} aria-hidden="true" /><p>These are local test identities, not connected wallets. No real funds, wallet signatures, or on-chain transactions are involved.</p></div>
    {error && <InlineError>{error}</InlineError>}
    {state?.wallet && <div className="dialog-footer"><span className="fine-print">Active: {state.walletLabel || shortAddress(state.wallet)}</span><button className="text-button" onClick={() => void logout()} disabled={Boolean(pending)}><LogOut size={15} />End session</button></div>}
  </Dialog>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { state, error, refresh, setIdentityOpen, notice } = useApp();
  const [networkOpen, setNetworkOpen] = useState(false);
  const links = [{ href: "/", label: "Explore" }, { href: "/launch", label: "Launch" }, { href: "/rewards", label: "Rewards" }];
  return <div className="app-root">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <Link href="/" className="brand" aria-label="weftcurve, explore tokens"><WeftMark /><span>weftcurve<span className="brand-domain">.fun</span></span></Link>
      <nav className="main-nav" aria-label="Main navigation">{links.map((link) => <Link key={link.href} href={link.href} className={pathname === link.href ? "nav-link nav-link-active" : "nav-link"} aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>)}</nav>
      <button className={`identity-button ${state?.wallet ? "identity-connected" : ""}`} type="button" onClick={() => setIdentityOpen(true)}><UserRound size={16} aria-hidden="true" /><span>{state?.wallet ? state.walletLabel || "Wallet active" : state?.network === "devnet" ? "Log in with wallet" : "Choose identity"}</span><ChevronDown size={14} aria-hidden="true" /></button>
    </div></header>
    <div className="environment-bar"><div className="environment-inner"><button type="button" className="environment-label" onClick={() => setNetworkOpen(true)}><span className="status-dot" />{state?.network === "devnet" ? "Solana Devnet" : "Local simulator"}<ChevronDown size={13} /></button><span className="environment-description">{state?.network === "devnet" ? "Test funds only. Mainnet is disabled." : "A testing space. No real funds."}</span>{state?.wallet && <span className="environment-balance">{units(state.balance, 9, 4)} SOL <span>{state.network === "devnet" ? "devnet" : "simulated"}</span></span>}</div></div>
    <main id="main" className="main-content" tabIndex={-1}>
      {error && <div className="connection-error" role="alert"><span><ShieldAlert size={17} />{error}</span><button className="text-button" onClick={() => void refresh()}>Try again</button></div>}
      {children}
    </main>
    <footer className="site-footer"><div className="footer-inner"><span><WeftMark />Made by creators. Shared with communities.</span><span>weftcurve MVP <span className="footer-separator">/</span> {state?.network === "devnet" ? "Devnet only" : "Simulated, not on-chain"}</span></div></footer>
    <IdentityDialog />
    <Dialog open={networkOpen} onClose={() => setNetworkOpen(false)} title="Test environment"><div className="network-option"><FlaskConical size={21} /><span><strong>Local simulator</strong><small>The complete flow, without real funds or wallets.</small></span>{state?.network !== "devnet" && <Check size={18} />}</div><div className="network-option network-unavailable"><ShieldAlert size={21} /><span><strong>Solana Devnet</strong><small>{state?.network === "devnet" ? "Active environment. Features depend on server capabilities." : "Not active. Requires configuration and server capability checks."}</small></span>{state?.network === "devnet" && <Check size={18} />}</div><p className="fine-print">Mainnet is unavailable. Simulator results do not prove devnet readiness.</p><div className="dialog-actions"><button className="button button-primary" onClick={() => setNetworkOpen(false)}>Got it<ArrowRight size={16} /></button></div></Dialog>
    <div className={`toast ${notice ? "toast-visible" : ""}`} role="status" aria-live="polite">{notice && <><Check size={18} aria-hidden="true" /><span>{notice}</span></>}</div>
  </div>;
}

export function LaunchLink({ small = false }: { small?: boolean }) {
  return <Link href="/launch" className={`button button-primary ${small ? "button-small" : ""}`}><Plus size={17} aria-hidden="true" />Launch a token<ArrowUpRight size={16} aria-hidden="true" /></Link>;
}
