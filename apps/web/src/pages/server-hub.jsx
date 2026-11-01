import { lazy } from "react";
import ServerLineIcon from "remixicon-react/ServerLineIcon";
import RadarLineIcon from "remixicon-react/RadarLineIcon";
import Database2LineIcon from "remixicon-react/Database2LineIcon";
import HeadphoneLineIcon from "remixicon-react/HeadphoneLineIcon";
import TerminalBoxLineIcon from "remixicon-react/TerminalBoxLineIcon";
import PageTabs, { readAuth, readNavAvailability } from "./components/general/PageTabs";

const ServerManagement = lazy(() => import("./server-management"));
const AutomationHealth = lazy(() => import("./automation-health"));
const Maintainerr = lazy(() => import("./maintainerr"));
const Audiobookshelf = lazy(() => import("./audiobookshelf"));
const OpsCopilot = lazy(() => import("./ops-copilot"));

export default function ServerHub() {
  const { isAdmin } = readAuth();
  const tabs = [
    { id: "jobs", label: "Server Jobs", icon: ServerLineIcon, visible: isAdmin, render: () => <ServerManagement /> },
    { id: "ops-copilot", label: "Ops Copilot", icon: TerminalBoxLineIcon, visible: isAdmin, render: () => <OpsCopilot /> },
    { id: "automation", label: "Automation Health", icon: RadarLineIcon, visible: readNavAvailability("jellyglance_automation_health_nav_available"), render: () => <AutomationHealth /> },
    { id: "maintainerr", label: "Maintainerr", icon: Database2LineIcon, visible: readNavAvailability("jellyglance_maintainerr_nav_available"), render: () => <Maintainerr /> },
    { id: "audiobooks", label: "Audiobooks", icon: HeadphoneLineIcon, visible: readNavAvailability("jellyglance_audiobookshelf_nav_available"), render: () => <Audiobookshelf /> },
  ];
  return <PageTabs title="Server" tabs={tabs} />;
}
