import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArrowLeftSLineIcon from "remixicon-react/ArrowLeftSLineIcon";
import ArrowDownSLineIcon from "remixicon-react/ArrowDownSLineIcon";
import ArrowRightSLineIcon from "remixicon-react/ArrowRightSLineIcon";
import FolderOpenLineIcon from "remixicon-react/FolderOpenLineIcon";
import SearchLineIcon from "remixicon-react/SearchLineIcon";

import axios from "../lib/axios_instance";
import ErrorBoundary from "./components/general/ErrorBoundary";
import Loading from "./components/general/loading";
import RecentlyAddedCard from "./components/library/RecentlyAdded/recently-added-card";
import "./css/home.css";
import "./css/recently-added-page.css";

const mediaTypes = ["Series", "Movie", "Audio", "Episode"];
const shelfCacheKey = "jellyglance_recently_added_shelves_v2_posters";
const typeFilterKey = "PREF_RECENTLY_ADDED_TypeFilter";
const libraryFilterKey = "PREF_RECENTLY_ADDED_LibraryFilter";
const itemOrderKey = "PREF_RECENTLY_ADDED_ItemOrder";
const shelfOrderKey = "PREF_RECENTLY_ADDED_ShelfOrder";

const itemOrderOptions = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "title-asc", label: "Title A-Z" },
  { value: "title-desc", label: "Title Z-A" },
];

const shelfOrderOptions = [
  { value: "library-asc", label: "Library A-Z" },
  { value: "library-desc", label: "Library Z-A" },
  { value: "most-recent", label: "Most recent library" },
  { value: "most-items", label: "Most items" },
];

function getItemTitle(item) {
  return `${item.SeriesName || item.Name || ""} ${item.Type === "Episode" ? item.Name || "" : ""}`.trim();
}

function compareDates(a, b) {
  return new Date(b.DateCreated || 0) - new Date(a.DateCreated || 0);
}

function sortItems(items, itemOrder) {
  const sortedItems = [...items];
  if (itemOrder === "oldest") {
    return sortedItems.sort((a, b) => new Date(a.DateCreated || 0) - new Date(b.DateCreated || 0));
  }
  if (itemOrder === "title-asc") {
    return sortedItems.sort((a, b) => getItemTitle(a).localeCompare(getItemTitle(b)));
  }
  if (itemOrder === "title-desc") {
    return sortedItems.sort((a, b) => getItemTitle(b).localeCompare(getItemTitle(a)));
  }
  return sortedItems.sort(compareDates);
}

