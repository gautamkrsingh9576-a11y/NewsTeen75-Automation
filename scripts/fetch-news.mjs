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
  process.env.MAX_NEW_BIHAR_PER_CATEGORY || 8
);
const MAX_NEW_STATE_PER_REGION = Number(
  process.env.MAX_NEW_STATE_PER_REGION || 1
);
const RSS_ITEMS_PER_CATEGORY = Number(
  process.env.RSS_ITEMS_PER_CATEGORY || 60
);
const FRESH_WINDOW_MS =
  Number(process.env.FRESH_WINDOW_HOURS || 48) * 60 * 60 * 1000;
const RETENTION_WINDOW_MS =
  Number(process.env.FEED_RETENTION_HOURS || 168) * 60 * 60 * 1000;
const MIN_SUMMARY_CHARS = 60;
const MIN_HEADLINE_WORDS = 8;
const MAX_HEADLINE_WORDS = 14;
const MAX_HEADLINE_CHARS = 90;
const MIN_SUMMARY_WORDS = 50;
const MAX_SUMMARY_WORDS = 60;
const MIN_FETCH_INTERVAL_MINUTES = Number(
  process.env.MIN_FETCH_INTERVAL_MINUTES || 5
);

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();

const GEMINI_API_KEY = String(
  process.env.GEMINI_API_KEY || ""
).trim();

const GEMINI_MODEL = String(
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite"
).trim();

let geminiDisabledForRun = false;
let geminiDisableReason = "";
let geminiDisableLogged = false;

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
  { name: "Politics & Government", query: "(Bihar OR Patna) politics government election policy when:2d" },
  { name: "Crime & Breaking News", query: "(Bihar OR Patna) crime police accident court breaking news when:2d" },
  { name: "Sports", query: "(Bihar OR Patna) sports cricket tournament when:2d" },
  { name: "Entertainment", query: "(Bihar OR Patna) entertainment cinema culture when:2d" },
  { name: "Technology", query: "(Bihar OR Patna) technology AI startup digital when:2d" },
  { name: "Business & Finance", query: "(Bihar OR Patna) business startup funding economy market when:2d" },
  { name: "National & Trending News", query: "(Bihar OR Patna) local development education infrastructure trending when:2d" },
];

const STATE_REGIONS = [
  { slug: "andhra-pradesh", name: "Andhra Pradesh", query: "Andhra Pradesh latest news when:2d" },
  { slug: "arunachal-pradesh", name: "Arunachal Pradesh", query: "Arunachal Pradesh latest news when:2d" },
  { slug: "assam", name: "Assam", query: "Assam latest news when:2d" },
  { slug: "chhattisgarh", name: "Chhattisgarh", query: "Chhattisgarh latest news when:2d" },
  { slug: "goa", name: "Goa", query: "Goa latest news when:2d" },
  { slug: "gujarat", name: "Gujarat", query: "Gujarat latest news when:2d" },
  { slug: "haryana", name: "Haryana", query: "Haryana latest news when:2d" },
  { slug: "himachal-pradesh", name: "Himachal Pradesh", query: "Himachal Pradesh latest news when:2d" },
  { slug: "jharkhand", name: "Jharkhand", query: "Jharkhand latest news when:2d" },
  { slug: "karnataka", name: "Karnataka", query: "Karnataka latest news when:2d" },
  { slug: "kerala", name: "Kerala", query: "Kerala latest news when:2d" },
  { slug: "madhya-pradesh", name: "Madhya Pradesh", query: "Madhya Pradesh latest news when:2d" },
  { slug: "maharashtra", name: "Maharashtra", query: "Maharashtra latest news when:2d" },
  { slug: "manipur", name: "Manipur", query: "Manipur latest news when:2d" },
  { slug: "meghalaya", name: "Meghalaya", query: "Meghalaya latest news when:2d" },
  { slug: "mizoram", name: "Mizoram", query: "Mizoram latest news when:2d" },
  { slug: "nagaland", name: "Nagaland", query: "Nagaland latest news when:2d" },
  { slug: "odisha", name: "Odisha", query: "Odisha latest news when:2d" },
  { slug: "punjab", name: "Punjab", query: "Punjab India latest news when:2d" },
  { slug: "rajasthan", name: "Rajasthan", query: "Rajasthan latest news when:2d" },
  { slug: "sikkim", name: "Sikkim", query: "Sikkim latest news when:2d" },
  { slug: "tamil-nadu", name: "Tamil Nadu", query: "Tamil Nadu latest news when:2d" },
  { slug: "telangana", name: "Telangana", query: "Telangana latest news when:2d" },
  { slug: "tripura", name: "Tripura", query: "Tripura latest news when:2d" },
  { slug: "uttar-pradesh", name: "Uttar Pradesh", query: "Uttar Pradesh latest news when:2d" },
  { slug: "uttarakhand", name: "Uttarakhand", query: "Uttarakhand latest news when:2d" },
  { slug: "west-bengal", name: "West Bengal", query: "West Bengal latest news when:2d" },
  { slug: "andaman-and-nicobar-islands", name: "Andaman and Nicobar Islands", query: "Andaman Nicobar latest news when:2d" },
  { slug: "chandigarh", name: "Chandigarh", query: "Chandigarh latest news when:2d" },
  { slug: "dadra-and-nagar-haveli-and-daman-and-diu", name: "Dadra and Nagar Haveli and Daman and Diu", query: "Dadra Nagar Haveli Daman Diu latest news when:2d" },
  { slug: "delhi", name: "Delhi", query: "Delhi NCR latest news when:2d" },
  { slug: "jammu-and-kashmir", name: "Jammu and Kashmir", query: "Jammu Kashmir latest news when:2d" },
  { slug: "ladakh", name: "Ladakh", query: "Ladakh latest news when:2d" },
  { slug: "lakshadweep", name: "Lakshadweep", query: "Lakshadweep latest news when:2d" },
  { slug: "puducherry", name: "Puducherry", query: "Puducherry latest news when:2d" },
];

