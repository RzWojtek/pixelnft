# 🎮 PixelNFT — Pixel art awatar za $0.05 USDC

Wklej adres portfela Ethereum → zapłać $0.05 USDC przez protokół **x402** → pobierz swój unikalny Pixel NFT jako plik SVG.

**Bez VPS. Bez serwera. Bez bazy danych. Tylko GitHub + Vercel.**

---

## Jak to działa

- Każdy adres portfela `0x...` daje **deterministycznie unikalny** pixel art (ten sam adres = zawsze ten sam obrazek)
- Grafika generuje się w <1ms czystym SVG — zero kosztów, zero zewnętrznych API
- Płatność $0.05 USDC przez protokół x402 na Base Mainnet — automatyczna, bez konta
- Plik SVG jest skalowalny (możesz drukować w dowolnej rozdzielczości)

---

## 🚀 Deployment: GitHub → Vercel (3 kroki)

### Krok 1 — Wrzuć na GitHub

Otwórz terminal i przejdź do folderu projektu:

```
cd pixelnft
```

Zainicjuj git i zrób pierwszy commit:

```
git init
git add .
git commit -m "PixelNFT v1"
```

Utwórz nowe repo na **github.com** (kliknij "New repository", nazwa: `pixelnft`, bez README).

Skopiuj URL repo i wykonaj:

```
git remote add origin https://github.com/TWOJA-NAZWA/pixelnft.git
git push -u origin main
```

---

### Krok 2 — Deploy na Vercel

1. Wejdź na **vercel.com** i zaloguj się
2. Kliknij **"Add New → Project"**
3. Wybierz swoje repo `pixelnft` z GitHuba
4. Vercel automatycznie wykryje Vite — kliknij **Deploy**

Vercel sam zajmuje się budowaniem i hostingiem. Folder `/api` jest automatycznie konwertowany na Serverless Functions.

---

### Krok 3 — Zmienne środowiskowe w Vercel

Po deployu wejdź w: **Settings → Environment Variables** i dodaj:

| Nazwa | Wartość |
|---|---|
| `RECIPIENT_ADDRESS` | `0xTwójAdresPortfelaTutaj` |
| `FACILITATOR_URL` | `https://x402.org/facilitator` |

`RECIPIENT_ADDRESS` to twój adres portfela na Base Mainnet — tam będą trafiać płatności $0.05 USDC.

Zapisz i kliknij **Redeploy** (Settings → Deployments → trzy kropki → Redeploy).

---

## 💰 Jak otrzymywać płatności

1. Potrzebujesz portfela na **Base Mainnet** — np. MetaMask lub Coinbase Wallet
2. Przełącz sieć na Base (Chain ID: 8453)
3. Twój adres portfela wpisz w `RECIPIENT_ADDRESS`
4. Każde wygenerowanie NFT = $0.05 USDC trafia bezpośrednio do ciebie

---

## 🛠 Lokalny development

```
npm install
npm run dev
```

Otwórz: http://localhost:5173

Uwaga: lokalnie bez ustawionych zmiennych środowiskowych endpoint `/api/generate` zwróci błąd — to normalne. Frontend działa, podgląd NFT też.

---

## 🎨 Jak działa generator pixel art

Algorytm jest w pełni deterministyczny:

1. Adres portfela `0x...` → tablica bajtów jako seed
2. Prosta LCG (Linear Congruential Generator) zamiast Math.random()
3. Siatka 16×16 pikseli z symetrią lewa-prawa (styl klasycznych pixel awatarów)
4. 8 palet kolorów — wybór palety i kolorów z seeda
5. SVG z `shape-rendering="crispEdges"` dla idealnej pikselowości

Ten sam algorytm działa na frontendzie (podgląd) i backendzie (pełna wersja po płatności).

---

## 📁 Struktura projektu

```
pixelnft/
├── api/
│   └── generate.js     ← Vercel Serverless Function (x402 + SVG generator)
├── src/
│   ├── App.jsx          ← Główna aplikacja React
│   └── main.jsx
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
└── .env.example
```

---

## 🔑 Zmiana ceny

Żeby zmienić cenę z $0.05 na inną, edytuj w `api/generate.js`:

```js
amount: "0.05",   // zmień na np. "0.10", "0.25", "1.00"
```

---

## 📚 Linki

- [x402 dokumentacja](https://docs.cdp.coinbase.com/x402/welcome)
- [Base Mainnet](https://base.org)
- [Vercel Serverless Functions](https://vercel.com/docs/functions)
