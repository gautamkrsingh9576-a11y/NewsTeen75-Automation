import fs from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const FEED_PATH = new URL("../data/news.json", import.meta.url);
const STATE_PATH = new URL("../data/notification-state.json", import.meta.url);

const TOPIC = String(process.env.FCM_TOPIC || "trending-news").trim();
const MAX_ARTICLE_AGE_HOURS = Number(
  process.env.NOTIFICATION_MAX_AGE_HOURS || 12
);
const SERVICE_ACCOUNT_JSON = String(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON || ""
).trim();
const SERVICE_ACCOUNT_BASE64 = String(
  process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || ""
).trim();

function loadJson(url, fallback) {
  try {
    return JSON.parse(fs.readFileSync(url, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeServiceAccount() {
  const raw = SERVICE_ACCOUNT_JSON ||
    (SERVICE_ACCOUNT_BASE64
      ? Buffer.from(SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")
      : "");

  if (!raw) return null;

  const parsed = JSON.parse(raw);

  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }

  return parsed;
}

function isRecent(article) {
  const publishedAt = new Date(article?.publishedAt || 0).getTime();
  if (!Number.isFinite(publishedAt)) return false;

  const ageMs = Date.now() - publishedAt;
  return ageMs >= 0 && ageMs <= MAX_ARTICLE_AGE_HOURS * 60 * 60 * 1000;
}

function articleId(article) {
  return String(
    article?.id ||
      article?.providerId ||
      article?.sourceUrl ||
      article?.url ||
      article?.title ||
      ""
  ).trim();
}

function isPriorityTrending(article) {
  const category = String(article?.category || "").toLowerCase();

  return (
    category.includes("trending") ||
    category.includes("breaking") ||
    category.includes("national")
  );
}

function pickTrendingArticle(articles, sentIds) {
  const eligible = articles
    .filter((article) => article && articleId(article))
    .filter(isRecent)
    .filter((article) => !sentIds.has(articleId(article)))
    .sort(
      (a, b) =>
        new Date(b.publishedAt || 0).getTime() -
        new Date(a.publishedAt || 0).getTime()
    );

  return (
    eligible.find(isPriorityTrending) ||
    eligible[0] ||
    null
  );
}

function cleanBody(article) {
  const title = String(article?.title || "Trending news update")
    .replace(/\s+/g, " ")
    .trim();

  return title.length <= 150
    ? title
    : `${title.slice(0, 147).trim()}...`;
}

async function main() {
  if (!TOPIC) {
    throw new Error("FCM_TOPIC cannot be empty.");
  }

  const serviceAccount = normalizeServiceAccount();

  if (!serviceAccount) {
    console.warn(
      "Firebase notification skipped: FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_BASE64 is not configured."
    );
    return;
  }

  const feed = loadJson(FEED_PATH, { articles: [] });
  const articles = Array.isArray(feed?.articles) ? feed.articles : [];

  if (articles.length === 0) {
    console.log("No feed articles available. Notification skipped.");
    return;
  }

  const state = loadJson(STATE_PATH, {
    lastSentArticleId: "",
    lastSentAt: null,
    sentArticleIds: [],
  });

  const sentIds = new Set(
    Array.isArray(state?.sentArticleIds)
      ? state.sentArticleIds.map(String)
      : []
  );

  if (state?.lastSentArticleId) {
    sentIds.add(String(state.lastSentArticleId));
  }

  const article = pickTrendingArticle(articles, sentIds);

  if (!article) {
    console.log(
      `No new trending article from the last ${MAX_ARTICLE_AGE_HOURS} hour(s). Notification skipped.`
    );
    return;
  }

  const id = articleId(article);
  const sourceUrl = String(
    article?.sourceUrl || article?.url || article?.link || ""
  );
  const category = String(article?.category || "");
  const source = String(article?.source || "");

  if (getApps().length === 0) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }

  const message = {
    topic: TOPIC,
    notification: {
      title: "🔥 Trending on NewsTeen75",
      body: cleanBody(article),
    },
    data: {
      type: "trending_news",
      articleId: id,
      sourceUrl,
      category,
      source,
    },
    android: {
      priority: "high",
      notification: {
        sound: "default",
        tag: `trending-${id}`,
      },
    },
  };

  const messageId = await getMessaging().send(message);

  const nextSentIds = [
    id,
    ...[...sentIds].filter((value) => value !== id),
  ].slice(0, 200);

  const nextState = {
    lastSentArticleId: id,
    lastSentAt: new Date().toISOString(),
    lastMessageId: messageId,
    topic: TOPIC,
    sentArticleIds: nextSentIds,
  };

  fs.writeFileSync(
    STATE_PATH,
    `${JSON.stringify(nextState, null, 2)}\n`
  );

  console.log(
    `Trending notification sent for article ${id} to topic "${TOPIC}".`
  );
}

main().catch((error) => {
  console.error("Trending notification failed:", error);
  process.exit(1);
});
