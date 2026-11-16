// jf_library_episodes.Id is EpisodeId+SeasonId, so the same episode can exist
// under more than one season folder. Joining the overview only on EpisodeId
// duplicated library cards (DC TV appeared twice). Pick one latest activity
// per library and match the episode by EpisodeId and SeasonId.
exports.up = async function (knex) {
  try {
    const role = process.env.POSTGRES_ROLE || process.env.POSTGRES_USER || "postgres";
    await knex.schema.raw(`
      DROP MATERIALIZED VIEW IF EXISTS public.js_library_stats_overview;

      CREATE MATERIALIZED VIEW public.js_library_stats_overview AS
      SELECT DISTINCT ON (l."Id")
        l."Id",
        l."Name",
        l."ServerId",
        l."IsFolder",
        l."Type",
        l."CollectionType",
        l."ImageTagsPrimary",
        i."Id" AS "ItemId",
        i."Name" AS "ItemName",
        i."Type" AS "ItemType",
        i."PrimaryImageHash",
        s."IndexNumber" AS "SeasonNumber",
        e."IndexNumber" AS "EpisodeNumber",
        e."Name" AS "EpisodeName",
        (SELECT count(*) FROM jf_playback_activity_with_metadata a WHERE a."ParentId" = l."Id") AS "Plays",
        (SELECT sum(a."PlaybackDuration") FROM jf_playback_activity_with_metadata a WHERE a."ParentId" = l."Id") AS total_playback_duration,
        l.total_play_time::numeric AS total_play_time,
        l.item_count AS "Library_Count",
        l.season_count AS "Season_Count",
        l.episode_count AS "Episode_Count",
        l.archived,
        latest_activity."ActivityDateInserted"
      FROM jf_libraries l
      LEFT JOIN (
        SELECT DISTINCT ON (jso."ParentId")
          jso."Id",
          jso."NowPlayingItemId",
          jso."SeasonId",
          jso."EpisodeId",
          jso."ParentId",
          jso."ActivityDateInserted"
        FROM js_latest_playback_activity jso
        ORDER BY jso."ParentId", jso."ActivityDateInserted" DESC, jso."Id" DESC
      ) latest_activity ON l."Id" = latest_activity."ParentId"
      LEFT JOIN jf_library_items i ON i."Id" = latest_activity."NowPlayingItemId"
      LEFT JOIN jf_library_seasons s ON s."Id" = latest_activity."SeasonId"
      LEFT JOIN jf_library_episodes e
        ON e."EpisodeId" = latest_activity."EpisodeId"
       AND (latest_activity."SeasonId" IS NULL OR e."SeasonId" = latest_activity."SeasonId")
      ORDER BY l."Id", latest_activity."ActivityDateInserted" DESC NULLS LAST, e.archived ASC, e."Id";

      CREATE UNIQUE INDEX js_library_stats_overview_id_idx
        ON public.js_library_stats_overview ("Id");

      ALTER MATERIALIZED VIEW public.js_library_stats_overview
      OWNER TO "${role}";
    `);
  } catch (error) {
    console.error(error);
  }
};

exports.down = async function (knex) {
  try {
    const role = process.env.POSTGRES_ROLE || process.env.POSTGRES_USER || "postgres";
    await knex.schema.raw(`
      DROP MATERIALIZED VIEW IF EXISTS public.js_library_stats_overview;

      CREATE MATERIALIZED VIEW public.js_library_stats_overview AS
        SELECT l."Id",
    l."Name",
    l."ServerId",
    l."IsFolder",
    l."Type",
    l."CollectionType",
    l."ImageTagsPrimary",
    i."Id" AS "ItemId",
    i."Name" AS "ItemName",
    i."Type" AS "ItemType",
    i."PrimaryImageHash",
    s."IndexNumber" AS "SeasonNumber",
    e."IndexNumber" AS "EpisodeNumber",
    e."Name" AS "EpisodeName",
    ( SELECT count(*) AS count
           FROM jf_playback_activity_with_metadata a
          WHERE a."ParentId" = l."Id") AS "Plays",
    ( SELECT sum(a."PlaybackDuration") AS sum
           FROM jf_playback_activity_with_metadata a
          WHERE a."ParentId" = l."Id") AS total_playback_duration,
    l.total_play_time::numeric AS total_play_time,
    l.item_count AS "Library_Count",
    l.season_count AS "Season_Count",
    l.episode_count AS "Episode_Count",
    l.archived,
    latest_activity."ActivityDateInserted"
   FROM jf_libraries l
     LEFT JOIN ( SELECT jso."Id",
            jso."NowPlayingItemId",
            jso."SeasonId",
            jso."EpisodeId",
            jso."ParentId",
            jso."ActivityDateInserted"
           FROM js_latest_playback_activity jso
             JOIN ( SELECT js_latest_playback_activity."ParentId",
                    max(js_latest_playback_activity."ActivityDateInserted") AS max_date
                   FROM js_latest_playback_activity
                  GROUP BY js_latest_playback_activity."ParentId") latest
                                  ON jso."ParentId" = latest."ParentId" AND jso."ActivityDateInserted" = latest.max_date )
                                  latest_activity ON l."Id" = latest_activity."ParentId"
     LEFT JOIN jf_library_items i ON i."Id" = latest_activity."NowPlayingItemId"
     LEFT JOIN jf_library_seasons s ON s."Id" = latest_activity."SeasonId"
     LEFT JOIN jf_library_episodes e ON e."EpisodeId" = latest_activity."EpisodeId"
  ORDER BY l."Id", latest_activity."ActivityDateInserted" DESC;

      ALTER MATERIALIZED VIEW public.js_library_stats_overview
      OWNER TO "${role}";
    `);
  } catch (error) {
    console.error(error);
  }
};
