import {useState} from "react";
import { Link } from "react-router-dom";
import "../../css/library/library-card.css";

import Card from 'react-bootstrap/Card';

import { Trans } from "react-i18next";
import i18next from "i18next";
import baseUrl from "../../../lib/baseurl";
import { libraryTypeMeta } from "../../../lib/library-types";
import { formatLastPlayedLabel, libraryCardStatTiles } from "./library-card-format";

function LibraryCard(props) {
  const [imageLoaded, setImageLoaded] = useState(true);
  const libraryMeta = libraryTypeMeta(props.data.CollectionType);
  const TypeIcon = libraryMeta.icon;
  const libraryIcon = <TypeIcon size={"50%"} color="white" />;
  const typeChipIcon = <TypeIcon size={13} color="white" />;
  const default_image=<div className="default_library_image default_library_image_hover d-flex justify-content-center align-items-center">{libraryIcon} </div>;
  const typeLabel = libraryMeta.name;
  const scanLabel = props.scanning ? "Scanning..." : "Scan library";
  const statTiles = libraryCardStatTiles({
    collectionType: props.data.CollectionType,
    plays: props.data.Plays,
    episodeCount: props.data.Episode_Count,
    librarySize: props.metadata && props.metadata.Size,
    files: props.metadata && props.metadata.files,
    seasonCount: props.data.Season_Count,
    totalTimeTicks: props.data && props.data.total_play_time,
    playbackSeconds: props.data.total_playback_duration,
  });

  function handleScan(event) {
    event.preventDefault();
    event.stopPropagation();
    if (props.onScan && !props.scanDisabled && !props.scanning) {
      props.onScan();
    }
  }

  const scanButton = (
    <button
      className="library-scan-button"
      type="button"
      onClick={handleScan}
      disabled={props.scanDisabled || props.scanning}
      aria-label={scanLabel}
      title={scanLabel}
    >
      {props.scanIcon}
    </button>
  );

  const statGrid = (
    <div className="library-card-stat-grid">
      {statTiles.map((tile) => (
        <div key={tile.key}>
          <span><Trans i18nKey={tile.labelKey} /></span>
          <strong>{tile.value}</strong>
        </div>
      ))}
    </div>
  );

  const lastPlayed = (
    <>
      <span><Trans i18nKey="LIBRARY_CARD.LAST_PLAYED" /></span>
      <strong>{props.data.ItemName || `${i18next.t("ERROR_MESSAGES.N/A")}`}</strong>
      <small>{formatLastPlayedLabel(props.data.LastActivity)}</small>
    </>
  );

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
          {statTiles.map((tile) => (
            <div key={tile.key}>
              <span><Trans i18nKey={tile.labelKey} /></span>
              <strong>{tile.value}</strong>
            </div>
          ))}
        </div>

        <div className="library-list-last-played">
          {lastPlayed}
        </div>

        <button
          className="library-scan-button library-list-scan-button"
          type="button"
          onClick={handleScan}
          disabled={props.scanDisabled || props.scanning}
          aria-label={scanLabel}
          title={scanLabel}
        >
          {props.scanIcon}
        </button>
      </article>
    );
  }

  return (
    <Card className="lib-card">
      <div className="library-card-image">
        <Link to={`/libraries/${props.data.Id}`} className="library-card-link">
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
        </Link>
        {scanButton}
        <Link to={`/libraries/${props.data.Id}`} className="library-card-hero-copy">
          <h2>{props.data.Name}</h2>
          <span className="library-type-chip">
            <span className="library-type-icon">{typeChipIcon}</span>
            <span className="library-type-label">{typeLabel}</span>
          </span>
        </Link>
      </div>

      <Card.Body className="library-card-details">
        {statGrid}
        <div className="library-card-footer">
          {lastPlayed}
        </div>
      </Card.Body>
    </Card>
  );
}

export default LibraryCard;
