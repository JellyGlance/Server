import { useState, useEffect } from "react";
import axios from "../../../lib/axios_instance";

import ItemStatComponent from "./ItemStatComponent";

import { Trans } from "react-i18next";
import { libraryTypeMeta } from "../../../lib/library-types";

function MVLibraries(props) {
  const [data, setData] = useState();
  const [days, setDays] = useState(30); 

  const token = localStorage.getItem('token');

  useEffect(() => {

    const fetchLibraries = () => {
        const url = `/stats/getMostViewedLibraries`;

        axios
        .post(url, {days:props.days}, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        })
          .then((data) => {
            setData(data.data);
          })
          .catch((error) => {
            console.log(error);
          });
    };
 


    if (!data) {
      fetchLibraries();
    }
    if (days !== props.days) {
      setDays(props.days);
      fetchLibraries();
    }

    const intervalId = setInterval(fetchLibraries, 60000 * 5);
    return () => clearInterval(intervalId);
  }, [data, days,props.days,token]);

  if (!data || data.length === 0) {
    return  <></>;
  }



  const TopLibraryIcon = libraryTypeMeta(data[0].CollectionType).icon;
  return (
    <ItemStatComponent icon={<TopLibraryIcon size={"100%"} />} data={data} heading={<Trans i18nKey="STAT_CARDS.MOST_VIEWED_LIBRARIES" />} units={<Trans i18nKey="UNITS.PLAYS" />}/>
  );
}

export default MVLibraries;
