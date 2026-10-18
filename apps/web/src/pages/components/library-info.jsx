import { useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import axios from "../../lib/axios_instance";
import BarChartBoxLineIcon from "remixicon-react/BarChartBoxLineIcon";
import HistoryLineIcon from "remixicon-react/HistoryLineIcon";
import Settings3LineIcon from "remixicon-react/Settings3LineIcon";
import StackLineIcon from "remixicon-react/StackLineIcon";

// import LibraryDetails from './library/library-details';
import Loading from "./general/loading";
import LibraryLastWatched from "./library/last-watched";
import RecentlyAdded from "./library/recently-added";
import LibraryActivity from "./library/library-activity";
import LibraryItems from "./library/library-items";
import ErrorBoundary from "./general/ErrorBoundary";

import { Tabs, Tab, Button, ButtonGroup } from "react-bootstrap";
import { Trans } from "react-i18next";
import LibraryOptions from "./library/library-options";
import GlobalStats from "./general/globalStats";
import GenreLibraryStats from "./library/genre-library-stats.jsx";
import "../css/library-detail.css";
import { libraryTypeMeta } from "../../lib/library-types";

function LibraryInfo() {
  const { LibraryId } = useParams();
  const [activeTab, setActiveTab] = useState(
    localStorage.getItem(`PREF_LIBRARY_TAB_LAST_SELECTED_${LibraryId}`) ?? "tabOverview"
  );
  const [data, setData] = useState();
  const token = localStorage.getItem("token");

  function setTab(tabName) {
    setActiveTab(tabName);
    localStorage.setItem(`PREF_LIBRARY_TAB_LAST_SELECTED_${LibraryId}`, tabName);
  }

  useEffect(() => {
    const fetchData = async () => {
      try {
        const libraryrData = await axios.post(
          `/api/getLibrary`,
          {
            libraryid: LibraryId,
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );
        setData(libraryrData.data);
      } catch (error) {
        console.log(error);
      }
    };

    fetchData();

    const intervalId = setInterval(fetchData, 60000 * 5);
    return () => clearInterval(intervalId);
  }, [LibraryId, token]);

  if (!data) {
    return <Loading />;
  }

  const tabs = [
    { key: "tabOverview", label: <Trans i18nKey="TAB_CONTROLS.OVERVIEW" />, icon: BarChartBoxLineIcon },
    { key: "tabItems", label: <Trans i18nKey="MEDIA" />, icon: StackLineIcon },
    { key: "tabActivity", label: <Trans i18nKey="TAB_CONTROLS.ACTIVITY" />, icon: HistoryLineIcon },
    { key: "tabOptions", label: <Trans i18nKey="TAB_CONTROLS.OPTIONS" />, icon: Settings3LineIcon },
  ];
  const libraryMeta = libraryTypeMeta(data.CollectionType);
  const LibraryIcon = libraryMeta.icon;
  const libraryType = libraryMeta.label;

  return (
    <div className="library-detail-page">
      <section className="library-detail-hero">
        <div className="library-detail-icon">
          <LibraryIcon size={48} />
        </div>
        <div className="library-detail-title">
          <span>{libraryType}</span>
          <h1>{data.Name}</h1>
          <ButtonGroup className="library-detail-tabs">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <Button
                  key={tab.key}
                  onClick={() => setTab(tab.key)}
                  active={activeTab === tab.key}
                  variant="outline-primary"
                  type="button"
                >
                  <Icon size={16} />
                  {tab.label}
                </Button>
              );
            })}
          </ButtonGroup>
        </div>
      </section>

      <Tabs defaultActiveKey={activeTab} activeKey={activeTab} variant="pills" className="hide-tab-titles">
        <Tab eventKey="tabOverview" title="Overview" className="bg-transparent">
          <div className="library-detail-overview">
            <GlobalStats
              id={LibraryId}
              param={"libraryid"}
              endpoint={"getGlobalLibraryStats"}
              title={<Trans i18nKey="LIBRARY_INFO.LIBRARY_STATS" />}
            />

            <GenreLibraryStats LibraryId={LibraryId} />

            {!data.archived && (
              <ErrorBoundary>
                <RecentlyAdded LibraryId={LibraryId} />
              </ErrorBoundary>
            )}

            <LibraryLastWatched LibraryId={LibraryId} />
          </div>
        </Tab>
        <Tab eventKey="tabItems" title="Items" className="bg-transparent">
          <LibraryItems LibraryId={LibraryId} />
        </Tab>
        <Tab eventKey="tabActivity" title="Activity" className="bg-transparent">
          <LibraryActivity LibraryId={LibraryId} />
        </Tab>
        <Tab eventKey="tabOptions" title="Options" className="bg-transparent">
          <LibraryOptions LibraryId={LibraryId} isArchived={data.archived} />
        </Tab>
      </Tabs>
    </div>
  );
}
export default LibraryInfo;
