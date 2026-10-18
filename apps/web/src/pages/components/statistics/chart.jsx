import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { useCompactChart } from "../../../lib/breakpoints";

function Chart({ stats, libraries, viewName }) {
  const compact = useCompactChart();
  const colors = [
    "var(--primary-light-color)",
    "var(--primary-color)",
    "var(--secondary-color)",
    "#55d6be",
    "#f3b562",
    "#f06c9b",
    "#8b9cff",
    "#7dd3fc",
    "#c084fc",
    "#34d399",
    "#f9a8d4",
    "#a7f3d0",
    "#93c5fd",
    "#fde68a",
    "#fda4af",
    "#99f6e4",
    "#e9d5ff",
    "#bae6fd",
    "#f0abfc",
    "#c4b5fd",
  ];

  const flattenedStats = stats.map(item => {
    const flatItem = { Key: item.Key };
    for (const [libraryName, data] of Object.entries(item)) {
      if (libraryName === "Key") continue;
      flatItem[libraryName] = data[viewName] ?? 0;
    }
    return flatItem;
  });

  const CustomTooltip = ({ payload, label, active }) => {
    if (active) {
      return (
        <div className="stats-tooltip">
          <p className="stats-tooltip-title">{label}</p>
          {libraries.map((library, index) => (
            <p key={library.Id} className="stats-tooltip-row" style={{ color: `${colors[index % colors.length]}` }}>
              {`${library.Name} : ${payload?.find(p => p.dataKey === library.Name)?.value ?? 0} ${viewName === "count" ? "Views" : "Minutes"}`}
            </p>
          ))}
        </div>
      );
    }

    return null;
  };

  const getMaxValue = () => {
    let max = 0;
    flattenedStats.forEach(datum => {
      libraries.forEach(library => {
        const value = parseFloat(datum[library.Name]);
        if (!isNaN(value)) {
          max = Math.max(max, value);
        }
      });
    });
    return max;
  };

  const max = getMaxValue() + 10;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={flattenedStats} margin={compact ? { top: 8, right: 8, left: -12, bottom: 0 } : { top: 12, right: 24, left: 0, bottom: 8 }}>
        <defs>
          {libraries.map((library, index) => (
            <linearGradient key={library.Id} id={library.Id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={colors[index % colors.length]} stopOpacity={0.72} />
              <stop offset="95%" stopColor={colors[index % colors.length]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <XAxis
          dataKey="Key"
          interval={compact ? "preserveStartEnd" : 0}
          minTickGap={compact ? 28 : 5}
          angle={compact ? 0 : -42}
          textAnchor={compact ? "middle" : "end"}
          height={compact ? 28 : 86}
          stroke="#64748b"
          tick={{ fill: "#9aa7bb", fontSize: compact ? 10.5 : 11, fontWeight: 700 }}
        />
        <YAxis domain={[0, max]} width={compact ? 34 : 60} allowDecimals={false} stroke="#64748b" tick={{ fill: "#9aa7bb", fontSize: compact ? 10 : 11, fontWeight: 700 }} />
        <Tooltip content={<CustomTooltip />} wrapperStyle={{ pointerEvents: "none" }} />
        {compact ? null : <Legend verticalAlign="bottom" wrapperStyle={{ color: "#cbd5e1", fontSize: 12, fontWeight: 800 }} />}
        {libraries.map((library, index) => (
          <Area
            key={library.Id}
            type="monotone"
            dataKey={library.Name}
            stroke={colors[index % colors.length]}
            strokeWidth={2}
            fillOpacity={1}
            fill={"url(#" + library.Id + ")"}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default Chart;
