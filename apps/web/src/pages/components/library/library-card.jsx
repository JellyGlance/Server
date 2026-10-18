import {useState} from "react";
import { Link } from "react-router-dom";
import "../../css/library/library-card.css";

import Card from 'react-bootstrap/Card';

import { Trans } from "react-i18next";
import i18next from "i18next";
import baseUrl from "../../../lib/baseurl";
import { libraryTypeMeta } from "../../../lib/library-types";

function LibraryCard(props) {
  const [imageLoaded, setImageLoaded] = useState(true);
  const libraryMeta = libraryTypeMeta(props.data.CollectionType);
  const TypeIcon = libraryMeta.icon;
  const libraryIcon = <TypeIcon size={"50%"} color="white" />;
  const default_image=<div className="default_library_image default_library_image_hover d-flex justify-content-center align-items-center">{libraryIcon} </div>;
  const typeLabel = libraryMeta.name;
  const primaryItemCount = props.data.CollectionType === "tvshows" ? props.data.Episode_Count : props.data.Library_Count;
  const primaryItemLabel = props.data.CollectionType === "tvshows" ? i18next.t("EPISODES") : libraryMeta.units;

  function formatFileSize(sizeInBytes) {
    const sizeInKB = sizeInBytes / 1024; // 1 KB = 1024 bytes
    if (sizeInKB < 1024) {
      return `${sizeInKB.toFixed(2)} KB`;
    } else {
      const sizeInMB = sizeInKB / 1024; // 1 MB = 1024 KB
      if (sizeInMB < 1024) {
        return `${sizeInMB.toFixed(2)} MB`;
      } else {
        const sizeInGB = sizeInMB / 1024; // 1 GB = 1024 MB
        if (sizeInGB < 1024) {
          return `${sizeInGB.toFixed(2)} GB`;
        } else {
          const sizeInTB = sizeInGB / 1024; // 1 TB = 1024 GB
          if (sizeInTB < 1024) {
            return `${sizeInTB.toFixed(2)} TB`;
          } else {
            const sizeInPB = sizeInTB / 1024; // 1 PB = 1024 TB
            return `${sizeInPB.toFixed(2)} PB`;
          }
        }
      }
    }
  }
  


  function formatTotalWatchTime(seconds) {
    const days = Math.floor(seconds / 86400); // 1 day = 86400 seconds
    const hours = Math.floor((seconds % 86400) / 3600); // 1 hour = 3600 seconds
    const minutes = Math.floor(((seconds % 86400) % 3600) / 60); // 1 minute = 60 seconds

    const units = {
      months: [i18next.t("UNITS.MONTH"), i18next.t("UNITS.MONTHS")],
      days: [i18next.t("UNITS.DAY"), i18next.t("UNITS.DAYS")],
      hours: [i18next.t("UNITS.HOUR"), i18next.t("UNITS.HOURS")],
      minutes: [i18next.t("UNITS.MINUTE"), i18next.t("UNITS.MINUTES")]
    };
    
    let formattedTime = '';
    if (days) {
      formattedTime += `${days} ${days > 1 ? units.days[1] : units.days[0]}`;
    }
    
    if (hours) {
      formattedTime += ` ${hours} ${hours > 1 ?  units.hours[1] : units.hours[0]}`;
    }
    
    if (minutes) {      formattedTime += ` ${minutes} ${minutes > 1 ?  units.minutes[1] : units.minutes[0]}`;
    }
    
    if (!days && !hours && !minutes) {
      formattedTime =`0 ${units.minutes[1]}`;
    }
    
    return formattedTime;
    
  }
  function ticksToTimeString(ticks) {
    const seconds = Math.floor(ticks / 10000000);
    const months = Math.floor(seconds / (86400 * 30)); // 1 month = 86400 seconds
    const days = Math.floor((seconds % (86400 * 30)) / 86400); // 1 day = 86400 seconds
    const hours = Math.floor((seconds % 86400) / 3600); // 1 hour = 3600 seconds
    const minutes = Math.floor((seconds % 3600) / 60); // 1 minute = 60 seconds
  
    const timeComponents = [];

    const units = {
      months: [i18next.t("UNITS.MONTH"), i18next.t("UNITS.MONTHS")],
      days: [i18next.t("UNITS.DAY"), i18next.t("UNITS.DAYS")],
      hours: [i18next.t("UNITS.HOUR"), i18next.t("UNITS.HOURS")],
      minutes: [i18next.t("UNITS.MINUTE"), i18next.t("UNITS.MINUTES")]
    };
  
    if (months) {
      timeComponents.push(`${months} ${months > 1 ? units.months[1] : units.months[0] }`);
    }
  
    if (days) {
      timeComponents.push(`${days} ${days > 1 ? units.days[1] : units.days[0]}`);
    }
  
    if (hours) {
      timeComponents.push(`${hours} ${hours > 1 ? units.hours[1] : units.hours[0]}`);
    }
  
    if (!months && minutes) {
      timeComponents.push(`${minutes} ${minutes > 1 ? units.minutes[1] : units.minutes[0]}`);
    }
  
    const formattedTime = timeComponents.length > 0 ? timeComponents.join(' ') : `0 ${units.minutes[1]}`;
    return formattedTime;
  }
  

  function formatLastActivityTime(time) {
    const units = {
      days: [i18next.t("UNITS.DAY"), i18next.t("UNITS.DAYS")],
      hours: [i18next.t("UNITS.HOUR"), i18next.t("UNITS.HOURS")],
      minutes: [i18next.t("UNITS.MINUTE"), i18next.t("UNITS.MINUTES")]
    };
  
    let formattedTime = '';
  
    for (const unit in units) {
      if (time[unit]) {
        const unitName = units[unit][time[unit] > 1 ? 1 : 0];
        formattedTime += `${time[unit]} ${unitName} `;
      }
    }
  
    return formattedTime;
  }

  if (props.viewMode === "list") {
    return (
      <article className="library-list-row">
        <Link to={`/libraries/${props.data.Id}`} className="library-list-main">
          <div className="library-list-thumb">
            {imageLoaded ? (
              <img
                className="library-list-image"
                src={baseUrl + "/proxy/Items/Images/Primary?id=" + props.data.Id + "&fillWidth=320&quality=55"}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setImageLoaded(false)}
              />
            ) : (
              default_image
            )}
          </div>
          <span className="library-list-icon">{libraryIcon}</span>
          <div className="library-list-title">
            <strong>{props.data.Name}</strong>
            <span>{typeLabel}</span>
          </div>
        </Link>

        <div className="library-list-stats">
          <div>
            <span><Trans i18nKey="TOTAL_PLAYS" /></span>
            <strong>{props.data.Plays?.toLocaleString()}</strong>
          </div>
          <div>
            <span>{primaryItemLabel}</span>
            <strong>{(primaryItemCount ?? 0).toLocaleString()}</strong>
          </div>
          <div>
            <span><Trans i18nKey="LIBRARY_CARD.LIBRARY_SIZE" /></span>
            <strong>{formatFileSize(props.metadata && props.metadata.Size ? props.metadata.Size : 0)}</strong>
          </div>
          <div>
            <span><Trans i18nKey="LIBRARY_CARD.TOTAL_TIME" /></span>
            <strong>{ticksToTimeString(props.data && props.data.total_play_time ? props.data.total_play_time : 0)}</strong>
          </div>
        </div>

        <div className="library-list-last-played">
          <span><Trans i18nKey="LIBRARY_CARD.LAST_PLAYED" /></span>
          <strong>{props.data.ItemName || `${i18next.t("ERROR_MESSAGES.N/A")}`}</strong>
          <small>
            {props.data.LastActivity
              ? `${i18next.t("USERS_PAGE.AGO_ALT")} ${formatLastActivityTime(props.data.LastActivity)} ${i18next.t("USERS_PAGE.AGO").toLocaleLowerCase()}`
              : i18next.t("ERROR_MESSAGES.NEVER")}
          </small>
        </div>

        <button className="library-scan-button library-list-scan-button" type="button" onClick={props.onScan} disabled={props.scanDisabled || props.scanning}>
          {props.scanIcon}
          <span>{props.scanning ? "Scanning..." : "Scan library"}</span>
        </button>
      </article>
    );
  }
  
  return (
    <Card className={`lib-card ${props.showName === false ? "is-library-name-hidden" : ""}`.trim()}>
      <Link to={`/libraries/${props.data.Id}`} className="library-card-link">
        <div className="library-card-image">
          {imageLoaded ? (
            <Card.Img
              variant="top"
              className="library-card-banner library-card-banner-hover"
              src={baseUrl + "/proxy/Items/Images/Primary?id=" + props.data.Id + "&fillWidth=560&quality=55"}
              loading="lazy"
              decoding="async"
              onError={() => setImageLoaded(false)}
            />
          ) : (
            default_image
          )}
          <div className="library-card-image-overlay" />
          <div className="library-card-hero-copy">
            <span className="library-type-icon">{libraryIcon}</span>
            <div>
              <span className="library-type-label">{typeLabel}</span>
              {props.showName !== false ? <h2>{props.data.Name}</h2> : null}
            </div>
          </div>
        </div>
      </Link>

      <Card.Body className="library-card-details">
        <div className="library-card-actions">
          <button className="library-scan-button" type="button" onClick={props.onScan} disabled={props.scanDisabled || props.scanning}>
            {props.scanIcon}
            <span>{props.scanning ? "Scanning..." : "Scan library"}</span>
          </button>
        </div>

        <div className="library-card-stat-grid">
          <div>
            <span><Trans i18nKey="TOTAL_PLAYS" /></span>
            <strong>{props.data.Plays?.toLocaleString()}</strong>
          </div>
          <div>
            <span>{primaryItemLabel}</span>
            <strong>{(primaryItemCount ?? 0).toLocaleString()}</strong>
          </div>
          <div>
            <span><Trans i18nKey="LIBRARY_CARD.LIBRARY_SIZE" /></span>
            <strong>{formatFileSize(props.metadata && props.metadata.Size ? props.metadata.Size : 0)}</strong>
          </div>
        </div>

        <div className="library-card-readout">
          <div>
            <span><Trans i18nKey="LIBRARY_CARD.TOTAL_TIME" /></span>
            <strong>{ticksToTimeString(props.data && props.data.total_play_time ? props.data.total_play_time : 0)}</strong>
          </div>
          <div>
            <span><Trans i18nKey="LIBRARY_CARD.TOTAL_PLAYBACK" /></span>
            <strong>{formatTotalWatchTime(props.data.total_playback_duration)}</strong>
          </div>
          <div>
            <span><Trans i18nKey="LIBRARY_CARD.TOTAL_FILES" /></span>
            <strong>{(props.metadata && props.metadata.files ? props.metadata.files : 0).toLocaleString()}</strong>
          </div>
          {props.data.CollectionType === "tvshows" ? (
            <div>
              <span><Trans i18nKey="SEASONS" /></span>
              <strong>{(props.data.Season_Count ?? 0).toLocaleString()}</strong>
            </div>
          ) : null}
        </div>

        <div className="library-card-footer">
          <span><Trans i18nKey="LIBRARY_CARD.LAST_PLAYED" /></span>
          <strong>{props.data.ItemName || `${i18next.t("ERROR_MESSAGES.N/A")}`}</strong>
          <small>
            {props.data.LastActivity
              ? `${i18next.t("USERS_PAGE.AGO_ALT")} ${formatLastActivityTime(props.data.LastActivity)} ${i18next.t("USERS_PAGE.AGO").toLocaleLowerCase()}`
              : i18next.t("ERROR_MESSAGES.NEVER")}
          </small>
        </div>
      </Card.Body>
    </Card>
  );
}

export default LibraryCard;
