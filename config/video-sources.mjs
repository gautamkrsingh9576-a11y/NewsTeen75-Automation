export const VIDEO_SOURCE_WHITELIST = [
  { name: "BBC News Hindi", channelId: "", handle: "@bbchindi", category: "politics", active: true },
  { name: "DW Hindi", channelId: "", handle: "@dw_hindi", category: "politics", active: true },
  { name: "The Lallantop", channelId: "", handle: "@TheLallantop", category: "politics", active: true },
  { name: "Dainik Bhaskar", channelId: "", handle: "@DainikBhaskar", category: "politics", active: true },
  { name: "Amar Ujala", channelId: "", handle: "@amarujala", category: "politics", active: true },
  { name: "PIB India", channelId: "", handle: "@PIBIndia", category: "politics", active: true },
  { name: "Sansad TV", channelId: "", handle: "@SansadTV", category: "politics", active: true },

  { name: "Moneycontrol Hindi", channelId: "", handle: "@MoneycontrolHindi", category: "finance", active: true },
  { name: "Business Standard Hindi", channelId: "", handle: "@BusinessStandardHindi", category: "finance", active: true },
  { name: "CA Rachana Ranade", channelId: "", handle: "@CARachanaRanade", category: "finance", active: true },
  { name: "Labour Law Advisor", channelId: "", handle: "@LabourLawAdvisor", category: "finance", active: true },
  { name: "Asset Yogi", channelId: "", handle: "@AssetYogi", category: "finance", active: true },

  { name: "Bollywood Hungama", channelId: "", handle: "@BollywoodHungama", category: "entertainment", active: true },
  { name: "FilmiBeat", channelId: "", handle: "@filmibeat", category: "entertainment", active: true },
  { name: "Navbharat Times", channelId: "", handle: "@NavbharatTimes", category: "entertainment", active: true },

  { name: "Cricbuzz", channelId: "", handle: "@cricbuzz", category: "sports", active: true },
  { name: "BCCI", channelId: "", handle: "@BCCI", category: "sports", active: true },
  { name: "Star Sports", channelId: "", handle: "@StarSports", category: "sports", active: true },

  { name: "Technical Guruji", channelId: "", handle: "@TechnicalGuruji", category: "technology", active: true },
  { name: "Trakin Tech", channelId: "", handle: "@TrakinTech", category: "technology", active: true },
  { name: "Gadgets 360", channelId: "", handle: "@Gadgets360", category: "technology", active: true },
  { name: "Technical Dost", channelId: "", handle: "@TechnicalDost", category: "technology", active: true },
  { name: "Manoj Saru", channelId: "", handle: "@ManojSaru", category: "technology", active: true },
];

export const VIDEO_SOURCE_BLOCKLIST = [
  { name: "Sports Yaari", channelId: "", handle: "@sportsyaari" },
  { name: "Sports Tak", channelId: "", handle: "@SportsTak" },
  { name: "Aaj Tak", channelId: "", handle: "@aajtak" },
  { name: "ABP News", channelId: "", handle: "@ABPNEWS" },
  { name: "Zee News", channelId: "", handle: "@ZeeNews" },
  { name: "India TV", channelId: "", handle: "@IndiaTV" },
  { name: "Republic Bharat", channelId: "", handle: "@RepublicBharat" },
  { name: "News18 India", channelId: "", handle: "@News18India" },
  { name: "NDTV India", channelId: "", handle: "@NDTVIndia" },
  { name: "Zee Business", channelId: "", handle: "@ZeeBusiness" },
  { name: "CNBC Awaaz", channelId: "", handle: "@CNBCAwaaz" },
];

export const VIDEO_CATEGORIES = new Set([
  "politics",
  "finance",
  "entertainment",
  "sports",
  "technology",
]);

export function normalizeHandle(value = "") {
  const clean = String(value || "").trim();
  if (!clean) return "";
  return clean.startsWith("@") ? clean.toLowerCase() : `@${clean.toLowerCase()}`;
}

export function normalizedName(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function activeVideoSources() {
  return VIDEO_SOURCE_WHITELIST.filter(
    (source) =>
      source?.active === true &&
      VIDEO_CATEGORIES.has(source.category)
  );
}

export function blocklistSets() {
  return {
    ids: new Set(
      VIDEO_SOURCE_BLOCKLIST
        .map((source) => String(source.channelId || "").trim())
        .filter(Boolean)
    ),
    handles: new Set(
      VIDEO_SOURCE_BLOCKLIST
        .map((source) => normalizeHandle(source.handle))
        .filter(Boolean)
    ),
    names: new Set(
      VIDEO_SOURCE_BLOCKLIST
        .map((source) => normalizedName(source.name))
        .filter(Boolean)
    ),
  };
}
