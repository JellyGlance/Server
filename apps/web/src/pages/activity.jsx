import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

import axios from "../lib/axios_instance";

import "./css/activity.css";
import Config from "../lib/config";

import ActivityTable from "./components/activity/activity-table";
import Loading from "./components/general/loading";
import { Trans } from "react-i18next";
import { Button, FormControl, FormSelect, Modal } from "react-bootstrap";
import i18next from "i18next";
import LibraryFilterModal from "./components/library/library-filter-modal";
import socket from "../socket";

function readActivityPreference(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function Activity() {
  const [data, setData] = useState();
  const [config, setConfig] = useState(null);
  const [streamTypeFilter, setStreamTypeFilter] = useState(localStorage.getItem("PREF_ACTIVITY_StreamTypeFilter") ?? "All");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
  const [itemCount, setItemCount] = useState(parseInt(localStorage.getItem("PREF_ACTIVITY_ItemCount") ?? "10"));
  const [libraryFilters, setLibraryFilters] = useState(
    () => {
      const stored = readActivityPreference("PREF_ACTIVITY_libraryFilters", []);
      return Array.isArray(stored) ? stored : [];
    }
  );
  const [libraries, setLibraries] = useState([]);
  const [showLibraryFilters, setShowLibraryFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [sorting, setSorting] = useState({ column: "ActivityDateInserted", desc: true });
  const [filterParams, setFilterParams] = useState([]);
  const [isBusy, setIsBusy] = useState(false);

  const handlePageChange = (newPage) => {
    setCurrentPage((currentPage) => (currentPage === newPage ? currentPage : newPage));
  };

  const onSortChange = (sort) => {
    setSorting((currentSort) => {
      if (currentSort.column === sort.column && currentSort.desc === sort.desc) {
        return currentSort;
      }
      return { column: sort.column, desc: sort.desc };
    });
  };

  const onFilterChange = (filter) => {
    setFilterParams((currentFilters) => (JSON.stringify(currentFilters) === JSON.stringify(filter) ? currentFilters : filter));
  };

  function setItemLimit(limit) {
    setItemCount(parseInt(limit));
    localStorage.setItem("PREF_ACTIVITY_ItemCount", limit);
  }

  function setTypeFilterParam(filter) {
    const type = config?.IS_JELLYFIN ? filter : filter.replace("Play", "Stream");
    const params = [...filterParams];
    const playMethodFilterIndex = params.findIndex((filter) => filter.field === "PlayMethod");
    if (playMethodFilterIndex !== -1) {
      params[playMethodFilterIndex].value = type;
    } else {
      params.push({ field: "PlayMethod", value: type });
    }
    if (filter == "All") {
      const playMethodFilterIndex = params.findIndex((filter) => filter.field === "PlayMethod");
      if (playMethodFilterIndex !== -1) {
        params.splice(playMethodFilterIndex, 1);
      }
    }
    setFilterParams(params);
  }

  function setTypeFilter(filter) {
    setStreamTypeFilter(filter);
    localStorage.setItem("PREF_ACTIVITY_StreamTypeFilter", filter);
    setTypeFilterParam(filter);
  }

  const updateLibraryFilterParams = (selectedLibraries) => {
    const params = [...filterParams];
    const selectedAllLibraries =
      libraries.length > 0 &&
      selectedLibraries.length === libraries.length &&
      libraries.every((library) => selectedLibraries.includes(library.Id));
    if (selectedAllLibraries) {
      setFilterParams(params.filter((filter) => filter.field !== "ParentId"));
      return;
    }

    if (selectedLibraries.length != 0) {
      const libraryFilterIndex = params.findIndex((filter) => filter.field === "ParentId");
      if (libraryFilterIndex !== -1) {
        params[libraryFilterIndex].in = selectedLibraries.join(",");
      } else {
        params.push({ field: "ParentId", in: selectedLibraries.join(",") });
      }
    } else {
      const libraryFilterIndex = params.findIndex((filter) => filter.field === "ParentId");
      if (libraryFilterIndex !== -1) {
        params[libraryFilterIndex].in = "no_libraries";
      } else {
        params.push({ field: "ParentId", in: "no_libraries" });
      }
    }
    setFilterParams(params);
  };

  const handleLibraryFilter = (selectedOptions) => {
    setLibraryFilters(selectedOptions);
    localStorage.setItem("PREF_ACTIVITY_libraryFilters", JSON.stringify(selectedOptions));
    updateLibraryFilterParams(selectedOptions);
  };

  const allLibrariesSelected =
    libraries.length > 0 &&
    libraryFilters.length === libraries.length &&
    libraries.every((library) => libraryFilters.includes(library.Id));

  const toggleSelectAll = () => {
    if (libraryFilters.length > 0) {
      setLibraryFilters([]);
      localStorage.setItem("PREF_ACTIVITY_libraryFilters", JSON.stringify([]));
      updateLibraryFilterParams([]);
    } else {
      setLibraryFilters(libraries.map((library) => library.Id));
      localStorage.setItem("PREF_ACTIVITY_libraryFilters", JSON.stringify(libraries.map((library) => library.Id)));
      updateLibraryFilterParams(libraries.map((library) => library.Id));
    }
  };

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300); // Adjust the delay as needed

    return () => {
      clearTimeout(handler);
    };
  }, [searchQuery]);

  useEffect(() => {
    const handleRestoredData = () => {
      localStorage.removeItem("PREF_ACTIVITY_libraryFilters");
      setLibraryFilters([]);
      setLibraries([]);
      setFilterParams((currentFilters) => currentFilters.filter((filter) => filter.field !== "ParentId"));
      setCurrentPage(1);
      setData(undefined);
      Config.getConfig(true)
        .then((newConfig) => {
          if (!newConfig?.response) {
            setConfig(newConfig);
          }
        })
        .catch((error) => console.log(error));
    };

    const handleImportedData = () => {
      setCurrentPage(1);
      setData(undefined);
    };

    window.addEventListener("jellyglance-backup-restored", handleRestoredData);
    window.addEventListener("jellyglance-history-imported", handleImportedData);
    socket.on("BackupRestore", handleRestoredData);

    return () => {
      window.removeEventListener("jellyglance-backup-restored", handleRestoredData);
      window.removeEventListener("jellyglance-history-imported", handleImportedData);
      socket.off("BackupRestore", handleRestoredData);
    };
  }, []);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const newConfig = await Config.getConfig();
        setConfig(newConfig);
      } catch (error) {
        if (error.code === "ERR_NETWORK") {
          console.log(error);
        }
      }
    };

    if (!config) {
      fetchConfig();
      return;
    }

    const requestFilters = [...filterParams].filter((filter) => filter.field !== "ParentId");
    if (libraries.length > 0 && libraryFilters.length != 0 && !allLibrariesSelected) {
      const libraryFilterIndex = requestFilters.findIndex((filter) => filter.field === "ParentId");
      if (libraryFilterIndex !== -1) {
        requestFilters[libraryFilterIndex].in = libraryFilters.join(",");
      } else {
        requestFilters.push({ field: "ParentId", in: libraryFilters.join(",") });
      }
    }

    if (streamTypeFilter != "All") {
      const streamTypeFilterIndex = requestFilters.findIndex((filter) => filter.field === "PlayMethod");
      if (streamTypeFilterIndex !== -1) {
        requestFilters[streamTypeFilterIndex].value = streamTypeFilter;
      } else {
        requestFilters.push({ field: "PlayMethod", value: streamTypeFilter });
      }
    }

    const fetchHistory = () => {
      setIsBusy(true);
      const url = `/api/getHistory`;

      axios
        .get(url, {
          params: {
            size: itemCount,
            page: currentPage,
            search: debouncedSearchQuery,
            sort: sorting.column,
            desc: sorting.desc,
            filters: requestFilters != undefined ? JSON.stringify(requestFilters) : null,
          },
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Content-Type": "application/json",
          },
        })
        .then((response) => {
          const payload = response.data;
          setData(
            Array.isArray(payload)
              ? { results: payload, pages: 1 }
              : {
                  ...payload,
                  results: Array.isArray(payload?.results) ? payload.results : [],
                  pages: payload?.pages || 1,
                }
          );
          setIsBusy(false);
        })
        .catch((error) => {
          console.log(error);
          setData({ results: [], pages: 1 });
          setIsBusy(false);
        });
    };

    const fetchLibraries = () => {
      const url = `/api/getLibraries`;
      axios
        .get(url, {
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Content-Type": "application/json",
          },
        })
        .then((data) => {
          const fetchedLibraryFilters = data.data.map((library) => {
            return {
              Name: library.Name,
              Id: library.Id,
              Archived: library.archived,
            };
          });
          setLibraries(fetchedLibraryFilters);
          if (libraryFilters.length == 0) {
            setLibraryFilters(fetchedLibraryFilters.map((library) => library.Id));
            localStorage.setItem(
              "PREF_ACTIVITY_libraryFilters",
              JSON.stringify(fetchedLibraryFilters.map((library) => library.Id))
            );
          }
        })
        .catch((error) => {
          console.log(error);
        });
    };

    fetchHistory();
    if (libraries.length == 0) {
      fetchLibraries();
    }

    const intervalId = setInterval(fetchHistory, 60000 * 60);
    return () => clearInterval(intervalId);
  }, [config, itemCount, currentPage, debouncedSearchQuery, sorting, filterParams, libraries.length, libraryFilters, allLibrariesSelected, streamTypeFilter]);

  if (!data) {
    return <Loading />;
  }

  const activityRows = Array.isArray(data?.results) ? data.results : [];
  // The API only returns the signed-in user's own plays unless they can see every user.
  const showingOwnActivity = data?.scope === "self";

  if (activityRows.length === 0) {
    return (
      <div className="Activity">
        <div className="Heading">
          <h1>
            <Trans i18nKey="MENU_TABS.ACTIVITY" />
          </h1>
        </div>
        <div className="Activity">
          <h1>
            <Trans i18nKey="ERROR_MESSAGES.NO_ACTIVITY" />
          </h1>
        </div>
      </div>
    );
  }

  return (
    <div className="Activity">
      <Modal show={showLibraryFilters} onHide={() => setShowLibraryFilters(false)}>
        <Modal.Header>
          <Modal.Title>
            <Trans i18nKey="MENU_TABS.LIBRARIES" />
          </Modal.Title>
        </Modal.Header>
        <LibraryFilterModal libraries={libraries} selectedLibraries={libraryFilters} onSelectionChange={handleLibraryFilter} />
        <Modal.Footer>
          <Button variant="outline-primary" onClick={toggleSelectAll}>
            <Trans i18nKey="ACTIVITY_TABLE.TOGGLE_SELECT_ALL" />
          </Button>
          <Button variant="outline-primary" onClick={() => setShowLibraryFilters(false)}>
            <Trans i18nKey="CLOSE" />
          </Button>
        </Modal.Footer>
      </Modal>
      <header className="activity-page-header">
        <div>
          <p>Playback log</p>
          <h1>
            <Trans i18nKey="MENU_TABS.ACTIVITY" />
          </h1>
          <span>
            {showingOwnActivity ? "Showing your activity only. " : ""}Review watch history, playback method, device, and session details.{" "}
            <Link to="/timeline">Open Timeline view</Link>.
          </span>
        </div>

        <div className="activity-controls">
          <Button onClick={() => setShowLibraryFilters(true)} className="activity-control-button">
            <Trans i18nKey="MENU_TABS.LIBRARIES" />
          </Button>

          <label className="activity-control-field">
            <span>
              <Trans i18nKey="TYPE" />
            </span>
            <FormSelect
              onChange={(event) => {
                setTypeFilter(event.target.value);
              }}
              value={streamTypeFilter}
            >
              <option value="All">
                <Trans i18nKey="ALL" />
              </option>
              <option value="Transcode">
                <Trans i18nKey="TRANSCODE" />
              </option>
              <option value="DirectPlay">
                <Trans i18nKey="DIRECT" />
              </option>
              <option value="DirectStream">
                <Trans i18nKey="DIRECT_STREAM" />
              </option>
            </FormSelect>
          </label>

          <label className="activity-control-field is-compact">
            <span>
              <Trans i18nKey="UNITS.ITEMS" />
            </span>
            <FormSelect
              onChange={(event) => {
                setItemLimit(event.target.value);
              }}
              value={itemCount}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </FormSelect>
          </label>
          <FormControl
            type="text"
            placeholder={i18next.t("SEARCH")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="activity-search-input"
          />
        </div>
      </header>
      <div className="Activity activity-table-shell">
        <ActivityTable
          data={activityRows}
          itemCount={itemCount}
          onPageChange={handlePageChange}
          onSortChange={onSortChange}
          onFilterChange={onFilterChange}
          pageCount={data.pages}
          isBusy={isBusy}
        />
      </div>
    </div>
  );
}

export default Activity;