const STATE_LOCATION_TERMS = {
  "bihar": [
    "bihar", "patna", "gaya", "muzaffarpur", "bhagalpur", "darbhanga",
    "nalanda", "bihar sharif", "purnia", "begusarai", "samastipur",
    "madhubani", "sitamarhi", "motihari", "bettiah", "katihar",
    "kishanganj", "arrah", "buxar", "sasaram", "rohtas", "nawada",
    "jamui", "munger", "hajipur", "vaishali", "siwan", "chapra",
    "saran", "saharsa", "supaul", "madhepura", "araria", "khagaria",
    "jehanabad", "aurangabad bihar", "kaimur", "gopalganj", "sheohar",
    "lakhisarai", "sheikhpura", "banka", "bhojpur", "east champaran",
    "west champaran", "purbi champaran", "pashchim champaran",
    "bpsc", "bihar public service commission", "bihar board",
    "bseb", "bihar police", "patna high court", "bihar government",
    "bihar govt", "bihar assembly", "bihar vidhan sabha"
  ],
  "andhra-pradesh": ["andhra pradesh", "visakhapatnam", "vijayawada", "tirupati", "guntur", "nellore"],
  "arunachal-pradesh": ["arunachal pradesh", "itanagar", "tawang"],
  "assam": ["assam", "guwahati", "dibrugarh", "silchar", "jorhat"],
  "chhattisgarh": ["chhattisgarh", "raipur", "bilaspur", "durg", "bhilai"],
  "goa": ["goa", "panaji", "margao", "vasco da gama"],
  "gujarat": ["gujarat", "ahmedabad", "surat", "vadodara", "rajkot", "gandhinagar"],
  "haryana": ["haryana", "gurugram", "gurgaon", "faridabad", "panipat", "hisar", "ambala"],
  "himachal-pradesh": ["himachal pradesh", "shimla", "manali", "dharamshala", "mandi"],
  "jharkhand": ["jharkhand", "ranchi", "jamshedpur", "dhanbad", "bokaro", "deoghar"],
  "karnataka": ["karnataka", "bengaluru", "bangalore", "mysuru", "mysore", "mangaluru", "hubballi"],
  "kerala": ["kerala", "thiruvananthapuram", "kochi", "kozhikode", "thrissur", "kannur"],
  "madhya-pradesh": ["madhya pradesh", "bhopal", "indore", "gwalior", "jabalpur", "ujjain"],
  "maharashtra": ["maharashtra", "mumbai", "pune", "nagpur", "nashik", "thane", "aurangabad"],
  "manipur": ["manipur", "imphal"],
  "meghalaya": ["meghalaya", "shillong"],
  "mizoram": ["mizoram", "aizawl"],
  "nagaland": ["nagaland", "kohima", "dimapur"],
  "odisha": ["odisha", "orissa", "bhubaneswar", "cuttack", "puri", "rourkela"],
  "punjab": ["punjab", "ludhiana", "amritsar", "jalandhar", "patiala", "bathinda"],
  "rajasthan": ["rajasthan", "jaipur", "jodhpur", "udaipur", "kota", "ajmer", "bikaner"],
  "sikkim": ["sikkim", "gangtok"],
  "tamil-nadu": ["tamil nadu", "chennai", "coimbatore", "madurai", "tiruchirappalli", "salem"],
  "telangana": ["telangana", "hyderabad", "warangal", "karimnagar", "nizamabad"],
  "tripura": ["tripura", "agartala"],
  "uttar-pradesh": ["uttar pradesh", "lucknow", "kanpur", "agra", "varanasi", "prayagraj", "noida", "ghaziabad", "gorakhpur"],
  "uttarakhand": ["uttarakhand", "dehradun", "haridwar", "rishikesh", "nainital", "haldwani"],
  "west-bengal": ["west bengal", "kolkata", "howrah", "siliguri", "durgapur", "asansol"],
  "andaman-and-nicobar-islands": ["andaman", "nicobar", "port blair"],
  "chandigarh": ["chandigarh"],
  "dadra-and-nagar-haveli-and-daman-and-diu": ["dadra and nagar haveli", "daman", "diu", "silvassa"],
  "delhi": ["delhi", "new delhi", "delhi ncr"],
  "jammu-and-kashmir": ["jammu and kashmir", "jammu", "srinagar", "kashmir"],
  "ladakh": ["ladakh", "leh", "kargil"],
  "lakshadweep": ["lakshadweep", "kavaratti"],
  "puducherry": ["puducherry", "pondicherry"],
};

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

