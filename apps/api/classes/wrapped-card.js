// Shareable recap card: renders a week, month or year in review as a PNG.
// Uses the same bundled fonts as webhook cards so it looks identical in Docker.
const sharp = require("sharp");
const { CARD_FONT, CARD_FONT_FACE, escapeXml } = require("./discord-webhook-media");

const WIDTH = 1080;
const HEIGHT = 1350;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function hours(seconds) {
  const value = Number(seconds || 0) / 3600;
  return value >= 100 ? Math.round(value).toLocaleString("en-GB") : value.toFixed(1);
}

function truncate(value, max) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function dayLabel(iso, withYear = true) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

function periodTitle(data) {
  if (data.period === "week") return `Week of ${dayLabel(data.start)}`;
  if (data.period === "month") {
    const [y, m] = data.start.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  return `${data.year} in review`;
}

// Bars: months for a year, days for a week or month.
function chartSeries(data) {
  if (data.period === "year") {
    return MONTHS.map((label, index) => ({
      label,
      seconds: Number(data.months.find((row) => row.month === index + 1)?.seconds || 0),
    }));
  }
  const byDay = new Map((data.days || []).map((row) => [row.day, Number(row.seconds || 0)]));
  const series = [];
  const [y, m, d] = data.start.split("-").map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  const last = data.end;
  while (cursor.toISOString().slice(0, 10) <= last) {
    const iso = cursor.toISOString().slice(0, 10);
    const dow = ((cursor.getUTCDay() + 6) % 7) + 1;
    series.push({ label: data.period === "week" ? WEEKDAYS[dow] : String(cursor.getUTCDate()), seconds: byDay.get(iso) || 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}

function text(x, y, value, { size = 28, weight = 400, fill = "#e8ecf6", anchor = "start" } = {}) {
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-family="${CARD_FONT}" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

function statTile(x, y, label, value, note) {
  const w = 460;
  const h = 150;
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="#ffffff" fill-opacity="0.06" stroke="#ffffff" stroke-opacity="0.08"/>`,
    text(x + 28, y + 44, label.toUpperCase(), { size: 20, weight: 700, fill: "#9aa6c2" }),
    text(x + 28, y + 90, truncate(value || "–", 26), { size: 34, weight: 700 }),
    note ? text(x + 28, y + 128, truncate(note, 36), { size: 22, fill: "#9aa6c2" }) : "",
  ].join("");
}

function buildSvg(data) {
  const totals = data.totals || {};
  const who = data.userName || (data.userId ? "You" : "The server");
  const series = chartSeries(data);
  const peak = Math.max(1, ...series.map((row) => row.seconds));
  const chartX = 60;
  const chartY = 1010;
  const chartW = WIDTH - 120;
  const chartH = 200;
  const gap = series.length > 20 ? 4 : 12;
  const barW = (chartW - gap * (series.length - 1)) / series.length;
  const showEvery = series.length > 20 ? 5 : 1;
  const bars = series
    .map((row, index) => {
      const h = Math.max(4, (row.seconds / peak) * chartH);
      const x = chartX + index * (barW + gap);
      const label = index % showEvery === 0 ? text(x + barW / 2, chartY + chartH + 36, row.label, { size: 20, fill: "#9aa6c2", anchor: "middle" }) : "";
      return `<rect x="${x.toFixed(1)}" y="${(chartY + chartH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(8, barW / 2).toFixed(1)}" fill="url(#bar)"/>${label}`;
    })
    .join("");

  const binge = data.longestBinge;
  const tiles = [
    ["Top show", data.topShows?.[0]?.name, data.topShows?.[0] ? `${hours(data.topShows[0].seconds)} hours` : null],
    ["Top movie", data.topMovies?.[0]?.name, data.topMovies?.[0] ? `${data.topMovies[0].plays} plays` : null],
    ["Longest binge", binge ? `${binge.episodes} episodes` : null, binge ? binge.name : null],
    ["Top genre", data.genres?.[0]?.name, data.genres?.[1] ? `then ${data.genres[1].name}` : null],
  ];
  const tileSvg = tiles.map(([label, value, note], index) => statTile(60 + (index % 2) * 500, 560 + Math.floor(index / 2) * 180, label, value, note)).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
${CARD_FONT_FACE}
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#1a1440"/>
    <stop offset="0.55" stop-color="#0f1426"/>
    <stop offset="1" stop-color="#0a0e1a"/>
  </linearGradient>
  <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#a78bfa"/>
    <stop offset="1" stop-color="#6d28d9"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.85" cy="0.1" r="0.6">
    <stop offset="0" stop-color="#8b5cf6" stop-opacity="0.35"/>
    <stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
${text(60, 110, "JELLYGLANCE", { size: 26, weight: 700, fill: "#a78bfa" })}
${text(60, 180, periodTitle(data), { size: 52, weight: 700 })}
${text(60, 232, `${data.period === "year" ? "" : `${dayLabel(data.start)} – ${dayLabel(data.end)} · `}${truncate(who, 40)}`, { size: 26, fill: "#9aa6c2" })}
${text(60, 400, hours(totals.seconds), { size: 150, weight: 700 })}
${text(62, 452, "hours watched", { size: 34, fill: "#c4b5fd" })}
${text(60, 512, `${Number(totals.plays || 0).toLocaleString("en-GB")} plays · ${Number(totals.titles || 0).toLocaleString("en-GB")} titles · ${totals.active_days || 0} active days`, { size: 28, fill: "#e8ecf6" })}
${tileSvg}
${text(60, 975, data.period === "year" ? "Hours by month" : "Hours by day", { size: 24, weight: 700, fill: "#9aa6c2" })}
${bars}
${text(WIDTH / 2, HEIGHT - 50, data.topClients?.[0] ? `Mostly watched on ${truncate(data.topClients[0].name, 40)}` : "", { size: 22, fill: "#6b7898", anchor: "middle" })}
</svg>`;
}

async function renderWrappedCard(data) {
  return sharp(Buffer.from(buildSvg(data))).png({ compressionLevel: 9 }).toBuffer();
}

module.exports = { renderWrappedCard, buildSvg, hours, dayLabel, periodTitle, MONTHS, WEEKDAYS };
