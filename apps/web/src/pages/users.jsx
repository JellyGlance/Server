import React, { useEffect, useMemo, useState } from "react";
import axios from "../lib/axios_instance";
import Config from "../lib/config";
import { Link } from "react-router-dom";
import AccountCircleFillIcon from "remixicon-react/AccountCircleFillIcon";
import CheckFillIcon from "remixicon-react/CheckFillIcon";
import CloseFillIcon from "remixicon-react/CloseFillIcon";
import EyeLineIcon from "remixicon-react/EyeLineIcon";
import EyeOffLineIcon from "remixicon-react/EyeOffLineIcon";
import SearchLineIcon from "remixicon-react/SearchLineIcon";
import DeleteBinLineIcon from "remixicon-react/DeleteBinLineIcon";
import LockPasswordLineIcon from "remixicon-react/LockPasswordLineIcon";
import ShieldUserLineIcon from "remixicon-react/ShieldUserLineIcon";
import PriceTag3LineIcon from "remixicon-react/PriceTag3LineIcon";
import UserAddLineIcon from "remixicon-react/UserAddLineIcon";
import UserSettingsLineIcon from "remixicon-react/UserSettingsLineIcon";
import ShieldKeyholeLineIcon from "remixicon-react/ShieldKeyholeLineIcon";
import Settings3LineIcon from "remixicon-react/Settings3LineIcon";
import { Alert, Badge, Button, ButtonGroup, Form, FormControl, FormSelect, Modal, Spinner } from "react-bootstrap";

import "./css/users/users.css";

import Loading from "./components/general/loading";
import i18next from "i18next";
import { mediaServerName } from "../lib/media-server";

const token = localStorage.getItem("token");
const PERMISSION_DEFINITIONS = [
  { key: "dashboard", label: "Dashboard", detail: "Can sign in and call protected routes." },
  { key: "home", label: "Home", detail: "Can open the admin Home dashboard." },
  { key: "myGlance", label: "My Glance", detail: "Can open their personal Glance page." },
  { key: "requests", label: "Requests", detail: "Can open the Requests page." },
  { key: "downloads", label: "Downloads", detail: "Can manage the download queue." },
  { key: "repair", label: "Repair", detail: "Can open the Repair hub." },
  { key: "users", label: "Users", detail: "Can manage user roles, tracking, and local accounts." },
  { key: "settings", label: "Settings", detail: "Can change integrations, backups, imports, and maintenance settings." },
  { key: "apiKeys", label: "API Keys", detail: "Can view and manage API keys." },
];
const LOCKED_PERMISSION_ROLES = new Set(["Owner", "Disabled"]);

function formatWatchTime(seconds = 0) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (!hours && !minutes) {
    return `0 ${i18next.t("UNITS.MINUTES")}`;
  }

  return `${hours ? `${hours} ${i18next.t("UNITS.HOURS")}` : ""}${minutes ? ` ${minutes} ${i18next.t("UNITS.MINUTES")}` : ""}`.trim();
}

