import { useEffect, useState } from "react";
import { Trans } from "react-i18next";
import ActivityTimelineComponent from "./components/activity-timeline/activity-timeline";

import { Button, FormSelect, Modal } from "react-bootstrap";
import axios from "../lib/axios_instance.jsx";
import Loading from "./components/general/loading";
import LibraryFilterModal from "./components/library/library-filter-modal";
import "./css/timeline/activity-timeline.css";

function readStoredLibraries() {
  const stored = localStorage.getItem("PREF_ACTIVITY_TIMELINE_selectedLibraries");
  if (stored == null) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function ActivityTimeline(props) {
  const { preselectedUser } = props;
  const [users, setUsers] = useState();
  const [selectedUser, setSelectedUser] = useState(
    preselectedUser ?? localStorage.getItem("PREF_ACTIVITY_TIMELINE_selectedUser") ?? ""
  );
  const [libraries, setLibraries] = useState();
  const [showLibraryFilters, setShowLibraryFilters] = useState(false);
  const [selectedLibraries, setSelectedLibraries] = useState(readStoredLibraries);

  const handleLibraryFilter = (selectedOptions) => {
    setSelectedLibraries(selectedOptions);
    localStorage.setItem("PREF_ACTIVITY_TIMELINE_selectedLibraries", JSON.stringify(selectedOptions));
  };
  const handleUserSelection = (nextUser) => {
    setSelectedUser(nextUser);
    localStorage.setItem("PREF_ACTIVITY_TIMELINE_selectedUser", nextUser);
  };

  const toggleSelectAll = () => {
    const allLibraryIds = (libraries || []).map((library) => library.Id);
    const currentlySelected = selectedLibraries ?? allLibraryIds;
    if (currentlySelected.length > 0) {
      setSelectedLibraries([]);
      localStorage.setItem("PREF_ACTIVITY_TIMELINE_selectedLibraries", JSON.stringify([]));
      return;
    }

    setSelectedLibraries(allLibraryIds);
    localStorage.setItem("PREF_ACTIVITY_TIMELINE_selectedLibraries", JSON.stringify(allLibraryIds));
  };

  useEffect(() => {
    if (preselectedUser) {
      return;
    }

    axios
      .get("/api/getTimelineUsers")
      .then((response) => {
        const nextUsers = response.data || [];
        setUsers(nextUsers);
        // A remembered choice may be someone this account can no longer see, so fall back to the first entry.
        setSelectedUser((current) => (nextUsers.some((user) => user.UserId === current) ? current : nextUsers[0]?.UserId || ""));
      })
      .catch((error) => {
        console.log(error);
        setUsers([]);
      });
  }, [preselectedUser]);

  useEffect(() => {
    axios
      .get("/api/getLibraries")
      .then((response) => {
        const nextLibraries = (response.data || [])
          .filter((library) => !library.archived)
          .map((library) => ({ Id: library.Id, Name: library.Name }));
        setLibraries(nextLibraries);
      })
      .catch((error) => {
        console.log(error);
        setLibraries([]);
      });
  }, []);

  const noneSelected = Array.isArray(selectedLibraries) && selectedLibraries.length === 0;
  const canLoadTimeline = Boolean(selectedUser) && !noneSelected;
  const checkedLibraries = selectedLibraries ?? (libraries || []).map((library) => library.Id);

  return (
    <div className="watch-stats">
      <div className="Heading">
        <h1>
          <Trans i18nKey={"TIMELINE_PAGE.TIMELINE"} />
        </h1>
        <div className="d-flex flex-column flex-sm-row" style={{ whiteSpace: "nowrap" }}>
          <div className="user-selection">
            <div className="d-flex flex-row w-100 ms-sm-3 w-sm-100 w-sm-75 mb-3 my-sm-1">
              {!preselectedUser && (
                <>
                  <div className="d-flex flex-col rounded-0 rounded-start  align-items-center px-2 bg-primary-1">
                    <Trans i18nKey="USER" />
                  </div>
                  <FormSelect
                    onChange={(e) => handleUserSelection(e.target.value)}
                    value={selectedUser}
                    className="w-sm-75 rounded-0 rounded-end"
                    disabled={!users?.length}
                  >
                    {(users || []).map((user) => (
                      <option key={user.UserId} value={user.UserId}>
                        {user.UserName}
                      </option>
                    ))}
                  </FormSelect>
                </>
              )}
            </div>
          </div>
          <div className="library-selection d-flex flex-column flex-sm-row">
            <Button onClick={() => setShowLibraryFilters(true)} className="ms-sm-3 mb-3 my-sm-1" disabled={!libraries?.length}>
              <Trans i18nKey="MENU_TABS.LIBRARIES" />
            </Button>

            <Modal show={showLibraryFilters} onHide={() => setShowLibraryFilters(false)}>
              <Modal.Header>
                <Modal.Title>
                  <Trans i18nKey="MENU_TABS.LIBRARIES" />
                </Modal.Title>
              </Modal.Header>
              <LibraryFilterModal
                libraries={libraries}
                selectedLibraries={checkedLibraries}
                onSelectionChange={handleLibraryFilter}
              />
              <Modal.Footer>
                <Button variant="outline-primary" onClick={toggleSelectAll}>
                  <Trans i18nKey="ACTIVITY_TABLE.TOGGLE_SELECT_ALL" />
                </Button>
                <Button variant="outline-primary" onClick={() => setShowLibraryFilters(false)}>
                  <Trans i18nKey="CLOSE" />
                </Button>
              </Modal.Footer>
            </Modal>
          </div>
        </div>
      </div>
      <div>
        {canLoadTimeline ? (
          <ActivityTimelineComponent userId={selectedUser} libraries={selectedLibraries} />
        ) : selectedLibraries?.length === 0 ? (
          <div className="activity-timeline-empty">Select at least one library to load the timeline.</div>
        ) : Array.isArray(users) && users.length === 0 ? (
          <div className="activity-timeline-empty">No timeline activity to show yet.</div>
        ) : (
          <Loading />
        )}
      </div>
    </div>
  );
}

export default ActivityTimeline;
