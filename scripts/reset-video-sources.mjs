import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  activeVideoSources,
  blocklistSets,
  normalizeHandle,
  normalizedName,
} from "../config/video-sources.mjs";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();

const confirmed = process.argv.includes("--confirm");

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

const whitelist = activeVideoSources();
const allowedIds = new Set(
  whitelist
    .map((source) => String(source.channelId || "").trim())
    .filter(Boolean)
);
const allowedHandles = new Set(
  whitelist
    .map((source) => normalizeHandle(source.handle))
    .filter(Boolean)
);
const allowedNames = new Set(
  whitelist
    .map((source) => normalizedName(source.name))
    .filter(Boolean)
);
const blocked = blocklistSets();

function channelIsAllowed(channel) {
  const youtubeId = String(channel.youtube_channel_id || "").trim();
  const handle = normalizeHandle(channel.youtube_handle);
  const name = normalizedName(channel.channel_name);

  if (
    blocked.ids.has(youtubeId) ||
    blocked.handles.has(handle) ||
    blocked.names.has(name)
  ) {
    return false;
  }

  return (
    (youtubeId && allowedIds.has(youtubeId)) ||
    (handle && allowedHandles.has(handle)) ||
    (name && allowedNames.has(name))
  );
}

async function fetchAllVideosForChannelIds(channelIds) {
  if (!channelIds.length) return [];

  const all = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("news_videos")
      .select("*")
      .in("channel_id", channelIds)
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Could not read videos: ${error.message}`);
    }

    all.push(...(data || []));

    if (!data || data.length < pageSize) {
      break;
    }
  }

  return all;
}

const { data: channels, error: channelsError } = await supabase
  .from("approved_channels")
  .select("*")
  .order("id", { ascending: true });

if (channelsError) {
  throw new Error(
    `Could not read approved channels: ${channelsError.message}`
  );
}

const affectedChannels = (channels || []).filter(
  (channel) => !channelIsAllowed(channel)
);
const affectedChannelIds = affectedChannels.map((channel) => channel.id);
const affectedVideos = await fetchAllVideosForChannelIds(
  affectedChannelIds
);

const backup = {
  createdAt: new Date().toISOString(),
  confirmed,
  affectedChannels,
  affectedVideos,
};

const backupDir = path.resolve("backups");
fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "-");

const backupPath = path.join(
  backupDir,
  `video-sources-reset-${stamp}.json`
);

fs.writeFileSync(
  backupPath,
  `${JSON.stringify(backup, null, 2)}\n`
);

console.log(
  `${confirmed ? "CONFIRMED" : "DRY RUN"}: ${affectedChannels.length} old channel(s), ${affectedVideos.length} video(s) affected.`
);
console.log(`Backup written to ${backupPath}`);

if (!confirmed) {
  console.log(
    "No data deleted. Re-run with --confirm only after reviewing the backup."
  );
  process.exit(0);
}

for (let index = 0; index < affectedVideos.length; index += 100) {
  const ids = affectedVideos
    .slice(index, index + 100)
    .map((video) => video.id);

  if (!ids.length) continue;

  const { error } = await supabase
    .from("news_videos")
    .delete()
    .in("id", ids);

  if (error) {
    throw new Error(
      `Could not delete old videos: ${error.message}`
    );
  }
}

for (let index = 0; index < affectedChannelIds.length; index += 100) {
  const ids = affectedChannelIds.slice(index, index + 100);

  if (!ids.length) continue;

  const { error } = await supabase
    .from("approved_channels")
    .delete()
    .in("id", ids);

  if (error) {
    throw new Error(
      `Could not delete old channels: ${error.message}`
    );
  }
}

console.log(
  `Deleted ${affectedVideos.length} old video(s) and ${affectedChannels.length} old channel source(s).`
);
