import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const { GoogleDecoder } = require("google-news-url-decoder");
const decoder = new GoogleDecoder();

const FEED_PATH = new URL("../data/news.json", import.meta.url);

const MAX_ARTICLES = Number(process.env.FEED_MAX_ARTICLES || 250);
const MAX_NEW_EXTERNAL_PER_CATEGORY = Number(
  process.env.MAX_NEW_EXTERNAL_PER_CATEGORY || 10
);
const MAX_NEW_BIHAR_PER_CATEGORY = Number(
  process.env.MAX_NEW_BIHAR_PER_CATEGORY || 4
);
const RSS_ITEMS_PER_CATEGORY = Number(
  process.env.RSS_ITEMS_PER_CATEGORY || 60
);
const FRESH_WINDOW_MS =
  Number(process.env.FRESH_WINDOW_HOURS || 48) * 60 * 60 * 1000;
const RETENTION_WINDOW_MS =
  Number(process.env.FEED_RETENTION_HOURS || 168) * 60 * 60 * 1000;
const MIN_SUMMARY_CHARS = 60;
const MIN_FETCH_INTERVAL_MINUTES = Number(
  process.env.MIN_FETCH_INTERVAL_MINUTES || 5
);

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

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

const CATEGORY_TRANSLATIONS = {
  "Politics & Government": {
    hi: "राजनीति और सरकार",
    hinglish: "Politics aur Government",
  },
  "Crime & Breaking News": {
    hi: "अपराध और ब्रेकिंग न्यूज़",
    hinglish: "Crime aur Breaking News",
  },
  Sports: {
    hi: "खेल",
    hinglish: "Sports",
  },
  Entertainment: {
    hi: "मनोरंजन",
    hinglish: "Entertainment",
  },
  Technology: {
    hi: "टेक्नोलॉजी",
    hinglish: "Technology",
  },
  "Business & Finance": {
    hi: "बिज़नेस और फाइनेंस",
    hinglish: "Business aur Finance",
  },
  "National & Trending News": {
    hi: "राष्ट्रीय और ट्रेंडिंग न्यूज़",
    hinglish: "National aur Trending News",
  },
};

async function translateArticleText(title = "", summary = "") {
  const cleanTitle = String(title || "").trim();
  const cleanSummary = String(summary || "").trim();

  if (!cleanTitle && !cleanSummary) {
    return { titleHi: "", summaryHi: "" };
  }

  const separator = "999999999";
  const combined = [cleanTitle, separator, cleanSummary].join("\n");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const url =
      "https://translate.googleapis.com/translate_a/single" +
      "?client=gtx&sl=en&tl=hi&dt=t&q=" +
      encodeURIComponent(combined);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 NewsTeen75/1.0",
        accept: "application/json,text/plain,*/*",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { titleHi: "", summaryHi: "" };
    }

    const data = await response.json();

    const translated = Array.isArray(data?.[0])
      ? data[0]
          .map((segment) => (Array.isArray(segment) ? segment[0] || "" : ""))
          .join("")
          .trim()
      : "";

    if (!translated) {
      return { titleHi: "", summaryHi: "" };
    }

    const parts = translated.split(separator);

    if (parts.length >= 2) {
      return {
        titleHi: parts[0].trim(),
        summaryHi: parts.slice(1).join(separator).trim(),
      };
    }

    return {
      titleHi: translated,
      summaryHi: "",
    };
  } catch {
    return { titleHi: "", summaryHi: "" };
  }
}

function transliterateHindi(text = "") {
  const vowels = {
    "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo",
    "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
  };

  const consonants = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng",
    "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
    "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
    "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
    "ष": "sh", "स": "s", "ह": "h", "ळ": "l",
    "क़": "q", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "d",
    "ढ़": "dh", "फ़": "f", "य़": "y",
  };

  const matras = {
    "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u",
    "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
    "ॉ": "o", "ॅ": "e", "ॆ": "e", "ॊ": "o",
  };

  let result = "";
  const chars = Array.from(String(text || ""));

  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    const next = chars[i + 1];

    if (vowels[char]) {
      result += vowels[char];
      continue;
    }

    if (consonants[char]) {
      if (matras[next]) {
        result += consonants[char] + matras[next];
        i += 1;
        continue;
      }

      if (next === "्") {
        result += consonants[char];
        i += 1;
        continue;
      }

      result += consonants[char] + "a";
      continue;
    }

    if (char === "ं" || char === "ँ") {
      result += "n";
      continue;
    }

    if (char === "ः") {
      result += "h";
      continue;
    }

    if (char === "़" || char === "्") {
      continue;
    }

    result += char;
  }

  return result
    .replace(/\s+/g, " ")
    .replace(/a([,.;:!?])/g, "$1")
    .trim();
}

