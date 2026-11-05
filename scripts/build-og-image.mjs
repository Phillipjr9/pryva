/** Regenerate the 1200×630 social sharing image: node scripts/build-og-image.mjs.
 * This card deliberately contains no illustrative prices or customer data.
 */
import sharp from "sharp";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <radialGradient id="glow"><stop stop-color="#d8c7fa" stop-opacity=".8"/><stop offset="1" stop-color="#f9f6f0" stop-opacity="0"/></radialGradient>
  <linearGradient id="panel" x2="1" y2="1"><stop stop-color="#faf6ff"/><stop offset="1" stop-color="#f0e8fc"/></linearGradient>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dy="12"/><feComponentTransfer><feFuncA type="linear" slope=".1"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="1200" height="630" fill="#faf7f1"/>
<circle cx="80" cy="20" r="370" fill="url(#glow)"/>
<circle cx="1150" cy="620" r="390" fill="url(#glow)"/>
<text x="116" y="90" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="700" fill="#211a2c">Pryva</text>
<text x="68" y="220" font-family="DejaVu Sans, sans-serif" font-size="56" font-weight="700" letter-spacing="-2" fill="#211a2c">Digital services,</text>
<text x="68" y="291" font-family="DejaVu Serif, serif" font-size="54" font-style="italic" letter-spacing="-1" fill="#7050b7">without the friction.</text>
<text x="70" y="350" font-family="DejaVu Sans, sans-serif" font-size="20" fill="#645d6f">Numbers, eSIM data and more.</text>
<text x="70" y="382" font-family="DejaVu Sans, sans-serif" font-size="20" fill="#645d6f">Explore and pay in Naira.</text>
<rect x="68" y="506" width="210" height="54" rx="27" fill="#ebe1fa"/>
<text x="91" y="540" font-family="DejaVu Sans, sans-serif" font-size="19" font-weight="700" fill="#56328d">pryvalogs.com</text>
<g filter="url(#shadow)">
  <rect x="716" y="110" width="405" height="405" rx="34" fill="url(#panel)" stroke="#e5daf2"/>
  <text x="750" y="163" font-family="DejaVu Sans, sans-serif" font-size="15" font-weight="700" letter-spacing="2" fill="#6c568e">EXPLORE PRYVA</text>
  <rect x="750" y="188" width="337" height="78" rx="18" fill="#fff" stroke="#eee9f3"/>
  <rect x="766" y="202" width="48" height="48" rx="14" fill="#e9e0fa"/>
  <path d="M783 211h15v27h-15z M788 234h5" fill="none" stroke="#7452ba" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="831" y="221" font-family="DejaVu Sans, sans-serif" font-size="19" font-weight="700" fill="#292135">Virtual numbers</text>
  <text x="831" y="244" font-family="DejaVu Sans, sans-serif" font-size="14" fill="#776d83">SMS verification</text>
  <rect x="750" y="281" width="337" height="78" rx="18" fill="#fff" stroke="#eee9f3"/>
  <rect x="766" y="296" width="48" height="48" rx="14" fill="#fcece4"/>
  <path d="M784 304h12l4 4v27h-16z M788 315h8v9h-8z" fill="none" stroke="#c77950" stroke-width="2.3" stroke-linejoin="round"/>
  <text x="831" y="314" font-family="DejaVu Sans, sans-serif" font-size="19" font-weight="700" fill="#292135">eSIM data</text>
  <text x="831" y="337" font-family="DejaVu Sans, sans-serif" font-size="14" fill="#776d83">Plans for your destination</text>
  <rect x="750" y="374" width="337" height="78" rx="18" fill="#fff" stroke="#eee9f3"/>
  <rect x="766" y="389" width="48" height="48" rx="14" fill="#e9f3ef"/>
  <path d="M790 397l10 4v10c0 8-6 12-10 14-4-2-10-6-10-14v-10z M786 410l3 3 6-7" fill="none" stroke="#539477" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="831" y="407" font-family="DejaVu Sans, sans-serif" font-size="19" font-weight="700" fill="#292135">Explore services</text>
  <text x="831" y="430" font-family="DejaVu Sans, sans-serif" font-size="14" fill="#776d83">One simple dashboard</text>
</g>
</svg>`;

const icon = await sharp("public/icon.png").resize(42, 42).png().toBuffer();
await sharp(Buffer.from(svg)).composite([{ input: icon, left: 67, top: 54 }]).png().toFile("public/og.png");
console.log("Wrote public/og.png (1200 × 630)");
