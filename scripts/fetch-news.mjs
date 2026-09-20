import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GoogleDecoder } = require("google-news-url-decoder");
const decoder = new GoogleDecoder();

const FEED_PATH = new URL("../data/news.json", import.meta.url);
const MAX_ARTICLES = 250;
const MAX_NEW_EXTERNAL_PER_CATEGORY = 2;
const MAX_NEW_BIHAR_PER_CATEGORY = 1;
const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETENTION_WINDOW_MS = 72 * 60 * 60 * 1000;
const MIN_SUMMARY_CHARS = 60;

const externalCategories = [
  { name: "Politics & Government", query: "India politics government when:1d" },
  { name: "Crime & Breaking News", query: "India crime breaking news when:1d" },
  { name: "Sports", query: "India sports when:1d" },
  { name: "Entertainment", query: "India entertainment when:1d" },
  { name: "Technology", query: "India technology when:1d" },
  { name: "Business & Finance", query: "India business finance when:1d" },
  { name: "National & Trending News", query: "India latest national trending news when:1d" },
];

const biharCategories = [
  { name: "Politics & Government", query: "Bihar politics government election policy when:1d" },
  { name: "Crime & Breaking News", query: "Bihar crime police accident court breaking news when:1d" },
  { name: "Sports", query: "Bihar sports cricket tournament when:1d" },
  { name: "Entertainment", query: "Bihar entertainment cinema culture when:1d" },
  { name: "Technology", query: "Bihar technology AI startup digital when:1d" },
  { name: "Business & Finance", query: "Bihar business startup funding economy market when:1d" },
  { name: "National & Trending News", query: "Bihar latest local development education infrastructure trending when:1d" },
];

const BIHAR_TERMS = [
  "bihar", "patna", "gaya", "muzaffarpur", "bhagalpur", "darbhanga",
  "nalanda", "bihar sharif", "purnia", "purnea", "begusarai",
  "samastipur", "madhubani", "sitamarhi", "motihari", "bettiah",
  "katihar", "kishanganj", "arrah", "ara", "buxar", "sasaram",
  "rohtas", "kaimur", "nawada", "jamui", "munger", "lakhisarai",
  "sheikhpura", "jehanabad", "arwal", "hajipur", "vaishali", "siwan",
  "chapra", "chhapra", "saharsa", "supaul", "madhepura", "araria",
  "khagaria"
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

function isGeneratedFallbackSummary(text = "") {
  return /this update was reported by .*open the original report/i.test(text);
}

function buildSummary(title, description) {
  const cleanTitle = normalizeTitle(title);
  const text = stripHtml(description || "");

  if (
    !text ||
    text.length < MIN_SUMMARY_CHARS ||
    isGenericGoogleDescription(text) ||
    isGeneratedFallbackSummary(text) ||
    text.toLowerCase() === cleanTitle.toLowerCase()
  ) {
    return "";
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

function isHttpUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isUsableImageUrl(value = "") {
  if (!isHttpUrl(value)) return false;

  const lower = value.toLowerCase();
  if (
    lower.startsWith("data:") ||
    /(?:^|[\/_\-.])(logo|favicon|icon|sprite|avatar|placeholder|default)(?:[\/_\-.]|$)/i.test(lower)
  ) {
    return false;
  }

  return true;
}

async function validateImageUrl(url) {
  if (!isUsableImageUrl(url)) return false;

  const checkResponse = (response) => {
    if (!response.ok) return false;
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    return type.startsWith("image/") && !type.includes("svg");
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "NewsTeen75Bot/1.0" },
    });
    clearTimeout(timeout);
    if (checkResponse(response)) return true;
  } catch {
    // Some CDNs block HEAD, so retry with a small ranged GET.
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "NewsTeen75Bot/1.0",
        range: "bytes=0-2047",
      },
    });
    clearTimeout(timeout);
    return checkResponse(response);
  } catch {
    return false;
  }
}

