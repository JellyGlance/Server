/* eslint-disable react/prop-types */
import React, { useEffect, useMemo } from "react";
import axios from "../../../lib/axios_instance";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";

import AddCircleFillIcon from "remixicon-react/AddCircleFillIcon";
import IndeterminateCircleFillIcon from "remixicon-react/IndeterminateCircleFillIcon";

import StreamInfo from "./stream_info";

import "../../css/activity/activity-table.css";
import i18next from "i18next";
import IpInfoModal from "../ip-info";
import BusyLoader from "../general/busyLoader.jsx";
import { MRT_ShowHideColumnsButton, MRT_TablePagination, MaterialReactTable, useMaterialReactTable } from "material-react-table";
import { PHONE, TABLET, useMediaQuery } from "../../../lib/breakpoints";
import { Box, Typography } from "@mui/material";

import { Link } from "react-router-dom";
import { Button, Modal } from "react-bootstrap";
import { Trans } from "react-i18next";

function formatTotalWatchTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  let timeString = "";

  if (hours > 0) {
    timeString += `${hours} ${hours === 1 ? i18next.t("UNITS.HOUR").toLowerCase() : i18next.t("UNITS.HOURS").toLowerCase()} `;
  }

  if (minutes > 0) {
    timeString += `${minutes} ${
      minutes === 1 ? i18next.t("UNITS.MINUTE").toLowerCase() : i18next.t("UNITS.MINUTES").toLowerCase()
    } `;
  }

  if (remainingSeconds > 0) {
    timeString += `${remainingSeconds} ${
      remainingSeconds === 1 ? i18next.t("UNITS.SECOND").toLowerCase() : i18next.t("UNITS.SECONDS").toLowerCase()
    }`;
  }

  return timeString.trim();
}

const colors = {
  primary: "#d78df0",
  secondary: "#00c8ff",
  backgroundColor: "#070a10",
  secondaryBackgroundColor: "#0b1018",
  tertiaryBackgroundColor: "#101620",
};
const token = localStorage.getItem("token");
const activityColumnVisibilityKey = "PREF_ACTIVITY_ColumnVisibility";
const defaultColumnVisibility = {
  RemoteEndPoint: false,
};

function readActivityTablePreference(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getCssVariableColor(variableName, fallback) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const value = window.getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return value || fallback;
}

function ActivityPoster({ itemId, title }) {
  const [imageFailed, setImageFailed] = React.useState(false);

  if (!itemId || imageFailed) {
    return (
      <span className="activity-poster-fallback" aria-hidden="true">
        {title?.slice(0, 1)?.toUpperCase() || "?"}
      </span>
    );
  }

  return (
    <img
      className="activity-poster-image"
      src={`/proxy/Items/Images/Primary?id=${itemId}&fillHeight=108&fillWidth=72&quality=72`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setImageFailed(true)}
    />
  );
}

function ActivityUserAvatar({ userId, userName }) {
  const [imageFailed, setImageFailed] = React.useState(!userId);
  const initial = userName?.slice(0, 1)?.toUpperCase() || "?";

  if (imageFailed) {
    return (
      <span className="activity-user-avatar activity-user-avatar-fallback" aria-hidden="true">
        {initial}
      </span>
    );
  }

  return (
    <img
      className="activity-user-avatar"
      src={`/proxy/Users/Images/Primary?id=${userId}&fillWidth=72&quality=72`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setImageFailed(true)}
    />
  );
}

// Tablets keep their own column preference so hiding columns there never changes the desktop table.
const tabletColumnVisibilityKey = `${activityColumnVisibilityKey}_tablet`;
const tabletDefaultColumnVisibility = () => ({ RemoteEndPoint: false, DeviceName: false, [i18next.t("TOTAL_PLAYS")]: false });

function getStoredColumnVisibility(tablet = false) {
  const stored = readActivityTablePreference(tablet ? tabletColumnVisibilityKey : activityColumnVisibilityKey, {});
  const defaults = tablet ? tabletDefaultColumnVisibility() : defaultColumnVisibility;
  return { ...defaults, ...(stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {}) };
}