function sortShelves(shelves, shelfOrder) {
  const sortedShelves = [...shelves];
  if (shelfOrder === "library-desc") {
    return sortedShelves.sort((a, b) => b.name.localeCompare(a.name));
  }
  if (shelfOrder === "most-recent") {
    return sortedShelves.sort((a, b) => b.latestItemDate - a.latestItemDate || a.name.localeCompare(b.name));
  }
  if (shelfOrder === "most-items") {
    return sortedShelves.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  return sortedShelves.sort((a, b) => a.name.localeCompare(b.name));
}

export default function RecentlyAddedPage() {
  const [shelves, setShelves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState(localStorage.getItem(typeFilterKey) || "All");
  const [libraryFilter, setLibraryFilter] = useState(localStorage.getItem(libraryFilterKey) || "All");
  const [itemOrder, setItemOrder] = useState(localStorage.getItem(itemOrderKey) || "newest");
  const [shelfOrder, setShelfOrder] = useState(localStorage.getItem(shelfOrderKey) || "library-asc");
  const [showEmpty, setShowEmpty] = useState(false);
  const shelfRefs = useRef({});
  const token = localStorage.getItem("token");

  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    [token]
  );

  const fetchShelves = useCallback(async () => {
    try {
      setError("");
      const response = await axios.get("/api/getRecentlyAddedShelves?limit=24", { headers });
      const nextShelves = Array.isArray(response.data)
        ? response.data.map((shelf) => {
            const items = Array.isArray(shelf.items)
              ? shelf.items.filter((item) => mediaTypes.includes(item.Type)).slice(0, 24)
              : [];

            return {
              ...shelf,
              count: items.length,
              items,
            };
          })
        : [];

      sessionStorage.setItem(shelfCacheKey, JSON.stringify({ shelves: nextShelves, cachedAt: Date.now() }));
      setShelves(nextShelves);
    } catch (err) {
      console.log(err);
      setError("Recently added media could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    const cached = sessionStorage.getItem(shelfCacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed.shelves)) {
          setShelves(parsed.shelves);
          setLoading(false);
        }
      } catch (error) {
        sessionStorage.removeItem(shelfCacheKey);
      }
    }

    fetchShelves();
    const intervalId = setInterval(fetchShelves, 60000 * 5);
    return () => clearInterval(intervalId);
  }, [fetchShelves]);

  const scrollShelf = (id, direction) => {
    const shelf = shelfRefs.current[id];
    if (!shelf) {
      return;
    }

    shelf.scrollBy({
      left: direction * shelf.clientWidth,
      behavior: "smooth",
    });
  };

  const libraryOptions = useMemo(
    () => shelves.map((shelf) => ({ id: shelf.id, name: shelf.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [shelves]
  );

  const filteredShelves = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    const hasActiveFilters = search.length > 0 || typeFilter !== "All" || libraryFilter !== "All";

    const nextShelves = shelves
      .filter((shelf) => libraryFilter === "All" || shelf.id === libraryFilter)
      .map((shelf) => {
        const items = sortItems(
          shelf.items.filter((item) => {
            const matchesType = typeFilter === "All" || item.Type === typeFilter;
            const matchesSearch =
              !search ||
              [item.Name, item.SeriesName, item.Type]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(search));

            return matchesType && matchesSearch;
          }),
          itemOrder
        );

        return {
          ...shelf,
          count: items.length,
          latestItemDate: Math.max(...items.map((item) => new Date(item.DateCreated || 0).getTime()), 0),
          items,
        };
      })
      .filter((shelf) => !hasActiveFilters || shelf.items.length > 0);

    return sortShelves(nextShelves, shelfOrder);
  }, [itemOrder, libraryFilter, searchQuery, shelfOrder, shelves, typeFilter]);

  // Libraries with something recent come first; the empty ones fold into one line at the end.
  const { filledShelves, emptyShelves } = useMemo(
    () => ({
      filledShelves: filteredShelves.filter((shelf) => shelf.items.length > 0),
      emptyShelves: filteredShelves.filter((shelf) => shelf.items.length === 0),
    }),
    [filteredShelves]
  );

  const visibleItemCount = useMemo(
    () => filteredShelves.reduce((count, shelf) => count + shelf.items.length, 0),
    [filteredShelves]
  );

  const updateTypeFilter = (value) => {
    setTypeFilter(value);
    localStorage.setItem(typeFilterKey, value);
  };

  const updateLibraryFilter = (value) => {
    setLibraryFilter(value);
    localStorage.setItem(libraryFilterKey, value);
  };

  const updateItemOrder = (value) => {
    setItemOrder(value);
    localStorage.setItem(itemOrderKey, value);
  };

  const updateShelfOrder = (value) => {
    setShelfOrder(value);
    localStorage.setItem(shelfOrderKey, value);
  };

  const clearFilters = () => {
    setSearchQuery("");
    updateTypeFilter("All");
    updateLibraryFilter("All");
    updateItemOrder("newest");
    updateShelfOrder("library-asc");
  };

  if (loading) {
    return <Loading />;
  }

  return (
    <div className="Home recently-added-page">
      <div className="recently-added-page-header">
        <p>Media shelf</p>
        <h1>Recently Added</h1>
        <span>Fresh films, series, episodes, and audio grouped by Jellyfin folder.</span>
      </div>

      <div className="recently-added-controls" aria-label="Recently added filters">
        <label className="recently-added-search">
          <SearchLineIcon size={18} />
          <input
            type="search"
            value={searchQuery}
            placeholder="Search title, series, type..."
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>

        <label className="recently-added-control">
          <span>Type</span>
          <select value={typeFilter} onChange={(event) => updateTypeFilter(event.target.value)}>
            <option value="All">All media</option>
            <option value="Movie">Movies</option>
            <option value="Episode">Episodes</option>
            <option value="Audio">Audio</option>
          </select>
        </label>

        <label className="recently-added-control">
          <span>Library</span>
          <select value={libraryFilter} onChange={(event) => updateLibraryFilter(event.target.value)}>
            <option value="All">All libraries</option>
            {libraryOptions.map((library) => (
              <option key={library.id} value={library.id}>
                {library.name}
              </option>
            ))}
          </select>
        </label>

        <label className="recently-added-control">
          <span>Items</span>
          <select value={itemOrder} onChange={(event) => updateItemOrder(event.target.value)}>
            {itemOrderOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="recently-added-control">
          <span>Shelves</span>
          <select value={shelfOrder} onChange={(event) => updateShelfOrder(event.target.value)}>
            {shelfOrderOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="recently-added-clear" onClick={clearFilters}>
          Reset
        </button>

        <div className="recently-added-count">
          {visibleItemCount} {visibleItemCount === 1 ? "item" : "items"}
        </div>
      </div>

      {error ? <div className="recently-added-error">{error}</div> : null}

      <div className="recently-added-shelves">
        {filteredShelves.length === 0 && !error ? (
          <div className="recently-added-empty">
            <FolderOpenLineIcon size={34} />
            <span>No recently added media matches the current filters.</span>
          </div>
        ) : null}

        {filledShelves.map((shelf) => (
          <section className="recent-library-shelf" key={shelf.id}>
            <div className="recent-library-shelf-header">
              <div className="recent-library-shelf-title">
                <div className="recent-library-shelf-icon" aria-hidden="true">
                  <FolderOpenLineIcon size={22} />
                </div>
                <div>
                  <h2>{shelf.name}</h2>
                  <span>
                    {shelf.count} recent {shelf.count === 1 ? "item" : "items"}
                  </span>
                </div>
              </div>
              <div className="recent-library-shelf-controls">
                <button
                  type="button"
                  aria-label={`Scroll ${shelf.name} left`}
                  disabled={shelf.items.length <= 10}
                  onClick={() => scrollShelf(shelf.id, -1)}
                >
                  <ArrowLeftSLineIcon size={21} />
                </button>
                <button
                  type="button"
                  aria-label={`Scroll ${shelf.name} right`}
                  disabled={shelf.items.length <= 10}
                  onClick={() => scrollShelf(shelf.id, 1)}
                >
                  <ArrowRightSLineIcon size={21} />
                </button>
              </div>
            </div>

            <div
              className="recent-library-shelf-track"
              ref={(node) => {
                shelfRefs.current[shelf.id] = node;
              }}
            >
              {shelf.items.map((item) => (
                <ErrorBoundary key={`${shelf.id}-${item.EpisodeId || item.Id}`}>
                  <RecentlyAddedCard data={item} />
                </ErrorBoundary>
              ))}
            </div>
          </section>
        ))}

        {emptyShelves.length > 0 ? (
          <div className="recent-empty-libraries">
            <button
              type="button"
              className="recent-empty-libraries-toggle"
              aria-expanded={showEmpty}
              aria-controls="recent-empty-libraries-list"
              onClick={() => setShowEmpty((open) => !open)}
            >
              {showEmpty ? <ArrowDownSLineIcon size={18} /> : <ArrowRightSLineIcon size={18} />}
              <span>Empty libraries</span>
              <em>{emptyShelves.length}</em>
            </button>
            {showEmpty ? (
              <ul id="recent-empty-libraries-list">
                {emptyShelves.map((shelf) => (
                  <li key={shelf.id}>
                    <FolderOpenLineIcon size={16} />
                    <span>{shelf.name}</span>
                    <small>No recent items</small>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