function splitWords(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function countWords(text = "") {
  return splitWords(text).length;
}

function hasRequiredSummary(article) {
  const summary = stripHtml(
    article?.summary || article?.description || ""
  );

  return (
    summary.length > 0 &&
    !isGeneratedFallbackSummary(summary) &&
    summaryWordCountIsValid(summary) &&
    summaryEndsWithCompleteSentence(summary)
  );
}

function headlineWordCountIsValid(text = "") {
  const clean = String(text || "").trim();
  const words = countWords(clean);

  return (
    words >= MIN_HEADLINE_WORDS &&
    words <= MAX_HEADLINE_WORDS &&
    clean.length <= MAX_HEADLINE_CHARS &&
    !clean.endsWith(".")
  );
}

function exactHeadline(title = "") {
  const words = splitWords(normalizeTitle(title));

  if (words.length < MIN_HEADLINE_WORDS) {
    return "";
  }

  const danglingWords = new Set([
    "a", "an", "the", "and", "or", "but", "to", "of", "in", "on",
    "at", "for", "from", "with", "by", "as", "into", "amid", "after",
    "before", "over", "under", "its", "their"
  ]);

  const maxLength = Math.min(words.length, MAX_HEADLINE_WORDS);

  for (
    let length = maxLength;
    length >= MIN_HEADLINE_WORDS;
    length -= 1
  ) {
    const headline = words
      .slice(0, length)
      .join(" ")
      .replace(/[.!?,:;–—-]+$/u, "")
      .trim();

    if (!headlineWordCountIsValid(headline)) {
      continue;
    }

    const lastWord = splitWords(headline)
      .at(-1)
      ?.toLowerCase()
      .replace(/[^a-z0-9']/g, "");

    if (lastWord && !danglingWords.has(lastWord)) {
      return headline;
    }
  }

  return "";
}

function summaryWordCountIsValid(text = "") {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;

  return (
    words >= MIN_SUMMARY_WORDS &&
    words <= MAX_SUMMARY_WORDS
  );
}

function summaryEndsWithCompleteSentence(text = "") {
  return /[.!?]["'”’)]?$/.test(String(text || "").trim());
}

function summaryIsValid(text = "") {
  const clean = String(text || "").trim();

  return (
    summaryWordCountIsValid(clean) &&
    summaryEndsWithCompleteSentence(clean) &&
    !/(?:\.\.\.|…)/.test(clean)
  );
}

function rangedSentenceExcerpt(text = "") {
  const clean = stripHtml(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "";

  const sentences =
    clean.match(/[^.!?]+[.!?]+(?:["'”’)]*)?/g) || [];

  for (let start = 0; start < sentences.length; start += 1) {
    let total = 0;
    const selected = [];

    for (let index = start; index < sentences.length; index += 1) {
      const sentence = sentences[index].trim();
      const words = countWords(sentence);

      if (!sentence || words === 0) continue;

      if (total + words > MAX_SUMMARY_WORDS) {
        break;
      }

      selected.push(sentence);
      total += words;

      if (total >= MIN_SUMMARY_WORDS) {
        const summary = selected.join(" ");
        if (summaryIsValid(summary)) {
          return summary;
        }
      }
    }
  }

  return "";
}

function trimSummary(text = "", maxWords = MAX_SUMMARY_WORDS) {
  const clean = stripHtml(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "";

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords && summaryEndsWithCompleteSentence(clean)) {
    return clean;
  }

  const limitedWords = words.slice(0, maxWords);
  const minSentenceWords = Math.ceil(limitedWords.length * 0.6);

  for (let index = limitedWords.length - 1; index >= 0; index -= 1) {
    if (!/[.!?]["'”’)]?$/.test(limitedWords[index])) {
      continue;
    }

    const sentenceWords = limitedWords.slice(0, index + 1);
    if (sentenceWords.length >= minSentenceWords) {
      return sentenceWords.join(" ");
    }
  }

  return `${limitedWords
    .join(" ")
    .replace(/[.!?,:;…]+$/u, "")
    .trim()}…`;
}

function getGeminiResponseText(data) {
  const parts =
    data?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) =>
      typeof part?.text === "string"
        ? part.text
        : ""
    )
    .filter(Boolean)
    .join("")
    .trim();
}

function stripJsonFences(value = "") {
  return String(value || "")
    .trim()
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();
}

function parseAiArticleJson(value = "") {
  try {
    const parsed = JSON.parse(stripJsonFences(value));

    return {
      headline: String(parsed?.headline || "").replace(/\s+/g, " ").trim(),
      summary: String(parsed?.summary || "").replace(/\s+/g, " ").trim(),
    };
  } catch {
    return null;
  }
}

async function requestAiArticleRewrite({
  title,
  source,
  content,
  retryForValidation = false,
}) {
  if (!GEMINI_API_KEY || geminiDisabledForRun) {
    return "";
  }

  const cleanTitle = normalizeTitle(title || "");
  const cleanSource = String(source || "Unknown source").trim();
  const cleanContent = stripHtml(content || "").slice(0, 9000);

  if (!cleanTitle || !cleanContent) {
    return "";
  }

  const validationRetryNote = retryForValidation
    ? "\n\nYour previous response failed the app's validation. Follow every word-count, character-limit, JSON, and complete-sentence rule exactly."
    : "";

  const prompt =
    `You are a news editor writing short, factual summaries for a mobile news app where each article is shown as a single swipeable card.

Rewrite the article below into a headline and a summary.

HEADLINE RULES
- 8 to 14 words (maximum 90 characters).
- Clear and factual. State the main event, who is involved, and where if relevant.
- No clickbait, no question headlines, no ALL CAPS, no emojis.
- Do not end with a full stop.

SUMMARY RULES
- Between 50 and 60 words. Never fewer than 50 and never more than 60.
- Must end with a complete sentence. Never cut off mid-sentence and never use "..." or "…".
- Cover in order of importance: what happened, who is involved, where, when, and why it matters or what happens next.
- Use only facts from the source article. No opinions or added information.
- Simple, neutral English readable in 15–20 seconds.
- Spell out an abbreviation the first time it appears.
- Do not repeat the headline word for word.
- No bullet points, line breaks, or emojis.

OUTPUT FORMAT
Return only valid JSON with no extra text or markdown fences:
{ "headline": "string", "summary": "string" }

SOURCE
Original title: ${cleanTitle}
Source name: ${cleanSource}
Article content: ${cleanContent}${validationRetryNote}`;

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(GEMINI_MODEL) +
    ":generateContent";

  const requestBody = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 320,
      responseMimeType: "application/json",
    },
  });

  const transportAttempts = 2;

  for (let attempt = 1; attempt <= transportAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      12000
    );

    try {
      const response = await fetch(
        endpoint,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY,
          },
          body: requestBody,
        }
      );

      if (!response.ok) {
        const errorText =
          await response
            .text()
            .catch(() => "");

        if (
          response.status === 429 ||
          response.status === 401 ||
          response.status === 403
        ) {
          geminiDisabledForRun = true;
          geminiDisableReason =
            response.status === 429
              ? "quota/rate limit reached"
              : "authentication/permission error";

          if (!geminiDisableLogged) {
            console.warn(
              `Gemini disabled for the rest of this run: ${geminiDisableReason}. Source-based summaries will be used as fallback.`
            );
            geminiDisableLogged = true;
          }

          return "";
        }

        const isTransient =
          response.status === 500 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504;

        if (isTransient) {
          console.warn(
            `Gemini rewrite temporary failure (${response.status}) on attempt ${attempt}/${transportAttempts}: ${errorText.slice(0, 300)}`
          );

          if (attempt < transportAttempts) {
            const retryAfterSeconds =
              Number(response.headers.get("retry-after")) || 0;
            const delayMs =
              retryAfterSeconds > 0
                ? Math.min(retryAfterSeconds * 1000, 10000)
                : 1500 * attempt;

            await new Promise((resolve) =>
              setTimeout(resolve, delayMs)
            );
            continue;
          }

          geminiDisabledForRun = true;
          geminiDisableReason =
            `temporary Gemini service error (${response.status})`;

          if (!geminiDisableLogged) {
            console.warn(
              `Gemini disabled for the rest of this run after repeated temporary failures: ${geminiDisableReason}. Source-based summaries will be used as fallback.`
            );
            geminiDisableLogged = true;
          }

          return "";
        }

        console.warn(
          `Gemini rewrite request failed (${response.status}): ${errorText.slice(0, 300)}`
        );

        return "";
      }

      const data = await response.json();
      return getGeminiResponseText(data);
    } catch (error) {
      const isAbort =
        error?.name === "AbortError" ||
        /aborted/i.test(String(error?.message || ""));

      console.warn(
        `Gemini rewrite ${isAbort ? "timed out" : "error"} on attempt ${attempt}/${transportAttempts}: ${error?.message || String(error)}`
      );

      if (attempt < transportAttempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1500 * attempt)
        );
        continue;
      }

      if (isAbort) {
        geminiDisabledForRun = true;
        geminiDisableReason =
          "repeated Gemini request timeouts";

        if (!geminiDisableLogged) {
          console.warn(
            `Gemini disabled for the rest of this run: ${geminiDisableReason}. Source-based summaries will be used as fallback.`
          );
          geminiDisableLogged = true;
        }
      }

      return "";
    } finally {
      clearTimeout(timeout);
    }
  }

  return "";
}

