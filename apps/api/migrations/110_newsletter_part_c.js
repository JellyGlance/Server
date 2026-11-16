exports.up = async function (knex) {
  const hasArchive = await knex.schema.hasTable("newsletter_archive");
  if (!hasArchive) {
    await knex.schema.createTable("newsletter_archive", (table) => {
      table.uuid("id").primary();
      table.uuid("campaign_id").nullable();
      table.string("subject", 255).nullable();
      table.timestamp("published_at", { useTz: true }).defaultTo(knex.fn.now());
      table.text("html").nullable();
      table.text("text_body").nullable();
      table.string("audience_label", 160).nullable();
      table.string("kind", 40).notNullable().defaultTo("campaign");
    });
    await knex.schema.table("newsletter_archive", (table) => {
      table.index(["published_at"]);
    });
  }

  const hasLog = await knex.schema.hasTable("newsletter_automation_log");
  if (!hasLog) {
    await knex.schema.createTable("newsletter_automation_log", (table) => {
      table.uuid("id").primary();
      table.string("kind", 40).notNullable();
      table.string("user_id", 128).notNullable().defaultTo("");
      table.string("dedupe_key", 120).notNullable();
      table.timestamp("sent_at", { useTz: true }).defaultTo(knex.fn.now());
      table.unique(["kind", "user_id", "dedupe_key"]);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("newsletter_automation_log");
  await knex.schema.dropTableIfExists("newsletter_archive");
};