// Compact form for the user cards: "174h 30m", "45m".
function formatWatchTimeShort(seconds = 0) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours.toLocaleString()}h ${minutes}m` : `${hours.toLocaleString()}h`;
}

// "Jellyfin for Android" -> "Android", "Jellyfin Web" -> "Web".
function shortClientName(client) {
  const name = String(client || "").trim();
  return name.replace(/^(Jellyfin|Emby)\s+(for\s+)?/i, "") || name;
}

function formatLastSeen(time) {
  if (!time) {
    return "Never";
  }

  const units = [
    ["days", i18next.t("UNITS.DAYS")],
    ["hours", i18next.t("UNITS.HOUR")],
    ["minutes", i18next.t("UNITS.MINUTES")],
  ];
  const value = units.find(([key]) => time[key]);
  return value ? `${time[value[0]]} ${value[1]} ago` : "Just now";
}

function userImage(user, size = 48) {
  const userId = user.UserId || user.Id || user.id;
  const primaryImageTag = user.PrimaryImageTag || user.primaryImageTag;
  if (userId && primaryImageTag) {
    return <img className="users-avatar" src={`/proxy/Users/Images/Primary?id=${encodeURIComponent(userId)}&tag=${encodeURIComponent(primaryImageTag)}&fillWidth=${Math.max(size * 2, 96)}&quality=80`} alt="" loading="lazy" decoding="async" style={{ width: size, height: size }} />;
  }

  return (
    <span className="users-avatar users-avatar-empty" style={{ width: size, height: size }}>
      <AccountCircleFillIcon size={size} />
    </span>
  );
}

function roleClass(role) {
  return `role-${role?.toLowerCase?.().replace(/[^a-z0-9]+/g, "-") || "viewer"}`;
}

function isJellyfinAdministrator(user) {
  const value = user?.IsAdministrator;
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

function sourceClass(source) {
  return `source-${source?.toLowerCase?.().replace(/[^a-z0-9]+/g, "-") || "jellyfin"}`;
}

export default function Users() {
  const [data, setData] = useState(null);
  const [config, setConfig] = useState(null);
  const [access, setAccess] = useState(null);
  const [activeUserIds, setActiveUserIds] = useState(new Set());
  const [rowsPerPage, setRowsPerPage] = useState(parseInt(localStorage.getItem("PREF_USER_ACTIVITY_ItemCount") ?? "25"));
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [viewMode, setViewMode] = useState(localStorage.getItem("PREF_USERS_ViewMode") || "cards");
  const [showHiddenUsers, setShowHiddenUsers] = useState(localStorage.getItem("PREF_USERS_ShowHidden") === "true");
  const [savingUserId, setSavingUserId] = useState("");
  const [alert, setAlert] = useState(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAddRole, setShowAddRole] = useState(false);
  const [showUsersManager, setShowUsersManager] = useState(false);
  const [showRolesManager, setShowRolesManager] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [newLocalUser, setNewLocalUser] = useState({ username: "", password: "", role: "Viewer" });
  const [newRole, setNewRole] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [previewRole, setPreviewRole] = useState("Viewer");
  const [folderTarget, setFolderTarget] = useState(null);
  const [folderOptions, setFolderOptions] = useState({ movie: [], tv: [] });
  const [userFoldersMap, setUserFoldersMap] = useState({});
  const [folderDraft, setFolderDraft] = useState({ movieValue: "", tvValue: "" });
  const [folderMessage, setFolderMessage] = useState("");
  const [savingFolders, setSavingFolders] = useState(false);

  async function fetchAccess() {
    const response = await axios.get("/api/userAccess", {
      headers: { Authorization: `Bearer ${token}` },
    });
    setAccess(response.data);
  }

  async function fetchData() {
    const [activityResponse, untrackedResponse, sessionsResponse] = await Promise.all([
      axios.get("/stats/getAllUserActivity", {
        params: { t: Date.now() },
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      }),
      axios.get("/api/UntrackedUsers", {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      }),
      axios
        .get("/proxy/getSessions", {
          params: { t: Date.now() },
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        })
        .catch(() => ({ data: [] })),
    ]);

    setActiveUserIds(new Set(sessionsResponse.data.filter((session) => session.NowPlayingItem && session.UserId).map((session) => session.UserId)));
    setData(
      activityResponse.data.map((item) => ({
        ...item,
        Tracked: !untrackedResponse.data.includes(item.UserId),
      }))
    );
  }

  useEffect(() => {
    const init = async () => {
      try {
        const newConfig = await Config.getConfig();
        setConfig(newConfig);
        await Promise.all([fetchAccess(), fetchData(), fetchUserFolders()]);
      } catch (error) {
        console.log(error);
      }
    };

    init();
    const intervalId = setInterval(() => fetchData(), 60000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (access?.roles?.length && !access.roles.includes(previewRole)) {
      setPreviewRole(access.roles.includes("Viewer") ? "Viewer" : access.roles[0]);
    }
  }, [access, previewRole]);

  const rows = useMemo(() => {
    if (!data || !access) {
      return [];
    }

    const jellyfinRows = data.map((user) => {
      const serverAdmin = isJellyfinAdministrator(user);
      const role = access.jellyfinRoles?.[user.UserId] || (serverAdmin ? "Admin" : "Viewer");
      return {
        ...user,
        IsAdministrator: serverAdmin,
        AccountId: user.UserId,
        Role: role,
        Source: "Jellyfin",
        SourceLabel: serverAdmin ? `${mediaServerName()} admin` : `${mediaServerName()} user`,
        IsRunning: activeUserIds.has(user.UserId),
        SortWatchTime: Number(user.TotalWatchTime || 0),
      };
    });

    const primaryLocalRow = access.primaryLocalUser
      ? [
          {
            AccountId: `local-primary-${access.primaryLocalUser}`,
            UserId: `local-primary-${access.primaryLocalUser}`,
            UserName: access.primaryLocalUser,
            Role: "Owner",
            Source: "Local",
            SourceLabel: "Primary local account",
            LastWatched: "N/A",
            LastClient: "Local login",
            TotalWatchTime: 0,
            LastSeen: null,
            Tracked: false,
            IsRunning: false,
            IsLocalAccount: true,
            IsPrimaryLocal: true,
            SortWatchTime: -1,
          },
        ]
      : [];

    const localRows = (access.localUsers || []).map((user) => ({
      AccountId: `local-${user.id}`,
      UserId: `local-${user.id}`,
      UserName: user.username,
      Role: user.role || "Viewer",
      Source: "Local",
      SourceLabel: "Local JellyGlance user",
      LastWatched: "N/A",
      LastClient: "Local login",
      TotalWatchTime: 0,
      LastSeen: null,
      Tracked: false,
      IsRunning: false,
      IsLocalAccount: true,
      LocalUser: user,
      SortWatchTime: -1,
    }));

    const oidcRows =
      access.authMode === "oidc"
        ? [
            {
              AccountId: "oidc-provider",
              UserId: "oidc-provider",
              UserName: access.oidcLabel || "OIDC / Authentik",
              Role: "Admin",
              Source: "OIDC",
              SourceLabel: "OIDC identity provider",
              LastWatched: "N/A",
              LastClient: "OIDC login",
              TotalWatchTime: 0,
              LastSeen: null,
              Tracked: false,
              IsRunning: false,
              IsOidcAccount: true,
              SortWatchTime: -2,
            },
          ]
        : [];

    return [...jellyfinRows, ...oidcRows, ...primaryLocalRow, ...localRows];
  }, [access, activeUserIds, data]);

  const filteredRows = useMemo(() => {
    return rows
      .filter((user) => roleFilter === "All" || user.Role === roleFilter)
      .filter((user) => sourceFilter === "All" || user.Source === sourceFilter)
      .filter((user) => showHiddenUsers || user.Source !== "Jellyfin" || user.Tracked)
      .filter((user) => {
        if (!searchQuery) {
          return true;
        }

        const query = searchQuery.toLowerCase();
        return (
          user.UserName?.toLowerCase().includes(query) ||
          user.LastWatched?.toLowerCase().includes(query) ||
          user.LastClient?.toLowerCase().includes(query) ||
          user.Source?.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => (b.SortWatchTime || 0) - (a.SortWatchTime || 0));
  }, [roleFilter, rows, searchQuery, showHiddenUsers, sourceFilter]);

  const visibleRows = filteredRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  const jellyfinRows = rows.filter((user) => user.Source === "Jellyfin");
  const trackedCount = jellyfinRows.filter((user) => user.Tracked).length;
  const hiddenUserCount = jellyfinRows.length - trackedCount;
  const totalWatchTime = jellyfinRows.reduce((total, user) => total + Number(user.TotalWatchTime || 0), 0);
  const localAccountCount = rows.filter((user) => user.Source === "Local").length;
  const oidcAccountCount = rows.filter((user) => user.Source === "OIDC").length;
  const previewPermissions = useMemo(() => {
    if (!access) return {};
    return {
      dashboard: false,
      users: false,
      settings: false,
      apiKeys: false,
      ...(access.rolePermissions?.[previewRole] || {}),
    };
  }, [access, previewRole]);
  const selectedRolePermissions = previewPermissions;
  const selectedRoleLocked = LOCKED_PERMISSION_ROLES.has(previewRole);

  async function fetchUserFolders() {
    try {
      const response = await axios.get("/api/requests/user-folders", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUserFoldersMap(response.data?.folders || {});
    } catch (error) {
      console.log("Unable to load user request folders", error);
    }
  }

  function folderOptionValue(option) {
    return JSON.stringify({
      sourceId: option.sourceId,
      serverId: option.serverId,
      path: option.path,
    });
  }

  function folderSelectValue(folders, mediaType) {
    const path = mediaType === "tv" ? folders?.tvRootFolder : folders?.movieRootFolder;
    if (!path) return "";
    return JSON.stringify({
      sourceId: mediaType === "tv" ? folders.tvSourceId : folders.movieSourceId,
      serverId: mediaType === "tv" ? folders.tvServerId : folders.movieServerId,
      path,
    });
  }

  function folderDraftLabel(value) {
    try {
      return JSON.parse(value)?.path || value;
    } catch {
      return value;
    }
  }

  function hasFolderOverride(user) {
    const folders = userFoldersMap[user?.UserId];
    return Boolean(folders?.movieRootFolder || folders?.tvRootFolder);
  }

  async function openFolderModal(user) {
    const folders = userFoldersMap[user.UserId] || {};
    setFolderTarget(user);
    setFolderMessage("");
    setFolderDraft({
      movieValue: folderSelectValue(folders, "movie"),
      tvValue: folderSelectValue(folders, "tv"),
    });
    try {
      const response = await axios.get("/api/requests/folder-options", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setFolderOptions({ movie: response.data?.movie || [], tv: response.data?.tv || [] });
    } catch (error) {
      setFolderOptions({ movie: [], tv: [] });
      setFolderMessage(error.response?.data?.error || "Unable to load Seerr folders. You can still reset this user to default.");
    }
  }

  async function saveFolderOverride(event) {
    event.preventDefault();
    if (!folderTarget?.UserId) return;
    setSavingFolders(true);
    setFolderMessage("");
    try {
      let movie = {};
      let tv = {};
      if (folderDraft.movieValue) movie = JSON.parse(folderDraft.movieValue);
      if (folderDraft.tvValue) tv = JSON.parse(folderDraft.tvValue);
      const response = await axios.put(
        `/api/requests/user-folders/${encodeURIComponent(folderTarget.UserId)}`,
        {
          movieRootFolder: movie.path || "",
          movieServerId: movie.serverId ?? null,
          movieSourceId: movie.sourceId || null,
          tvRootFolder: tv.path || "",
          tvServerId: tv.serverId ?? null,
          tvSourceId: tv.sourceId || null,
        },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
      setUserFoldersMap((current) => {
        const next = { ...current };
        const saved = response.data?.folders;
        if (!saved?.movieRootFolder && !saved?.tvRootFolder) delete next[folderTarget.UserId];
        else next[folderTarget.UserId] = saved;
        return next;
      });
      setFolderTarget(null);
      const synced = Number(response.data?.sync?.updated || 0);
      const syncErrors = response.data?.sync?.errors?.length || 0;
      setAlert({
        variant: syncErrors ? "warning" : "success",
        message:
          synced > 0
            ? `Request folders updated for ${folderTarget.UserName}. Updated ${synced} Seerr/Arr item${synced === 1 ? "" : "s"}${syncErrors ? ` (${syncErrors} failed)` : ""}.`
            : `Request folders saved for ${folderTarget.UserName}${syncErrors ? `, but sync reported errors` : ""}. Open approved/pending requests already matched in Seerr and Radarr/Sonarr, or none were found.`,
      });
    } catch (error) {
      setFolderMessage(error.response?.data?.error || "Unable to save request folders");
    } finally {
      setSavingFolders(false);
    }
  }

  async function toggleTrackedState(userid) {
    try {
      setSavingUserId(userid);
      const response = await axios.post(
        "/api/setUntrackedUsers",
        { userId: userid },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );

      const excluded = response.data;
      setData((currentData) =>
        currentData.map((item) => ({
          ...item,
          Tracked: !excluded.includes(item.UserId),
        }))
      );
    } catch (error) {
      setAlert({ variant: "danger", message: error.response?.data?.errorMessage || "Unable to update tracking." });
    } finally {
      setSavingUserId("");
    }
  }

  async function changeJellyfinRole(userid, role) {
    try {
      setSavingUserId(userid);
      await axios.patch(
        `/api/userRoles/${userid}`,
        { role },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
      setAccess((currentAccess) => ({
        ...currentAccess,
        jellyfinRoles: { ...(currentAccess?.jellyfinRoles || {}), [userid]: role },
      }));
      setAlert({ variant: "success", message: "Role updated." });
    } catch (error) {
      setAlert({ variant: "danger", message: error.response?.data?.errorMessage || "Unable to update role." });
    } finally {
      setSavingUserId("");
    }
  }

  async function addLocalUser(event) {
    event.preventDefault();
    try {
      const response = await axios.post(
        "/api/localUsers",
        {
          ...newLocalUser,
          password: newLocalUser.password,
        },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );

      setAccess((currentAccess) => ({
        ...currentAccess,
        localUsers: [...(currentAccess?.localUsers || []), response.data],
      }));
      setNewLocalUser({ username: "", password: "", role: "Viewer" });
      setShowAddUser(false);
      setAlert({ variant: "success", message: "Local user added." });
    } catch (error) {
      setAlert({ variant: "danger", message: error.response?.data?.errorMessage || "Unable to add local user." });
    }
  }

  async function addRole(event) {
    event.preventDefault();
    try {
      const response = await axios.post(
        "/api/roles",
        { role: newRole },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );

      setAccess((currentAccess) => ({
        ...currentAccess,
        roles: response.data.roles,
        rolePermissions: response.data.rolePermissions || currentAccess.rolePermissions,
      }));
      setNewRole("");
      setShowAddRole(false);
      setAlert({ variant: "success", message: "Role added." });
    } catch (error) {
      setAlert({ variant: "danger", message: error.response?.data?.errorMessage || "Unable to add role." });
    }
  }

  async function removeRole(role) {
    try {
      const response = await axios.delete(`/api/roles/${encodeURIComponent(role)}`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });

      setAccess((currentAccess) => ({
        ...currentAccess,
        roles: response.data.roles,
        rolePermissions: response.data.rolePermissions || currentAccess.rolePermissions,
        jellyfinRoles: Object.fromEntries(
          Object.entries(currentAccess.jellyfinRoles || {}).map(([userid, assignedRole]) => [userid, assignedRole === role ? "Viewer" : assignedRole])
        ),
        localUsers: currentAccess.localUsers.map((localUser) => ({
          ...localUser,
          role: localUser.role === role ? "Viewer" : localUser.role,
        })),
      }));
      setAlert({ variant: "success", message: "Role removed." });
    } catch (error) {
      setAlert({ variant: "danger", message: error.response?.data?.errorMessage || "Unable to remove role." });
    }
  }

  async function updateRolePermission(role, permission, enabled) {
    const nextPermissions = {
      dashboard: false,
      home: false,
      myGlance: false,
      requests: false,
      downloads: false,
      repair: false,
      users: false,
      settings: false,
      apiKeys: false,
      ...(access.rolePermissions?.[role] || {}),
      [permission]: enabled,
    };

    if (LOCKED_PERMISSION_ROLES.has(role)) return;

    try {
      const response = await axios.patch(
        `/api/roles/${encodeURIComponent(role)}/permissions`,
        { permissions: nextPermissions },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
      setAccess((currentAccess) => ({
        ...currentAccess,
        rolePermissions: {
          ...(currentAccess.rolePermissions || {}),
          [role]: response.data.permissions,
        },
      }));
    } catch (error) {
      setAlert({ variant: "danger", message: error.response?.data?.errorMessage || "Unable to update permissions." });
      await fetchAccess();
    }
  }

  async function changeLocalRole(user, role) {
    try {
      setSavingUserId(`local-${user.id}`);
      const response = await axios.patch(
        `/api/localUsers/${user.id}`,
        { role },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );

      setAccess((currentAccess) => ({
        ...currentAccess,
        localUsers: currentAccess.localUsers.map((localUser) => (localUser.id === user.id ? response.data : localUser)),
      }));
      setAlert({ variant: "success", message: "Local role updated." });
    } catch (error) {
      setAlert({ variant: "danger", message: error.response?.data?.errorMessage || "Unable to update local role." });
    } finally {
      setSavingUserId("");
    }
  }

  async function removeLocalUser(user) {
    try {
      await axios.delete(`/api/localUsers/${user.id}`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });

      setAccess((currentAccess) => ({
        ...currentAccess,
        localUsers: currentAccess.localUsers.filter((localUser) => localUser.id !== user.id),
      }));
      setDeleteTarget(null);
      setAlert({ variant: "success", message: `${user.username} deleted.` });
    } catch (error) {
      setAlert({ variant: "danger", message: error.response?.data?.errorMessage || "Unable to delete local user." });
    }
  }

  async function submitPasswordReset(event) {
    event.preventDefault();
    if (!resetPassword || resetPassword.length < 6) {
      setAlert({ variant: "danger", message: i18next.t("ERROR_MESSAGES.PASSWORD_LENGTH") });
      return;
    }

    const payload = { password: resetPassword };
    if (resetTarget.primary) {
      await axios.patch("/api/primaryLocalPassword", payload, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
    } else {
      await axios.patch(`/api/localUsers/${resetTarget.id}`, payload, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
    }

    setResetPassword("");
    setResetTarget(null);
    setAlert({ variant: "success", message: "Password reset." });
  }

  function updateViewMode(nextMode) {
    setViewMode(nextMode);
    localStorage.setItem("PREF_USERS_ViewMode", nextMode);
  }

  function updateShowHiddenUsers(nextValue) {
    setShowHiddenUsers(nextValue);
    localStorage.setItem("PREF_USERS_ShowHidden", String(nextValue));
    setPage(0);
  }

  function renderRoleControl(user) {
    if (user.IsLocalAccount && !user.IsPrimaryLocal) {
      return (
        <FormSelect className="users-role-select" value={user.Role} onChange={(event) => changeLocalRole(user.LocalUser, event.target.value)} disabled={savingUserId === `local-${user.LocalUser.id}`}>
          {access.roles.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </FormSelect>
      );
    }

    if (user.Source === "Jellyfin") {
      return (
        <FormSelect className="users-role-select" value={user.Role} onChange={(event) => changeJellyfinRole(user.UserId, event.target.value)} disabled={savingUserId === user.UserId}>
          {access.roles.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </FormSelect>
      );
    }

    return <span className="users-role-readonly">{user.Role}</span>;
  }

  function renderUserActions(user) {
    const folderButton = user.Source !== "OIDC" ? (
      <Button
        type="button"
        className={`users-row-action-button users-folder-button${hasFolderOverride(user) ? " has-override" : ""}`}
        title="Request folders"
        aria-label={`Request folders for ${user.UserName}`}
        onClick={() => openFolderModal(user)}
      >
        <Settings3LineIcon size={17} />
      </Button>
    ) : null;

    if (user.Source === "Jellyfin") {
      return (
        <div className="users-row-actions">
          {folderButton}
          <Button
            className={`users-track-button ${user.Tracked ? "is-tracked" : ""}`}
            type="button"
            onClick={() => toggleTrackedState(user.UserId)}
            disabled={savingUserId === user.UserId}
            title={user.Tracked ? "Hide user" : "Unhide user"}
            aria-label={`${user.Tracked ? "Hide" : "Unhide"} ${user.UserName}`}
            aria-pressed={!user.Tracked}
          >
            {savingUserId === user.UserId ? <Spinner size="sm" animation="border" /> : user.Tracked ? <EyeLineIcon size={20} /> : <EyeOffLineIcon size={20} />}
          </Button>
        </div>
      );
    }

    if (user.IsLocalAccount) {
      return (
        <div className="users-row-actions">
          {folderButton}
          <Button
            type="button"
            className="users-row-action-button"
            title="Reset password"
            aria-label={`Reset password for ${user.UserName}`}
            onClick={() => setResetTarget(user.IsPrimaryLocal ? { primary: true, username: user.UserName } : user.LocalUser)}
          >
            <LockPasswordLineIcon size={17} />
          </Button>
          {!user.IsPrimaryLocal ? (
            <Button
              type="button"
              className="users-row-action-button is-danger"
              title="Delete local user"
              aria-label={`Delete ${user.UserName}`}
              onClick={() => setDeleteTarget(user.LocalUser)}
            >
              <DeleteBinLineIcon size={17} />
            </Button>
          ) : null}
        </div>
      );
    }

    return <span className="users-track-placeholder" />;
  }

  if (!data || !config || !access) {
    return <Loading />;
  }

  return (
    <div className="Users users-page">
      <section className="users-hero">
        <div className="users-title-block">
          <div className="users-title-icon">
            <UserSettingsLineIcon size={26} />
          </div>
          <div>
            <p className="users-eyebrow">Access control</p>
            <h1>Users</h1>
            <p>Manage {mediaServerName()} role metadata, tracking, and local JellyGlance accounts.</p>
          </div>
        </div>
        <div className="users-header-actions">
          <Button className="users-primary-action" onClick={() => setShowUsersManager(true)}>
            <UserAddLineIcon size={17} />
            Add Users
          </Button>
          <Button className="users-primary-action" onClick={() => setShowRolesManager(true)}>
            <PriceTag3LineIcon size={17} />
            Roles
          </Button>
        </div>
      </section>

      {alert && (
        <Alert variant={alert.variant} onClose={() => setAlert(null)} dismissible>
          {alert.message}
        </Alert>
      )}

      <section className="users-stat-grid">
        <div className="users-stat-card">
          <ShieldUserLineIcon />
          <span>{mediaServerName()}</span>
          <strong>{jellyfinRows.length}</strong>
        </div>
        <div className="users-stat-card">
          <CheckFillIcon />
          <span>Tracked</span>
          <strong>{trackedCount}</strong>
        </div>
        <div className="users-stat-card">
          <UserSettingsLineIcon />
          <span>Local</span>
          <strong>{localAccountCount}</strong>
        </div>
        <div className="users-stat-card">
          <ShieldKeyholeLineIcon />
          <span>OIDC</span>
          <strong>{oidcAccountCount}</strong>
        </div>
      </section>

      <section className="users-management-grid">
        <div className="users-panel users-table-panel">
          <div className="users-panel-header">
            <div>
              <h2>JellyGlance Users</h2>
              <p>{formatWatchTime(totalWatchTime)} watched across synced users.</p>
            </div>
            <div className="users-toolbar">
              <div className="users-view-toggle" role="group" aria-label="User view">
                <button type="button" className={viewMode === "cards" ? "is-active" : ""} onClick={() => updateViewMode("cards")}>
                  Cards
                </button>
                <button type="button" className={viewMode === "list" ? "is-active" : ""} onClick={() => updateViewMode("list")}>
                  List
                </button>
              </div>
              <div className="users-search">
                <SearchLineIcon size={17} />
                <FormControl type="text" placeholder="Search users, media, clients" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
              </div>
              <FormSelect value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                <option value="All">All roles</option>
                {access.roles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </FormSelect>
              <FormSelect value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                <option value="All">All accounts</option>
                <option value="Jellyfin">{mediaServerName()}</option>
                <option value="OIDC">OIDC</option>
                <option value="Local">Local</option>
              </FormSelect>
              <FormSelect
                value={rowsPerPage}
                onChange={(event) => {
                  const value = parseInt(event.target.value);
                  setRowsPerPage(value);
                  localStorage.setItem("PREF_USER_ACTIVITY_ItemCount", value);
                  setPage(0);
                }}
              >
                <option value="10">10 per page</option>
                <option value="25">25 per page</option>
                <option value="50">50 per page</option>
              </FormSelect>
              <label className="users-hidden-toggle">
                <Form.Check type="switch" checked={showHiddenUsers} onChange={(event) => updateShowHiddenUsers(event.target.checked)} />
                <span>Show hidden</span>
                <small>{hiddenUserCount}</small>
              </label>
            </div>
          </div>

          {viewMode === "cards" ? (
            <div className="users-profile-grid">
              {visibleRows.map((user) => (
                <article className={`users-profile-card ${user.Source !== "Jellyfin" ? "is-account-card" : ""} ${!user.Tracked && user.Source === "Jellyfin" ? "is-hidden-user" : ""}`} key={user.AccountId}>
                  <div className="users-profile-top">
                    {userImage(user, 48)}
                    <div className="users-profile-actions">
                      {renderUserActions(user)}
                    </div>
                  </div>
                  <div className="users-profile-name">
                    {user.Source === "Jellyfin" ? <Link to={`/users/${user.UserId}`}>{user.UserName}</Link> : <strong>{user.UserName}</strong>}
                    <span>{user.SourceLabel}</span>
                  </div>
                  <div className="users-profile-badges">
                    <Badge className={`users-role-badge ${roleClass(user.Role)}`}>{user.Role}</Badge>
                    <Badge className={`users-source-badge ${sourceClass(user.Source)}`}>{user.Source}</Badge>
                    {user.IsAdministrator && user.Role !== "Admin" ? <Badge className="users-source-badge source-admin">Jellyfin admin</Badge> : null}
                    {user.Source === "Jellyfin" && !user.Tracked ? <Badge className="users-source-badge source-hidden">Hidden</Badge> : null}
                  </div>
                  <div className="users-profile-metrics">
                    <span title={formatWatchTime(user.TotalWatchTime)}>
                      <small>Watch time</small>
                      <strong>{formatWatchTimeShort(user.TotalWatchTime)}</strong>
                    </span>
                    <span title={user.LastWatched || "Never"}>
                      <small>Watched</small>
                      <strong className="is-wrap">{user.LastWatched || "Never"}</strong>
                    </span>
                    <span title={user.LastClient || ""}>
                      <small>Client</small>
                      <strong>{user.LastClient ? shortClientName(user.LastClient) : "—"}</strong>
                    </span>
                    <span>
                      <small>{user.IsRunning ? "Watching now" : "Last seen"}</small>
                      <strong>{user.IsRunning ? "Running" : formatLastSeen(user.LastSeen)}</strong>
                    </span>
                  </div>
                  <div className="users-profile-role">
                    {renderRoleControl(user)}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="users-list">
              {visibleRows.map((user) => (
                <article className={`users-row-card ${user.Source !== "Jellyfin" ? "is-account-row" : ""} ${!user.Tracked && user.Source === "Jellyfin" ? "is-hidden-user" : ""}`} key={user.AccountId}>
                  <div className="users-row-person">
                    {userImage(user, 54)}
                    <div>
                      {user.Source === "Jellyfin" ? <Link to={`/users/${user.UserId}`}>{user.UserName}</Link> : <strong>{user.UserName}</strong>}
                      <span>{user.SourceLabel}</span>
                    </div>
                  </div>

                  <div className="users-row-metrics">
                    <div className="users-row-meta">
                      <span>Last watched</span>
                      <strong>{user.LastWatched || "Never"}</strong>
                    </div>
                    <div className="users-row-meta">
                      <span>Client</span>
                      <strong>{user.LastClient || "N/A"}</strong>
                    </div>
                    <div className="users-row-meta">
                      <span>Watch time</span>
                      <strong>{formatWatchTime(user.TotalWatchTime)}</strong>
                    </div>
                    <div className="users-row-meta">
                      <span>{user.IsRunning ? "Watching now" : "Last seen"}</span>
                      <strong>{user.IsRunning ? "Running" : formatLastSeen(user.LastSeen)}</strong>
                    </div>
                  </div>

                  <div className="users-row-badges">
                    <Badge className={`users-role-badge ${roleClass(user.Role)}`}>{user.Role}</Badge>
                    <Badge className={`users-source-badge ${sourceClass(user.Source)}`}>{user.Source}</Badge>
                    {user.IsAdministrator && user.Role !== "Admin" ? <Badge className="users-source-badge source-admin">Jellyfin admin</Badge> : null}
                    {user.Source === "Jellyfin" && !user.Tracked ? <Badge className="users-source-badge source-hidden">Hidden</Badge> : null}
                  </div>

                  {renderRoleControl(user)}
                  {renderUserActions(user)}
                </article>
              ))}
            </div>
          )}

          {!visibleRows.length ? <div className="users-empty-state">No users match this view.</div> : null}

          <div className="users-pagination">
            <span>
              {filteredRows.length ? page * rowsPerPage + 1 : 0}-{Math.min(page * rowsPerPage + rowsPerPage, filteredRows.length)} of {filteredRows.length}
            </span>
            <ButtonGroup>
              <Button onClick={() => setPage(0)} disabled={page === 0}>
                First
              </Button>
              <Button onClick={() => setPage((currentPage) => Math.max(currentPage - 1, 0))} disabled={page === 0}>
                Previous
              </Button>
              <Button onClick={() => setPage((currentPage) => currentPage + 1)} disabled={page >= Math.ceil(filteredRows.length / rowsPerPage) - 1}>
                Next
              </Button>
            </ButtonGroup>
          </div>
        </div>

        <aside className="users-panel users-access-panel">
          <div className="users-panel-header compact">
            <div>
              <h2>Permissions</h2>
              <p>Role access is saved to the backend and checked on protected API routes.</p>
            </div>
            <Button className="users-primary-action" onClick={() => setShowRolesManager(true)}>
              <PriceTag3LineIcon size={17} />
              Roles
            </Button>
          </div>

          <div className="users-role-selector">
            <span>Editing role</span>
            <FormSelect value={previewRole} onChange={(event) => setPreviewRole(event.target.value)}>
              {access.roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </FormSelect>
          </div>

          <div className="users-permission-editor">
            {PERMISSION_DEFINITIONS.map((permission) => (
              <label className={`users-permission-row ${selectedRolePermissions[permission.key] ? "is-enabled" : ""}`} key={permission.key}>
                <span>
                  <strong>{permission.label}</strong>
                  <small>{permission.detail}</small>
                </span>
                <Form.Check
                  type="switch"
                  checked={Boolean(selectedRolePermissions[permission.key])}
                  disabled={selectedRoleLocked}
                  onChange={(event) => updateRolePermission(previewRole, permission.key, event.target.checked)}
                  aria-label={`${permission.label} permission for ${previewRole}`}
                />
              </label>
            ))}
          </div>

          {selectedRoleLocked ? (
            <p className="users-permission-note">{previewRole === "Owner" ? "Owner always keeps full access." : "Disabled users cannot access JellyGlance."}</p>
          ) : (
            <p className="users-permission-note">Changes save immediately and apply the next time that user calls a protected route.</p>
          )}
        </aside>
      </section>

      <Modal show={showUsersManager} onHide={() => setShowUsersManager(false)} centered size="lg" contentClassName="users-modal users-manager-modal">
        <Modal.Header closeButton>
          <Modal.Title>Local Users</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="users-modal-topline">
            <div>
              <strong>JellyGlance accounts</strong>
              <span>{(access.localUsers?.length || 0) + (access.primaryLocalUser ? 1 : 0)} accounts</span>
            </div>
            <Button className="users-primary-action" onClick={() => setShowAddUser(true)}>
              <UserAddLineIcon size={17} />
              Add User
            </Button>
          </div>

          <div className="local-users-modal-list">
            {access.primaryLocalUser && (
              <article className="local-user-card is-primary">
                <div>
                  <strong>{access.primaryLocalUser}</strong>
                  <span>Primary local account</span>
                </div>
                <Badge className="users-role-badge role-owner">Owner</Badge>
                <Button variant="outline-primary" onClick={() => setResetTarget({ primary: true, username: access.primaryLocalUser })}>
                  Reset
                </Button>
              </article>
            )}

            {access.localUsers.map((user) => (
              <article className="local-user-card" key={user.id}>
                <div>
                  <strong>{user.username}</strong>
                  <span>Local JellyGlance user</span>
                </div>
                <FormSelect value={user.role} onChange={(event) => changeLocalRole(user, event.target.value)}>
                  {access.roles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </FormSelect>
                <div className="local-user-actions">
                  <Button variant="outline-primary" onClick={() => setResetTarget(user)}>
                    Reset
                  </Button>
                  <Button variant="outline-danger" onClick={() => setDeleteTarget(user)}>
                    Remove
                  </Button>
                </div>
              </article>
            ))}
          </div>

          {!access.localUsers.length && <div className="users-empty-state">No extra local users yet.</div>}
        </Modal.Body>
      </Modal>

      <Modal show={showRolesManager} onHide={() => setShowRolesManager(false)} centered size="lg" contentClassName="users-modal users-manager-modal">
        <Modal.Header closeButton>
          <Modal.Title>Roles</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="users-modal-topline">
            <div>
              <strong>Role permissions</strong>
              <span>{access.roles.length} roles</span>
            </div>
            <Button className="users-primary-action" onClick={() => setShowAddRole(true)}>
              <PriceTag3LineIcon size={17} />
              Add New Role
            </Button>
          </div>

          <div className="role-preview-panel">
            <div>
              <strong>Preview as</strong>
              <FormSelect value={previewRole} onChange={(event) => setPreviewRole(event.target.value)}>
                {access.roles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </FormSelect>
            </div>
            <div className="role-preview-grid">
              {PERMISSION_DEFINITIONS.map((permission) => (
                <span key={permission.key} className={previewPermissions[permission.key] ? "is-allowed" : "is-denied"}>
                  {previewPermissions[permission.key] ? <CheckFillIcon size={14} /> : <CloseFillIcon size={14} />}
                  {permission.label}
                </span>
              ))}
            </div>
          </div>

          <div className="roles-manager">
            <div className="roles-permission-list">
              {access.roles.map((role) => (
                <article className="role-permission-card" key={role}>
                  <div className="role-permission-title">
                    <Badge className={`users-role-badge ${roleClass(role)}`}>{role}</Badge>
                    {!["Owner", "Admin", "Manager", "Viewer", "Household", "Disabled"].includes(role) && (
                      <button type="button" onClick={() => removeRole(role)} aria-label={`Remove ${role}`}>
                        <CloseFillIcon size={14} />
                      </button>
                    )}
                  </div>
                  <div className="permission-toggle-grid">
                    {PERMISSION_DEFINITIONS.map((permission) => (
                      <Form.Check
                        key={permission.key}
                        type="switch"
                        id={`role-${role}-${permission.key}`}
                        label={permission.label}
                        checked={Boolean(access.rolePermissions?.[role]?.[permission.key])}
                        disabled={LOCKED_PERMISSION_ROLES.has(role)}
                        onChange={(event) => updateRolePermission(role, permission.key, event.target.checked)}
                      />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </Modal.Body>
      </Modal>

      <Modal show={showAddUser} onHide={() => setShowAddUser(false)} centered contentClassName="users-modal">
        <Form onSubmit={addLocalUser}>
          <Modal.Header closeButton>
            <Modal.Title>Add local user</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>Username</Form.Label>
              <Form.Control value={newLocalUser.username} onChange={(event) => setNewLocalUser({ ...newLocalUser, username: event.target.value })} required />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Password</Form.Label>
              <Form.Control
                type="password"
                minLength={6}
                value={newLocalUser.password}
                onChange={(event) => setNewLocalUser({ ...newLocalUser, password: event.target.value })}
                required
              />
            </Form.Group>
            <Form.Group>
              <Form.Label>Role</Form.Label>
              <FormSelect value={newLocalUser.role} onChange={(event) => setNewLocalUser({ ...newLocalUser, role: event.target.value })}>
                {access.roles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </FormSelect>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setShowAddUser(false)}>
              Cancel
            </Button>
            <Button type="submit" className="users-primary-action">
              Add User
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={showAddRole} onHide={() => setShowAddRole(false)} centered contentClassName="users-modal">
        <Form onSubmit={addRole}>
          <Modal.Header closeButton>
            <Modal.Title>Add new role</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group>
              <Form.Label>Role name</Form.Label>
              <Form.Control value={newRole} onChange={(event) => setNewRole(event.target.value)} placeholder="Technician, Family, Read only..." required />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setShowAddRole(false)}>
              Cancel
            </Button>
            <Button type="submit" className="users-primary-action" disabled={!newRole.trim()}>
              Add New Role
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={Boolean(folderTarget)} onHide={() => setFolderTarget(null)} centered contentClassName="users-modal">
        <Form onSubmit={saveFolderOverride}>
          <Modal.Header closeButton>
            <Modal.Title>Request folders</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p className="users-modal-copy">
              Override Seerr movie and TV root folders for {folderTarget?.UserName}. Leave as default to use the Seerr / Radarr / Sonarr folder.
            </p>
            {folderMessage ? <Alert variant="warning">{folderMessage}</Alert> : null}
            <Form.Group className="mb-3">
              <Form.Label>Films folder</Form.Label>
              <FormSelect value={folderDraft.movieValue} onChange={(event) => setFolderDraft((current) => ({ ...current, movieValue: event.target.value }))}>
                <option value="">Seerr default</option>
                {(folderOptions.movie || []).map((option) => (
                  <option key={`movie-${option.sourceId}-${option.serverId}-${option.path}`} value={folderOptionValue(option)}>
                    {option.label}
                  </option>
                ))}
                {folderDraft.movieValue && !(folderOptions.movie || []).some((option) => folderOptionValue(option) === folderDraft.movieValue) ? (
                  <option value={folderDraft.movieValue}>{folderDraftLabel(folderDraft.movieValue)}</option>
                ) : null}
              </FormSelect>
            </Form.Group>
            <Form.Group>
              <Form.Label>TV folder</Form.Label>
              <FormSelect value={folderDraft.tvValue} onChange={(event) => setFolderDraft((current) => ({ ...current, tvValue: event.target.value }))}>
                <option value="">Seerr default</option>
                {(folderOptions.tv || []).map((option) => (
                  <option key={`tv-${option.sourceId}-${option.serverId}-${option.path}`} value={folderOptionValue(option)}>
                    {option.label}
                  </option>
                ))}
                {folderDraft.tvValue && !(folderOptions.tv || []).some((option) => folderOptionValue(option) === folderDraft.tvValue) ? (
                  <option value={folderDraft.tvValue}>{folderDraftLabel(folderDraft.tvValue)}</option>
                ) : null}
              </FormSelect>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setFolderTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" className="users-primary-action" disabled={savingFolders}>
              {savingFolders ? "Saving..." : "Save folders"}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!resetTarget} onHide={() => setResetTarget(null)} centered contentClassName="users-modal">
        <Form onSubmit={submitPasswordReset}>
          <Modal.Header closeButton>
            <Modal.Title>Reset password</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p className="users-modal-copy">Set a new local password for {resetTarget?.username}.</p>
            <Form.Control
              type="password"
              minLength={6}
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
              placeholder="New password"
              required
            />
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setResetTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" className="users-primary-action">
              Reset Password
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!deleteTarget} onHide={() => setDeleteTarget(null)} centered contentClassName="users-modal">
        <Modal.Header closeButton>
          <Modal.Title>Delete local user</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="users-modal-copy">
            Delete {deleteTarget?.username}? This removes the local JellyGlance account only.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => removeLocalUser(deleteTarget)}>
            Delete User
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