async function rewriteArticleWithAI({
  title,
  source,
  content,
  articleRef,
}) {
  if (!GEMINI_API_KEY || geminiDisabledForRun) {
    return null;
  }

  let lastParsed = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await requestAiArticleRewrite({
      title,
      source,
      content,
      retryForValidation: attempt === 1,
    });

    if (!raw) {
      return null;
    }

    const parsed = parseAiArticleJson(raw);
    if (parsed) {
      lastParsed = parsed;
    }

    if (
      parsed &&
      headlineWordCountIsValid(parsed.headline) &&
      summaryIsValid(parsed.summary)
    ) {
      return parsed;
    }

    console.warn(
      `AI article rewrite failed validation for ${articleRef || title} on attempt ${attempt + 1}/2.`
    );
  }

  const fallbackHeadline =
    lastParsed?.headline &&
    headlineWordCountIsValid(lastParsed.headline)
      ? lastParsed.headline
      : exactHeadline(title);

  const fallbackSummary = trimSummary(
    lastParsed?.summary || content,
    MAX_SUMMARY_WORDS
  );

  if (
    headlineWordCountIsValid(fallbackHeadline) &&
    summaryWordCountIsValid(fallbackSummary)
  ) {
    console.warn(
      `AI fallback used for article ${articleRef || title}.`
    );

    return {
      headline: fallbackHeadline,
      summary: fallbackSummary,
    };
  }

  return null;
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

