import { useState, useEffect } from "react";
import {
  createConfig, http,
  useAccount, useConnect, useDisconnect, useSwitchChain, useWalletClient, usePublicClient,
  WagmiProvider,
} from "wagmi";
import { base } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseUnits, encodeFunctionData, keccak256, toBytes, hexToNumber } from "viem";
import { signTypedData } from "viem/accounts";

// ─── Wagmi config ─────────────────────────────────────────────────────────────
const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    injected({ target: "metaMask" }),
    injected(),
    coinbaseWallet({ appName: "PixelNFT" }),
  ],
  transports: { [base.id]: http("https://mainnet.base.org") },
});
const queryClient = new QueryClient();

// ─── Constants ────────────────────────────────────────────────────────────────
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PRICE = "0.05";
const AMOUNT = BigInt(Math.round(parseFloat(PRICE) * 1_000_000)); // 50000n

// ─── Pixel preview generator ──────────────────────────────────────────────────
function hexToSeed(hex) {
  const clean = hex.toLowerCase().replace("0x", "");
  const nums = [];
  for (let i = 0; i < clean.length; i += 2) nums.push(parseInt(clean.slice(i, i + 2), 16));
  return nums;
}
function seededRand(seed, index) {
  let s = ((seed[index % seed.length] * 1664525 + 1013904223) ^ (index * 0x9e3779b9)) >>> 0;
  return ((s ^ (s >> 16)) >>> 0) / 0xffffffff;
}
function generatePreviewSVG(address, blurred = false) {
  const seed = hexToSeed(address);
  const palettes = [
    ["#FF6B6B","#FFE66D","#4ECDC4","#1A535C","#FF6B35"],
    ["#E63946","#457B9D","#A8DADC","#1D3557","#F1FAEE"],
    ["#06D6A0","#118AB2","#073B4C","#FFD166","#EF476F"],
    ["#9B5DE5","#F15BB5","#FEE440","#00BBF9","#00F5D4"],
    ["#FB8500","#FFB703","#023047","#219EBC","#8ECAE6"],
    ["#2D00F7","#6A00F4","#8900F2","#A100F2","#BC00DD"],
    ["#FFBE0B","#FB5607","#FF006E","#8338EC","#3A86FF"],
    ["#D62828","#F77F00","#FCBF49","#EAE2B7","#003049"],
  ];
  const pi = Math.floor(seededRand(seed, 0) * palettes.length);
  const palette = palettes[pi];
  const ci = Math.floor(seededRand(seed, 1) * palette.length);
  const main = palette[ci], bg = palette[(ci+2)%palette.length];
  const accent = palette[Math.floor(seededRand(seed,10)*palette.length)];
  const shadow = palette[Math.floor(seededRand(seed,11)*palette.length)];
  const SIZE=16, PX=20, TOTAL=SIZE*PX, half=SIZE/2;
  const grid = [];
  for (let r=0;r<SIZE;r++){
    const row=[];
    for (let c=0;c<half;c++){
      const d=Math.abs(c-half/2)/(half/2);
      row.push(seededRand(seed,r*half+c+20)<(0.55-d*0.25)?1:0);
    }
    grid.push([...row,...[...row].reverse()]);
  }
  let px="";
  for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++) if(grid[r][c]){
    const fill=seededRand(seed,r*SIZE+c+200)<0.1?shadow:seededRand(seed,r*SIZE+c+100)<0.2?accent:main;
    px+=`<rect x="${c*PX}" y="${r*PX}" width="${PX}" height="${PX}" fill="${fill}"/>`;
  }
  const tid=address.slice(2,10).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TOTAL}" height="${TOTAL+40}" viewBox="0 0 ${TOTAL} ${TOTAL+40}" shape-rendering="crispEdges">
    <rect width="${TOTAL}" height="${TOTAL+40}" fill="${bg}"/>
    <rect x="3" y="3" width="${TOTAL-6}" height="${TOTAL-6}" fill="none" stroke="${main}" stroke-width="3" opacity="0.4"/>
    <g${blurred?` style="filter:blur(8px);opacity:0.45"`:""}}>${px}</g>
    ${blurred?`<text x="${TOTAL/2}" y="${TOTAL/2-8}" text-anchor="middle" font-family="monospace" font-size="20" fill="${main}">&#x1F512;</text><text x="${TOTAL/2}" y="${TOTAL/2+16}" text-anchor="middle" font-family="monospace" font-size="10" fill="${main}">PAY TO UNLOCK</text>`:""}
    <rect x="0" y="${TOTAL}" width="${TOTAL}" height="40" fill="${main}"/>
    <text x="${TOTAL/2}" y="${TOTAL+16}" text-anchor="middle" font-family="monospace" font-size="9" font-weight="bold" fill="${bg}" opacity="0.7">PIXEL NFT</text>
    <text x="${TOTAL/2}" y="${TOTAL+32}" text-anchor="middle" font-family="monospace" font-size="11" font-weight="bold" fill="${bg}">#${tid}</text>
  </svg>`;
}

// ─── x402 payment using EIP-3009 transferWithAuthorization ───────────────────
// This is the correct method — signs a typed message, no on-chain tx needed upfront.
// The facilitator verifies the signature and the server delivers the NFT.

async function buildPaymentHeader({ walletClient, from, to, amount, validBefore }) {
  const nonce = keccak256(toBytes(`${from}-${Date.now()}-${Math.random()}`));

  const domain = {
    name: "USD Coin",
    version: "2",
    chainId: base.id,
    verifyingContract: USDC_ADDRESS,
  };

  const types = {
    TransferWithAuthorization: [
      { name: "from",        type: "address" },
      { name: "to",          type: "address" },
      { name: "value",       type: "uint256" },
      { name: "validAfter",  type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce",       type: "bytes32" },
    ],
  };

  const message = {
    from,
    to,
    value: amount,
    validAfter: BigInt(0),
    validBefore: BigInt(validBefore),
    nonce,
  };

  const signature = await walletClient.signTypedData({ domain, types, primaryType: "TransferWithAuthorization", message });

  // x402 exact scheme payload
  return JSON.stringify({
    x402Version: 1,
    scheme: "exact",
    network: "base",
    payload: {
      signature,
      authorization: {
        from,
        to,
        value:       amount.toString(),
        validAfter:  "0",
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  });
}

// ─── Main component ───────────────────────────────────────────────────────────
function PixelNFTApp() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [wallet, setWallet]         = useState("");
  const [step, setStep]             = useState("idle");
  const [svgData, setSvgData]       = useState(null);
  const [error, setError]           = useState("");
  const [statusMsg, setStatusMsg]   = useState("");
  const [showModal, setShowModal]   = useState(false);

  const validWallet = wallet.startsWith("0x") && wallet.length >= 40;
  const wrongNetwork = isConnected && chain?.id !== base.id;
  const isLoading = step === "paying";

  // Auto-fill address when wallet connects
  useEffect(() => { if (address && !wallet) setWallet(address); }, [address]);

  // When wallet connects, close modal
  useEffect(() => { if (isConnected) setShowModal(false); }, [isConnected]);

  const previewSVG  = validWallet ? generatePreviewSVG(wallet, step !== "done") : null;
  const previewBlob = previewSVG  ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewSVG)}` : null;

  async function handlePay() {
    if (!validWallet) return;
    if (!isConnected) { setShowModal(true); return; }
    if (wrongNetwork) { switchChain({ chainId: base.id }); return; }
    if (!walletClient) { setError("Wallet not ready — please try again."); return; }

    setError("");
    setStep("paying");

    try {
      // 1. Probe for payment requirements
      setStatusMsg("Fetching payment requirements...");
      const probe = await fetch(`/api/generate?wallet=${encodeURIComponent(wallet)}`);

      if (probe.status === 200) {
        // Already paid / no payment required (shouldn't happen, but handle gracefully)
        const svg = await probe.text();
        setSvgData(svg);
        setStep("done");
        return;
      }

      if (probe.status !== 402) {
        const body = await probe.json().catch(() => ({}));
        throw new Error(body.error || `Unexpected server response: ${probe.status}`);
      }

      const requirements = await probe.json();
      const req = requirements.accepts?.[0];
      if (!req) throw new Error("Server returned no payment requirements.");

      // 2. Sign EIP-3009 authorization (this opens the wallet popup)
      setStatusMsg("Please sign the payment in your wallet...");
      const validBefore = Math.floor(Date.now() / 1000) + 300; // 5 min window
      const paymentHeader = await buildPaymentHeader({
        walletClient,
        from:        address,
        to:          req.payTo,
        amount:      AMOUNT,
        validBefore,
      });

      // 3. Retry request with payment header
      setStatusMsg("Verifying payment and generating NFT...");
      const res = await fetch(`/api/generate?wallet=${encodeURIComponent(wallet)}`, {
        headers: { "X-PAYMENT": paymentHeader },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error: HTTP ${res.status}`);
      }

      const svgText = await res.text();
      setSvgData(svgText);
      setStep("done");
      setStatusMsg("");

    } catch (e) {
      console.error(e);
      // User rejected in wallet
      if (e.message?.includes("User rejected") || e.message?.includes("user rejected") || e.code === 4001) {
        setError("Transaction cancelled in wallet.");
      } else {
        setError(e.message || "Something went wrong. Please try again.");
      }
      setStep("error");
      setStatusMsg("");
    }
  }

  function handleDownload() {
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `pixel-nft-${wallet.slice(2,10)}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() { setStep("idle"); setSvgData(null); setError(""); setStatusMsg(""); }

  // Deduplicate connectors by name
  const uniqueConnectors = connectors.filter((c, i, arr) => arr.findIndex(x => x.name === c.name) === i);

  return (
    <div className="app">
      <div className="scanlines"/>

      <div className="container">

        {/* Header */}
        <header>
          <div className="logo-row">
            <div className="logo-pixel">
              <div className="px" style={{background:"#FF6B6B"}}/>
              <div className="px" style={{background:"#FFE66D"}}/>
              <div className="px" style={{background:"#4ECDC4"}}/>
              <div className="px" style={{background:"#9B5DE5"}}/>
            </div>
            <div className="logo-titles">
              <h1 className="logo-text">PIXEL<span className="logo-nft">NFT</span></h1>
              <div className="x402-pill">
                <span className="x402-pill-code">x402</span>
                <span className="x402-pill-text">PAYMENT PROTOCOL</span>
              </div>
            </div>
          </div>
          <div className="tagline">Your unique crypto avatar for $0.05 USDC</div>
          <div className="header-bottom">
            <div className="x402-badge"><span className="dot"/>Powered by x402 · Base Mainnet · No minting</div>
            <div className="wallet-area">
              {!isConnected ? (
                <button className="btn-connect" onClick={() => setShowModal(true)}>Connect Wallet</button>
              ) : (
                <div className="wallet-connected">
                  <span className="wallet-net">{chain?.name ?? "Unknown"}</span>
                  <span className="wallet-addr">{address?.slice(0,6)}...{address?.slice(-4)}</span>
                  <button className="btn-disconnect" onClick={() => disconnect()}>✕</button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Wrong network banner */}
        {wrongNetwork && (
          <div className="warn-box">
            ⚠ Your wallet is on <strong>{chain?.name}</strong>, but this app requires <strong>Base Mainnet</strong>.
            <button className="btn-switch" onClick={() => switchChain({ chainId: base.id })} disabled={isSwitching}>
              {isSwitching ? "Switching..." : "Switch to Base"}
            </button>
          </div>
        )}

        {/* Connector modal */}
        {showModal && (
          <div className="modal-overlay" onClick={() => setShowModal(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-title">Connect wallet</div>
              <div className="modal-sub">Select your wallet. Make sure you have USDC on Base Mainnet.</div>
              <div className="connector-list">
                {uniqueConnectors.map(c => (
                  <button key={c.uid} className="btn-connector"
                    onClick={() => connect({ connector: c })}>
                    {c.name}
                  </button>
                ))}
              </div>
              <button className="btn-close" onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Main grid */}
        <div className="main-grid">

          {/* Left — form */}
          <div className="panel">
            <div className="panel-label">01 / WALLET ADDRESS</div>

            <div className="input-wrapper">
              <input className="wallet-input" type="text" placeholder="0x..."
                value={wallet}
                onChange={e => { setWallet(e.target.value); reset(); }}
                disabled={isLoading}
                spellCheck={false} autoComplete="off"
              />
              {wallet && (
                <div className={`input-status ${validWallet ? "valid" : "invalid"}`}>
                  {validWallet ? "✓ valid" : "✗ invalid address"}
                </div>
              )}
            </div>

            {validWallet && step !== "done" && (
              <div className="preview-info">
                <div className="preview-label">NFT PREVIEW</div>
                <div className="preview-note">Unlock the full version by paying $0.05 USDC</div>
              </div>
            )}

            <div className="steps">
              {[
                { n:"01", label:"Connect wallet + paste address", done: isConnected && validWallet },
                { n:"02", label:"Sign $0.05 USDC payment (x402)",  done: step === "done" },
                { n:"03", label:"Download your Pixel NFT",          done: step === "done" },
              ].map(s => (
                <div key={s.n} className={`step ${s.done ? "step-active" : ""}`}>
                  <span className="step-n">{s.done ? "✓" : s.n}</span>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>

            {statusMsg && <div className="status-msg">{statusMsg}</div>}

            {error && (
              <div className="error-box">
                <div className="error-title">⚠ Error</div>
                <div className="error-body">{error}</div>
              </div>
            )}

            {step !== "done" ? (
              <button
                className={`btn-pay ${isLoading?"loading":""} ${!validWallet||wrongNetwork?"btn-disabled":""}`}
                onClick={handlePay}
                disabled={isLoading || !validWallet || wrongNetwork}
              >
                {isLoading ? (
                  <><span className="btn-spinner"/>{ statusMsg || "Processing..."}</>
                ) : wrongNetwork ? (
                  <><span className="btn-icon">⚠</span>Switch to Base first</>
                ) : !isConnected ? (
                  <><span className="btn-icon">◈</span>Connect wallet to pay</>
                ) : (
                  <><span className="btn-icon">◈</span>Pay $0.05 USDC · Get NFT</>
                )}
              </button>
            ) : (
              <div className="done-actions">
                <button className="btn-download" onClick={handleDownload}>↓ Download SVG</button>
                <button className="btn-reset" onClick={reset}>↺ New NFT</button>
              </div>
            )}

            {step === "done" && (
              <div className="success-note">
                NFT generated! Every wallet address produces a unique result.
                Import the SVG to OpenSea, Zora or keep it locally.
              </div>
            )}
          </div>

          {/* Right — preview */}
          <div className="panel">
            <div className="panel-label">02 / PREVIEW</div>
            <div className="nft-frame">
              {!validWallet ? (
                <div className="empty-state">
                  <div className="empty-grid">
                    {Array.from({length:64}).map((_,i)=>(
                      <div key={i} className="empty-px" style={{background:`hsl(${(i*37)%360},60%,30%)`,opacity:i%3===0?0.4:0.1}}/>
                    ))}
                  </div>
                  <div className="empty-label">← paste a wallet address</div>
                </div>
              ) : (
                <div className="nft-preview-wrapper">
                  <img
                    key={wallet+step}
                    src={step==="done"
                      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`
                      : previewBlob}
                    alt="Pixel NFT"
                    className={`nft-img ${step==="done"?"nft-unlocked":"nft-locked"}`}
                  />
                  {step!=="done" && (
                    <div className="lock-overlay">
                      <div className="lock-icon">◈</div>
                      <div className="lock-text">Pay $0.05 to unlock</div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {validWallet && (
              <div className="nft-meta">
                {[["TOKEN ID",`#${wallet.slice(2,10).toUpperCase()}`],["NETWORK","Base Mainnet"],["FORMAT","SVG (scalable)"],["PRICE","$0.05 USDC"]].map(([k,v])=>(
                  <div key={k} className="meta-row">
                    <span className="meta-key">{k}</span>
                    <span className={`meta-val ${k==="PRICE"?"meta-price":""}`}>{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Explainer */}
        <div className="explainer">
          <div className="explainer-title">HOW DOES x402 WORK?</div>
          <div className="explainer-cards">
            {[
              {code:"402",text:"Server responds HTTP 402 — payment request with price and recipient address"},
              {code:"✍",text:"Your wallet signs an EIP-3009 authorization (no gas needed) and sends it in X-PAYMENT header"},
              {code:"✓",text:"Coinbase facilitator verifies the signature onchain → server returns 200 OK + your Pixel NFT"},
            ].map(c=>(
              <div key={c.code} className="ex-card">
                <div className="ex-code">{c.code}</div>
                <div className="ex-text">{c.text}</div>
              </div>
            ))}
          </div>
        </div>

        <footer>PIXEL NFT · x402 Protocol · Base Mainnet · SVG on demand</footer>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Share+Tech+Mono&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        :root{
          --bg:#0C0C14;--bg2:#18182A;--bg3:#1A1A2A;
          --cyan:#00F5FF;--magenta:#FF006E;--yellow:#FFB800;--green:#00FF88;
          --dim:#E0E0FF;--text:#FFFFFF;--border:#8888AA;
        }
        body{background:var(--bg);color:var(--text);font-family:'Share Tech Mono',monospace;min-height:100vh}
        .app{position:relative;min-height:100vh}
        .scanlines{position:fixed;inset:0;pointer-events:none;z-index:10;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.08) 2px,rgba(0,0,0,0.08) 4px)}
        .container{max-width:900px;margin:0 auto;padding:2rem 1.5rem 4rem;position:relative;z-index:1}

        header{margin-bottom:2rem}
        .logo-row{display:flex;align-items:center;gap:1rem;margin-bottom:0.5rem}
        .logo-pixel{display:grid;grid-template-columns:1fr 1fr;gap:3px;width:28px;height:28px}
        .px{border-radius:1px}
        .logo-titles{display:flex;flex-direction:column;gap:0.4rem}
        .logo-text{font-family:'Press Start 2P',monospace;font-size:clamp(1.2rem,4vw,2rem);color:var(--cyan);text-shadow:3px 3px 0 rgba(0,245,255,0.2);letter-spacing:0.05em}
        .logo-nft{color:var(--magenta);text-shadow:3px 3px 0 rgba(255,0,110,0.2)}
        .x402-pill{display:inline-flex;align-items:center;overflow:hidden;border-radius:2px;font-family:'Share Tech Mono',monospace;font-size:0.62rem;letter-spacing:0.08em;border:1px solid var(--cyan);width:fit-content}
        .x402-pill-code{background:var(--cyan);color:#000;font-weight:bold;padding:0.18rem 0.45rem}
        .x402-pill-text{color:var(--cyan);padding:0.18rem 0.5rem}
        .tagline{font-size:0.8rem;color:#F0F0FF;margin-bottom:0.5rem}
        .header-bottom{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem}
        .x402-badge{display:inline-flex;align-items:center;gap:0.5rem;font-size:0.72rem;color:#E8E8FF;border:1px solid var(--border);padding:0.3rem 0.7rem}
        .dot{width:6px;height:6px;background:var(--green);border-radius:50%;animation:blink 1.8s ease-in-out infinite}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}

        .wallet-area{display:flex;align-items:center}
        .btn-connect{background:transparent;border:1px solid var(--cyan);color:var(--cyan);font-family:'Share Tech Mono',monospace;font-size:0.75rem;padding:0.4rem 1rem;cursor:pointer;transition:background 0.15s}
        .btn-connect:hover{background:rgba(0,245,255,0.1)}
        .wallet-connected{display:flex;align-items:center;gap:0.5rem;border:1px solid var(--border);padding:0.3rem 0.7rem}
        .wallet-net{font-size:0.65rem;color:var(--yellow)}
        .wallet-addr{font-size:0.72rem;color:var(--green)}
        .btn-disconnect{background:transparent;border:none;color:var(--dim);font-size:0.8rem;cursor:pointer;padding:0 0.2rem}
        .btn-disconnect:hover{color:var(--magenta)}

        .warn-box{background:rgba(255,184,0,0.08);border:1px solid rgba(255,184,0,0.5);color:#FFD060;font-size:0.8rem;padding:0.85rem 1rem;margin-bottom:1.5rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;line-height:1.5}
        .btn-switch{background:var(--yellow);color:#000;border:none;font-family:'Share Tech Mono',monospace;font-size:0.75rem;padding:0.4rem 0.9rem;cursor:pointer;white-space:nowrap}
        .btn-switch:disabled{opacity:0.5;cursor:wait}

        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:200;display:flex;align-items:center;justify-content:center}
        .modal{background:var(--bg2);border:1px solid var(--border);padding:2rem;width:340px;max-width:90vw;display:flex;flex-direction:column;gap:1rem}
        .modal-title{font-family:'Press Start 2P',monospace;font-size:0.8rem;color:var(--cyan)}
        .modal-sub{font-size:0.72rem;color:var(--dim);line-height:1.5}
        .connector-list{display:flex;flex-direction:column;gap:0.5rem}
        .btn-connector{background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:'Share Tech Mono',monospace;font-size:0.85rem;padding:0.75rem 1rem;cursor:pointer;text-align:left;transition:border-color 0.15s,color 0.15s}
        .btn-connector:hover{border-color:var(--cyan);color:var(--cyan)}
        .btn-close{background:transparent;border:1px solid var(--border);color:var(--dim);font-family:'Share Tech Mono',monospace;font-size:0.8rem;padding:0.5rem;cursor:pointer}
        .btn-close:hover{border-color:var(--text);color:var(--text)}

        .main-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:3rem}
        @media(max-width:640px){.main-grid{grid-template-columns:1fr}}
        .panel{background:var(--bg2);border:1px solid var(--border);padding:1.5rem}
        .panel-label{font-size:0.65rem;color:var(--dim);letter-spacing:0.15em;margin-bottom:1.25rem;border-bottom:1px solid var(--border);padding-bottom:0.5rem}

        .input-wrapper{margin-bottom:1.25rem}
        .wallet-input{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--cyan);font-family:'Share Tech Mono',monospace;font-size:0.85rem;padding:0.7rem 0.9rem;outline:none;transition:border-color 0.2s}
        .wallet-input:focus{border-color:var(--cyan)}
        .wallet-input::placeholder{color:#AAAAEE}
        .wallet-input:disabled{opacity:0.5}
        .input-status{font-size:0.65rem;margin-top:0.35rem;padding:0.2rem 0.5rem}
        .valid{color:var(--green)}
        .invalid{color:var(--magenta)}

        .preview-info{margin-bottom:1rem}
        .preview-label{font-size:0.65rem;color:var(--yellow);letter-spacing:0.1em}
        .preview-note{font-size:0.65rem;color:var(--dim);margin-top:0.2rem}

        .steps{display:flex;flex-direction:column;gap:0.5rem;margin-bottom:1.25rem}
        .step{display:flex;align-items:center;gap:0.6rem;font-size:0.72rem;color:var(--dim);padding:0.4rem;transition:color 0.3s}
        .step-active{color:var(--text)}
        .step-n{font-family:'Press Start 2P',monospace;font-size:0.55rem;color:var(--dim);min-width:24px;background:var(--border);padding:2px 5px;text-align:center;transition:background 0.3s,color 0.3s}
        .step-active .step-n{background:var(--cyan);color:#000}

        .status-msg{font-size:0.72rem;color:var(--cyan);margin-bottom:0.75rem;padding:0.5rem;border:1px solid rgba(0,245,255,0.2);background:rgba(0,245,255,0.04);animation:pulse 1.5s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}

        .error-box{background:rgba(255,0,110,0.06);border:1px solid rgba(255,0,110,0.3);padding:0.8rem;margin-bottom:1rem}
        .error-title{font-size:0.7rem;color:var(--magenta);margin-bottom:0.3rem}
        .error-body{font-size:0.68rem;color:#FF88AA;line-height:1.5;word-break:break-word}

        .btn-pay{width:100%;display:flex;align-items:center;justify-content:center;gap:0.5rem;padding:0.9rem 1rem;background:var(--cyan);color:#000;font-family:'Share Tech Mono',monospace;font-size:0.8rem;font-weight:bold;border:none;cursor:pointer;transition:background 0.15s,transform 0.1s;margin-bottom:1rem}
        .btn-pay:hover:not(.btn-disabled):not(.loading){background:var(--yellow)}
        .btn-pay:active:not(.btn-disabled){transform:scale(0.98)}
        .btn-pay.btn-disabled{opacity:0.4;cursor:not-allowed}
        .btn-pay.loading{background:var(--bg3);color:var(--cyan);border:1px solid var(--cyan);cursor:wait}
        .btn-icon{font-size:1rem}
        .btn-spinner{width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 0.7s linear infinite;flex-shrink:0}
        @keyframes spin{to{transform:rotate(360deg)}}
        .done-actions{display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:1rem}
        .btn-download{padding:0.7rem;background:var(--green);color:#000;font-family:'Share Tech Mono',monospace;font-size:0.8rem;border:none;cursor:pointer;font-weight:bold}
        .btn-download:hover{opacity:0.85}
        .btn-reset{padding:0.7rem;background:transparent;border:1px solid #9090BB;color:#E0E0FF;font-family:'Share Tech Mono',monospace;font-size:0.8rem;cursor:pointer}
        .btn-reset:hover{border-color:var(--text);color:var(--text)}
        .success-note{font-size:0.68rem;color:var(--dim);line-height:1.5}

        .nft-frame{background:var(--bg);border:1px solid var(--border);aspect-ratio:1;display:flex;align-items:center;justify-content:center;margin-bottom:1rem;overflow:hidden;position:relative}
        .empty-state{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem}
        .empty-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;width:60%;aspect-ratio:1;image-rendering:pixelated}
        .empty-px{aspect-ratio:1;animation:flicker 3s ease-in-out infinite}
        @keyframes flicker{0%,100%{opacity:0.4}50%{opacity:0.1}}
        .empty-label{font-size:0.65rem;color:var(--dim)}
        .nft-preview-wrapper{width:100%;height:100%;position:relative}
        .nft-img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated;transition:filter 0.4s}
        .nft-locked{filter:blur(8px) brightness(0.6)}
        .nft-unlocked{filter:none;animation:reveal 0.5s ease-out}
        @keyframes reveal{from{filter:blur(8px) brightness(0.6);transform:scale(0.98)}to{filter:none;transform:scale(1)}}
        .lock-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.5rem}
        .lock-icon{font-family:'Press Start 2P',monospace;font-size:1.5rem;color:var(--cyan);animation:float 2s ease-in-out infinite}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        .lock-text{font-size:0.65rem;color:var(--dim)}

        .nft-meta{display:flex;flex-direction:column;gap:0.4rem}
        .meta-row{display:flex;justify-content:space-between;font-size:0.7rem;padding:0.35rem 0;border-bottom:1px solid var(--border)}
        .meta-key{color:var(--dim)}
        .meta-val{color:var(--text)}
        .meta-price{color:var(--yellow)}

        .explainer{margin-bottom:3rem}
        .explainer-title{font-family:'Press Start 2P',monospace;font-size:0.65rem;color:#E8E8FF;letter-spacing:0.15em;margin-bottom:1rem}
        .explainer-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}
        @media(max-width:540px){.explainer-cards{grid-template-columns:1fr}}
        .ex-card{background:var(--bg2);border:1px solid var(--border);padding:1rem}
        .ex-code{font-family:'Press Start 2P',monospace;font-size:1.1rem;color:var(--cyan);margin-bottom:0.6rem}
        .ex-text{font-size:0.7rem;color:var(--dim);line-height:1.6}

        footer{text-align:center;font-size:0.65rem;color:#C8C8F0;letter-spacing:0.1em}
      `}</style>
    </div>
  );
}

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <PixelNFTApp />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
