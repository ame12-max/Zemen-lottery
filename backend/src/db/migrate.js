require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { pool } = require("../config/db");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function run() {
  try {
    // Migration tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const appliedResult = await pool.query(
      "SELECT name FROM _migrations"
    );

    const applied = new Set(
      appliedResult.rows.map((row) => row.name)
    );

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }

      const sql = fs.readFileSync(
        path.join(MIGRATIONS_DIR, file),
        "utf8"
      );

      console.log(`Applying ${file}...`);

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        await client.query(sql);

        await client.query(
          "INSERT INTO _migrations (name) VALUES ($1)",
          [file]
        );

        await client.query("COMMIT");

        console.log(`Applied ${file} successfully.`);
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch (_) {
          // Connection may already be dead.
        }

        console.error(`Failed applying ${file}:`, err.message);
        throw err;
      } finally {
        client.release();
      }
    }

    console.log("Migrations up to date.");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();