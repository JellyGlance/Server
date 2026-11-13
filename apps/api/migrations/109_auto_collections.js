exports.up = async function (knex) {
  if (!(await knex.schema.hasTable("jg_collection_builders"))) {
    await knex.schema.createTable("jg_collection_builders", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
      table.text("name").notNullable();
      table.text("type").notNullable();
      table.text("library_id");
      table.jsonb("options").notNullable().defaultTo("{}");
      table.boolean("preview_only").notNullable().defaultTo(true);
      table.boolean("apply_enabled").notNullable().defaultTo(false);
      table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable("jg_poster_originals"))) {
    await knex.schema.createTable("jg_poster_originals", (table) => {
      table.text("item_id").primary();
      table.text("item_name");
      table.binary("image_bytes").notNullable();
      table.text("content_type").notNullable().defaultTo("image/jpeg");
      table.timestamp("saved_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable("jg_collection_runs"))) {
    await knex.schema.createTable("jg_collection_runs", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
      table.uuid("builder_id").references("id").inTable("jg_collection_builders").onDelete("SET NULL");
      table.boolean("preview").notNullable().defaultTo(true);
      table.text("status").notNullable().defaultTo("preview");
      table.integer("item_count").notNullable().defaultTo(0);
      table.text("message");
      table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("jg_collection_runs");
  await knex.schema.dropTableIfExists("jg_poster_originals");
  await knex.schema.dropTableIfExists("jg_collection_builders");
};
