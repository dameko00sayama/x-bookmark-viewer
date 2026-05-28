import fs from "node:fs";
import path from "node:path";

const source = process.argv[2];

if (!source) {
  console.error("Usage: npm run db:restore -- <backup-file>");
  process.exit(1);
}

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "app.sqlite");
const backupPath = path.resolve(source);

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function removeIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

if (!fs.existsSync(backupPath)) {
  console.error(`Backup file not found: ${backupPath}`);
  process.exit(1);
}

fs.mkdirSync(dataDir, { recursive: true });

if (fs.existsSync(dbPath)) {
  const currentBackupPath = path.join(dataDir, `app.before-restore-${timestamp()}.sqlite`);
  fs.copyFileSync(dbPath, currentBackupPath);
  console.log(`Current database copied to: ${currentBackupPath}`);
}

removeIfExists(`${dbPath}-shm`);
removeIfExists(`${dbPath}-wal`);
fs.copyFileSync(backupPath, dbPath);

console.log(`Database restored from: ${backupPath}`);
