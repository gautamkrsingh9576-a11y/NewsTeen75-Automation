import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const YOUTUBE_API_KEY = String(process.env.YOUTUBE_API_KEY || "").trim();
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();

const MAX_VIDEOS_PER_CHANNEL = Math.min(
  25,
  Math.max(1, Number(process.env.MAX_VIDEOS_PER_CHANNEL || 10))
);
const VIDEO_FEED_MAX = Math.min(
  500,
  Math.max(20, Number(process.env.VIDEO_FEED_MAX || 250))
);
const OUTPUT_PATH = new URL("../data/videos.json", import.meta.url);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function parseIsoDurationToSeconds(value = "") {
  const match = String(value).match(
    /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/
  );

  if (!match) return null;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);

  return hours * 3600 + minutes * 60 + seconds;
}

function bestThumbnail(thumbnails = {}) {
  return (
    thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    ""
  );
}

async function youtubeGet(resource, params) {
  const url = new URL(
    `https://www.googleapis.com/youtube/v3/${resource}`
  );

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== undefined &&
      value !== null &&
      String(value).length > 0
    ) {
      url.searchParams.set(key, String(value));
    }
  }

  url.searchParams.set("key", YOUTUBE_API_KEY);

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "NewsTeen75VideoBot/1.0",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `YouTube API ${resource} failed: ${response.status} ${body.slice(0, 300)}`
    );
  }

  return response.json();
}

