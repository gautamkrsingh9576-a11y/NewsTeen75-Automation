import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GoogleDecoder } = require("google-news-url-decoder");
const decoder = new GoogleDecoder();

const FEED_PATH = new URL("../data/news.json", import.meta.url);
const MAX_ARTICLES = 250;
const MAX_NEW_PER_CATEGORY = 2;
const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETENTION_WINDOW_MS = 72 * 60 * 60 * 1000;
const MAX_IMAGE_BACKFILLS_PER_RUN = 12;

const categories = [
  { name: "Politics & Government", query: "India politics government when:1d" },
  { name: "Crime & Breaking News", query: "India crime breaking news when:1d" },
  { name: "Sports", query: "India sports when:1d" },
  { name: "Entertainment", query: "India entertainment when:1d" },
  { name: "Technology", query: "India technology when:1d" },
  { name: "Business & Finance", query: "India business finance when:1d" },
  { name: "National & Trending News", query: "India latest national trending news when:1d" },
];

function decodeEntities(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripHtml(value = "") {
  return decodeEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? stripHtml(match[1]) : "";
}

function parseItems(xml) {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => {
    const block = m[1];
    return {
      title: tag(block, "title"),
      link: tag(block, "link"),
      pubDate: tag(block, "pubDate"),
      source: tag(block, "source"),
    };
  });
}

function normalizeTitle(title = "") {
  return title.replace(/\s+-\s+[^-]{2,80}$/u, "").trim();
}

function idFor(link, title) {
  return crypto.createHash("sha1").update(link || title).digest("hex").slice(0, 16);
}

function trimWords(text, max = 50) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return `${words.slice(0, max).join(" ")}…`;
}

function isGenericGoogleDescription(text = "") {
  const value = text.toLowerCase();
  return (
    value.includes("comprehensive up-to-date news coverage") ||
    value.includes("aggregated from sources all over the world by google news")
  );
}

function buildSummary(title, description, source) {
  const cleanTitle = normalizeTitle(title);
  let text = stripHtml(description || "");

  if (
    !text ||
    text.length < 80 ||
    isGenericGoogleDescription(text) ||
    text.toLowerCase() === cleanTitle.toLowerCase()
  ) {
    text = `${cleanTitle}. This update was reported by ${source || "the original publisher"}. Open the original report for full context and any developing updates.`;
  }

  return trimWords(text, 50);
}

function metaValue(html, keys) {
  for (const key of keys) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escapedKey}["'][^>]*>`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return decodeEntities(match[1]).trim();
    }
  }
  return "";
}

function linkImageValue(html) {
  const patterns = [
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["'][^>]*>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1]).trim();
  }
  return "";
}

function extractImageFromJson(value) {
  if (!value) return "";
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractImageFromJson(item);
      if (found) return found;
    }
    return "";
  }

  if (typeof value === "object") {
    for (const key of ["url", "contentUrl", "thumbnailUrl"]) {
      if (typeof value[key] === "string" && value[key]) return value[key];
    }

    for (const key of ["image", "thumbnail", "primaryImageOfPage"]) {
      if (value[key]) {
        const found = extractImageFromJson(value[key]);
        if (found) return found;
      }
    }
  }

  return "";
}

function jsonLdImageValue(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const script of scripts) {
    const raw = decodeEntities(script[1]).trim();
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      const found = extractImageFromJson(parsed);
      if (found) return found;
    } catch {
      // Some publishers expose invalid JSON-LD. Meta tags are still checked first.
    }
  }

  return "";
}

function absoluteUrl(value, baseUrl) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fallbackImage(category = "Latest News") {
  const label = escapeXml(category);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#0b0b10"/><circle cx="980" cy="150" r="180" fill="#ff3045" opacity="0.25"/><text x="80" y="270" fill="#ffffff" font-family="Arial,sans-serif" font-size="92" font-weight="700">NewsTeen75</text><text x="80" y="370" fill="#ff3045" font-family="Arial,sans-serif" font-size="46" font-weight="700">${label}</text><text x="80" y="455" fill="#b7b7c2" font-family="Arial,sans-serif" font-size="32">Latest news update</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function isFresh(dateValue, windowMs = FRESH_WINDOW_MS) {
  const time = new Date(dateValue).getTime();
  if (!Number.isFinite(time)) return false;
  const age = Date.now() - time;
  return age >= -60 * 60 * 1000 && age <= windowMs;
}

function isRetained(dateValue) {
  const time = new Date(dateValue).getTime();
  if (!Number.isFinite(time)) return false;
  const age = Date.now() - time;
  return age >= -60 * 60 * 1000 && age <= RETENTION_WINDOW_MS;
}

