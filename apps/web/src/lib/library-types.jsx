import i18next from "i18next";
import BookOpenLineIcon from "remixicon-react/BookOpenLineIcon";
import CheckboxMultipleBlankLineIcon from "remixicon-react/CheckboxMultipleBlankLineIcon";
import FileMusicLineIcon from "remixicon-react/FileMusicLineIcon";
import FilmLineIcon from "remixicon-react/FilmLineIcon";
import ImageLineIcon from "remixicon-react/ImageLineIcon";
import MovieLineIcon from "remixicon-react/MovieLineIcon";
import TvLineIcon from "remixicon-react/TvLineIcon";
import VideoLineIcon from "remixicon-react/VideoLineIcon";
import ClapperboardLineIcon from "remixicon-react/ClapperboardLineIcon";

// Library collection types as Jellyfin and Emby report them. Books libraries hold both books and
// audiobooks. Anything unknown (folders, null) is shown as mixed.
const LIBRARY_TYPES = {
  movies: { icon: FilmLineIcon, key: "MOVIES" },
  tvshows: { icon: TvLineIcon, key: "TVSHOWS" },
  music: { icon: FileMusicLineIcon, key: "MUSIC" },
  musicvideos: { icon: VideoLineIcon, key: "MUSICVIDEOS" },
  homevideos: { icon: MovieLineIcon, key: "HOMEVIDEOS" },
  books: { icon: BookOpenLineIcon, key: "BOOKS" },
  photos: { icon: ImageLineIcon, key: "PHOTOS" },
  trailers: { icon: ClapperboardLineIcon, key: "TRAILERS" },
  mixed: { icon: CheckboxMultipleBlankLineIcon, key: "MIXED" },
};

// The original four keep their existing, already translated overview headings.
const OVERVIEW_HEADINGS = {
  movies: "LIBRARY_OVERVIEW.MOVIE_LIBRARIES",
  tvshows: "LIBRARY_OVERVIEW.SHOW_LIBRARIES",
  music: "LIBRARY_OVERVIEW.MUSIC_LIBRARIES",
  mixed: "LIBRARY_OVERVIEW.MIXED_LIBRARIES",
};

export const LIBRARY_TYPE_ORDER = Object.keys(LIBRARY_TYPES);

export function libraryTypeKey(collectionType) {
  const value = String(collectionType || "").toLowerCase();
  return LIBRARY_TYPES[value] ? value : "mixed";
}

// icon: the remixicon component; label: "Movie library"; name: "Movies"; units: what the item count means.
export function libraryTypeMeta(collectionType) {
  const type = libraryTypeKey(collectionType);
  const { icon, key } = LIBRARY_TYPES[type];
  return {
    type,
    icon,
    label: i18next.t(`LIBRARY_TYPES.${key}_LIBRARY`),
    name: i18next.t(`LIBRARY_TYPES.${key}`),
    heading: i18next.t(OVERVIEW_HEADINGS[type] || `LIBRARY_TYPES.${key}_LIBRARIES`),
    units: i18next.t(`LIBRARY_TYPES.${key}_UNITS`),
  };
}
