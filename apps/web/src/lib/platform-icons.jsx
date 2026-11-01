import { selfhstIconUrl } from "./selfhst-icons";
import React from "react";
import {
  siAndroid,
  siApple,
  siAppletv,
  siBrave,
  siEmby,
  siFirefox,
  siGooglecast,
  siGooglechrome,
  siGoogletv,
  siHomeassistant,
  siJellyfin,
  siKodi,
  siLg,
  siLinux,
  siNvidia,
  siOpera,
  siPlex,
  siRoku,
  siSafari,
  siSamsung,
  siUbuntu,
  siVivaldi,
} from "simple-icons";

const selfHostedIconUrl = (slug) => selfhstIconUrl(slug);

const iconMap = [
  { match: ["home assistant", "hacs"], icon: siHomeassistant },
  { match: ["reclaimerr"], imageSlug: "reclaimerr", title: "Reclaimerr" },
  { match: ["jellystat"], imageSlug: "jellystat", title: "Jellystat" },
  { match: ["jellyseerr"], imageSlug: "jellyseerr", title: "Jellyseerr" },
  { match: ["overseerr"], imageSlug: "overseerr", title: "Overseerr" },
  { match: ["seerr"], imageSlug: "seerr", title: "Seerr" },
  { match: ["jellyfin-uwp", "xbox"], imageSlug: "xbox", title: "Xbox" },
  { match: ["roku"], icon: siRoku },
  { match: ["android", "fire tv"], icon: siAndroid },
  { match: ["edge chromium", "microsoft edge"], imageSlug: "microsoft-edge", title: "Microsoft Edge" },
  { match: ["apple tv", "tvos"], icon: siAppletv },
  { match: ["iphone", "ipad", "ios", "macos", "apple"], icon: siApple },
  { match: ["google tv"], icon: siGoogletv },
  { match: ["chromecast", "cast"], icon: siGooglecast },
  { match: ["chrome"], icon: siGooglechrome },
  { match: ["firefox"], icon: siFirefox },
  { match: ["safari"], icon: siSafari },
  { match: ["opera"], icon: siOpera },
  { match: ["brave"], icon: siBrave, color: "var(--primary-light-color)" },
  { match: ["vivaldi"], icon: siVivaldi },
  { match: ["lg", "webos"], icon: siLg },
  { match: ["samsung", "tizen"], icon: siSamsung },
  { match: ["nvidia", "shield"], icon: siNvidia },
  { match: ["linux"], icon: siLinux },
  { match: ["ubuntu"], icon: siUbuntu },
  { match: ["kodi"], icon: siKodi },
  { match: ["plex"], icon: siPlex },
  { match: ["emby"], icon: siEmby },
  { match: ["jellyfin"], icon: siJellyfin, color: "#AA5CC3" },
];

function getPlatformIconMeta(client = "", deviceName = "") {
  const haystack = `${client} ${deviceName}`.toLowerCase();
  const matched = iconMap.find((entry) => entry.match.some((term) => haystack.includes(term)));

  return matched ?? { icon: siJellyfin, color: "#AA5CC3" };
}

const chromeIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" fill="none" viewBox="0 0 190 190"><linearGradient id="d" x1="28.3" x2="80.8" y1="75" y2="44.4" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#a52714" stop-opacity=".6"/><stop offset=".7" stop-color="#a52714" stop-opacity="0"/></linearGradient><linearGradient id="f" x1="109.9" x2="51.5" y1="164.5" y2="130.3" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#055524" stop-opacity=".4"/><stop offset=".3" stop-color="#055524" stop-opacity="0"/></linearGradient><linearGradient id="h" x1="121.9" x2="136.6" y1="49.8" y2="114.1" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ea6100" stop-opacity=".3"/><stop offset=".7" stop-color="#ea6100" stop-opacity="0"/></linearGradient><radialGradient id="a" cx="91.2" cy="55" r="84.1" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3e2723" stop-opacity=".2"/><stop offset="1" stop-color="#3e2723" stop-opacity="0"/></radialGradient><radialGradient xlink:href="#a" id="i" cx="20.9" cy="47.5" r="78"/><radialGradient id="j" cx="94.8" cy="95.1" r="87.9" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#263238" stop-opacity=".2"/><stop offset="1" stop-color="#263238" stop-opacity="0"/></radialGradient><radialGradient id="k" cx="33.3" cy="31" r="176.8" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><clipPath id="b"><circle cx="95" cy="95" r="88"/></clipPath><g clip-path="url(#b)"><use xlink:href="#c" fill="#db4437"/><use xlink:href="#c" fill="url(#d)"/><use xlink:href="#e" fill="#0f9d58"/><use xlink:href="#e" fill="url(#f)"/><use xlink:href="#g" fill="#ffcd40"/><use xlink:href="#g" fill="url(#h)"/><g fill-opacity=".1"><path fill="#3e2723" d="M61.3 114.7 21 47.4l39 67.8z"/><path fill="#263238" d="m128.8 116.3-.8-.4-37.3 67 38.3-67z"/></g><path id="e" d="M7 183h83.8l39-39v-29H60.2L7 23.5z"/><path id="g" d="m95 55 34.6 60L91 183h92V55z"/><path id="c" d="M21 7v108h39.4L95 55h88V7z"/><path fill="url(#a)" d="M95 55v21l78.4-21z"/><path fill="url(#i)" d="m21 47.5 57.2 57.2L60.4 115z"/><path fill="url(#j)" d="m90.8 183 21-78.3 17.8 10.3z"/><circle cx="95" cy="95" r="40" fill="#f1f1f1"/><circle cx="95" cy="95" r="32" fill="#4285f4"/><circle cx="95" cy="95" r="88" fill="url(#k)"/><g fill="#3e2723" fill-opacity=".1"><path fill="#fff" d="M129.6 115a40 40 0 0 1-69.2 0L7 24.5 60.4 116a40 40 0 0 0 69.2 0z"/><path d="M96 55h-.5a40 40 0 1 1 0 80h.5c22 0 40-18 40-40s-18-40-40-40m-1 127a88 88 0 0 0 88-87.5v.5A88 88 0 0 1 7 95v-.5A88 88 0 0 0 95 182"/><g fill-opacity=".2"><path fill="#fff" d="M130 116.3a39.3 39.3 0 0 0 3.4-32 38 38 0 0 1-3.8 30.7L92 183l38.2-66.5zM95 8a88 88 0 0 1 88 87.5V95A88 88 0 0 0 7 95v.5A88 88 0 0 1 95 8"/><path d="M95 54c-22 0-40 18-40 40v1c0-22 18-40 40-40h88v-1z"/></g></g></g></svg>`;

const chromeIconDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(chromeIconSvg)}`;

function ChromeIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" role="img" aria-label="Google Chrome">
      <image href={chromeIconDataUri} width="24" height="24" />
    </svg>
  );
}

export function PlatformIcon({ client, deviceName, className = "" }) {
  const { icon, imageSlug, title, color: overrideColor } = getPlatformIconMeta(client, deviceName);

  if (imageSlug) {
    return <img className={className} src={selfHostedIconUrl(imageSlug)} alt="" loading="lazy" decoding="async" title={title} />;
  }

  const color = overrideColor || `#${icon.hex}`;

  if (icon === siGooglechrome) {
    return <ChromeIcon className={className} />;
  }

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      role="img"
      aria-label={icon.title}
      style={{ "--platform-icon-color": color }}
    >
      <path d={icon.path} />
    </svg>
  );
}
