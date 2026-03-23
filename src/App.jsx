import { useState, useCallback, useRef } from "react";

// ─── Pixel Art Preview (local preview WITHOUT payment) ───────────────────────
// Identical algorithm as backend — user sees preview before paying

function hexToSeed(hex) {
  const clean = hex.toLowerCase().replace("0x", "");
  const nums = [];
  for (let i = 0; i < clean.length; i += 2) {
    nums.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return nums;
}

function seededRand(seed, index) {
  let s = ((seed[index % seed.length] * 1664525 + 1013904223) ^ (index * 0x9e3779b9)) >>> 0;
  s = (s ^ (s >> 16)) >>> 0;
  return s / 0xffffffff;
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
  const paletteIdx = Math.floor(seededRand(seed, 0) * palettes.length);
  const palette = palettes[paletteIdx];
  const colorIdx = Math.floor(seededRand(seed, 1) * palette.length);
  const mainColor = palette[colorIdx];
  const bgColor = palette[(colorIdx + 2) % palette.length];
  const accentColor = palette[Math.floor(seededRand(seed, 10) * palette.length)];
  const shadowColor = palette[Math.floor(seededRand(seed, 11) * palette.length)];

  const SIZE = 16, PIXEL = 20, TOTAL = SIZE * PIXEL, half = SIZE / 2;
  const grid = [];
  for (let row = 0; row < SIZE; row++) {
    const rowArr = [];
    for (let col = 0; col < half; col++) {
      const distFromCenter = Math.abs(col - half / 2) / (half / 2);
      const density = 0.55 - distFromCenter * 0.25;
      rowArr.push(seededRand(seed, row * half + col + 20) < density ? 1 : 0);
    }
    grid.push([...rowArr, ...[...rowArr].reverse()]);
  }

  let pixels = "";
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (grid[row][col]) {
        const x = col * PIXEL, y = row * PIXEL;
        const useAccent = seededRand(seed, row * SIZE + col + 100) < 0.2;
        const useShadow = seededRand(seed, row * SIZE + col + 200) < 0.1;
        const fill = useShadow ? shadowColor : useAccent ? accentColor : mainColor;
        pixels += `<rect x="${x}" y="${y}" width="${PIXEL}" height="${PIXEL}" fill="${fill}"/>`;
      }
    }
  }

  const tokenId = address.slice(2, 10).toUpperCase();
  const blurFilter = blurred ? `<filter id="blur"><feGaussianBlur stdDeviation="8"/></filter>` : "";
  const blurAttr = blurred ? ` filter="url(#blur)" opacity="0.5"` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TOTAL}" height="${TOTAL + 40}" viewBox="0 0 ${TOTAL} ${TOTAL + 40}" shape-rendering="crispEdges">
    <defs>${blurFilter}</defs>
    <rect width="${TOTAL}" height="${TOTAL + 40}" fill="${bgColor}"/>
    <rect x="3" y="3" width="${TOTAL - 6}" height="${TOTAL - 6}" fill="none" stroke="${mainColor}" stroke-width="3" opacity="0.4"/>
    <g${blurAttr}>${pixels}</g>
    ${blurred ? `<rect x="0" y="0" width="${TOTAL}" height="${TOTAL}" fill="${bgColor}" opacity="0.3"/>
    <text x="${TOTAL/2}" y="${TOTAL/2 - 10}" text-anchor="middle" font-family="monospace" font-size="22" fill="${mainColor}" font-weight="bold">🔒</text>
    <text x="${TOTAL/2}" y="${TOTAL/2 + 18}" text-anchor="middle" font-family="monospace" font-size="11" fill="${mainColor}">PAY TO UNLOCK</text>` : ""}
    <rect x="0" y="${TOTAL}" width="${TOTAL}" height="40" fill="${mainColor}"/>
    <text x="${TOTAL/2}" y="${TOTAL + 16}" text-anchor="middle" font-family="monospace" font-size="9" font-weight="bold" fill="${bgColor}" opacity="0.7">PIXEL NFT</text>
    <text x="${TOTAL/2}" y="${TOTAL + 32}" text-anchor="middle" font-family="monospace" font-size="11" font-weight="bold" fill="${bgColor}">#${tokenId}</text>
  </svg>`;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function App() {
  const [wallet, setWallet] = useState("");
  const [step, setStep] = useState("idle"); // idle | preview | paying | done | error
  const [svgData, setSvgData] = useState(null);
  const [error, setError] = useState("");
  const downloadRef = useRef();

  const validWallet = wallet.startsWith("0x") && wallet.length >= 40;
  const previewSVG = validWallet ? generatePreviewSVG(wallet, step !== "done") : null;
  const previewBlob = previewSVG ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewSVG)}` : null;

  async function handlePay() {
    if (!validWallet) return;
    setError("");
    setStep("paying");

    try {
      // x402 flow:
      // 1. Fetch without payment → server returns 402 with instructions
      // 2. wrapFetchWithPayment automatically signs and retries
      // W demo mode (bez wallet client) robimy normalny fetch
      const res = await fetch(`/api/generate?wallet=${encodeURIComponent(wallet)}`);

      if (res.status === 402) {
        // Show info — in production wrapFetchWithPayment handles this automatically
        const paymentInfo = await res.json().catch(() => ({}));
        setError(
          `Payment required: $0.05 USDC on Base. ` +
          `Connect your wallet with the x402 library to pay automatically.\n\n` +
          `Payment address: ${paymentInfo.paymentRequirements?.[0]?.payTo ?? "—"}`
        );
        setStep("error");
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const svgText = await res.text();
      setSvgData(svgText);
      setStep("done");
    } catch (e) {
      setError(e.message || "Something went wrong.");
      setStep("error");
    }
  }

  function handleDownload() {
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pixel-nft-${wallet.slice(2, 10)}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setStep("idle");
    setSvgData(null);
    setError("");
  }

  return (
    <div className="app">
      <div className="scanlines" />
      <div className="noise" />

      <div className="container">
        {/* ── Header ── */}
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
          <div className="x402-badge">
            <span className="dot"/>
            Powered by x402 · Base Mainnet · No minting
          </div>
        </header>

        {/* ── Main grid ── */}
        <div className="main-grid">

          {/* Lewa — formularz */}
          <div className="panel left-panel">
            <div className="panel-label">01 / WALLET ADDRESS</div>

            <div className="input-wrapper">
              <input
                className="wallet-input"
                type="text"
                placeholder="0x..."
                value={wallet}
                onChange={e => { setWallet(e.target.value); setStep("idle"); setSvgData(null); setError(""); }}
                disabled={step === "paying"}
                spellCheck={false}
                autoComplete="off"
              />
              {wallet && (
                <div className={`input-status ${validWallet ? "valid" : "invalid"}`}>
                  {validWallet ? "✓ valid" : "invalid"}
                </div>
              )}
            </div>

            {validWallet && step !== "done" && (
              <div className="preview-info">
                <div className="preview-label">NFT PREVIEW</div>
                <div className="preview-note">Unlock the full version by paying $0.05 USDC</div>
              </div>
            )}

            {/* Kroki x402 */}
            <div className="steps">
              {[
                { n:"01", label:"Paste your 0x address", active: wallet.length > 0 },
                { n:"02", label:"Pay $0.05 USDC (x402)", active: step === "paying" || step === "done" },
                { n:"03", label:"Download your Pixel NFT", active: step === "done" },
              ].map(s => (
                <div key={s.n} className={`step ${s.active ? "step-active" : ""}`}>
                  <span className="step-n">{s.n}</span>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>

            {error && (
              <div className="error-box">
                <div className="error-title">⚠ Error</div>
                <div className="error-body">{error}</div>
              </div>
            )}

            {step !== "done" ? (
              <button
                className={`btn-pay ${step === "paying" ? "btn-loading" : ""} ${!validWallet ? "btn-disabled" : ""}`}
                onClick={handlePay}
                disabled={!validWallet || step === "paying"}
              >
                {step === "paying" ? (
                  <><span className="btn-spinner"/>Processing payment...</>
                ) : (
                  <><span className="btn-icon">◈</span>Pay $0.05 USDC and download NFT</>
                )}
              </button>
            ) : (
              <div className="done-actions">
                <button className="btn-download" onClick={handleDownload}>
                  ↓ Download SVG
                </button>
                <button className="btn-reset" onClick={reset}>
                  ↺ New NFT
                </button>
              </div>
            )}

            {step === "done" && (
              <div className="success-note">
                NFT generated! Every wallet address produces a unique result.
                You can import the SVG to OpenSea, Zora or keep it locally.
              </div>
            )}
          </div>

          {/* Prawa — preview */}
          <div className="panel right-panel">
            <div className="panel-label">02 / PREVIEW</div>

            <div className="nft-frame">
              {!validWallet ? (
                <div className="empty-state">
                  <div className="empty-grid">
                    {Array.from({length: 64}).map((_,i) => (
                      <div key={i} className="empty-px" style={{
                        background: `hsl(${(i*37)%360}, 60%, 30%)`,
                        opacity: Math.random() > 0.5 ? 0.4 : 0.1,
                        animationDelay: `${(i*0.05)%2}s`
                      }}/>
                    ))}
                  </div>
                  <div className="empty-label">← paste a wallet address</div>
                </div>
              ) : (
                <div className="nft-preview-wrapper">
                  <img
                    key={wallet + step}
                    src={step === "done"
                      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`
                      : previewBlob
                    }
                    alt="Pixel NFT"
                    className={`nft-img ${step === "done" ? "nft-unlocked" : "nft-locked"}`}
                  />
                  {step !== "done" && (
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
                <div className="meta-row">
                  <span className="meta-key">TOKEN ID</span>
                  <span className="meta-val">#{wallet.slice(2,10).toUpperCase()}</span>
                </div>
                <div className="meta-row">
                  <span className="meta-key">NETWORK</span>
                  <span className="meta-val">Base Mainnet</span>
                </div>
                <div className="meta-row">
                  <span className="meta-key">FORMAT</span>
                  <span className="meta-val">SVG (skalowalny)</span>
                </div>
                <div className="meta-row">
                  <span className="meta-key">CENA</span>
                  <span className="meta-val meta-price">$0.05 USDC</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* x402 explainer */}
        <div className="explainer">
          <div className="explainer-title">HOW DOES x402 WORK?</div>
          <div className="explainer-cards">
            {[
              { code:"402", text:"Server responds HTTP 402 — payment request with price and address"},
              { code:"💸", text:"Your wallet signs a $0.05 USDC transfer on Base and sends it in the X-PAYMENT header"},
              { code:"✓", text:"Coinbase facilitator verifies onchain → server returns 200 OK + your Pixel NFT"},
            ].map(c => (
              <div key={c.code} className="ex-card">
                <div className="ex-code">{c.code}</div>
                <div className="ex-text">{c.text}</div>
              </div>
            ))}
          </div>
        </div>

        <footer>
          PIXEL NFT · x402 Protocol · Base Mainnet · SVG on demand
        </footer>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Share+Tech+Mono&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg: #0C0C14;
          --bg2: #18182A;
          --bg3: #1A1A2A;
          --cyan: #00F5FF;
          --magenta: #FF006E;
          --yellow: #FFE66D;
          --green: #00FF88;
          --dim: #E0E0FF;
          --text: #FFFFFF;
          --border: #8888AA;
        }

        body {
          background: var(--bg);
          color: var(--text);
          font-family: 'Share Tech Mono', monospace;
          min-height: 100vh;
          overflow-x: hidden;
        }

        .app {
          position: relative;
          min-height: 100vh;
        }

        /* Retro scanlines */
        .scanlines {
          position: fixed; inset: 0; pointer-events: none; z-index: 10;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.08) 2px,
            rgba(0,0,0,0.08) 4px
          );
        }

        /* Noise texture */
        .noise {
          position: fixed; inset: 0; pointer-events: none; z-index: 9; opacity: 0.03;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E");
        }

        .container {
          max-width: 900px;
          margin: 0 auto;
          padding: 2rem 1.5rem 4rem;
          position: relative; z-index: 1;
        }

        /* ── Header ── */
        header { margin-bottom: 3rem; }

        .logo-row {
          display: flex; align-items: center; gap: 1rem;
          margin-bottom: 0.5rem;
        }

        .logo-pixel {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 3px; width: 28px; height: 28px;
        }

        .px {
          border-radius: 1px;
          image-rendering: pixelated;
        }

        .logo-text {
          font-family: 'Press Start 2P', monospace;
          font-size: clamp(1.2rem, 4vw, 2rem);
          color: var(--cyan);
          text-shadow: 3px 3px 0 rgba(0,245,255,0.2);
          letter-spacing: 0.05em;
        }

        .logo-nft {
          color: var(--magenta);
          text-shadow: 3px 3px 0 rgba(255,0,110,0.2);
        }

        .logo-titles {
          display: flex; flex-direction: column; gap: 0.4rem;
        }

        .x402-pill {
          display: inline-flex; align-items: center; gap: 0;
          overflow: hidden; border-radius: 2px;
          font-family: "Share Tech Mono", monospace;
          font-size: 0.62rem; letter-spacing: 0.08em;
          border: 1px solid var(--cyan);
          width: fit-content;
        }

        .x402-pill-code {
          background: var(--cyan); color: #000;
          font-weight: bold; padding: 0.18rem 0.45rem;
        }

        .x402-pill-text {
          color: var(--cyan); padding: 0.18rem 0.5rem;
        }

        .tagline {
          font-size: 0.8rem; color: #F0F0FF;
          margin-bottom: 0.5rem;
        }

        .x402-badge {
          display: inline-flex; align-items: center; gap: 0.5rem;
          font-size: 0.72rem; color: #E8E8FF;
          border: 1px solid #8888AA;
          padding: 0.3rem 0.7rem;
        }

        .dot {
          width: 6px; height: 6px; background: var(--green);
          animation: blink 1.8s ease-in-out infinite;
        }

        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }

        /* ── Main grid ── */
        .main-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
          margin-bottom: 3rem;
        }

        @media (max-width: 640px) {
          .main-grid { grid-template-columns: 1fr; }
        }

        .panel {
          background: var(--bg2);
          border: 1px solid var(--border);
          padding: 1.5rem;
        }

        .panel-label {
          font-size: 0.65rem; color: #E0E0FF;
          letter-spacing: 0.15em; margin-bottom: 1.25rem;
          border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;
        }

        /* ── Input ── */
        .input-wrapper { margin-bottom: 1.25rem; }

        .wallet-input {
          width: 100%; background: var(--bg);
          border: 1px solid var(--border);
          color: var(--cyan); font-family: 'Share Tech Mono', monospace;
          font-size: 0.85rem; padding: 0.7rem 0.9rem;
          outline: none; transition: border-color 0.2s;
        }

        .wallet-input:focus { border-color: var(--cyan); }
        .wallet-input::placeholder { color: #AAAAEE; }
        .wallet-input:disabled { opacity: 0.5; }

        .input-status {
          font-size: 0.65rem; margin-top: 0.35rem;
          padding: 0.2rem 0.5rem;
        }

        .valid { color: var(--green); }
        .invalid { color: var(--magenta); }

        .preview-info { margin-bottom: 1rem; }
        .preview-label { font-size: 0.65rem; color: var(--yellow); letter-spacing: 0.1em; }
        .preview-note { font-size: 0.65rem; color: #E0E0FF; margin-top: 0.2rem; }

        /* Steps */
        .steps { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.25rem; }

        .step {
          display: flex; align-items: center; gap: 0.6rem;
          font-size: 0.72rem; color: #E0E0FF; padding: 0.4rem;
          transition: color 0.3s;
        }

        .step-active { color: var(--text); }

        .step-n {
          font-family: 'Press Start 2P', monospace;
          font-size: 0.55rem; color: #E0E0FF;
          min-width: 24px;
        }

        .step-active .step-n { color: var(--cyan); }

        /* Error */
        .error-box {
          background: rgba(255,0,110,0.06);
          border: 1px solid rgba(255,0,110,0.25);
          padding: 0.8rem; margin-bottom: 1rem;
        }

        .error-title { font-size: 0.7rem; color: var(--magenta); margin-bottom: 0.3rem; }
        .error-body { font-size: 0.68rem; color: #FF88AA; line-height: 1.5; white-space: pre-wrap; }

        /* Buttons */
        .btn-pay {
          width: 100%; display: flex; align-items: center; justify-content: center;
          gap: 0.5rem; padding: 0.85rem 1rem;
          background: var(--cyan); color: #000;
          font-family: 'Share Tech Mono', monospace; font-size: 0.8rem;
          font-weight: bold; border: none; cursor: pointer;
          transition: background 0.15s, transform 0.1s;
          image-rendering: pixelated;
        }

        .btn-pay:hover:not(.btn-disabled):not(.btn-loading) {
          background: var(--yellow);
        }

        .btn-pay:active:not(.btn-disabled) { transform: scale(0.98); }

        .btn-disabled { opacity: 0.3; cursor: not-allowed; }

        .btn-loading {
          background: var(--bg3); color: var(--cyan);
          border: 1px solid var(--cyan); cursor: wait;
        }

        .btn-icon { font-size: 1rem; }

        .btn-spinner {
          width: 12px; height: 12px;
          border: 2px solid currentColor; border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .done-actions {
          display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;
          margin-bottom: 1rem;
        }

        .btn-download {
          padding: 0.7rem; background: var(--green); color: #000;
          font-family: 'Share Tech Mono', monospace; font-size: 0.8rem;
          border: none; cursor: pointer; font-weight: bold;
          transition: opacity 0.15s;
        }
        .btn-download:hover { opacity: 0.85; }

        .btn-reset {
          padding: 0.7rem; background: transparent;
          border: 1px solid #9090BB; color: #E0E0FF;
          font-family: 'Share Tech Mono', monospace; font-size: 0.8rem;
          cursor: pointer; transition: border-color 0.15s, color 0.15s;
        }
        .btn-reset:hover { border-color: var(--text); color: var(--text); }

        .success-note {
          font-size: 0.68rem; color: #E0E0FF; line-height: 1.5;
        }

        /* ── NFT Preview ── */
        .nft-frame {
          background: var(--bg);
          border: 1px solid var(--border);
          aspect-ratio: 1;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 1rem; overflow: hidden; position: relative;
        }

        .empty-state {
          width: 100%; height: 100%;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 1rem;
        }

        .empty-grid {
          display: grid; grid-template-columns: repeat(8, 1fr);
          gap: 2px; width: 60%; aspect-ratio: 1;
          image-rendering: pixelated;
        }

        .empty-px {
          aspect-ratio: 1;
          animation: flicker 3s ease-in-out infinite;
        }

        @keyframes flicker {
          0%,100%{opacity:0.4} 50%{opacity:0.1}
        }

        .empty-label { font-size: 0.65rem; color: #E0E0FF; }

        .nft-preview-wrapper {
          width: 100%; height: 100%; position: relative;
        }

        .nft-img {
          width: 100%; height: 100%;
          object-fit: contain;
          image-rendering: pixelated;
          transition: filter 0.4s;
        }

        .nft-locked { filter: blur(8px) brightness(0.6); }
        .nft-unlocked { filter: none; animation: reveal 0.5s ease-out; }

        @keyframes reveal {
          from { filter: blur(8px) brightness(0.6); transform: scale(0.98); }
          to { filter: none; transform: scale(1); }
        }

        .lock-overlay {
          position: absolute; inset: 0;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 0.5rem;
        }

        .lock-icon {
          font-family: 'Press Start 2P', monospace;
          font-size: 1.5rem; color: var(--cyan);
          text-shadow: 0 0 20px rgba(0,245,255,0.5);
          animation: float 2s ease-in-out infinite;
        }

        @keyframes float {
          0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)}
        }

        .lock-text { font-size: 0.65rem; color: var(--text); letter-spacing: 0.05em; }

        /* Metadata */
        .nft-meta { display: flex; flex-direction: column; gap: 0.4rem; }
        .meta-row {
          display: flex; justify-content: space-between;
          font-size: 0.7rem; padding: 0.35rem 0;
          border-bottom: 1px solid var(--border);
        }
        .meta-key { color: #E0E0FF; }
        .meta-val { color: var(--text); }
        .meta-price { color: var(--yellow); }

        /* ── Explainer ── */
        .explainer { margin-bottom: 3rem; }

        .explainer-title {
          font-family: 'Press Start 2P', monospace;
          font-size: 0.65rem; color: #E8E8FF;
          letter-spacing: 0.15em; margin-bottom: 1rem;
        }

        .explainer-cards {
          display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
        }

        @media (max-width: 540px) {
          .explainer-cards { grid-template-columns: 1fr; }
        }

        .ex-card {
          background: var(--bg2); border: 1px solid var(--border);
          padding: 1rem;
        }

        .ex-code {
          font-family: 'Press Start 2P', monospace;
          font-size: 1.1rem; color: var(--cyan);
          margin-bottom: 0.6rem;
        }

        .ex-text { font-size: 0.7rem; color: #E0E0FF; line-height: 1.6; }

        footer {
          text-align: center; font-size: 0.65rem; color: #C8C8F0;
          letter-spacing: 0.1em;
        }
      `}</style>
    </div>
  );
}