async function resolvePublisherUrl(url) {
  if (!url) return "";

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname !== "news.google.com" && !hostname.endsWith(".news.google.com")) {
      return url;
    }
  } catch {
    return url;
  }

  try {
    const result = await decoder.decode(url);
    if (result?.status && result?.decoded_url) return result.decoded_url;
  } catch (error) {
    console.warn(`Could not decode Google News URL: ${error.message}`);
  }

  return url;
}

async function enrichArticle(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36 NewsTeen75/1.0",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-IN,en;q=0.9",
      },
    });
    clearTimeout(timeout);
    if (!response.ok) return {};

    const finalUrl = response.url || url;
    const hostname = new URL(finalUrl).hostname.toLowerCase();

    if (hostname === "news.google.com" || hostname.endsWith(".news.google.com")) {
      return { finalUrl };
    }

    const html = await response.text();
    const description = metaValue(html, ["og:description", "twitter:description", "description"]);
    const rawImage =
      metaValue(html, ["og:image", "og:image:url", "twitter:image", "twitter:image:src", "image"]) ||
      linkImageValue(html) ||
      jsonLdImageValue(html);

    return {
      finalUrl,
      description: isGenericGoogleDescription(description) ? "" : description,
      image: absoluteUrl(rawImage, finalUrl),
    };
  } catch {
    return {};
  }
}

async function fetchCategory(category, knownLinks, knownTitles) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(category.query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const response = await fetch(url, { headers: { "user-agent": "NewsTeen75Bot/1.0" } });
  if (!response.ok) throw new Error(`RSS failed for ${category.name}: ${response.status}`);

  const xml = await response.text();
  const items = parseItems(xml).slice(0, 25);
  const fresh = [];

  for (const item of items) {
    if (fresh.length >= MAX_NEW_PER_CATEGORY) break;

    const cleanTitle = normalizeTitle(item.title);
    if (!item.link || !cleanTitle || !isFresh(item.pubDate)) continue;
    if (knownLinks.has(item.link) || knownTitles.has(cleanTitle.toLowerCase())) continue;

    const publisherUrl = await resolvePublisherUrl(item.link);
    const enriched = await enrichArticle(publisherUrl);
    const publishedAt = new Date(item.pubDate).toISOString();
    const sourceUrl = enriched.finalUrl || publisherUrl || item.link;

    fresh.push({
      id: idFor(sourceUrl, cleanTitle),
      title: cleanTitle,
      summary: buildSummary(cleanTitle, enriched.description, item.source),
      category: category.name,
      image: enriched.image || fallbackImage(category.name),
      source: item.source || "Google News",
      sourceUrl,
      publishedAt,
      fetchedAt: new Date().toISOString(),
    });

    knownLinks.add(item.link);
    knownLinks.add(sourceUrl);
    knownTitles.add(cleanTitle.toLowerCase());
  }

  return fresh;
}

async function backfillMissingImages(articles) {
  let changed = false;
  let processed = 0;

  for (const article of articles) {
    if (processed >= MAX_IMAGE_BACKFILLS_PER_RUN) break;
    if (article.image) continue;

    processed += 1;
    const currentUrl = article.sourceUrl || article.link || "";
    const publisherUrl = await resolvePublisherUrl(currentUrl);
    const enriched = await enrichArticle(publisherUrl);

    const nextImage = enriched.image || fallbackImage(article.category);
    if (nextImage !== article.image) {
      article.image = nextImage;
      changed = true;
    }

    const nextSourceUrl = enriched.finalUrl || publisherUrl;
    if (nextSourceUrl && nextSourceUrl !== article.sourceUrl) {
      article.sourceUrl = nextSourceUrl;
      changed = true;
    }
  }

  return changed;
}

async function main() {
  const existing = JSON.parse(fs.readFileSync(FEED_PATH, "utf8"));
  const previousArticles = Array.isArray(existing.articles) ? existing.articles : [];
  const articles = previousArticles.filter((article) => isRetained(article.publishedAt));

  const changedByImageBackfill = await backfillMissingImages(articles);

  const knownLinks = new Set(articles.flatMap((a) => [a.sourceUrl, a.link].filter(Boolean)));
  const knownTitles = new Set(articles.map((a) => String(a.title || "").toLowerCase()));
  const newArticles = [];

  for (const category of categories) {
    try {
      newArticles.push(...(await fetchCategory(category, knownLinks, knownTitles)));
    } catch (error) {
      console.error(error.message);
    }
  }

  const merged = [...newArticles, ...articles]
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, MAX_ARTICLES);

  const changedByRetention = articles.length !== previousArticles.length;
  if (!newArticles.length && !changedByRetention && !changedByImageBackfill) {
    console.log("No new articles or image updates found. Feed unchanged.");
    return;
  }

  const output = {
    updatedAt: new Date().toISOString(),
    count: merged.length,
    articles: merged,
  };

  fs.writeFileSync(FEED_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Added ${newArticles.length} new article(s). Total: ${merged.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
