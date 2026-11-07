// Explains why Jellyfin is transcoding a session, using only the session JSON
// already fetched for Active Sessions (TranscodingInfo, PlayState, NowPlayingItem).

export const DEVICE_FAMILIES = {
  infuse: "Infuse",
  swiftfin: "Swiftfin",
  roku: "Roku",
  androidtv: "Android TV",
  android: "Android",
  ios: "iOS",
  web: "Web browser",
  webos: "LG webOS",
  tizen: "Samsung Tizen",
  kodi: "Kodi",
  mpv: "Jellyfin Media Player",
  dlna: "DLNA",
  xbox: "Xbox",
  other: "Client",
};

export function detectDeviceFamily(session = {}) {
  const text = `${session.Client || ""} ${session.DeviceName || ""} ${session.DeviceType || ""}`.toLowerCase();
  if (text.includes("infuse")) return "infuse";
  if (text.includes("swiftfin")) return "swiftfin";
  if (text.includes("roku")) return "roku";
  if (/android ?tv|shield|fire ?tv|chromecast|google tv/.test(text)) return "androidtv";
  if (text.includes("android")) return "android";
  if (/ios|iphone|ipad/.test(text)) return "ios";
  if (/webos|\blg\b/.test(text)) return "webos";
  if (/tizen|samsung/.test(text)) return "tizen";
  if (text.includes("kodi")) return "kodi";
  if (/media player|jmp|mpv/.test(text)) return "mpv";
  if (text.includes("dlna")) return "dlna";
  if (text.includes("xbox")) return "xbox";
  if (/web|chrome|firefox|safari|edge|browser/.test(text)) return "web";
  return "other";
}

const FIX_HINTS = {
  videoCodec: {
    infuse: "Infuse plays HEVC/AV1 natively — set Playback → Direct Play in Infuse and avoid forcing transcode.",
    swiftfin: "Switch Swiftfin to the native (VLCKit) player, which direct plays HEVC and most codecs.",
    roku: "Roku decodes HEVC on 4K models only; enable HEVC in the Jellyfin Roku settings or keep an H.264 version.",
    androidtv: "In Jellyfin for Android TV, pick ExoPlayer and enable HEVC/AV1 direct play under Playback.",
    android: "Use the ExoPlayer/integrated player in Settings → Playback, or play via an external app like VLC.",
    ios: "Use a native player (Infuse or Swiftfin) instead of the web player to direct play HEVC.",
    web: "Browsers rarely support HEVC — use a desktop/TV app, or enable HEVC in the browser if your GPU supports it.",
    webos: "Enable HEVC in the webOS app's playback settings, or keep an H.264 copy for older LG TVs.",
    tizen: "Newer Samsung TVs handle HEVC — check the Tizen app's codec settings.",
    kodi: "Use JellyCon/Jellyfin for Kodi in add-on (native) playback mode to avoid server transcodes.",
    mpv: "Jellyfin Media Player direct plays nearly everything — check it's not set to force transcoding.",
    other: "Use a client that supports this codec natively, or keep an H.264 version in the library.",
  },
  audioCodec: {
    roku: "Roku can't decode DTS/TrueHD — enable passthrough to a soundbar/AVR or add an AAC/AC3 track.",
    web: "Browsers can't decode DTS/TrueHD/AC3 — add an AAC stereo track or use a native app.",
    infuse: "Enable audio passthrough in Infuse (Settings → Audio) if your receiver supports it.",
    androidtv: "Enable audio passthrough (AC3/DTS) in the Android TV app if your receiver supports it.",
    other: "Enable audio passthrough on the client, or add a compatible AAC/AC3 audio track.",
  },
  audioChannels: {
    other: "The client only accepts stereo/fewer channels — enable surround or passthrough in the client's audio settings.",
  },
  bitrate: {
    web: "Raise “Maximum streaming bitrate” in the web player's Playback settings (or set it to Auto).",
    other: "Raise the client's max streaming bitrate, and check the user's remote bitrate limit in Jellyfin Dashboard → Users.",
  },
  subtitles: {
    roku: "Roku burns in PGS/ASS subtitles — use SRT text subtitles or turn subs off.",
    web: "Image subs (PGS/VobSub) and styled ASS get burned in — use SRT/soft subtitles instead.",
    other: "Use external/soft text subtitles (SRT) instead of image-based PGS/VobSub to avoid burn-in.",
  },
  container: {
    web: "MKV isn't playable in most browsers — remux to MP4 or use a native app.",
    other: "The client can't open this container — this is usually a cheap remux, but an MP4/MKV the device likes avoids it.",
  },
  videoRange: {
    other: "The display/client can't show HDR/Dolby Vision, so Jellyfin tone-maps — use an HDR-capable client or keep an SDR version.",
  },
  videoProfile: {
    other: "The client doesn't accept this video profile/level (e.g. 10-bit or High 4:4:4) — use a more capable client or re-encode once.",
  },
  resolution: {
    other: "The client is capped below the source resolution — raise its max resolution, or keep a 1080p version for this device.",
  },
  directPlayDisabled: {
    other: "Direct play looks disabled for this client — re-enable it in the client's playback settings.",
  },
  error: {
    other: "Direct play failed on the client and Jellyfin fell back to transcoding — check the client logs or retry playback.",
  },
};

