exports.up = async function (knex) {
  const hasRules = await knex.schema.hasTable("jg_cleanup_rules");
  if (!hasRules) {
    await knex.schema.createTable("jg_cleanup_rules", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
      table.text("name").notNullable();
      table.text("library_id").notNullable();
      table.boolean("enabled").notNullable().defaultTo(false);
      table.boolean("dry_run").notNullable().defaultTo(true);
      table.jsonb("conditions").notNullable().defaultTo("{}");
      table.jsonb("actions").notNullable().defaultTo("{}");
      table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  const hasExclusions = await knex.schema.hasTable("jg_cleanup_exclusions");
  if (!hasExclusions) {
    await knex.schema.createTable("jg_cleanup_exclusions", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
      table.uuid("rule_id").references("id").inTable("jg_cleanup_rules").onDelete("CASCADE");
      table.text("item_id").notNullable();
      table.text("item_name");
      table.text("reason");
      table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.unique(["rule_id", "item_id"]);
    });
  }

  const hasRuns = await knex.schema.hasTable("jg_cleanup_runs");
  if (!hasRuns) {
    await knex.schema.createTable("jg_cleanup_runs", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
      table.uuid("rule_id").notNullable().references("id").inTable("jg_cleanup_rules").onDelete("CASCADE");
      table.timestamp("started_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("finished_at", { useTz: true });
      table.boolean("dry_run").notNullable().defaultTo(true);
      table.text("status").notNullable().defaultTo("preview");
      table.integer("match_count").notNullable().defaultTo(0);
      table.bigInteger("bytes").notNullable().defaultTo(0);
      table.text("message");
      table.text("created_by");
    });
  }

  const hasRunItems = await knex.schema.hasTable("jg_cleanup_run_items");
  if (!hasRunItems) {
    await knex.schema.createTable("jg_cleanup_run_items", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
      table.uuid("run_id").notNullable().references("id").inTable("jg_cleanup_runs").onDelete("CASCADE");
      table.text("item_id").notNullable();
      table.text("item_name");
      table.bigInteger("bytes").defaultTo(0);
      table.jsonb("actions").notNullable().defaultTo("[]");
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("jg_cleanup_run_items");
  await knex.schema.dropTableIfExists("jg_cleanup_runs");
  await knex.schema.dropTableIfExists("jg_cleanup_exclusions");
  await knex.schema.dropTableIfExists("jg_cleanup_rules");
};
