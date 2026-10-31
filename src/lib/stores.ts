const STORE_DOMAINS: [string, string][] = [
  ["amazon", "amazon.com"],
  ["target", "target.com"],
  ["walmart", "walmart.com"],
  ["tesco", "tesco.com"],
  ["flipkart", "flipkart.com"],
  ["starbucks", "starbucks.com"],
  ["airbnb", "airbnb.com"],
  ["steam", "steampowered.com"],
  ["whole foods", "wholefoodsmarket.com"],
  ["shell", "shell.com"],
  ["best buy", "bestbuy.com"],
  ["apple", "apple.com"],
  ["google play", "play.google.com"],
  ["netflix", "netflix.com"],
  ["spotify", "spotify.com"],
  ["uber", "uber.com"],
  ["doordash", "doordash.com"],
  ["ikea", "ikea.com"],
  ["nike", "nike.com"],
  ["adidas", "adidas.com"],
  ["sephora", "sephora.com"],
  ["sainsburys", "sainsburys.co.uk"],
  ["marks and spencer", "marksandspencer.com"],
  ["marks spencer", "marksandspencer.com"],
  ["jcrew", "jcrew.com"],
  ["mcdonalds", "mcdonalds.com"],
  ["costco", "costco.com"],
  ["etsy", "etsy.com"],
  ["ebay", "ebay.com"],
  ["xbox", "xbox.com"],
  ["playstation", "playstation.com"],
  ["nintendo", "nintendo.com"],
];

const NAME_SUFFIXES = new Set(["uk", "us", "usa", "store", "stores", "market", "superstore", "express", "shop", "online", "gift", "card", "cards"]);

function normalizeStoreName(retailer: string): string {
  return retailer
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function brandDomain(name: string): string | null {
  const spaceless = name.replace(/ /g, "");
  for (const [key, domain] of STORE_DOMAINS) {
    if (name === key || spaceless === key.replace(/ /g, "")) return domain;
    if (name.startsWith(`${key} `)) {
      const next = name.slice(key.length + 1).split(" ")[0];
      if (NAME_SUFFIXES.has(next)) return domain;
    }
  }
  return null;
}

function domainFromText(retailer: string): string | null {
  const text = retailer
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return null;
  const labels = text.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((label) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1])) return null;
  return text;
}

export function storeDomain(retailer: string): string | null {
  if (!retailer || retailer.trim().length === 0) return null;
  const branded = brandDomain(normalizeStoreName(retailer));
  if (branded) return branded;
  return domainFromText(retailer);
}

export function faviconUrl(domain: string, size = 64): string {
  const sz = Math.min(256, Math.max(16, Math.round(size) || 64));
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${sz}`;
}
