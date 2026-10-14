import fs from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const FEED_PATH = new URL("../data/news.json", import.meta.url);
const STATE_PATH = new URL("../data/notification-state.json", import.meta.url);
const HISTORY_PATH = new URL("../data/notifications.json", import.meta.url);

const TOPIC = String(process.env.FCM_TOPIC || "trending-news").trim();
const MAX_ARTICLE_AGE_HOURS = Number(
  process.env.NOTIFICATION_MAX_AGE_HOURS || 12
);
const HISTORY_LIMIT = Math.min(
  200,
  Math.max(20, Number(process.env.NOTIFICATION_HISTORY_LIMIT || 100))
);
const SEND_TEST_NOTIFICATION =
  String(process.env.SEND_TEST_NOTIFICATION || "").toLowerCase() === "true";
const TEST_FCM_TOKEN = String(
  process.env.FCM_TEST_TOKEN || ""
).trim();

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

function writeJson(url, value) {
  fs.writeFileSync(
    url,
    `${JSON.stringify(value, null, 2)}\n`
  );
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

function safeHttpUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol)
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function appendNotificationHistory(entry) {
  const current = loadJson(HISTORY_PATH, {
    updatedAt: null,
    count: 0,
    notifications: [],
  });

  const notifications = Array.isArray(current?.notifications)
    ? current.notifications
    : [];

  const deduped = [
    entry,
    ...notifications.filter(
      (item) =>
        String(item?.notificationId || "") !== entry.notificationId
    ),
  ].slice(0, HISTORY_LIMIT);

  writeJson(HISTORY_PATH, {
    updatedAt: new Date().toISOString(),
    count: deduped.length,
    notifications: deduped,
  });
}

async function sendMessage(message) {
  if (SEND_TEST_NOTIFICATION && TEST_FCM_TOKEN) {
    const response = await getMessaging().send({
      ...message,
      token: TEST_FCM_TOKEN,
    });

    return {
      messageId: response,
      target: "test-token",
    };
  }

  const response = await getMessaging().send({
    ...message,
    topic: TOPIC,
  });

  return {
    messageId: response,
    target: `topic:${TOPIC}`,
  };
}

async function main() {
  if (!TOPIC) {
    throw new Error("FCM_TOPIC cannot be empty.");
  }

  const serviceAccount = normalizeServiceAccount();

  if (!serviceAccount) {
    throw new Error(
      "Firebase credentials are missing. Configure FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_BASE64."
    );
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }

  if (SEND_TEST_NOTIFICATION) {
    const now = new Date().toISOString();
    const notificationId = `test-${Date.now()}`;
    const title = "NewsTeen75 test notification";
    const body = "Firebase push delivery is working on this device.";

    const result = await sendMessage({
      notification: {
        title,
        body,
      },
      data: {
        type: "test_notification",
        notificationId,
        title,
        body,
        articleId: "",
        sourceUrl: "",
        category: "test",
        source: "NewsTeen75",
        imageUrl: "",
        publishedAt: now,
        sentAt: now,
      },
      android: {
        priority: "high",
        ttl: 60 * 60 * 1000,
        notification: {
          sound: "default",
          tag: notificationId,
        },
      },
    });

    console.log(
      `Test notification sent successfully to ${result.target}. Firebase message: ${result.messageId}`
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
  const sourceUrl = safeHttpUrl(
    article?.sourceUrl || article?.url || article?.link || ""
  );
  const category = String(article?.category || "");
  const source = String(article?.source || "");
  const imageUrl = safeHttpUrl(
    article?.image || article?.imageUrl || article?.image_url || ""
  );
  const publishedAt = String(article?.publishedAt || "");
  const title = "🔥 Trending on NewsTeen75";
  const body = cleanBody(article);
  const notificationId = `trending-${id}`;
  const sentAt = new Date().toISOString();

  const message = {
    notification: {
      title,
      body,
      ...(imageUrl ? { imageUrl } : {}),
    },
    data: {
      type: "trending_news",
      notificationId,
      title,
      body,
      articleId: id,
      sourceUrl,
      category,
      source,
      imageUrl,
      publishedAt,
      sentAt,
    },
    android: {
      priority: "high",
      ttl: 60 * 60 * 1000,
      notification: {
        sound: "default",
        tag: notificationId,
        ...(imageUrl ? { imageUrl } : {}),
      },
    },
  };

  const result = await sendMessage(message);

  const nextSentIds = [
    id,
    ...[...sentIds].filter((value) => value !== id),
  ].slice(0, 200);

  const nextState = {
    lastSentArticleId: id,
    lastSentAt: sentAt,
    lastMessageId: result.messageId,
    topic: TOPIC,
    sentArticleIds: nextSentIds,
  };

  writeJson(STATE_PATH, nextState);

  appendNotificationHistory({
    notificationId,
    articleId: id,
    type: "trending_news",
    title,
    body,
    sourceUrl,
    category,
    source,
    imageUrl,
    publishedAt,
    sentAt,
    firebaseMessageId: result.messageId,
  });

  console.log(
    `Trending notification sent for article ${id} to ${result.target}. Firebase message: ${result.messageId}`
  );
}

main().catch((error) => {
  console.error("Trending notification failed:", error);
  process.exit(1);
});
