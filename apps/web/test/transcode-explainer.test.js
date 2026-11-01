import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { detectDeviceFamily, explainTranscode, fixHintFor, summarizeTranscode } from "../src/lib/transcode-explainer.js";

const base = (over = {}) => ({
  Client: "Jellyfin Web",
  DeviceName: "Chrome",
  PlayState: { PlayMethod: "Transcode", AudioStreamIndex: 1, SubtitleStreamIndex: -1 },
  NowPlayingItem: {
    Container: "mkv",
    Bitrate: 40_000_000,
    MediaStreams: [
      { Type: "Video", Index: 0, Codec: "hevc", Width: 3840, Height: 2160, VideoRangeType: "HDR10", BitDepth: 10 },
      { Type: "Audio", Index: 1, Codec: "truehd", Channels: 8, IsDefault: true },
      { Type: "Subtitle", Index: 2, Codec: "PGSSUB", IsTextSubtitleStream: false },
      { Type: "Subtitle", Index: 3, Codec: "subrip", IsTextSubtitleStream: true },
    ],
  },
  TranscodingInfo: { VideoCodec: "h264", AudioCodec: "aac", IsVideoDirect: false, IsAudioDirect: false, Bitrate: 8_000_000, TranscodeReasons: [] },
  ...over,
});

describe("detectDeviceFamily", () => {
  test("recognises common clients", () => {
    assert.equal(detectDeviceFamily({ Client: "Infuse-Direct", DeviceName: "Apple TV" }), "infuse");
    assert.equal(detectDeviceFamily({ Client: "Roku", DeviceName: "Living Room" }), "roku");
    assert.equal(detectDeviceFamily({ Client: "Android TV", DeviceName: "SHIELD" }), "androidtv");
    assert.equal(detectDeviceFamily({ Client: "Jellyfin Web", DeviceName: "Firefox" }), "web");
    assert.equal(detectDeviceFamily({}), "other");
  });
});

describe("explainTranscode", () => {
  test("returns null for direct play", () => {
    assert.equal(explainTranscode({ PlayState: { PlayMethod: "DirectPlay" } }), null);
  });

  test("maps Jellyfin reasons to causes with device hints", () => {
    const s = base({ TranscodingInfo: { ...base().TranscodingInfo, TranscodeReasons: ["VideoCodecNotSupported", "AudioCodecNotSupported", "ContainerBitrateExceedsLimit"] } });
    const out = explainTranscode(s);
    assert.deepEqual(out.causes.map((c) => c.id), ["videoCodec", "bitrate", "audioCodec"]);
    assert.match(out.causes[0].explanation, /HEVC.*H264/);
    assert.match(out.causes[0].hint, /Browsers/);
    assert.match(out.causes[1].explanation, /40 Mbps.*8\.0 Mbps/);
    assert.equal(out.mode, "transcode");
  });

  test("surfaces image subtitle burn-in first", () => {
    const s = base({ PlayState: { PlayMethod: "Transcode", AudioStreamIndex: 1, SubtitleStreamIndex: 2 }, TranscodingInfo: { ...base().TranscodingInfo, TranscodeReasons: ["SubtitleCodecNotSupported"] } });
    const out = explainTranscode(s);
    assert.equal(out.causes[0].id, "subtitles");
    assert.match(out.causes[0].explanation, /PGSSUB.*burned/);
  });

  test("infers burn-in even when reasons only mention video", () => {
    const s = base({ PlayState: { PlayMethod: "Transcode", SubtitleStreamIndex: 2 }, TranscodingInfo: { ...base().TranscodingInfo, TranscodeReasons: ["VideoCodecNotSupported"] } });
    assert.deepEqual(explainTranscode(s).causes.map((c) => c.id), ["subtitles", "videoCodec"]);
  });

  test("heuristics without reasons: codec swap", () => {
    const out = explainTranscode(base());
    assert.deepEqual(out.causes.map((c) => c.id), ["videoCodec", "audioCodec"]);
  });

  test("remux when both streams are copied", () => {
    const s = base({ TranscodingInfo: { IsVideoDirect: true, IsAudioDirect: true, TranscodeReasons: ["ContainerNotSupported"] } });
    const out = explainTranscode(s);
    assert.equal(out.mode, "remux");
    assert.equal(summarizeTranscode(out), "Remux: Container");
  });

  test("audio-only transcode and HDR tone-mapping labels", () => {
    const audio = explainTranscode(base({ TranscodingInfo: { IsVideoDirect: true, IsAudioDirect: false, AudioCodec: "aac", TranscodeReasons: ["AudioChannelsNotSupported"] } }));
    assert.equal(audio.mode, "audio-only");
    assert.equal(audio.causes[0].id, "audioChannels");
    const hdr = explainTranscode(base({ TranscodingInfo: { ...base().TranscodingInfo, TranscodeReasons: ["VideoRangeTypeNotSupported"] } }));
    assert.match(hdr.causes[0].explanation, /HDR10.*tone-maps/);
  });

  test("falls back to direct-play-disabled when nothing explains it", () => {
    const s = base({ NowPlayingItem: { MediaStreams: [] }, TranscodingInfo: { IsVideoDirect: false, IsAudioDirect: true, TranscodeReasons: [] } });
    assert.equal(explainTranscode(s).causes[0].id, "directPlayDisabled");
  });

  test("accepts comma-separated reasons and unknown codes", () => {
    const out = explainTranscode(base({ TranscodingInfo: { ...base().TranscodingInfo, TranscodeReasons: "VideoResolutionNotSupported, SomethingNew" } }));
    assert.deepEqual(out.causes.map((c) => c.id), ["resolution", "error"]);
  });
});

test("fixHintFor falls back to generic hint", () => {
  assert.match(fixHintFor("bitrate", "roku"), /max streaming bitrate/);
  assert.equal(fixHintFor("nope", "web"), "");
});
