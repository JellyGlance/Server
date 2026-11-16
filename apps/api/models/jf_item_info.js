const jf_item_info_columns = ["Id", "Path", "Name", "Size", "Bitrate", "MediaStreams", "Type"];

const jf_item_info_mapping = (item, typeOverride) => ({
  Id: item.ItemId || item.EpisodeId || item.Id,
  Path: item.Path,
  Name: item.Name,
  Size: item.Size,
  Bitrate: item.Bitrate,
  MediaStreams: JSON.stringify(item.MediaStreams),
  Type: typeOverride !== undefined ? typeOverride : item.Type,
});

// Live TV channels, extras, box sets and other virtual items can come back from
// Jellyfin without MediaSources. Treat them as having no file info instead of
// letting one item stop the whole sync.
const mediaSourcesOf = (item) => (Array.isArray(item?.MediaSources) ? item.MediaSources : []);

const jf_item_info_rows = (item, typeOverride) =>
  mediaSourcesOf(item).map((source) => jf_item_info_mapping(source, typeOverride));

module.exports = {
  jf_item_info_columns,
  jf_item_info_mapping,
  jf_item_info_rows,
  mediaSourcesOf,
};