export function fixHintFor(category, family) {
  const table = FIX_HINTS[category] || {};
  return table[family] || table.other || "";
}

const REASON_MAP = {
  VideoCodecNotSupported: "videoCodec",
  AudioCodecNotSupported: "audioCodec",
  ContainerNotSupported: "container",
  SubtitleCodecNotSupported: "subtitles",
  ContainerBitrateExceedsLimit: "bitrate",
  VideoBitrateNotSupported: "bitrate",
  AudioBitrateNotSupported: "bitrate",
  VideoLevelNotSupported: "videoProfile",
  VideoProfileNotSupported: "videoProfile",
  VideoBitDepthNotSupported: "videoProfile",
  VideoFramerateNotSupported: "videoProfile",
  RefFramesNotSupported: "videoProfile",
  AnamorphicVideoNotSupported: "videoProfile",
  InterlacedVideoNotSupported: "videoProfile",
  VideoRangeTypeNotSupported: "videoRange",
  VideoResolutionNotSupported: "resolution",
  AudioChannelsNotSupported: "audioChannels",
  AudioProfileNotSupported: "audioCodec",
  AudioSampleRateNotSupported: "audioCodec",
  SecondaryAudioNotSupported: "audioCodec",
  AudioBitDepthNotSupported: "audioCodec",
  UnknownVideoStreamInfo: "error",
  UnknownAudioStreamInfo: "error",
  DirectPlayError: "error",
  ContainerNotSupportedByClient: "container",
};

const CATEGORY_LABELS = {
  videoCodec: "Video codec",
  audioCodec: "Audio codec",
  audioChannels: "Audio channels",
  bitrate: "Bitrate limit",
  subtitles: "Subtitle burn-in",
  container: "Container",
  videoRange: "HDR tone-mapping",
  videoProfile: "Video profile",
  resolution: "Resolution cap",
  directPlayDisabled: "Direct play off",
  error: "Direct play failed",
};

const CATEGORY_ORDER = ["subtitles", "videoRange", "videoCodec", "videoProfile", "resolution", "bitrate", "audioCodec", "audioChannels", "container", "directPlayDisabled", "error"];

function upper(value) {
  return value ? String(value).toUpperCase() : "";
}

function streamsOf(session) {
  const item = session?.NowPlayingItem || {};
  const streams = item.MediaStreams || item.MediaSources?.[0]?.MediaStreams || [];
  return Array.isArray(streams) ? streams : [];
}

function sourceStream(session, type, index) {
  const streams = streamsOf(session);
  if (Number.isInteger(index)) {
    const hit = streams.find((s) => s.Type === type && s.Index === index);
    if (hit) return hit;
  }
  return streams.find((s) => s.Type === type && (s.IsDefault || type === "Video")) || streams.find((s) => s.Type === type) || null;
}

function formatMbps(bps) {
  const n = Number(bps);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)} Mbps`;
}

function explainCategory(category, ctx) {
  const { srcVideo, srcAudio, srcSub, ti } = ctx;
  switch (category) {
    case "videoCodec": {
      const from = upper(srcVideo?.Codec) || "the source video";
      const to = upper(ti.VideoCodec);
      return `The client can't play ${from}${to ? `, so the server is converting it to ${to}` : ""}.`;
    }
    case "audioCodec": {
      const from = upper(srcAudio?.Codec) || "the source audio";
      const to = upper(ti.AudioCodec);
      return `The client can't decode ${from} audio${to ? `, so it's converted to ${to}` : ""}. Usually cheap on CPU.`;
    }
    case "audioChannels":
      return `The source has ${srcAudio?.Channels || "more"} audio channels than the client accepts${ti.AudioChannels ? ` (sending ${ti.AudioChannels})` : ""}.`;
    case "bitrate": {
      const src = formatMbps(ctx.sourceBitrate);
      const out = formatMbps(ti.Bitrate);
      return `The source${src ? ` (${src})` : ""} is above the client or user bitrate limit${out ? `, so it's being squeezed to ${out}` : ""}.`;
    }
    case "subtitles": {
      const codec = upper(srcSub?.Codec);
      return `${codec ? `${codec} subtitles` : "The selected subtitles"} can't be shown by the client, so they're burned into the video — this forces a full video transcode.`;
    }
    case "container":
      return `The client can't open the ${upper(ctx.container) || "source"} container. If video and audio are copied this is just a remux.`;
    case "videoRange":
      return `The source is ${srcVideo?.VideoRangeType || srcVideo?.VideoRange || "HDR"} but the client can't display it, so the server tone-maps to SDR.`;
    case "videoProfile":
      return `The client doesn't support this video's profile/level${srcVideo?.Profile ? ` (${srcVideo.Profile}${srcVideo.Level ? ` L${srcVideo.Level}` : ""})` : ""}${srcVideo?.BitDepth ? `, ${srcVideo.BitDepth}-bit` : ""}.`;
    case "resolution":
      return `The client is limited below the source resolution${srcVideo?.Width ? ` (${srcVideo.Width}×${srcVideo.Height})` : ""}${ti.Width ? `, so it's scaled to ${ti.Width}×${ti.Height}` : ""}.`;
    case "directPlayDisabled":
      return "Jellyfin didn't report a codec problem, yet the client asked for a transcode — direct play is probably turned off in the client.";
    case "error":
      return "Jellyfin couldn't confirm direct play for this stream (missing stream info or a direct play error).";
    default:
      return "";
  }
}