async function ensureTranslations(article) {
  if (!article) return article;

  const next = { ...article };

  if (!next.title_hi || !next.summary_hi) {
    const translated = await translateArticleText(
      next.title || "",
      next.summary || ""
    );

    if (!next.title_hi) {
      next.title_hi = translated.titleHi || "";
    }

    if (!next.summary_hi) {
      next.summary_hi = translated.summaryHi || "";
    }
  }

  next.category_hi =
    next.category_hi ||
    CATEGORY_TRANSLATIONS[next.category]?.hi ||
    next.category ||
    "";

  if ((!next.title_hinglish || !next.summary_hinglish) && next.title_hi) {
    if (!next.title_hinglish) {
      next.title_hinglish = transliterateHindi(next.title_hi);
    }

    if (!next.summary_hinglish && next.summary_hi) {
      next.summary_hinglish = transliterateHindi(next.summary_hi);
    }
  }

  next.category_hinglish =
    next.category_hinglish ||
    CATEGORY_TRANSLATIONS[next.category]?.hinglish ||
    next.category ||
    "";

  return next;
}

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
      providerId: tag(block, "guid") || tag(block, "link"),
      pubDate: tag(block, "pubDate"),
      source: tag(block, "source"),
    };
  });
}

async function fetchWithRetry(
  url,
  options = {},
  { attempts = 3, baseDelayMs = 800 } = {}
) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);

      if (
        response.ok ||
        (response.status < 500 && response.status !== 429)
      ) {
        return response;
      }

      lastError = new Error(
        `Request failed with status ${response.status}`
      );
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      const retryAfter =
        Number(lastError?.response?.headers?.get?.("retry-after")) || 0;
      const delay =
        retryAfter > 0
          ? retryAfter * 1000
          : baseDelayMs * 2 ** (attempt - 1);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error("Request failed");
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

  try {
    const url = new URL(value);
    const lowerPath = url.pathname.toLowerCase();
    const fileName = lowerPath.split("/").pop() || "";

    if (
      /(logo|favicon|icon|sprite|avatar|placeholder|default)/i.test(fileName)
    ) {
      return false;
    }
  } catch {
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

function articleHasArchiveQuality(article) {
  const title = normalizeTitle(article?.title || "");
  const sourceUrl = article?.sourceUrl || article?.url || article?.link || "";
  const publishedAt = new Date(article?.publishedAt).getTime();

  return (
    title.length >= 12 &&
    isHttpUrl(sourceUrl) &&
    Number.isFinite(publishedAt)
  );
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

function normalizedStoryTitle(title = "") {
  return normalizeTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|and|or|but|to|of|in|on|at|for|from|with|by|as|is|are|was|were|be|been|being|this|that|these|those|after|before|over|under|into|amid|says|said|latest|live|update|updates|news)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(title = "") {
  return new Set(
    normalizedStoryTitle(title)
      .split(/\s+/)
      .filter((word) => word.length > 2)
  );
}

function isNearDuplicateTitle(a = "", b = "") {
  const leftTitle = normalizedStoryTitle(a);
  const rightTitle = normalizedStoryTitle(b);

  if (!leftTitle || !rightTitle) return false;
  if (leftTitle === rightTitle) return true;

  const left = titleTokens(leftTitle);
  const right = titleTokens(rightTitle);
  if (left.size < 3 || right.size < 3) return false;

  let common = 0;
  for (const word of left) {
    if (right.has(word)) common += 1;
  }

  const union = new Set([...left, ...right]).size;
  const smaller = Math.min(left.size, right.size);

  const jaccard = union > 0 ? common / union : 0;
  const containment = smaller > 0 ? common / smaller : 0;

  return common >= 4 && (jaccard >= 0.68 || containment >= 0.82);
}

function dedupeArticles(articles) {
  const sorted = [...articles].sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );

  const kept = [];
  const seenIds = new Set();
  const seenUrls = new Set();
  const seenTitles = new Set();

  for (const article of sorted) {
    const id = String(article?.id || "").trim();
    const url = canonicalUrl(article.sourceUrl || article.url || article.link || "");
    const title = normalizedStoryTitle(article.title || "");

    if (!url || !title) continue;
    if (id && seenIds.has(id)) continue;
    if (seenUrls.has(url) || seenTitles.has(title)) continue;
    if (
      kept.some((existing) =>
        isNearDuplicateTitle(existing.title, article.title)
      )
    ) {
      continue;
    }

    kept.push(article);

    if (id) seenIds.add(id);
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

  const total = Math.min(limit, bihar.length + external.length);

  if (total <= 0) return [];
  if (!bihar.length) return external.slice(0, total);
  if (!external.length) return bihar.slice(0, total);

  const biharTarget = Math.min(
    bihar.length,
    Math.round(total * 0.3)
  );

  const externalTarget = Math.min(
    external.length,
    total - biharTarget
  );

  const selectedBihar = bihar.slice(0, biharTarget);
  const selectedExternal = external.slice(0, externalTarget);

  const selected = [];
  const pattern = [
    "external",
    "external",
    "bihar",
    "external",
    "external",
    "bihar",
    "external",
    "external",
    "external",
    "bihar",
  ];

  let externalIndex = 0;
  let biharIndex = 0;

  while (
    selected.length < total &&
    (externalIndex < selectedExternal.length ||
      biharIndex < selectedBihar.length)
  ) {
    for (const slot of pattern) {
      if (selected.length >= total) break;

      if (
        slot === "external" &&
        externalIndex < selectedExternal.length
      ) {
        selected.push(selectedExternal[externalIndex++]);
      } else if (
        slot === "bihar" &&
        biharIndex < selectedBihar.length
      ) {
        selected.push(selectedBihar[biharIndex++]);
      }
    }
  }

  const selectedIds = new Set(selected.map((article) => article.id));

  const overflow = [...external, ...bihar]
    .filter((article) => !selectedIds.has(article.id))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  for (const article of overflow) {
    if (selected.length >= total) break;
    selected.push(article);
  }

  return selected.slice(0, total);
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
  const response = await fetchWithRetry(
    url,
    {
      headers: {
        "user-agent": "NewsTeen75Bot/1.0",
        accept: "application/rss+xml,application/xml,text/xml,*/*",
      },
    },
    { attempts: 3, baseDelayMs: 1000 }
  );

  if (!response.ok) {
    throw new Error(
      `RSS failed for ${category.name}: ${response.status}`
    );
  }

  const xml = await response.text();
  const items = parseItems(xml).slice(0, RSS_ITEMS_PER_CATEGORY);
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
    const rawImage = enriched.image || "";
    const image =
      rawImage && isUsableImageUrl(rawImage) && (await validateImageUrl(rawImage))
        ? rawImage
        : "";

    if (!isHttpUrl(sourceUrl)) continue;

    fresh.push({
      id: idFor(canonicalUrl(sourceUrl), cleanTitle),
      provider: "google_news_rss",
      providerId: item.providerId || item.link,
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

function articleToArchiveRow(article) {
  const originalUrl =
    article?.sourceUrl || article?.url || article?.link || "";
  const canonical = canonicalUrl(originalUrl);

  return {
    id: String(
      article?.id || idFor(canonical, article?.title || "")
    ),
    provider: String(article?.provider || "google_news_rss"),
    provider_id: String(article?.providerId || "") || null,
    canonical_url: canonical,
    title: String(article?.title || "").trim(),
    summary: String(article?.summary || article?.description || "").trim(),
    image_url: String(article?.image || "").trim(),
    publisher: String(article?.source || "Google News").trim(),
    original_url: originalUrl,
    category: String(article?.category || "").trim(),
    language: "en",
    title_hi: String(article?.title_hi || "").trim() || null,
    summary_hi: String(article?.summary_hi || "").trim() || null,
    title_hinglish: String(article?.title_hinglish || "").trim() || null,
    summary_hinglish:
      String(article?.summary_hinglish || "").trim() || null,
    published_at: article?.publishedAt,
    ingested_at: article?.fetchedAt || new Date().toISOString(),
    story_fingerprint: normalizedStoryTitle(article?.title || "") || null,
  };
}

async function upsertArchiveToSupabase(articles) {
  if (!supabase) {
    console.warn(
      "Supabase archive sync skipped: SUPABASE_URL or service role key is missing."
    );
    return { synced: 0, skipped: true };
  }

  const rows = dedupeArticles(articles)
    .filter(articleHasArchiveQuality)
    .map(articleToArchiveRow);

  let synced = 0;

  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100);

    const { error } = await supabase
      .from("news_articles")
      .upsert(batch, {
        onConflict: "canonical_url",
        ignoreDuplicates: false,
      });

    if (error) {
      throw new Error(`Supabase archive upsert failed: ${error.message}`);
    }

    synced += batch.length;
  }

  return { synced, skipped: false };
}

async function recordIngestionRun({
  status,
  fetchedCount,
  feedCount,
  archivedCount,
  errorMessage = null,
}) {
  if (!supabase) return;

  const { error } = await supabase.from("news_ingestion_runs").insert({
    status,
    fetched_count: fetchedCount,
    feed_count: feedCount,
    archived_count: archivedCount,
    error_message: errorMessage,
  });

  if (error) {
    console.warn(`Could not record ingestion run: ${error.message}`);
  }
}

async function shouldSkipForConfiguredFrequency() {
  if (!supabase || MIN_FETCH_INTERVAL_MINUTES <= 5) {
    return false;
  }

  const { data, error } = await supabase
    .from("news_ingestion_runs")
    .select("ran_at,status")
    .eq("status", "success")
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(
      `Could not check ingestion frequency: ${error.message}`
    );
    return false;
  }

  if (!data?.ran_at) {
    return false;
  }

  const lastRun = new Date(data.ran_at).getTime();
  if (!Number.isFinite(lastRun)) {
    return false;
  }

  const ageMinutes = (Date.now() - lastRun) / 60000;

  if (ageMinutes < MIN_FETCH_INTERVAL_MINUTES) {
    console.log(
      `Skipping fetch: last successful run was ${ageMinutes.toFixed(
        1
      )} minute(s) ago; configured interval is ${MIN_FETCH_INTERVAL_MINUTES} minute(s).`
    );
    return true;
  }

  return false;
}

async function main() {
  if (await shouldSkipForConfiguredFrequency()) {
    return;
  }

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

  const archiveCandidates = dedupeArticles([
    ...newArticles,
    ...previousArticles,
  ]).filter(articleHasArchiveQuality);

  const eligible = dedupeArticles([
    ...newArticles,
    ...retainedArticles,
  ]).filter(articleHasRequiredQuality);

  const selected = selectWithSeventyThirtyRatio(
    eligible,
    MAX_ARTICLES
  );

  const translatedSelected = [];

  for (const article of selected) {
    translatedSelected.push(await ensureTranslations(article));
  }

  const outputArticles = translatedSelected.map(stripInternalFields);

  const archiveResult = await upsertArchiveToSupabase([
    ...archiveCandidates,
    ...translatedSelected,
  ]);

  const previousComparable = previousArticles.map((article) => JSON.stringify(article));
  const nextComparable = outputArticles.map((article) => JSON.stringify(article));
  const feedChanged =
    previousComparable.length !== nextComparable.length ||
    previousComparable.some((value, index) => value !== nextComparable[index]);

  if (!feedChanged) {
    await recordIngestionRun({
      status: "success",
      fetchedCount: newArticles.length,
      feedCount: outputArticles.length,
      archivedCount: archiveResult.synced,
    });

    console.log(
      `No feed JSON changes. Archive synced ${archiveResult.synced} article(s).`
    );
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

  await recordIngestionRun({
    status: "success",
    fetchedCount: newArticles.length,
    feedCount: outputArticles.length,
    archivedCount: archiveResult.synced,
  });

  console.log(
    `Fetched ${newArticles.length} new candidate article(s). ` +
      `Archive synced ${archiveResult.synced}. ` +
      `Final feed: ${externalCount} external / ${biharCount} Bihar / ${outputArticles.length} total.`
  );
}

main().catch(async (error) => {
  console.error(error);

  try {
    await recordIngestionRun({
      status: "error",
      fetchedCount: 0,
      feedCount: 0,
      archivedCount: 0,
      errorMessage: error?.message || String(error),
    });
  } catch {
    // Keep the original ingestion error as the process failure.
  }

  process.exit(1);
});
