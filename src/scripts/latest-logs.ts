import Database from "better-sqlite3";
import { config } from "../config.js";

const db = new Database(config.sync.databasePath);
const latest = db
  .prepare(
    "SELECT datetime(created_at, 'localtime') AS at, level, job, message FROM sync_log ORDER BY id DESC LIMIT 5"
  )
  .all();
console.log(JSON.stringify(latest, null, 2));