function articleHasRequiredQuality(article) {
  const title = normalizeTitle(article?.title || "");
  const summary = stripHtml(article?.summary || article?.description || "");
  const source = String(article?.source || "").trim();
  const sourceUrl = article?.sourceUrl || article?.url || article?.link || "";

  return (
    title.length >= 20 &&
    summary.length >= MIN_SUMMARY_CHARS &&
    !isGeneratedFallbackSummary(summary) &&
    source.length >= 2 &&
    isHttpUrl(sourceUrl) &&
    isUsableImageUrl(article?.image || "") &&
    isRetained(article?.publishedAt)
  );
}

function canonicalUrl(value = "") {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return `${url.origin}${url.pathname}${url.search}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return String(value || "").trim().toLowerCase();
  }
}

function titleTokens(title = "") {
  return new Set(
    normalizeTitle(title)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2)
  );
}

function isNearDuplicateTitle(a = "", b = "") {
  const left = titleTokens(a);
  const right = titleTokens(b);
  if (left.size < 4 || right.size < 4) return false;

  let common = 0;
  for (const word of left) {
    if (right.has(word)) common += 1;
  }

  const union = new Set([...left, ...right]).size;
  return union > 0 && common / union >= 0.8;
}

function dedupeArticles(articles) {
  const sorted = [...articles].sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );

  const kept = [];
  const seenUrls = new Set();
  const seenTitles = new Set();

  for (const article of sorted) {
    const url = canonicalUrl(article.sourceUrl || article.url || article.link || "");
    const title = normalizeTitle(article.title || "").toLowerCase();

    if (!url || !title) continue;
    if (seenUrls.has(url) || seenTitles.has(title)) continue;
    if (kept.some((existing) => isNearDuplicateTitle(existing.title, article.title))) continue;

    kept.push(article);
    seenUrls.add(url);
    seenTitles.add(title);
  }

  return kept;
}

function containsBiharLocation(article) {
  const text = [
    article?.title,
    article?.summary,
    article?.description,
    article?.source,
    article?.sourceUrl,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return BIHAR_TERMS.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  });
}

function isBiharArticle(article) {
  return article?.__scope === "bihar" || containsBiharLocation(article);
}

function selectWithSeventyThirtyRatio(articles, limit = MAX_ARTICLES) {
  const bihar = articles
    .filter(isBiharArticle)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const external = articles
    .filter((article) => !isBiharArticle(article))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const pattern = [
    "external", "external", "bihar", "external", "external",
    "bihar", "external", "external", "external", "bihar"
  ];

  const selected = [];
  let externalIndex = 0;
  let biharIndex = 0;

  while (
    selected.length < limit &&
    (externalIndex < external.length || biharIndex < bihar.length)
  ) {
    let addedThisRound = 0;

    for (const slot of pattern) {
      if (selected.length >= limit) break;

      if (slot === "external" && externalIndex < external.length) {
        selected.push(external[externalIndex++]);
        addedThisRound += 1;
        continue;
      }

      if (slot === "bihar" && biharIndex < bihar.length) {
        selected.push(bihar[biharIndex++]);
        addedThisRound += 1;
      }
    }

    if (addedThisRound === 0) break;

    if (externalIndex >= external.length && biharIndex < bihar.length) {
      while (selected.length < limit && biharIndex < bihar.length) {
        selected.push(bihar[biharIndex++]);
      }
    }

    if (biharIndex >= bihar.length && externalIndex < external.length) {
      while (selected.length < limit && externalIndex < external.length) {
        selected.push(external[externalIndex++]);
      }
    }
  }

  return selected;
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

async function fetchCategory(category, knownLinks, knownTitles, maxNew, scope) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(category.query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const response = await fetch(url, { headers: { "user-agent": "NewsTeen75Bot/1.0" } });
  if (!response.ok) throw new Error(`RSS failed for ${category.name}: ${response.status}`);

  const xml = await response.text();
  const items = parseItems(xml).slice(0, 30);
  const fresh = [];

  for (const item of items) {
    if (fresh.length >= maxNew) break;

    const cleanTitle = normalizeTitle(item.title);
    if (!item.link || !cleanTitle || !isFresh(item.pubDate)) continue;
    if (knownLinks.has(item.link) || knownTitles.has(cleanTitle.toLowerCase())) continue;

    const publisherUrl = await resolvePublisherUrl(item.link);
    const enriched = await enrichArticle(publisherUrl);
    const publishedAt = new Date(item.pubDate).toISOString();
    const sourceUrl = enriched.finalUrl || publisherUrl || item.link;
    const summary = buildSummary(cleanTitle, enriched.description);
    const image = enriched.image || "";

    if (!summary) continue;
    if (!isUsableImageUrl(image)) continue;
    if (!(await validateImageUrl(image))) continue;
    if (!isHttpUrl(sourceUrl)) continue;

    fresh.push({
      id: idFor(sourceUrl, cleanTitle),
      title: cleanTitle,
      summary,
      category: category.name,
      image,
      source: item.source || "Google News",
      sourceUrl,
      publishedAt,
      fetchedAt: new Date().toISOString(),
      __scope: scope,
    });

    knownLinks.add(item.link);
    knownLinks.add(sourceUrl);
    knownTitles.add(cleanTitle.toLowerCase());
  }

  return fresh;
}

function stripInternalFields(article) {
  const { __scope, ...publicArticle } = article;
  return publicArticle;
}

async function main() {
  const existing = JSON.parse(fs.readFileSync(FEED_PATH, "utf8"));
  const previousArticles = Array.isArray(existing.articles) ? existing.articles : [];

  const retainedArticles = previousArticles
    .filter((article) => isRetained(article.publishedAt))
    .filter(articleHasRequiredQuality);

  const knownLinks = new Set(
    retainedArticles.flatMap((article) => [
      article.sourceUrl,
      article.url,
      article.link,
    ].filter(Boolean))
  );

  const knownTitles = new Set(
    retainedArticles.map((article) => normalizeTitle(article.title || "").toLowerCase())
  );

  const newArticles = [];

  for (const category of externalCategories) {
    try {
      newArticles.push(
        ...(await fetchCategory(
          category,
          knownLinks,
          knownTitles,
          MAX_NEW_EXTERNAL_PER_CATEGORY,
          "external"
        ))
      );
    } catch (error) {
      console.error(error.message);
    }
  }

  for (const category of biharCategories) {
    try {
      newArticles.push(
        ...(await fetchCategory(
          category,
          knownLinks,
          knownTitles,
          MAX_NEW_BIHAR_PER_CATEGORY,
          "bihar"
        ))
      );
    } catch (error) {
      console.error(error.message);
    }
  }

  const eligible = dedupeArticles([
    ...newArticles,
    ...retainedArticles,
  ]).filter(articleHasRequiredQuality);

  const selected = selectWithSeventyThirtyRatio(
    eligible,
    MAX_ARTICLES
  );

  const outputArticles = selected.map(stripInternalFields);

  const previousComparable = previousArticles.map((article) => JSON.stringify(article));
  const nextComparable = outputArticles.map((article) => JSON.stringify(article));
  const feedChanged =
    previousComparable.length !== nextComparable.length ||
    previousComparable.some((value, index) => value !== nextComparable[index]);

  if (!feedChanged) {
    console.log("No eligible feed changes found. Feed unchanged.");
    return;
  }

  const biharCount = selected.filter(isBiharArticle).length;
  const externalCount = selected.length - biharCount;

  const output = {
    updatedAt: new Date().toISOString(),
    count: outputArticles.length,
    articles: outputArticles,
  };

  fs.writeFileSync(FEED_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(
    `Added ${newArticles.length} new eligible article(s). ` +
    `Final feed: ${externalCount} external / ${biharCount} Bihar / ${outputArticles.length} total.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
