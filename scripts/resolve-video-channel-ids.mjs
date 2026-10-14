import {
  VIDEO_SOURCE_BLOCKLIST,
  VIDEO_SOURCE_WHITELIST,
  normalizeHandle,
} from "../config/video-sources.mjs";

const YOUTUBE_API_KEY = String(process.env.YOUTUBE_API_KEY || "").trim();

if (!YOUTUBE_API_KEY) {
  throw new Error("YOUTUBE_API_KEY is required.");
}

async function resolveHandle(entry) {
  const handle = normalizeHandle(entry.handle);

  if (!handle) {
    return {
      ...entry,
      error: "missing handle",
    };
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "id,snippet,contentDetails");
  url.searchParams.set("forHandle", handle.replace(/^@/, ""));
  url.searchParams.set("key", YOUTUBE_API_KEY);

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "NewsTeen75VideoResolver/1.0",
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ...entry,
      error: `${response.status} ${JSON.stringify(data).slice(0, 240)}`,
    };
  }

  const item = data.items?.[0];

  if (!item?.id) {
    return {
      ...entry,
      error: "channel not found",
    };
  }

  return {
    ...entry,
    channelId: item.id,
    canonicalTitle: item.snippet?.title || entry.name,
    uploadsPlaylistId:
      item.contentDetails?.relatedPlaylists?.uploads ||
      (item.id.startsWith("UC") ? `UU${item.id.slice(2)}` : ""),
  };
}

async function resolveGroup(label, entries) {
  const results = [];

  for (const entry of entries) {
    try {
      results.push(await resolveHandle(entry));
    } catch (error) {
      results.push({
        ...entry,
        error: error?.message || String(error),
      });
    }
  }

  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(results, null, 2));

  return results;
}

await resolveGroup("WHITELIST", VIDEO_SOURCE_WHITELIST);
await resolveGroup("BLOCKLIST", VIDEO_SOURCE_BLOCKLIST);