/**
 * Returns null when the session isn't transcoding, otherwise:
 * { mode: "transcode"|"remux"|"audio-only", family, familyLabel, causes: [{ id, label, explanation, hint, reasons }] }
 */
export function explainTranscode(session) {
  const ti = session?.TranscodingInfo;
  if (!ti) return null;
  const playMethod = session?.PlayState?.PlayMethod;
  if (playMethod && playMethod !== "Transcode" && ti.IsVideoDirect !== false && ti.IsAudioDirect !== false) return null;

  const family = detectDeviceFamily(session);
  const srcVideo = sourceStream(session, "Video");
  const srcAudio = sourceStream(session, "Audio", session?.PlayState?.AudioStreamIndex);
  const subIndex = session?.PlayState?.SubtitleStreamIndex;
  const srcSub = Number.isInteger(subIndex) && subIndex >= 0 ? sourceStream(session, "Subtitle", subIndex) : null;
  const sourceBitrate = session?.NowPlayingItem?.Bitrate || session?.NowPlayingItem?.MediaSources?.[0]?.Bitrate || srcVideo?.BitRate;
  const container = session?.NowPlayingItem?.Container || session?.NowPlayingItem?.MediaSources?.[0]?.Container;
  const ctx = { ti, srcVideo, srcAudio, srcSub, sourceBitrate, container };

  const grouped = new Map();
  const add = (category, reason) => {
    if (!grouped.has(category)) grouped.set(category, []);
    if (reason) grouped.get(category).push(reason);
  };

  const reasons = Array.isArray(ti.TranscodeReasons)
    ? ti.TranscodeReasons
    : typeof ti.TranscodeReasons === "string"
      ? ti.TranscodeReasons.split(",").map((r) => r.trim()).filter(Boolean)
      : [];
  for (const reason of reasons) add(REASON_MAP[reason] || "error", reason);

  // Heuristics when Jellyfin gives no (or partial) reasons.
  if (!reasons.length) {
    if (srcSub && srcSub.IsTextSubtitleStream === false && ti.IsVideoDirect === false) add("subtitles");
    if (ti.IsVideoDirect === false && srcVideo?.Codec && ti.VideoCodec && srcVideo.Codec.toLowerCase() !== String(ti.VideoCodec).toLowerCase()) add("videoCodec");
    if (ti.IsAudioDirect === false && srcAudio?.Codec && ti.AudioCodec && srcAudio.Codec.toLowerCase() !== String(ti.AudioCodec).toLowerCase()) add("audioCodec");
    if (ti.IsVideoDirect === false && Number(sourceBitrate) > 0 && Number(ti.Bitrate) > 0 && Number(ti.Bitrate) < Number(sourceBitrate) * 0.8 && !grouped.size) add("bitrate");
    if (ti.IsVideoDirect !== false && ti.IsAudioDirect !== false) add("container");
    if (!grouped.size) add("directPlayDisabled");
  }

  // Subtitle burn-in hides behind a video transcode; surface it when an image sub is active.
  if (reasons.length && srcSub && srcSub.IsTextSubtitleStream === false && ti.IsVideoDirect === false && !grouped.has("subtitles")) add("subtitles");

  const causes = CATEGORY_ORDER.filter((c) => grouped.has(c)).map((id) => ({
    id,
    label: CATEGORY_LABELS[id],
    explanation: explainCategory(id, ctx),
    hint: fixHintFor(id, family),
    reasons: grouped.get(id),
  }));

  let mode = "transcode";
  if (ti.IsVideoDirect !== false && ti.IsAudioDirect !== false) mode = "remux";
  else if (ti.IsVideoDirect !== false && ti.IsAudioDirect === false) mode = "audio-only";

  return { mode, family, familyLabel: DEVICE_FAMILIES[family], causes, hardware: ti.HardwareAccelerationType || null };
}

export function summarizeTranscode(explained) {
  if (!explained) return "";
  const prefix = explained.mode === "remux" ? "Remux" : explained.mode === "audio-only" ? "Audio transcode" : "Transcode";
  const primary = explained.causes[0]?.label;
  return primary ? `${prefix}: ${primary}${explained.causes.length > 1 ? ` +${explained.causes.length - 1}` : ""}` : prefix;
}
