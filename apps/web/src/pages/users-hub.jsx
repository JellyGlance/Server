import { lazy } from "react";
import { Link, Navigate } from "react-router-dom";
import UserLineIcon from "remixicon-react/UserLineIcon";
import UserAddLineIcon from "remixicon-react/UserAddLineIcon";
import PageTabs, { readAuth, readNavAvailability } from "./components/general/PageTabs";
import "./css/home-user-wrap.css";

const Users = lazy(() => import("./users"));
const Wizarr = lazy(() => import("./wizarr"));

function readOwnUserId() {
  try {
    const config = JSON.parse(localStorage.getItem("config") || "{}");
    const auth = config?.settings?.auth || {};
    if (!["quick-connect", "oidc"].includes(auth.mode)) return "";
    return String(auth.jellyfinUser?.id || auth.jellyfinUser?.Id || "");
  } catch {
    return "";
  }
}

export default function UsersHub() {
  const { permissions } = readAuth();
  const tabs = [
    { id: "users", label: "Users", icon: UserLineIcon, visible: Boolean(permissions.users), render: () => <Users /> },
    { id: "invites", label: "Invites", icon: UserAddLineIcon, visible: readNavAvailability("jellyglance_wizarr_nav_available"), render: () => <Wizarr /> },
  ];

  // Without the Users permission there's nothing to list, so send people to their own profile.
  if (!tabs.some((tab) => tab.visible)) {
    const ownId = readOwnUserId();
    if (ownId) {
      return <Navigate to={`/users/${encodeURIComponent(ownId)}`} replace />;
    }
    return (
      <div className="user-profile-page">
        <section className="user-profile-empty">
          <h1>Users not available</h1>
          <p>The user list is only available to admins.</p>
          <Link to="/me">Go to My Glance</Link>
        </section>
      </div>
    );
  }

  return <PageTabs title="Users" tabs={tabs} />;
}