function buildSummary(title, description, articleText = "") {
  const cleanTitle = normalizeTitle(title);
  const descriptionText = stripHtml(description || "");
  const articleBody = stripHtml(articleText || "");

  const candidates = [descriptionText, articleBody].filter(
    (text) =>
      text &&
      text.length >= MIN_SUMMARY_CHARS &&
      !isGenericGoogleDescription(text) &&
      !isGeneratedFallbackSummary(text) &&
      text.toLowerCase() !== cleanTitle.toLowerCase()
  );

  for (const candidate of candidates) {
    const summary = rangedSentenceExcerpt(candidate);

    if (summary && summaryIsValid(summary)) {
      return summary;
    }
  }

  const fallbackText = [
    articleBody,
    descriptionText,
  ].filter(Boolean).join(" ");

  const trimmed = trimSummary(
    fallbackText,
    MAX_SUMMARY_WORDS
  );

  if (
    summaryWordCountIsValid(trimmed) &&
    summaryEndsWithCompleteSentence(trimmed)
  ) {
    return trimmed;
  }

  return "";
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

function extractArticleText(html = "") {
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter((text) => text.length >= 40)
    .slice(0, 30)
    .join(" ")
    .trim();
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

function isFacebookSource(article = {}) {
  const values = [
    article?.source,
    article?.sourceUrl,
    article?.url,
    article?.link,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return values.some(
    (value) =>
      value.includes("facebook.com") ||
      value.includes("fb.com") ||
      value.includes("m.facebook.com") ||
      value.includes("facebook")
  );
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

async function keepArticlesWithLiveImages(articles = []) {
  const kept = [];
  const chunkSize = 12;

  for (let start = 0; start < articles.length; start += chunkSize) {
    const chunk = articles.slice(start, start + chunkSize);

    const checks = await Promise.all(
      chunk.map(async (article) => ({
        article,
        valid: await validateImageUrl(
          article?.image || article?.image_url || ""
        ),
      }))
    );

    for (const check of checks) {
      if (check.valid) {
        kept.push(check.article);
      }
    }
  }

  return kept;
}

function articleHasArchiveQuality(article) {
  const title = normalizeTitle(article?.title || "");
  const summary = stripHtml(article?.summary || article?.description || "");
  const sourceUrl = article?.sourceUrl || article?.url || article?.link || "";
  const publishedAt = new Date(article?.publishedAt).getTime();

  return (
    !isFacebookSource(article) &&
    headlineWordCountIsValid(title) &&
    hasRequiredSummary(article) &&
    isHttpUrl(sourceUrl) &&
    isUsableImageUrl(article?.image || article?.image_url || "") &&
    Number.isFinite(publishedAt)
  );
}

function articleHasRequiredQuality(article) {
  const title = normalizeTitle(article?.title || "");
  const summary = stripHtml(article?.summary || article?.description || "");
  const source = String(article?.source || "").trim();
  const sourceUrl = article?.sourceUrl || article?.url || article?.link || "";

  return (
    !isFacebookSource(article) &&
    headlineWordCountIsValid(title) &&
    hasRequiredSummary(article) &&
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

function textMatchesTerms(text, terms = []) {
  return terms.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("\\b" + escaped + "\\b", "i").test(text);
  });
}

function inferStateSlug(article) {
  const explicit = String(article?.__stateSlug || "").trim().toLowerCase();

  if (explicit) return explicit;

  const text = [
    article?.title,
    article?.summary,
    article?.description,
    article?.source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!text) return null;

  for (const [slug, terms] of Object.entries(STATE_LOCATION_TERMS)) {
    if (textMatchesTerms(text, terms)) return slug;
  }

  return null;
}

function verifiedBiharText(article) {
  return [
    article?.title,
    article?.summary,
    article?.description,
    article?.source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isBiharArticle(article) {
  const text = verifiedBiharText(article);

  if (!text) return false;

  return textMatchesTerms(
    text,
    STATE_LOCATION_TERMS.bihar || []
  );
}

function publishedTime(article) {
  const value = new Date(article?.publishedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function selectBalancedBiharIndiaArticles(
  articles,
  limit = MAX_ARTICLES
) {
  const sorted = [...articles].sort(
    (a, b) => publishedTime(b) - publishedTime(a)
  );

  const bihar = sorted.filter(isBiharArticle);
  const allIndia = sorted.filter(
    (article) => !isBiharArticle(article)
  );

  const pairLimit = Math.floor(limit / 2);
  const pairCount = Math.min(
    pairLimit,
    bihar.length,
    allIndia.length
  );

  if (pairCount <= 0) {
    return [];
  }

  const selected = [];

  for (let index = 0; index < pairCount; index += 1) {
    selected.push(bihar[index]);
    selected.push(allIndia[index]);
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
      articleText: extractArticleText(html),
      image: absoluteUrl(rawImage, finalUrl),
    };
  } catch {
    return {};
  }
}

async function fetchCategory(
  category,
  knownLinks,
  knownTitles,
  maxNew,
  scope,
  stateSlug = null
) {
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
    const rawImage = enriched.image || "";
    const image =
      rawImage && isUsableImageUrl(rawImage) && (await validateImageUrl(rawImage))
        ? rawImage
        : "";

    if (
      isFacebookSource({
        source: item.source,
        sourceUrl,
      }) ||
      !isHttpUrl(sourceUrl) ||
      !image
    ) {
      continue;
    }

    const sourceName = item.source || "Google News";
    const sourceContent = [
      enriched.description,
      enriched.articleText,
    ]
      .filter(Boolean)
      .join("\n\n");

    const aiArticle =
      GEMINI_API_KEY && !geminiDisabledForRun
        ? await rewriteArticleWithAI({
            title: cleanTitle,
            source: sourceName,
            content: sourceContent,
            articleRef: sourceUrl || item.providerId || item.link,
          })
        : null;

    const headline =
      aiArticle?.headline ||
      exactHeadline(cleanTitle);

    const summary =
      aiArticle?.summary ||
      buildSummary(
        cleanTitle,
        enriched.description,
        enriched.articleText
      );

    if (
      !headlineWordCountIsValid(headline) ||
      !summary ||
      !summaryIsValid(summary)
    ) {
      continue;
    }

    fresh.push({
      id: idFor(canonicalUrl(sourceUrl), cleanTitle),
      provider: "google_news_rss",
      providerId: item.providerId || item.link,
      title: headline,
      summary,
      category: category.name,
      image,
      source: item.source || "Google News",
      sourceUrl,
      publishedAt,
      fetchedAt: new Date().toISOString(),
      __scope: scope,
      __stateSlug: stateSlug,
    });

    knownLinks.add(item.link);
    knownLinks.add(sourceUrl);
    knownTitles.add(cleanTitle.toLowerCase());
  }

  return fresh;
}

function stripInternalFields(article) {
  const { __scope, __stateSlug, ...publicArticle } = article;

  return {
    ...publicArticle,
    stateSlug: inferStateSlug(article),
  };
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
    // Canonical URL is the archive conflict key. Keep provider_id null so a
    // publisher URL change cannot block ingestion on the separate provider-id index.
    provider_id: null,
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
    state_slug: inferStateSlug(article),
    is_bihar: isBiharArticle(article),
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
          "state",
          "bihar"
        ))
      );
    } catch (error) {
      console.error(error.message);
    }
  }

  for (const region of STATE_REGIONS) {
    try {
      newArticles.push(
        ...(await fetchCategory(
          {
            name: "National & Trending News",
            query: region.query,
          },
          knownLinks,
          knownTitles,
          MAX_NEW_STATE_PER_REGION,
          "state",
          region.slug
        ))
      );
    } catch (error) {
      console.error(region.name + ": " + error.message);
    }
  }

  const archiveCandidates = await keepArticlesWithLiveImages(
    dedupeArticles([
      ...newArticles,
      ...previousArticles,
    ]).filter(articleHasArchiveQuality)
  );

  const eligible = await keepArticlesWithLiveImages(
    dedupeArticles([
      ...newArticles,
      ...retainedArticles,
    ]).filter(articleHasRequiredQuality)
  );

  const selected = selectBalancedBiharIndiaArticles(
    eligible,
    MAX_ARTICLES
  );

  if (!selected.length) {
    console.warn(
      "Balanced feed update skipped: both Bihar and All India articles are required to preserve the strict 50:50 ratio."
    );

    await recordIngestionRun({
      status: "success",
      fetchedCount: newArticles.length,
      feedCount: previousArticles.length,
      archivedCount: 0,
    });

    return;
  }

  const translatedSelected = [];

  for (const article of selected) {
    translatedSelected.push(await ensureTranslations(article));
  }

  const outputArticles = translatedSelected
    .filter(hasRequiredSummary)
    .map(stripInternalFields);

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
  const allIndiaCount = selected.length - biharCount;

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
      `Final feed: ${biharCount} Bihar / ${allIndiaCount} All India / ${outputArticles.length} total (strict 50:50).`
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
