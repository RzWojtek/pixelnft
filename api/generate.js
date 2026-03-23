// api/generate.js — Vercel Serverless Function
// x402 protocol: EIP-3009 transferWithAuthorization

const RECIPIENT = process.env.RECIPIENT_ADDRESS ?? "0x0000000000000000000000000000000000000000";
const FACILITATOR = process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";
const PRICE_USDC = "0.05";
const NETWORK = "base";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AMOUNT = String(Math.round(parseFloat(PRICE_USDC) * 1_000_000)); // 50000 (6 decimals)

// ─── Pixel Art Generator ──────────────────────────────────────────────────────

function hexToSeed(hex) {
  const clean = hex.toLowerCase().replace("0x", "");
  const nums = [];
  for (let i = 0; i < clean.length; i += 2) nums.push(parseInt(clean.slice(i, i + 2), 16));
  return nums;
}

function seededRand(seed, index) {
  let s = ((seed[index % seed.length] * 1664525 + 1013904223) ^ (index * 0x9e3779b9)) >>> 0;
  s = (s ^ (s >> 16)) >>> 0;
  return s / 0xffffffff;
}

function generatePixelArt(address) {
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
  const mainColor = palette[ci];
  const bgColor = palette[(ci + 2) % palette.length];
  const accentColor = palette[Math.floor(seededRand(seed, 10) * palette.length)];
  const shadowColor = palette[Math.floor(seededRand(seed, 11) * palette.length)];
  const SIZE = 16, PIXEL = 24, TOTAL = SIZE * PIXEL, half = SIZE / 2;
  const grid = [];
  for (let row = 0; row < SIZE; row++) {
    const rowArr = [];
    for (let col = 0; col < half; col++) {
      const d = Math.abs(col - half / 2) / (half / 2);
      rowArr.push(seededRand(seed, row * half + col + 20) < (0.55 - d * 0.25) ? 1 : 0);
    }
    grid.push([...rowArr, ...[...rowArr].reverse()]);
  }
  let pixels = "";
  for (let row = 0; row < SIZE; row++)
    for (let col = 0; col < SIZE; col++)
      if (grid[row][col]) {
        const fill = seededRand(seed,row*SIZE+col+200)<0.1 ? shadowColor
                   : seededRand(seed,row*SIZE+col+100)<0.2 ? accentColor : mainColor;
        pixels += `<rect x="${col*PIXEL}" y="${row*PIXEL}" width="${PIXEL}" height="${PIXEL}" fill="${fill}"/>`;
      }
  const tokenId = address.slice(2, 10).toUpperCase();
  return { tokenId, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${TOTAL}" height="${TOTAL+48}" viewBox="0 0 ${TOTAL} ${TOTAL+48}" shape-rendering="crispEdges">
  <rect width="${TOTAL}" height="${TOTAL+48}" fill="${bgColor}"/>
  <rect x="4" y="4" width="${TOTAL-8}" height="${TOTAL-8}" fill="none" stroke="${mainColor}" stroke-width="4" opacity="0.4"/>
  ${pixels}
  <rect x="0" y="${TOTAL}" width="${TOTAL}" height="48" fill="${mainColor}"/>
  <text x="${TOTAL/2}" y="${TOTAL+20}" text-anchor="middle" font-family="monospace" font-size="11" font-weight="bold" fill="${bgColor}" opacity="0.7">PIXEL NFT</text>
  <text x="${TOTAL/2}" y="${TOTAL+38}" text-anchor="middle" font-family="monospace" font-size="13" font-weight="bold" fill="${bgColor}">#${tokenId}</text>
</svg>` };
}

// ─── Payment requirements object ─────────────────────────────────────────────

function buildRequirements(resource) {
  return {
    scheme: "exact",
    network: NETWORK,
    maxAmountRequired: AMOUNT,
    resource,
    description: "Pixel NFT — unique avatar from wallet address",
    mimeType: "image/svg+xml",
    payTo: RECIPIENT,
    maxTimeoutSeconds: 300,
    asset: USDC_BASE,
    outputSchema: null,
    extra: null,
  };
}

// ─── Verify payment with Coinbase facilitator ─────────────────────────────────

async function verifyPayment(paymentHeader, resource) {
  try {
    const res = await fetch(`${FACILITATOR}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payment: paymentHeader,
        paymentRequirements: buildRequirements(resource),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("Facilitator error:", res.status, text);
      return false;
    }
    const data = await res.json();
    return data.isValid === true;
  } catch (e) {
    console.error("Verify exception:", e);
    return false;
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-PAYMENT, X-PAYMENT-RESPONSE");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { wallet } = req.query;
  if (!wallet || !wallet.startsWith("0x") || wallet.length < 40) {
    return res.status(400).json({ error: "Provide a valid Ethereum wallet address (0x...)" });
  }

  // Build resource URL (used as payment identifier)
  const host = req.headers.host || "pixelnft.vercel.app";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const resource = `${proto}://${host}/api/generate?wallet=${wallet}`;

  const paymentHeader = req.headers["x-payment"];

  // No payment header → return 402
  if (!paymentHeader) {
    res.setHeader("Content-Type", "application/json");
    return res.status(402).json({
      x402Version: 1,
      accepts: [buildRequirements(resource)],
      error: "X-PAYMENT header is required",
    });
  }

  // Verify payment
  const isValid = await verifyPayment(paymentHeader, resource);
  if (!isValid) {
    res.setHeader("Content-Type", "application/json");
    return res.status(402).json({
      x402Version: 1,
      accepts: [buildRequirements(resource)],
      error: "Payment verification failed — please try again",
    });
  }

  // Payment OK → return SVG
  const { svg, tokenId } = generatePixelArt(wallet);
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Token-Id", tokenId);
  res.setHeader("X-PAYMENT-RESPONSE", JSON.stringify({ success: true, tokenId }));
  return res.status(200).send(svg);
}