function activityTitle(row) {
  return !row.SeriesName ? row.NowPlayingItemName : `${row.SeriesName} : S${row.SeasonNumber}E${row.EpisodeNumber} - ${row.NowPlayingItemName}`;
}

function relativeTime(value, locale) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.round((then - Date.now()) / 1000);
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const format = new Intl.RelativeTimeFormat(locale || undefined, { numeric: "auto", style: "short" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "minute");
}

const METHOD_LABEL = { Transcode: "TRANSCODE", DirectPlay: "DIRECT", DirectStream: "DIRECT_STREAM" };
const METHOD_CLASS = { Transcode: "is-transcode", DirectPlay: "is-direct", DirectStream: "is-stream" };

// Phone layout: one card per play, driven by the same table instance so paging, search and selection carry over.
function ActivityCardList({ table, locale, onOpenStream }) {
  const rows = table.getRowModel().rows.filter((row) => row.depth === 0);
  if (!rows.length) {
    return <p className="activity-card-empty">{i18next.t("ACTIVITY_TABLE.NO_RESULTS")}</p>;
  }
  return (
    <ul className="activity-card-list">
      {rows.map((row) => {
        const item = row.original;
        const title = activityTitle(item);
        const plays = Number(item.TotalPlays ?? 1);
        const subRows = row.subRows || [];
        return (
          <li key={row.id} className="activity-card">
            <Link className="activity-card-poster" to={`/libraries/item/${item.EpisodeId || item.NowPlayingItemId}`} aria-label={title}>
              <ActivityPoster itemId={item.NowPlayingItemId || item.EpisodeId} title={title} />
            </Link>
            <div className="activity-card-body">
              <div className="activity-card-head">
                <Link className="activity-card-title" to={`/libraries/item/${item.EpisodeId || item.NowPlayingItemId}`}>
                  {title}
                </Link>
                <time className="activity-card-time" dateTime={item.ActivityDateInserted}>
                  {relativeTime(item.ActivityDateInserted, locale)}
                </time>
              </div>
              <Link className="activity-card-user" to={`/users/${item.UserId}`}>
                <ActivityUserAvatar userId={item.UserId} userName={item.UserName} />
                <span>{item.UserName}</span>
              </Link>
              <div className="activity-card-meta">
                <button type="button" className={`activity-method-pill ${METHOD_CLASS[item.PlayMethod] || "is-empty"}`} onClick={() => onOpenStream(item)}>
                  {METHOD_LABEL[item.PlayMethod] ? i18next.t(METHOD_LABEL[item.PlayMethod]) : "-"}
                </button>
                <span className="activity-card-duration">{formatTotalWatchTime(item.PlaybackDuration)}</span>
                {plays > 1 || subRows.length ? (
                  <button type="button" className="activity-card-plays" aria-expanded={row.getIsExpanded()} onClick={() => row.toggleExpanded()}>
                    ×{Math.max(plays, subRows.length)}
                  </button>
                ) : null}
              </div>
              {row.getIsExpanded() && subRows.length ? (
                <ul className="activity-card-subplays">
                  {subRows.map((sub) => (
                    <li key={sub.id}>
                      <span>{relativeTime(sub.original.ActivityDateInserted, locale)}</span>
                      <span>{formatTotalWatchTime(sub.original.PlaybackDuration)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function ActivityTable(props) {
  const twelve_hr = readActivityTablePreference("12hr", false);
  const localization = localStorage.getItem("i18nextLng");
  const [data, setData] = React.useState(props.data ?? []);
  const pages = props.pageCount || 1;
  const isBusy = props.isBusy;

  const [rowSelection, setRowSelection] = React.useState({});
  const [pagination, setPagination] = React.useState({
    pageSize: 10,
    pageIndex: 0,
  });
  const [sorting, setSorting] = React.useState([{ id: "Date", desc: true }]);

  const [columnFilters, setColumnFilters] = React.useState([]);
  const isPhone = useMediaQuery(PHONE);
  const isTablet = useMediaQuery(TABLET);
  const [columnVisibility, setColumnVisibility] = React.useState(() => getStoredColumnVisibility(isTablet));
  useEffect(() => {
    setColumnVisibility(getStoredColumnVisibility(isTablet));
  }, [isTablet]);

  const [modalState, setModalState] = React.useState(false);
  const [modalData, setModalData] = React.useState();
  const [themeTick, setThemeTick] = React.useState(0);
  const muiColors = useMemo(
    () => ({
      primary: getCssVariableColor("--primary-light-color", colors.primary),
      secondary: getCssVariableColor("--secondary-color", colors.secondary),
      tertiaryBackgroundColor: colors.tertiaryBackgroundColor,
    }),
    [themeTick]
  );

  useEffect(() => {
    const handleThemeUpdate = () => setThemeTick((current) => current + 1);
    window.addEventListener("jellyglance-theme-updated", handleThemeUpdate);
    return () => window.removeEventListener("jellyglance-theme-updated", handleThemeUpdate);
  }, []);

  const handlePageChange = (updater) => {
    setPagination((old) => {
      const newPaginationState = typeof updater === "function" ? updater(old) : updater;
      const newPage = newPaginationState.pageIndex; // MaterialReactTable uses 0-based index
      if (props.onPageChange) {
        props.onPageChange(newPage + 1);
      }
      return newPaginationState;
    });
  };

  //IP MODAL

  const ipv4Regex = new RegExp(
    /\b(?!(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168))(?:(?:2(?:[0-4][0-9]|5[0-5])|[0-1]?[0-9]?[0-9])\.){3}(?:(?:2([0-4][0-9]|5[0-5])|[0-1]?[0-9]?[0-9]))\b/
  );

  const [ipModalVisible, setIPModalVisible] = React.useState(false);
  const [confirmDeleteShow, setDeleteShow] = React.useState(false);
  const [ipAddressLookup, setIPAddressLookup] = React.useState();

  const isRemoteSession = (ipAddress) => {
    ipv4Regex.lastIndex = 0;
    if (ipv4Regex.test(ipAddress ?? ipAddressLookup)) {
      return true;
    }
    return false;
  };

  const openModal = (data) => {
    setModalData(data);
    setModalState(!modalState);
  };

  function showIPDataModal(ipAddress) {
    ipv4Regex.lastIndex = 0;
    setIPAddressLookup(ipAddress);
    if (!isRemoteSession) {
      return;
    }

    setIPModalVisible(true);
  }

  async function deleteActivity() {
    const url = `/api/deletePlaybackActivity`;

    axios
      .post(
        url,
        { ids: [...Object.keys(rowSelection)] },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      )
      .then(() => {
        setData(data.filter((item) => !rowSelection[item.Id]));
        setRowSelection({});
      })
      .catch((error) => {
        console.log(error);
      });
  }

  // eslint-disable-next-line react/prop-types
  if (pagination.pageSize !== props.itemCount) {
    // eslint-disable-next-line react/prop-types
    setPagination({ pageIndex: 0, pageSize: props.itemCount });
  }

  const columns = [
    {
      accessorFn: (row) =>
        `${
          !row?.SeriesName
            ? row.NowPlayingItemName
            : row.SeriesName + " : S" + row.SeasonNumber + "E" + row.EpisodeNumber + " - " + row.NowPlayingItemName
      }`,
      field: "NowPlayingItemName",
      header: i18next.t("TITLE"),
      minSize: isTablet ? 240 : 360,
      grow: 1.6,
      Cell: ({ row }) => {
        row = row.original;
        const title = !row.SeriesName
          ? row.NowPlayingItemName
          : row.SeriesName + " : S" + row.SeasonNumber + "E" + row.EpisodeNumber + " - " + row.NowPlayingItemName;
        const itemId = row.NowPlayingItemId || row.EpisodeId;

        return (
          <Link to={`/libraries/item/${row.EpisodeId || row.NowPlayingItemId}`} className="activity-table-link activity-title-link">
            <span className="activity-title-media">
              <ActivityPoster itemId={itemId} title={title} />
              <span className="activity-title-copy">
                <strong>{title}</strong>
                <small>{row.SeriesName ? "Episode" : row.NowPlayingItemName ? "Movie" : "Media"}</small>
              </span>
            </span>
          </Link>
        );
      },
    },
    {
      accessorKey: "UserName",
      header: i18next.t("USER"),
      size: 190,
      Cell: ({ row }) => {
        row = row.original;
        return (
          <Link to={`/users/${row.UserId}`} className="activity-table-link activity-user-link">
            <ActivityUserAvatar userId={row.UserId} userName={row.UserName} />
            <span>{row.UserName || "Unknown"}</span>
          </Link>
        );
      },
    },
    {
      accessorKey: "Client",
      header: i18next.t("ACTIVITY_TABLE.CLIENT"),
      size: 160,
      Cell: ({ row }) => {
        row = row.original;
        return (
          <Link onClick={() => openModal(row)} className="activity-table-link activity-client-link">
            {row.Client}
          </Link>
        );
      },
    },
    {
      accessorKey: "DeviceName",
      header: i18next.t("ACTIVITY_TABLE.DEVICE"),
      size: 180,
      Cell: ({ cell }) => <span className="activity-device-cell">{cell.getValue() || "-"}</span>,
    },
    {
      accessorKey: "PlayMethod",
      header: i18next.t("TRANSCODE"),
      size: 160,
      Cell: ({ row }) => {
        row = row.original;
        if (row.PlayMethod === "Transcode") {
          return (
            <Link onClick={() => openModal(row)} className="activity-method-pill is-transcode">
              <span>
                {i18next.t("TRANSCODE")}
                {row.TranscodingInfo ? (
                  <span>
                    {!row.TranscodingInfo.IsVideoDirect && <span> ({i18next.t("VIDEO")})</span>}
                    {!row.TranscodingInfo.IsAudioDirect && <span> ({i18next.t("AUDIO")})</span>}
                  </span>
                ) : (
                  ""
                )}
              </span>
            </Link>
          );
        } else if (row.PlayMethod === "DirectPlay") {
          return (
            <Link onClick={() => openModal(row)} className="activity-method-pill is-direct">
              {i18next.t("DIRECT")}{" "}
            </Link>
          );
        } else if (row.PlayMethod === "DirectStream") {
          return (
            <Link onClick={() => openModal(row)} className="activity-method-pill is-stream">
              {i18next.t("DIRECT_STREAM")}{" "}
            </Link>
          );
        } else {
          return (
            <Link onClick={() => openModal(row)} className="activity-method-pill is-empty">
              -
            </Link>
          );
        }
      },
    },
    {
      accessorFn: (row) => new Date(row.ActivityDateInserted),
      field: "ActivityDateInserted",
      header: i18next.t("DATE"),
      size: 170,
      filterVariant: "date-range",
      Cell: ({ row }) => {
        const options = {
          day: "numeric",
          month: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
          hour12: twelve_hr,
        };
        row = row.original;
        return <span className="activity-date-cell">{Intl.DateTimeFormat(localization, options).format(new Date(row.ActivityDateInserted))}</span>;
      },
    },
    {
      accessorKey: "RemoteEndPoint",
      header: i18next.t("ACTIVITY_TABLE.IP_ADDRESS"),
      size: 150,
      Cell: ({ row }) => {
        row = row.original;
        if (
          isRemoteSession(row.RemoteEndPoint) &&
          (window.env?.JS_GEOLITE_ACCOUNT_ID ?? import.meta.env.JS_GEOLITE_ACCOUNT_ID) != undefined
        ) {
          return (
            <Link className="activity-table-link activity-ip-link" onClick={() => showIPDataModal(row.RemoteEndPoint)}>
              {row.RemoteEndPoint}
            </Link>
          );
        }
        return <span className="activity-ip-cell">{row.RemoteEndPoint || "-"}</span>;
      },
    },
    {
      accessorKey: "PlaybackDuration",
      header: i18next.t("ACTIVITY_TABLE.TOTAL_PLAYBACK"),
      size: 160,
      // filterFn: (row, id, filterValue) => formatTotalWatchTime(row.getValue(id)).startsWith(filterValue),
      filterVariant: "range",
      Cell: ({ cell }) => <span className="activity-duration-cell">{formatTotalWatchTime(cell.getValue())}</span>,
    },
    {
      accessorFn: (row) => Number(row.TotalPlays ?? 1),
      field: "TotalPlays",
      header: i18next.t("TOTAL_PLAYS"),
      filterFn: "betweenInclusive",
      size: 110,

      Cell: ({ cell }) => <span className="activity-plays-cell">{cell.getValue() ?? 1}</span>,
    },
  ];

  const fieldMap = columns.map((column) => {
    return { accessorKey: column.accessorKey ?? column.field, header: column.header };
  });

  const handleSortingChange = (updater) => {
    setSorting((old) => {
      const newSortingState = typeof updater === "function" ? updater(old) : updater;
      const column = newSortingState.length > 0 ? newSortingState[0].id : "Date";
      const desc = newSortingState.length > 0 ? newSortingState[0].desc : true;
      if (props.onSortChange) {
        props.onSortChange({ column: fieldMap.find((field) => field.header == column)?.accessorKey ?? column, desc: desc });
      }
      return newSortingState;
    });
  };

  const handleFilteringChange = (updater) => {
    setColumnFilters((old) => {
      const newFilterState = typeof updater === "function" ? updater(old) : updater;

      const modifiedFilterState = newFilterState.map((filter) => ({ ...filter }));

      modifiedFilterState.map((filter) => {
        filter.field = fieldMap.find((field) => field.header == filter.id)?.accessorKey ?? filter.id;
        delete filter.id;
        if (Array.isArray(filter.value)) {
          filter.min = filter.value[0];
          filter.max = filter.value[1];
          delete filter.value;
        } else {
          const val = filter.value;
          delete filter.value;
          filter.value = val;
        }

        return filter;
      });

      if (props.onFilterChange) {
        props.onFilterChange(modifiedFilterState);
      }
      return newFilterState;
    });
  };

  const handleColumnVisibilityChange = (updater) => {
    setColumnVisibility((currentVisibility) => {
      const nextVisibility = typeof updater === "function" ? updater(currentVisibility) : updater;
      localStorage.setItem(isTablet ? tabletColumnVisibilityKey : activityColumnVisibilityKey, JSON.stringify(nextVisibility));
      return nextVisibility;
    });
  };

  useEffect(() => {
    setData(props.data);
  }, [props.data]);

  const table = useMaterialReactTable({
    columns,
    data,
    localization: {
      expand: i18next.t("ACTIVITY_TABLE.EXPAND"),
      collapse: i18next.t("ACTIVITY_TABLE.COLLAPSE"),
      sortByColumnAsc: `${i18next.t("ACTIVITY_TABLE.SORT_BY")} {column} - ${i18next.t("ACTIVITY_TABLE.ASCENDING")}`,
      sortByColumnDesc: `${i18next.t("ACTIVITY_TABLE.SORT_BY")} {column} - ${i18next.t("ACTIVITY_TABLE.DESCENDING")}`,
      clearFilter: i18next.t("ACTIVITY_TABLE.CLEAR_FILTER"),
      clearSort: i18next.t("ACTIVITY_TABLE.CLEAR_SORT"),
      filterByColumn: `${i18next.t("ACTIVITY_TABLE.FILTER_BY")} {column}`,
      toggleSelectAll: i18next.t("ACTIVITY_TABLE.TOGGLE_SELECT_ALL"),
      toggleSelectRow: i18next.t("ACTIVITY_TABLE.TOGGLE_SELECT_ROW"),
      columnActions: i18next.t("ACTIVITY_TABLE.COLUMN_ACTIONS"),
    },
    columnFilterDisplayMode: "popover",
    layoutMode: "grid",
    enableExpandAll: false,
    enableExpanding: true,
    enableDensityToggle: false,
    enableFilters: true,
    manualFiltering: true,
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: handleFilteringChange,
    onColumnVisibilityChange: handleColumnVisibilityChange,
    enableTopToolbar: true,
    manualPagination: true,
    manualSorting: true,
    autoResetPageIndex: false,
    initialState: {
      expanded: false,
      showGlobalFilter: true,
      pagination: {
        pageSize: 10,
        pageIndex: 0,
      },
      sorting: [
        {
          id: "Date",
          desc: true,
        },
      ],
    },
    pageCount: pages,
    rowCount: pagination.pageSize, // fix for bug causing pagination index to reset when row count changes
    showAlertBanner: false,
    enableHiding: true,
    enableFullScreenToggle: false,
    enableGlobalFilter: false,
    enableBottomToolbar: false,
    enableRowSelection: (row) => row.original.Id,
    enableMultiRowSelection: true,
    enableBatchRowSelection: true,
    onRowSelectionChange: setRowSelection,
    positionToolbarAlertBanner: "bottom",
    renderToolbarInternalActions: ({ table }) => (
      <Box className="activity-table-actions">
        <span className="activity-table-actions-label">Columns</span>
        <MRT_ShowHideColumnsButton table={table} />
      </Box>
    ),
    renderTopToolbarCustomActions: () => {
      if (Object.keys(rowSelection).length > 0) {
        return (
          <Box sx={{ display: "flex", gap: "1rem", p: "0px" }}>
            <span>
              <Typography variant="h5">
                {i18next.t("X_ROWS_SELECTED").replace("{ROWS}", Object.keys(rowSelection).length)}
              </Typography>
            </span>
            <Button
              color="error"
              onClick={() => {
                setDeleteShow(true);
              }}
              variant="danger"
            >
              <Trans i18nKey="DELETE" />
            </Button>
          </Box>
        );
      }
      return <span className="activity-table-toolbar-title">Activity view</span>;
    },
    renderEmptyRowsFallback: () => (
      <span style={{ textAlign: "center", fontStyle: "italic", color: "grey" }} className="py-5">
        <Trans i18nKey="ERROR_MESSAGES.NO_ACTIVITY" />
      </span>
    ),
    muiTableBodyRowProps: {
      sx: {
        backgroundColor: "transparent",
        "&:nth-of-type(odd) .MuiTableCell-body": {
          backgroundColor: "rgba(10, 13, 18, 0.92)",
        },
        "&:nth-of-type(even) .MuiTableCell-body": {
          backgroundColor: "rgba(13, 17, 23, 0.92)",
        },
        "& .MuiTableCell-body:first-of-type": {
          borderTopLeftRadius: "0",
          borderBottomLeftRadius: "0",
        },
        "& .MuiTableCell-body:last-of-type": {
          borderTopRightRadius: "0",
          borderBottomRightRadius: "0",
        },
        "&:hover .MuiTableCell-body": {
          backgroundColor: "rgba(24, 30, 39, 0.96)",
        },
        "&:hover .MuiCheckbox-root": {
          opacity: 1,
          color: muiColors.secondary,
        },
      },
    },
    muiSelectCheckboxProps: {
      sx: {
        opacity: 0.72,
        "&:hover": {
          opacity: 1,
        },
        "&.Mui-checked": {
          opacity: 1,
        },
      },
    },
    enableColumnPinning: isTablet,
    state: {
      rowSelection,
      pagination,
      sorting,
      columnFilters,
      columnVisibility,
      columnPinning: isTablet ? { left: ["mrt-row-select", i18next.t("TITLE")], right: [] } : { left: [], right: [] },
    },
    filterFromLeafRows: true,
    getSubRows: (row) => {
      if (Array.isArray(row.results) && row.results.length == 1) {
        row.results.pop();
      }

      return row.results;
    },
    onPaginationChange: handlePageChange,
    getRowId: (row) => row.Id,
    muiExpandButtonProps: ({ row }) => ({
      children: row.getIsExpanded() ? <IndeterminateCircleFillIcon /> : <AddCircleFillIcon />,
      onClick: () => table.setExpanded({ [row.id]: !row.getIsExpanded() }),
      sx: {
        transform: row.getIsExpanded() ? "rotate(180deg)" : "rotate(-90deg)",
        transition: "transform 0.2s",
      },
    }),
    muiPaginationProps: {
      rowsPerPageOptions: [10, 25, 50, 100],
      variant: "outlined",
      showFirstButton: true,
      showLastButton: true,
      showRowsPerPage: false,
    },
    paginationDisplayMode: "pages",
    muiTableBodyCellProps: {
      sx: {
        borderBottom: "1px solid rgba(255, 255, 255, 0.045)",
        color: "#d9e2ee",
        fontSize: "13px",
        fontWeight: 560,
        lineHeight: 1.35,
        padding: "12px 14px",
      },
    },
    muiTableHeadCellProps: {
      sx: {
        backgroundColor: "rgba(8, 11, 16, 0.98)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        color: "#9ca8b8",
        fontSize: "11px",
        fontWeight: 680,
        letterSpacing: "0.04em",
        padding: "11px 14px",
        textTransform: "uppercase",
      },
    },
    muiTablePaperProps: {
      className: "activity-mrt-paper",
      elevation: 0,
      sx: {
        overflow: "hidden",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        borderRadius: "8px",
        background: "rgba(9, 12, 17, 0.96)",
        boxShadow: "0 12px 30px rgba(0, 0, 0, 0.18)",
      },
    },
    muiTopToolbarProps: {
      sx: {
        minHeight: "48px",
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        background: "rgba(8, 11, 16, 0.98)",
      },
    },
    muiTableContainerProps: {
      sx: {
        backgroundColor: "transparent",
        padding: "0",
      },
    },
    muiTableProps: {
      sx: {
        borderCollapse: "separate",
        borderSpacing: "0",
      },
    },
    muiFilterAutocompleteProps: {
      sx: {
        color: muiColors.primary,
      },
    },

    mrtTheme: () => ({
      baseBackgroundColor: "#070a10",
    }),
  });
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      {isBusy && <BusyLoader />}

      <IpInfoModal show={ipModalVisible} onHide={() => setIPModalVisible(false)} ipAddress={ipAddressLookup} />
      <Modal
        show={confirmDeleteShow}
        onHide={() => {
          setDeleteShow(false);
        }}
      >
        <Modal.Header closeButton>
          <Modal.Title>
            <Trans i18nKey="ITEM_INFO.CONFIRM_ACTION" />
            {" - "}
            {i18next.t("X_ROWS_SELECTED").replace("{ROWS}", Object.keys(rowSelection).length)}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>{i18next.t("PURGE_OPTIONS.PURGE_ACTIVITY")}</p>
        </Modal.Body>
        <Modal.Footer>
          <button
            className="btn btn-danger"
            onClick={() => {
              deleteActivity().then(() => setDeleteShow(false));
            }}
          >
            <Trans i18nKey="DELETE" />
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setDeleteShow(false);
            }}
          >
            <Trans i18nKey="CLOSE" />
          </button>
        </Modal.Footer>
      </Modal>
      <Modal show={modalState} onHide={() => setModalState(false)} dialogClassName="stream-info-modal">
        <Modal.Header>
          <Modal.Title>
            <Trans i18nKey="ACTIVITY_TABLE.MODAL.HEADER" />
            {": "}
            {!modalData?.SeriesName
              ? modalData?.NowPlayingItemName
              : modalData?.SeriesName + " - " + modalData?.NowPlayingItemName}{" "}
            ({modalData?.UserName})
          </Modal.Title>
        </Modal.Header>
        <StreamInfo data={modalData} />
        <Modal.Footer>
          <Button variant="outline-primary" onClick={() => setModalState(false)}>
            <Trans i18nKey="CLOSE" />
          </Button>
        </Modal.Footer>
      </Modal>
      {isPhone ? (
        <div className="activity-card-shell">
          <ActivityCardList table={table} locale={localization} onOpenStream={openModal} />
        </div>
      ) : (
        <div className={isTablet ? "activity-table-tablet" : undefined}>
          {isTablet ? <p className="activity-swipe-hint">{i18next.t("ACTIVITY_TABLE.SWIPE_HINT")}</p> : null}
          <MaterialReactTable table={table} />
        </div>
      )}
      <Box
        sx={{
          display: "flex",
          justifyContent: "end",
          alignItems: "center",
        }}
      >
        <MRT_TablePagination table={table} />
      </Box>
    </LocalizationProvider>
  );
}