async function resolveChannel(channel) {
  if (
    channel.youtube_channel_id &&
    channel.uploads_playlist_id
  ) {
    return channel;
  }

  if (!YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY is missing.");
  }

  const params = {
    part: "id,snippet,contentDetails",
  };

  if (channel.youtube_channel_id) {
    params.id = channel.youtube_channel_id;
  } else if (channel.youtube_handle) {
    params.forHandle = String(channel.youtube_handle)
      .replace(/^@/, "")
      .trim();
  } else {
    throw new Error(
      `No YouTube channel ID/handle for ${channel.channel_name}`
    );
  }

  const data = await youtubeGet("channels", params);
  const item = data.items?.[0];

  if (!item?.id) {
    throw new Error(
      `Could not resolve channel: ${channel.channel_name}`
    );
  }

  const uploadsPlaylistId =
    item.contentDetails?.relatedPlaylists?.uploads || null;

  if (!uploadsPlaylistId) {
    throw new Error(
      `No uploads playlist found for ${channel.channel_name}`
    );
  }

  const resolved = {
    ...channel,
    youtube_channel_id: item.id,
    uploads_playlist_id: uploadsPlaylistId,
  };

  const { error } = await supabase
    .from("approved_channels")
    .update({
      youtube_channel_id: item.id,
      uploads_playlist_id: uploadsPlaylistId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", channel.id);

  if (error) {
    throw new Error(
      `Could not save resolved channel ${channel.channel_name}: ${error.message}`
    );
  }

  return resolved;
}

async function fetchLatestUploads(channel) {
  const data = await youtubeGet("playlistItems", {
    part: "snippet,contentDetails,status",
    playlistId: channel.uploads_playlist_id,
    maxResults: MAX_VIDEOS_PER_CHANNEL,
  });

  return (data.items || [])
    .map((item) => {
      const videoId =
        item.contentDetails?.videoId ||
        item.snippet?.resourceId?.videoId ||
        "";

      const publishedAt =
        item.contentDetails?.videoPublishedAt ||
        item.snippet?.publishedAt ||
        null;

      if (!videoId || !publishedAt) return null;

      return {
        videoId,
        publishedAt,
        channel,
      };
    })
    .filter(Boolean);
}

async function writeFallbackJson() {
  const { data: channels, error: channelsError } =
    await supabase
      .from("approved_channels")
      .select("id")
      .eq("active", true);

  if (channelsError) {
    throw new Error(
      `Could not read active channels: ${channelsError.message}`
    );
  }

  const activeIds = (channels || []).map((row) => row.id);

  if (!activeIds.length) {
    fs.writeFileSync(
      OUTPUT_PATH,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          count: 0,
          videos: [],
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  const { data: videos, error } = await supabase
    .from("news_videos")
    .select(
      "id,youtube_video_id,title,thumbnail_url,channel_name,channel_id,published_at,duration_seconds,youtube_url,category,language"
    )
    .in("channel_id", activeIds)
    .eq("status", "active")
    .eq("embeddable", true)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(VIDEO_FEED_MAX);

  if (error) {
    throw new Error(
      `Could not build fallback video feed: ${error.message}`
    );
  }

  const output = {
    updatedAt: new Date().toISOString(),
    count: videos?.length || 0,
    videos: (videos || []).map((video) => ({
      id: video.id,
      youtubeVideoId: video.youtube_video_id,
      title: video.title,
      thumbnail: video.thumbnail_url,
      channelName: video.channel_name,
      channelId: video.channel_id,
      publishedAt: video.published_at,
      durationSeconds: video.duration_seconds,
      youtubeUrl: video.youtube_url,
      category: video.category,
      language: video.language,
    })),
  };

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(output, null, 2) + "\n"
  );
}

async function recordRun({
  status,
  channelsChecked,
  fetchedCount,
  upsertedCount,
  errorMessage = null,
}) {
  const { error } = await supabase
    .from("video_ingestion_runs")
    .insert({
      status,
      channels_checked: channelsChecked,
      fetched_count: fetchedCount,
      upserted_count: upsertedCount,
      error_message: errorMessage,
    });

  if (error) {
    console.warn(
      `Could not record video ingestion run: ${error.message}`
    );
  }
}

async function main() {
  if (!YOUTUBE_API_KEY) {
    await writeFallbackJson();

    await recordRun({
      status: "skipped",
      channelsChecked: 0,
      fetchedCount: 0,
      upsertedCount: 0,
      errorMessage: "YOUTUBE_API_KEY is not configured.",
    });

    console.log(
      "Video ingestion skipped: add the YOUTUBE_API_KEY repository secret to enable YouTube fetching."
    );
    return;
  }

  const { data: channels, error: channelsError } =
    await supabase
      .from("approved_channels")
      .select(
        "id,channel_name,youtube_channel_id,youtube_handle,youtube_url,uploads_playlist_id,category,language,active"
      )
      .eq("active", true)
      .order("id", { ascending: true });

  if (channelsError) {
    throw new Error(
      `Could not read approved channels: ${channelsError.message}`
    );
  }

  const approvedChannels = channels || [];
  const candidates = [];
  const resolvedChannels = [];

  for (const rawChannel of approvedChannels) {
    try {
      const channel = await resolveChannel(rawChannel);
      resolvedChannels.push(channel);

      const uploads = await fetchLatestUploads(channel);
      candidates.push(...uploads);

      await supabase
        .from("approved_channels")
        .update({
          last_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", channel.id);
    } catch (error) {
      console.warn(
        `Channel skipped (${rawChannel.channel_name}): ${error.message}`
      );
    }
  }

  const uniqueCandidateMap = new Map();

  for (const candidate of candidates) {
    if (!uniqueCandidateMap.has(candidate.videoId)) {
      uniqueCandidateMap.set(candidate.videoId, candidate);
    }
  }

  const uniqueCandidates = [...uniqueCandidateMap.values()];
  const detailsById = new Map();

  for (const idBatch of chunk(
    uniqueCandidates.map((item) => item.videoId),
    50
  )) {
    const details = await youtubeGet("videos", {
      part: "snippet,contentDetails,status",
      id: idBatch.join(","),
      maxResults: 50,
    });

    for (const item of details.items || []) {
      detailsById.set(item.id, item);
    }
  }

  const rows = [];

  for (const candidate of uniqueCandidates) {
    const detail = detailsById.get(candidate.videoId);

    if (!detail?.id) continue;

    const privacyStatus = detail.status?.privacyStatus || "";
    const embeddable = detail.status?.embeddable !== false;

    if (privacyStatus !== "public" || !embeddable) {
      continue;
    }

    const title = String(detail.snippet?.title || "").trim();
    const thumbnail = bestThumbnail(detail.snippet?.thumbnails);

    if (!title || !thumbnail) continue;

    const durationIso =
      detail.contentDetails?.duration || null;

    rows.push({
      id: detail.id,
      youtube_video_id: detail.id,
      channel_id: candidate.channel.id,
      channel_name:
        detail.snippet?.channelTitle ||
        candidate.channel.channel_name,
      title,
      description: String(
        detail.snippet?.description || ""
      ).trim(),
      thumbnail_url: thumbnail,
      youtube_url: `https://www.youtube.com/watch?v=${detail.id}`,
      category: candidate.channel.category || "General",
      language: candidate.channel.language || "hi",
      duration_seconds: parseIsoDurationToSeconds(
        durationIso
      ),
      duration_iso: durationIso,
      published_at:
        detail.snippet?.publishedAt ||
        candidate.publishedAt,
      embeddable: true,
      status: "active",
      updated_at: new Date().toISOString(),
    });
  }

  let upsertedCount = 0;

  for (const batch of chunk(rows, 100)) {
    if (!batch.length) continue;

    const { error } = await supabase
      .from("news_videos")
      .upsert(batch, {
        onConflict: "youtube_video_id",
        ignoreDuplicates: false,
      });

    if (error) {
      throw new Error(
        `Video upsert failed: ${error.message}`
      );
    }

    upsertedCount += batch.length;
  }

  await writeFallbackJson();

  await recordRun({
    status: "success",
    channelsChecked: resolvedChannels.length,
    fetchedCount: uniqueCandidates.length,
    upsertedCount,
  });

  console.log(
    `Video ingestion complete: ${resolvedChannels.length} approved channel(s), ${uniqueCandidates.length} candidate video(s), ${upsertedCount} upserted.`
  );
}

main().catch(async (error) => {
  console.error(error);

  await recordRun({
    status: "failed",
    channelsChecked: 0,
    fetchedCount: 0,
    upsertedCount: 0,
    errorMessage: String(error?.message || error).slice(0, 1000),
  });

  process.exitCode = 1;
});
