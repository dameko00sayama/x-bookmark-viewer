import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "app.sqlite");
const backupDir = process.env.BACKUP_DIR ?? path.join(dataDir, "backups");

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });

const backupPath = path.join(backupDir, `app-${timestamp()}.sqlite`);
const db = new Database(dbPath, { readonly: true });

try {
  await db.backup(backupPath);
  console.log(`Backup created: ${backupPath}`);
} finally {
  db.close();
}
