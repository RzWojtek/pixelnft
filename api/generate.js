// api/generate.js — Vercel Serverless Function
// Obsługuje x402: zwraca 402 bez płatności, 200 + SVG po weryfikacji

import { withPaymentRequired } from "@x402/next";

const RECIPIENT = process.env.RECIPIENT_ADDRESS ?? "0x0000000000000000000000000000000000000000";
const FACILITATOR = process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";

// ─── Pixel Art Generator ──────────────────────────────────────────────────────
// Deterministyczny: ten sam adres = ta sama grafika, zawsze.

function hexToSeed(hex) {
  // Zamienia adres Ethereum na tablicę liczb jako seed
  const clean = hex.toLowerCase().replace("0x", "");
  const nums = [];
  for (let i = 0; i < clean.length; i += 2) {
    nums.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return nums;
}

function seededRand(seed, index) {
  // Prosty LCG PRNG — deterministyczny
  let s = (seed[index % seed.length] * 1664525 + 1013904223 + index * 6364136223846793005n) >>> 0;
  s = (s ^ (s >> 16)) >>> 0;
  return s / 0xffffffff;
}

function pickColor(seed, offset) {
  // Palety pixelartowe — 8 motywów
  const palettes = [
    ["#FF6B6B", "#FFE66D", "#4ECDC4", "#1A535C", "#FF6B35"],
    ["#E63946", "#457B9D", "#A8DADC", "#1D3557", "#F1FAEE"],
    ["#06D6A0", "#118AB2", "#073B4C", "#FFD166", "#EF476F"],
    ["#9B5DE5", "#F15BB5", "#FEE440", "#00BBF9", "#00F5D4"],
    ["#FB8500", "#FFB703", "#023047", "#219EBC", "#8ECAE6"],
    ["#2D00F7", "#6A00F4", "#8900F2", "#A100F2", "#BC00DD"],
    ["#FFBE0B", "#FB5607", "#FF006E", "#8338EC", "#3A86FF"],
    ["#D62828", "#F77F00", "#FCBF49", "#EAE2B7", "#003049"],
  ];
  const paletteIdx = Math.floor(seededRand(seed, offset) * palettes.length);
  const palette = palettes[paletteIdx];
  const colorIdx = Math.floor(seededRand(seed, offset + 1) * palette.length);
  return { color: palette[colorIdx], bg: palette[(colorIdx + 2) % palette.length], palette };
}

function generatePixelArt(address) {
  const seed = hexToSeed(address);
  const SIZE = 16; // 16x16 pikseli
  const PIXEL = 24; // każdy piksel = 24px w SVG → 384x384 SVG
  const TOTAL = SIZE * PIXEL;

  // Kolory
  const { color: mainColor, bg: bgColor, palette } = pickColor(seed, 0);
  const accentColor = palette[Math.floor(seededRand(seed, 10) * palette.length)];
  const shadowColor = palette[Math.floor(seededRand(seed, 11) * palette.length)];

  // Generuj siatkę 8x16, potem odbij symetrycznie (klasyczny pixel avatar)
  const half = SIZE / 2; // 8 kolumn
  const grid = [];

  for (let row = 0; row < SIZE; row++) {
    const rowArr = [];
    for (let col = 0; col < half; col++) {
      // Więcej pikseli w środku (głowa / tułów)
      const distFromCenter = Math.abs(col - half / 2) / (half / 2);
      const density = 0.55 - distFromCenter * 0.25;
      const val = seededRand(seed, row * half + col + 20);
      rowArr.push(val < density ? 1 : 0);
    }
    // Symetria lewa-prawa
    grid.push([...rowArr, ...[...rowArr].reverse()]);
  }

  // Buduj SVG
  let pixels = "";

  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (grid[row][col] === 1) {
        const x = col * PIXEL;
        const y = row * PIXEL;
        // Akcent lub główny kolor zależnie od pozycji
        const useAccent = seededRand(seed, row * SIZE + col + 100) < 0.2;
        const useShadow = seededRand(seed, row * SIZE + col + 200) < 0.1;
        const fill = useShadow ? shadowColor : useAccent ? accentColor : mainColor;
        pixels += `<rect x="${x}" y="${y}" width="${PIXEL}" height="${PIXEL}" fill="${fill}"/>`;
      }
    }
  }

  // Krótki hash adresu jako "token ID"
  const tokenId = address.slice(2, 10).toUpperCase();

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${TOTAL}" height="${TOTAL + 48}" viewBox="0 0 ${TOTAL} ${TOTAL + 48}" shape-rendering="crispEdges">
  <defs>
    <pattern id="bg-dots" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="4" fill="${bgColor}"/>
      <rect x="0" y="0" width="2" height="2" fill="${bgColor}" opacity="0.6"/>
    </pattern>
  </defs>

  <!-- Tło -->
  <rect width="${TOTAL}" height="${TOTAL + 48}" fill="${bgColor}"/>
  <rect width="${TOTAL}" height="${TOTAL + 48}" fill="url(#bg-dots)" opacity="0.3"/>

  <!-- Ramka pixel -->
  <rect x="4" y="4" width="${TOTAL - 8}" height="${TOTAL - 8}" fill="none" stroke="${mainColor}" stroke-width="4" opacity="0.4"/>
  <rect x="8" y="8" width="${TOTAL - 16}" height="${TOTAL - 16}" fill="none" stroke="${mainColor}" stroke-width="2" opacity="0.2"/>

  <!-- Piksele awatara -->
  ${pixels}

  <!-- Pasek dolny -->
  <rect x="0" y="${TOTAL}" width="${TOTAL}" height="48" fill="${mainColor}"/>
  <text x="${TOTAL / 2}" y="${TOTAL + 20}" text-anchor="middle" font-family="monospace" font-size="11" font-weight="bold" fill="${bgColor}" opacity="0.7">PIXEL NFT</text>
  <text x="${TOTAL / 2}" y="${TOTAL + 38}" text-anchor="middle" font-family="monospace" font-size="13" font-weight="bold" fill="${bgColor}">#${tokenId}</text>
</svg>`;

  return { svg: svgContent, tokenId, mainColor, bgColor };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { wallet } = req.query;
  if (!wallet || !wallet.startsWith("0x") || wallet.length < 10) {
    return res.status(400).json({ error: "Podaj prawidłowy adres portfela (0x...)" });
  }

  const { svg, tokenId, mainColor, bgColor } = generatePixelArt(wallet);

  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // SVG jest deterministyczny = można cache'ować
  res.setHeader("X-Token-Id", tokenId);
  res.setHeader("X-Wallet", wallet.slice(0, 10) + "...");

  return res.status(200).send(svg);
}

// Owijamy handler w x402 — wymaga $0.05 USDC na Base przed dostępem
export default withPaymentRequired(handler, {
  amount: "0.05",
  currency: "USDC",
  network: "base-mainnet",
  recipientAddress: RECIPIENT,
  facilitatorUrl: FACILITATOR,
  description: "Pixel NFT — unikalny awatar z adresu portfela",
});
