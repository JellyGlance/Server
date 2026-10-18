import "../css/libraryOverview.css";
import { useState, useEffect } from "react";
import axios from "../../lib/axios_instance";
import Loading from "./general/loading";

import LibraryStatComponent from "./libraryStatCard/library-stat-component";

import { Trans } from "react-i18next";
import { LIBRARY_TYPE_ORDER, libraryTypeKey, libraryTypeMeta } from "../../lib/library-types";
import i18next from "i18next";

const ALWAYS_SHOWN = ["movies", "tvshows", "music", "mixed"];

export default function LibraryOverView() {
  const token = localStorage.getItem("token");
  const [data, setData] = useState();

  useEffect(() => {
    const fetchData = () => {
      const url = `/stats/getLibraryOverview`;
      axios
        .get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        })
        .then((response) => setData(response.data))
        .catch((error) => console.log(error));
    };

    if (!data) {
      fetchData();
    }
  }, [data, token]);

  if (!data) {
    return <Loading />;
  }

  return (
    <div>
      <h1 className="my-3">
        <Trans i18nKey="HOME_PAGE.LIBRARY_OVERVIEW" />
      </h1>
      <div className="overview-container">
        {LIBRARY_TYPE_ORDER.map((type) => {
          const libraries = data.filter((stat) => libraryTypeKey(stat.CollectionType) === type);
          // Movies, shows, music and mixed always show; the rest only when such a library exists.
          if (!ALWAYS_SHOWN.includes(type) && libraries.length === 0) return null;
          const meta = libraryTypeMeta(type);
          const Icon = meta.icon;
          return (
            <LibraryStatComponent
              key={type}
              data={libraries}
              heading={meta.heading}
              units={type === "tvshows" ? `${i18next.t("SERIES")} / ${i18next.t("SEASONS")} / ${i18next.t("EPISODES")}` : meta.units}
              icon={<Icon size={"100%"} />}
            />
          );
        })}
      </div>
    </div>
  );
}
