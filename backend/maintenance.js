/**
 * @file        maintenance.js
 * @description Provides maintenance functions which are called by the maintenance GUI
 * @author      Chris Staples
 * @license     GPL3
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Parser } = require("@json2csv/plainjs");
const { exec } = require("child_process");
const JSZip = require("jszip");
const Database = require("better-sqlite3");
const router = express.Router();
const { CONFIG_IMG_DIR, SAMPLE_DIR, UPLOAD_DIR, DB_PATH, DB_NAME, BACKUP_DIR, MAX_UPLOADS, allowedExtensions, MAX_AUCTIONS, PPTX_CONFIG_DIR, LOG_DIR, LOG_NAME, PASSWORD_MIN_LENGTH, SERVICE_NAME } = require('./config');
const crypto = require('crypto');
const { validateJsonPaths } = require('./middleware/json-path-validator');
const { validateAndNormalizeSlipConfig } = require('./slip-config');
const { sanitiseText } = require('./middleware/sanitiseText');
const upload = multer({ dest: UPLOAD_DIR });
const sharp = require("sharp");
const db = require('./db');
const archiver = require("archiver");
const logFilePath = path.join(LOG_DIR, LOG_NAME);
const logLines = 500;
const CONFIG_PATHS = {
  pptx: path.join(PPTX_CONFIG_DIR, 'pptxConfig.json'),
  card: path.join(PPTX_CONFIG_DIR, 'cardConfig.json'),
  slip: path.join(PPTX_CONFIG_DIR, 'slipConfig.json')
};
const { audit } = require('./middleware/audit');
const bcrypt = require('bcryptjs');
const { logLevels, setLogLevel, logFromRequest, createLogger, log } = require('./logger');
const { checkAuctionState } = require('./middleware/checkAuctionState');
const {
  SUMMARY_MODE,
  VERBOSE_MODE,
  collectIntegrityChecks,
  applyIntegrityFixes
} = require('./integrity-check');
const {
  ROLE_LIST,
  PERMISSION_LIST,
  ROOT_USERNAME,
  normaliseUsername,
  isValidUsername,
  normaliseRoles,
  normalisePermissions,
  getUserByUsername,
  listUsers,
  createUser,
  updateUserRoles,
  updateUserAccess,
  setUserPassword,
  invalidateUserSessions,
  deleteUser,
  getAuditActor
} = require('./users');

// (
//  { ttlSeconds: 2 }   // optional – default is 5
// );

const allowedStatuses = ["setup", "locked", "live", "settlement", "archived"];
const MANAGED_BACKUP_FORMAT_VERSION = 1;
const MANAGED_BACKUP_PREFIX = "managed_backup_";
const MANAGED_BACKUP_SUFFIX = ".zip";
const MANAGED_BACKUP_METADATA_SUFFIX = ".metadata.json";
const BACKUP_NOTE_MAX_LENGTH = 500;
const SQLITE_SIGNATURE = Buffer.from("SQLite format 3\u0000", "utf8");
const RESOURCE_CONFIG_BACKUP_PATHS = Object.freeze([
  { key: "pptx", filename: "pptxConfig.json", livePath: CONFIG_PATHS.pptx },
  { key: "card", filename: "cardConfig.json", livePath: CONFIG_PATHS.card },
  { key: "slip", filename: "slipConfig.json", livePath: CONFIG_PATHS.slip }
]);

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toPosixPath(filePath) {
  return String(filePath || "").split(path.sep).join("/");
}

function formatBackupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function normaliseManagedBackupId(value) {
  const text = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(text)) {
    throw new Error("Invalid backup identifier.");
  }
  return text;
}

function createManagedBackupId() {
  if (!fs.existsSync(BACKUP_DIR)) {
    return "1";
  }

  let maxId = 0;
  const sidecars = fs.readdirSync(BACKUP_DIR)
    .filter((filename) => filename.startsWith(MANAGED_BACKUP_PREFIX) && filename.endsWith(MANAGED_BACKUP_METADATA_SUFFIX));

  for (const sidecarFilename of sidecars) {
    const candidate = sidecarFilename
      .slice(MANAGED_BACKUP_PREFIX.length, -MANAGED_BACKUP_METADATA_SUFFIX.length);
    const numericId = Number.parseInt(candidate, 10);
    if (Number.isInteger(numericId) && numericId > maxId) {
      maxId = numericId;
    }
  }

  return String(maxId + 1);
}

function createManagedBackupPaths(backupId, createdAt = new Date().toISOString()) {
  const archiveFilename = `CA_Backup_${backupId}_${formatBackupTimestamp(new Date(createdAt))}${MANAGED_BACKUP_SUFFIX}`;
  const sidecarFilename = `${MANAGED_BACKUP_PREFIX}${backupId}${MANAGED_BACKUP_METADATA_SUFFIX}`;
  return {
    archiveFilename,
    archivePath: path.join(BACKUP_DIR, archiveFilename),
    sidecarFilename,
    sidecarPath: path.join(BACKUP_DIR, sidecarFilename)
  };
}

function createManagedBackupSidecarPath(backupId) {
  const sidecarFilename = `${MANAGED_BACKUP_PREFIX}${backupId}${MANAGED_BACKUP_METADATA_SUFFIX}`;
  return {
    sidecarFilename,
    sidecarPath: path.join(BACKUP_DIR, sidecarFilename)
  };
}

function createOperationLog() {
  const lines = [];

  return {
    add(level, message) {
      lines.push(`[${new Date().toISOString()}] [${String(level || "INFO").toUpperCase()}] ${String(message || "")}`);
    },
    info(message) {
      this.add("INFO", message);
    },
    warn(message) {
      this.add("WARN", message);
    },
    error(message) {
      this.add("ERROR", message);
    },
    toString() {
      return lines.length ? `${lines.join("\n")}\n` : "";
    }
  };
}

function listFilesRecursively(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const rootResolved = path.resolve(rootDir);
  const files = [];
  const stack = [rootResolved];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const relativePath = toPosixPath(path.relative(rootResolved, fullPath));
      const stats = fs.statSync(fullPath);
      files.push({
        absolutePath: fullPath,
        relativePath,
        size_bytes: stats.size
      });
    }
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function listManagedResourceImages() {
  return listFilesRecursively(CONFIG_IMG_DIR).filter((file) =>
    allowedExtensions.includes(path.extname(file.relativePath).toLowerCase())
  );
}

function safeResolveWithin(baseDir, relativePath) {
  const targetPath = path.resolve(baseDir, relativePath);
  const baseResolved = path.resolve(baseDir);
  if (targetPath !== baseResolved && !targetPath.startsWith(`${baseResolved}${path.sep}`)) {
    throw new Error("Archive entry escapes target directory.");
  }
  return targetPath;
}

function copyDirectoryContents(sourceDir, targetDir) {
  ensureDirectory(targetDir);
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  const files = listFilesRecursively(sourceDir);
  for (const file of files) {
    const destPath = safeResolveWithin(targetDir, file.relativePath);
    ensureDirectory(path.dirname(destPath));
    fs.copyFileSync(file.absolutePath, destPath);
  }
}

function removeDirectoryContents(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  for (const entry of fs.readdirSync(dirPath)) {
    fs.rmSync(path.join(dirPath, entry), { recursive: true, force: true });
  }
}

function sanitiseBackupNote(note) {
  return sanitiseText(note || "", BACKUP_NOTE_MAX_LENGTH).trim();
}

function verifyMaintenancePassword(req, password) {
  const username = req.user?.username;
  if (!username || !password) {
    const error = new Error("Missing password.");
    error.statusCode = 400;
    throw error;
  }

  const user = getUserByUsername(username);
  if (!user || !user.password) {
    const error = new Error("Incorrect password");
    error.statusCode = 403;
    throw error;
  }

  const stored = String(user.password || '');
  const valid = stored.startsWith('$2')
    ? bcrypt.compareSync(password, stored)
    : stored === password;

  if (!valid) {
    const error = new Error("Incorrect password");
    error.statusCode = 403;
    throw error;
  }
}

function collectAuctionBackupSummary() {
  return db.all(`
    SELECT a.id,
           a.short_name,
           a.full_name,
           a.status,
           COUNT(i.id) AS item_count,
           SUM(CASE WHEN COALESCE(i.is_deleted, 0) = 0 THEN 1 ELSE 0 END) AS active_item_count,
           SUM(CASE WHEN COALESCE(i.is_deleted, 0) = 1 THEN 1 ELSE 0 END) AS deleted_item_count
      FROM auctions a
      LEFT JOIN items i ON i.auction_id = a.id
     GROUP BY a.id
     ORDER BY a.id
  `).map((row) => ({
    id: row.id,
    short_name: row.short_name,
    full_name: row.full_name,
    status: row.status,
    item_count: Number(row.item_count || 0),
    active_item_count: Number(row.active_item_count || 0),
    deleted_item_count: Number(row.deleted_item_count || 0)
  }));
}

function createSafeDatabaseSnapshot(destinationPath) {
  const databaseFile = path.join(DB_PATH, DB_NAME);
  let reopened = false;

  db.setMaintenanceLock(true);
  try {
    db.close();
    fs.copyFileSync(databaseFile, destinationPath);
    if (typeof db.reopen === "function") {
      db.reopen({ skipClose: true });
      reopened = true;
    }

    return {
      file_path: destinationPath,
      size_bytes: fs.statSync(destinationPath).size
    };
  } finally {
    if (!reopened && typeof db.reopen === "function") {
      try {
        db.reopen({ skipClose: true });
      } catch (_error) {
        // Best effort; allow the original error to propagate.
      }
    }
    db.setMaintenanceLock(false);
  }
}

function validateSqliteSnapshot(filePath, { expectedSchemaVersion = String(db.schemaVersion) } = {}) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(SQLITE_SIGNATURE.length);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (bytesRead < SQLITE_SIGNATURE.length || !buffer.equals(SQLITE_SIGNATURE)) {
      throw new Error("Uploaded file is not a valid SQLite database.");
    }
  } finally {
    fs.closeSync(fd);
  }

  const testDb = new Database(filePath, { readonly: true });
  try {
    const metadataTable = testDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'metadata'").get();
    if (!metadataTable) {
      throw new Error("Uploaded database is missing schema version.");
    }

    const row = testDb.prepare("SELECT value FROM metadata WHERE data = 'schema_version'").get();
    const schemaVersion = row && row.value != null && String(row.value).length > 0 ? String(row.value) : null;
    if (!schemaVersion) {
      throw new Error("Uploaded database is missing schema version.");
    }

    if (schemaVersion !== String(expectedSchemaVersion)) {
      throw new Error(`Uploaded database schema version does not match. (import=${schemaVersion}, required=${expectedSchemaVersion})`);
    }

    return { schemaVersion };
  } finally {
    testDb.close();
  }
}

function archiveContainsEntries(zip, prefix) {
  return Object.values(zip.files).some((entry) => !entry.dir && entry.name.startsWith(prefix));
}

async function extractZipPrefixToDirectory(zip, prefix, targetDir) {
  let extracted = 0;

  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.startsWith(prefix)) {
      continue;
    }

    const relativePath = entry.name.slice(prefix.length);
    if (!relativePath) {
      continue;
    }

    const destination = safeResolveWithin(targetDir, relativePath);
    ensureDirectory(path.dirname(destination));
    const content = await entry.async("nodebuffer");
    fs.writeFileSync(destination, content);
    extracted += 1;
  }

  return extracted;
}

function validateManagedBackupMetadata(metadata) {
  if (!metadata || Number(metadata.format_version) !== MANAGED_BACKUP_FORMAT_VERSION) {
    throw new Error("Unsupported backup format.");
  }
  if (!metadata.backup_id) {
    throw new Error("Backup metadata is missing backup_id.");
  }
  return metadata;
}

function readManagedBackupRecord(backupId) {
  const normalizedId = normaliseManagedBackupId(backupId);
  const { sidecarPath } = createManagedBackupSidecarPath(normalizedId);
  if (!fs.existsSync(sidecarPath)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
  validateManagedBackupMetadata(parsed);
  const archiveFilename = String(parsed.archive_filename || "");
  if (!archiveFilename) {
    return null;
  }
  const archivePath = path.join(BACKUP_DIR, archiveFilename);
  if (!fs.existsSync(archivePath)) {
    return null;
  }
  const archiveStats = fs.statSync(archivePath);

  return {
    ...parsed,
    archive_size_bytes: archiveStats.size,
    archive_path: archivePath,
    sidecar_path: sidecarPath
  };
}

function listManagedBackups() {
  if (!fs.existsSync(BACKUP_DIR)) {
    return [];
  }

  const sidecars = fs.readdirSync(BACKUP_DIR)
    .filter((filename) => filename.startsWith(MANAGED_BACKUP_PREFIX) && filename.endsWith(MANAGED_BACKUP_METADATA_SUFFIX))
    .sort()
    .reverse();

  const backups = [];
  for (const sidecarFilename of sidecars) {
    try {
      const backupId = sidecarFilename
        .slice(MANAGED_BACKUP_PREFIX.length, -MANAGED_BACKUP_METADATA_SUFFIX.length);
      const record = readManagedBackupRecord(backupId);
      if (record) {
        backups.push(record);
      }
    } catch (_error) {
      // Ignore malformed or partially written backup metadata files.
    }
  }

  backups.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return backups;
}

function publicManagedBackupSummary(record) {
  return {
    backup_id: record.backup_id,
    filename: record.archive_filename,
    created_at: record.created_at,
    created_by: record.created_by,
    note: record.note || "",
    schema_version: record.schema_version,
    archive_size_bytes: Number(record.archive_size_bytes || 0),
    component_manifest: record.component_manifest || {},
    auction_count: Number(record.summary_counts?.auction_count || 0),
    item_count: Number(record.summary_counts?.item_count || 0)
  };
}

function publicManagedBackupDetail(record) {
  const { archive_path, sidecar_path, ...rest } = record;
  return {
    ...rest,
    archive_size_bytes: Number(record.archive_size_bytes || 0)
  };
}

function requireManageUsers(req, res, next) {
  if (Array.isArray(req.user?.permissions) && req.user.permissions.includes("manage_users")) {
    return next();
  }

  logFromRequest(req, logLevels.WARN, `Rejected user-management access for ${req.user?.username || 'unknown'} without manage_users permission`);
  return res.status(403).json({ error: "Unauthorized" });
}

function normaliseAuctionShortName(shortName) {
  if (!shortName) {
    return { error: "Missing short_name or full_name" };
  }

  if (/\s/.test(shortName) || shortName.length < 3 || shortName.length > 64) {
    return { error: "Short name must not contain spaces and be between 3 and 64 characters." };
  }

  const sanitisedShortName = sanitiseText(shortName, 64).trim().toLowerCase();
  if (!sanitisedShortName) {
    return { error: "Short name must not be empty." };
  }

  return { value: sanitisedShortName };
}

function normaliseAuctionFullName(fullName) {
  if (!fullName) {
    return { error: "Missing short_name or full_name" };
  }

  const sanitisedFullName = sanitiseText(fullName, 256).trim();
  if (!sanitisedFullName) {
    return { error: "Full name must not be empty." };
  }

  return { value: sanitisedFullName };
}

function validateAuctionLogo(logo) {
  const requestedLogo = sanitiseText(logo || "default_logo.png", 255).trim() || "default_logo.png";
  const logoPath = path.join(CONFIG_IMG_DIR, requestedLogo);

  if (!logoPath.startsWith(CONFIG_IMG_DIR)) {
    return { error: "Invalid logo selection." };
  }

  if (!fs.existsSync(logoPath)) {
    return { error: "Selected logo does not exist." };
  }

  const ext = path.extname(requestedLogo).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return { error: "Selected logo is not a supported image." };
  }

  return { value: requestedLogo };
}

// Ensure PPTX_CONFIG_DIR exists and has default config files (removes a manual setup step)
if (!fs.existsSync(PPTX_CONFIG_DIR)) fs.mkdirSync(PPTX_CONFIG_DIR, { recursive: true });

const defaultConfigs = [
  { src: 'default.cardConfig.json', dest: 'cardConfig.json' },
  { src: 'default.pptxConfig.json', dest: 'pptxConfig.json' },
  { src: 'default.slipConfig.json', dest: 'slipConfig.json' }
];

for (const { src, dest } of defaultConfigs) {
  const destPath = path.join(PPTX_CONFIG_DIR, dest);
  if (!fs.existsSync(destPath)) {
    fs.copyFileSync(path.join(__dirname, src), destPath);
    log("Server", logLevels.INFO, `Default pptx config file created: ${dest}`);
  }
}

if (!fs.existsSync(CONFIG_IMG_DIR)) fs.mkdirSync(CONFIG_IMG_DIR);

const resourcesDir = path.join(__dirname, "resources");
if (fs.existsSync(resourcesDir)) {
  for (const entry of fs.readdirSync(resourcesDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const destPath = path.join(CONFIG_IMG_DIR, entry.name);
    if (!fs.existsSync(destPath)) {
      fs.copyFileSync(path.join(resourcesDir, entry.name), destPath);
      log("Server", logLevels.INFO, `Default resource file copied: ${entry.name}`);
    }
  }
}

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

// const CONFIG_IMG_DIR = path.join(__dirname, "resources");


//--------------------------------------------------------------------------
// POST /backup
// API to create a managed backup archive on the server
//--------------------------------------------------------------------------

router.post("/backup", async (req, res) => {
  const createdAt = new Date().toISOString();
  const createdBy = req.user?.username || "unknown";
  const note = sanitiseBackupNote(req.body?.note);
  const backupId = createManagedBackupId();
  const backupLog = createOperationLog();
  const tempRoot = fs.mkdtempSync(path.join(BACKUP_DIR, `managed-backup-${backupId}-`));
  const tempDbPath = path.join(tempRoot, DB_NAME);
  const { archiveFilename, archivePath, sidecarPath } = createManagedBackupPaths(backupId, createdAt);

  backupLog.info(`Starting managed backup ${backupId}`);
  backupLog.info(`Requested by ${createdBy}`);
  if (note) {
    backupLog.info(`Backup note: ${note}`);
  }

  try {
    const snapshot = createSafeDatabaseSnapshot(tempDbPath);
    backupLog.info(`Database snapshot created (${snapshot.size_bytes} bytes)`);

    const photoFiles = listFilesRecursively(UPLOAD_DIR);
    const resourceImages = listManagedResourceImages();
    const configFiles = RESOURCE_CONFIG_BACKUP_PATHS
      .filter((entry) => fs.existsSync(entry.livePath))
      .map((entry) => ({
        key: entry.key,
        filename: entry.filename,
        livePath: entry.livePath,
        size_bytes: fs.statSync(entry.livePath).size
      }));
    const auctions = collectAuctionBackupSummary();

    backupLog.info(`Including ${photoFiles.length} photo file(s) from uploads`);
    backupLog.info(`Including ${resourceImages.length} resource image file(s)`);
    backupLog.info(`Including ${configFiles.length} resource config file(s)`);
    backupLog.info(`Captured metadata for ${auctions.length} auction(s)`);

    const metadata = {
      format_version: MANAGED_BACKUP_FORMAT_VERSION,
      backup_id: backupId,
      archive_filename: archiveFilename,
      created_at: createdAt,
      created_by: createdBy,
      schema_version: String(db.schemaVersion),
      note,
      backup_log_included: true,
      component_manifest: {
        database: {
          included: true,
          path: "database/auction.db",
          size_bytes: snapshot.size_bytes
        },
        photos: {
          included: true,
          path: "photos/",
          file_count: photoFiles.length,
          total_size_bytes: photoFiles.reduce((total, file) => total + file.size_bytes, 0)
        },
        resources: {
          included: true,
          image_path: "resources/images/",
          image_count: resourceImages.length,
          image_total_size_bytes: resourceImages.reduce((total, file) => total + file.size_bytes, 0),
          config_path: "resources/config/",
          config_files: configFiles.map((file) => ({
            key: file.key,
            filename: file.filename,
            size_bytes: file.size_bytes
          }))
        }
      },
      summary_counts: {
        auction_count: auctions.length,
        item_count: auctions.reduce((total, auction) => total + Number(auction.item_count || 0), 0)
      },
      auctions
    };

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(archivePath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", resolve);
      output.on("error", reject);
      archive.on("warning", (err) => {
        backupLog.warn(`Archive warning: ${err.message}`);
      });
      archive.on("error", reject);

      archive.pipe(output);
      archive.file(tempDbPath, { name: "database/auction.db" });

      for (const photo of photoFiles) {
        archive.file(photo.absolutePath, { name: `photos/${photo.relativePath}` });
      }

      for (const resource of resourceImages) {
        archive.file(resource.absolutePath, { name: `resources/images/${resource.relativePath}` });
      }

      for (const configFile of configFiles) {
        archive.file(configFile.livePath, { name: `resources/config/${configFile.filename}` });
      }

      archive.append(JSON.stringify(metadata, null, 2), { name: "metadata.json" });
      backupLog.info("Archive payload assembled");
      archive.append(backupLog.toString(), { name: "backup.log" });
      archive.finalize();
    });

    const archiveSize = fs.statSync(archivePath).size;
    backupLog.info(`Managed backup complete (${archiveSize} bytes)`);
    const sidecarMetadata = {
      ...metadata,
      archive_size_bytes: archiveSize
    };
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecarMetadata, null, 2), "utf8");

    logFromRequest(req, logLevels.INFO, `Managed backup created ${archiveFilename}`);
    res.json({
      message: "Backup created.",
      backup_id: backupId,
      filename: archiveFilename,
      created_at: createdAt,
      archive_size_bytes: archiveSize,
      backup_log: backupLog.toString()
    });
  } catch (err) {
    backupLog.error(`Managed backup failed: ${err.message}`);
    try {
      fs.rmSync(archivePath, { force: true });
      fs.rmSync(sidecarPath, { force: true });
    } catch (_cleanupError) {
      // Ignore cleanup failures for partially written backup files.
    }
    logFromRequest(req, logLevels.ERROR, `Managed backup failed: ${err.message}`);
    res.status(500).json({ error: "Failed to create backup." });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

router.get("/backups", (req, res) => {
  try {
    const backups = listManagedBackups();
    res.json({
      backups: backups.map(publicManagedBackupSummary),
      total_size_bytes: backups.reduce((total, backup) => total + Number(backup.archive_size_bytes || 0), 0)
    });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Failed to list backups: ${err.message}`);
    res.status(500).json({ error: "Failed to list backups." });
  }
});

router.get("/backups/:backupId/download", (req, res) => {
  try {
    const backup = readManagedBackupRecord(req.params.backupId);
    if (!backup) {
      return res.status(404).json({ error: "Backup not found." });
    }

    logFromRequest(req, logLevels.INFO, `Backup download requested ${backup.archive_filename}`);
    return res.download(backup.archive_path, backup.archive_filename, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: "Failed to download backup archive." });
      }
    });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Failed to download backup: ${err.message}`);
    return res.status(500).json({ error: "Failed to download backup archive." });
  }
});

router.get("/backups/:backupId", (req, res) => {
  try {
    const backup = readManagedBackupRecord(req.params.backupId);
    if (!backup) {
      return res.status(404).json({ error: "Backup not found." });
    }

    res.json(publicManagedBackupDetail(backup));
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Failed to load backup metadata: ${err.message}`);
    res.status(500).json({ error: "Failed to load backup metadata." });
  }
});

router.delete("/backups/:backupId", (req, res) => {
  try {
    const backup = readManagedBackupRecord(req.params.backupId);
    if (!backup) {
      return res.status(404).json({ error: "Backup not found." });
    }

    fs.rmSync(backup.archive_path, { force: true });
    fs.rmSync(backup.sidecar_path, { force: true });
    logFromRequest(req, logLevels.WARN, `Managed backup deleted ${backup.archive_filename}`);
    res.json({ message: "Backup deleted." });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Failed to delete backup: ${err.message}`);
    res.status(500).json({ error: "Failed to delete backup." });
  }
});

//--------------------------------------------------------------------------
// GET /download-db
// API to download full DB
//--------------------------------------------------------------------------

router.get("/download-db", (req, res) => {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ext = path.extname(DB_NAME);
  const base = path.basename(DB_NAME, ext);
  const filename = `${base}_${timestamp}${ext}`;
  const databaseFile = path.join(DB_PATH, DB_NAME);
  const tempSnapshotPath = path.join(BACKUP_DIR, `${base}_download_${Date.now()}${ext}`);

  db.setMaintenanceLock(true);
  try {
    db.close();
    fs.copyFileSync(databaseFile, tempSnapshotPath);
    if (typeof db.reopen === "function") {
      db.reopen({ skipClose: true });
    }
  } finally {
    db.setMaintenanceLock(false);
  }

  res.download(tempSnapshotPath, filename, (err) => {
    try {
      fs.rmSync(tempSnapshotPath, { force: true });
    } catch (_) {
      // Ignore cleanup errors for temp snapshot files.
    }
    if (err && !res.headersSent) {
      res.status(500).json({ error: "Failed to download database snapshot." });
    }
  });

});

//--------------------------------------------------------------------------
// POST /restore
// API to restore full DB from an uploaded copy
//--------------------------------------------------------------------------

router.post("/restore", async (req, res) => {
  try {
    await awaitMiddleware(upload.single("backup"))(req, res);

    if (!req.file || !req.file.path) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const filePath = req.file.path;


    try {
      validateSqliteSnapshot(filePath, { expectedSchemaVersion: String(db.schemaVersion) });
    } catch (ioErr) {
      fs.unlinkSync(filePath);
      logFromRequest(req, logLevels.ERROR, `Database restore failed ${ioErr.message}`);
      return res.status(400).json({ error: ioErr.message || "Unable to read uploaded file." });
    }

    const dbFilePath = path.join(DB_PATH, DB_NAME);
    const walPath = `${dbFilePath}-wal`;
    const shmPath = `${dbFilePath}-shm`;

    db.setMaintenanceLock(true);
    try {
      db.close();
      fs.copyFileSync(filePath, dbFilePath);
      fs.unlinkSync(filePath);
      fs.rmSync(walPath, { force: true });
      fs.rmSync(shmPath, { force: true });
      if (typeof db.reopen === "function") {
        db.reopen({ skipClose: true });
      }
    } finally {
      db.setMaintenanceLock(false);
    }

    logFromRequest(req, logLevels.INFO, "Database restored");
    res.json({ message: "Database restored." });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function restoreManagedBackup(backup, selection, req) {
  const restoreLog = createOperationLog();
  const operationId = `${backup.backup_id}_${Date.now()}`;
  const tempRoot = fs.mkdtempSync(path.join(BACKUP_DIR, `managed-restore-${operationId}-`));
  const stagedDbPath = path.join(tempRoot, "database", DB_NAME);
  const stagedPhotosDir = path.join(tempRoot, "photos");
  const stagedResourcesDir = path.join(tempRoot, "resources-images");
  const stagedConfigDir = path.join(tempRoot, "resources-config");
  const liveDbPath = path.join(DB_PATH, DB_NAME);
  const liveWalPath = `${liveDbPath}-wal`;
  const liveShmPath = `${liveDbPath}-shm`;
  const rollbackPaths = {};
  let databaseClosed = false;
  let databaseReopened = false;
  let photosApplied = false;
  let resourcesApplied = false;
  let databaseApplied = false;

  restoreLog.info(`Starting restore for backup ${backup.backup_id}`);
  restoreLog.info(`Requested by ${req.user?.username || "unknown"}`);
  restoreLog.info(`Restore selection: db=${selection.restoreDb}, photos=${selection.restorePhotos}, resources=${selection.restoreResources}`);

  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(backup.archive_path));
    const metadataEntry = zip.file("metadata.json");
    if (!metadataEntry) {
      throw new Error("Backup archive is missing metadata.json.");
    }

    const archiveMetadata = validateManagedBackupMetadata(JSON.parse(await metadataEntry.async("string")));
    if (String(archiveMetadata.backup_id) !== String(backup.backup_id)) {
      throw new Error("Backup archive metadata does not match the selected backup.");
    }

    if (selection.restoreDb) {
      const dbEntry = zip.file("database/auction.db");
      if (!dbEntry) {
        throw new Error("Backup archive is missing the database snapshot.");
      }

      ensureDirectory(path.dirname(stagedDbPath));
      fs.writeFileSync(stagedDbPath, await dbEntry.async("nodebuffer"));
      const validation = validateSqliteSnapshot(stagedDbPath, { expectedSchemaVersion: String(db.schemaVersion) });
      restoreLog.info(`Validated staged database snapshot (schema ${validation.schemaVersion})`);
    }

    if (selection.restorePhotos) {
      ensureDirectory(stagedPhotosDir);
      await extractZipPrefixToDirectory(zip, "photos/", stagedPhotosDir);
      restoreLog.info("Staged photo payload extracted");
    }

    if (selection.restoreResources) {
      ensureDirectory(stagedResourcesDir);
      ensureDirectory(stagedConfigDir);
      await extractZipPrefixToDirectory(zip, "resources/images/", stagedResourcesDir);
      await extractZipPrefixToDirectory(zip, "resources/config/", stagedConfigDir);

      for (const configFile of RESOURCE_CONFIG_BACKUP_PATHS) {
        const stagedPath = path.join(stagedConfigDir, configFile.filename);
        if (!fs.existsSync(stagedPath)) {
          throw new Error(`Backup archive is missing ${configFile.filename}.`);
        }
        JSON.parse(fs.readFileSync(stagedPath, "utf8"));
      }

      restoreLog.info("Staged resource payload extracted");
    }

    db.setMaintenanceLock(true);
    try {
      if (selection.restoreDb) {
        db.close();
        databaseClosed = true;
        restoreLog.info("Database connection closed for restore");
      }

      if (selection.restorePhotos) {
        rollbackPaths.photos = path.join(tempRoot, "rollback-uploads");
        if (fs.existsSync(UPLOAD_DIR)) {
          fs.renameSync(UPLOAD_DIR, rollbackPaths.photos);
        }
        ensureDirectory(UPLOAD_DIR);
        removeDirectoryContents(UPLOAD_DIR);
        copyDirectoryContents(stagedPhotosDir, UPLOAD_DIR);
        photosApplied = true;
        restoreLog.info("Photo directory replaced from staged restore");
      }

      if (selection.restoreResources) {
        rollbackPaths.resources = path.join(tempRoot, "rollback-resources");
        if (fs.existsSync(CONFIG_IMG_DIR)) {
          fs.renameSync(CONFIG_IMG_DIR, rollbackPaths.resources);
        }
        ensureDirectory(CONFIG_IMG_DIR);
        removeDirectoryContents(CONFIG_IMG_DIR);
        copyDirectoryContents(stagedResourcesDir, CONFIG_IMG_DIR);

        rollbackPaths.configs = path.join(tempRoot, "rollback-configs");
        ensureDirectory(rollbackPaths.configs);
        for (const configFile of RESOURCE_CONFIG_BACKUP_PATHS) {
          if (fs.existsSync(configFile.livePath)) {
            fs.copyFileSync(configFile.livePath, path.join(rollbackPaths.configs, configFile.filename));
          }
          fs.copyFileSync(path.join(stagedConfigDir, configFile.filename), configFile.livePath);
        }

        resourcesApplied = true;
        restoreLog.info("Resources and config files replaced from staged restore");
      }

      if (selection.restoreDb) {
        rollbackPaths.db = path.join(tempRoot, "rollback-auction.db");
        if (fs.existsSync(liveDbPath)) {
          fs.copyFileSync(liveDbPath, rollbackPaths.db);
        }
        fs.copyFileSync(stagedDbPath, liveDbPath);
        fs.rmSync(liveWalPath, { force: true });
        fs.rmSync(liveShmPath, { force: true });
        databaseApplied = true;
        restoreLog.info("Database file replaced from staged restore");

        if (typeof db.reopen === "function") {
          db.reopen({ skipClose: true });
          databaseReopened = true;
          databaseClosed = false;
          const liveValidation = validateSqliteSnapshot(liveDbPath, { expectedSchemaVersion: String(db.schemaVersion) });
          restoreLog.info(`Reopened restored database successfully (schema ${liveValidation.schemaVersion})`);
        }
      }
    } catch (swapErr) {
      restoreLog.error(`Restore swap failed: ${swapErr.message}`);

      if (databaseApplied && rollbackPaths.db && fs.existsSync(rollbackPaths.db)) {
        fs.copyFileSync(rollbackPaths.db, liveDbPath);
        fs.rmSync(liveWalPath, { force: true });
        fs.rmSync(liveShmPath, { force: true });
        restoreLog.warn("Rolled back database file");
      }

      if (resourcesApplied) {
        fs.rmSync(CONFIG_IMG_DIR, { recursive: true, force: true });
        if (rollbackPaths.resources && fs.existsSync(rollbackPaths.resources)) {
          fs.renameSync(rollbackPaths.resources, CONFIG_IMG_DIR);
        } else {
          ensureDirectory(CONFIG_IMG_DIR);
        }

        if (rollbackPaths.configs && fs.existsSync(rollbackPaths.configs)) {
          for (const configFile of RESOURCE_CONFIG_BACKUP_PATHS) {
            const rollbackConfigPath = path.join(rollbackPaths.configs, configFile.filename);
            if (fs.existsSync(rollbackConfigPath)) {
              fs.copyFileSync(rollbackConfigPath, configFile.livePath);
            }
          }
        }
        restoreLog.warn("Rolled back resource files");
      }

      if (photosApplied) {
        fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
        if (rollbackPaths.photos && fs.existsSync(rollbackPaths.photos)) {
          fs.renameSync(rollbackPaths.photos, UPLOAD_DIR);
        } else {
          ensureDirectory(UPLOAD_DIR);
        }
        restoreLog.warn("Rolled back photo files");
      }

      throw swapErr;
    } finally {
      if ((selection.restoreDb || databaseClosed) && !databaseReopened && typeof db.reopen === "function") {
        try {
          db.reopen({ skipClose: true });
        } catch (_reopenErr) {
          // Best effort; any relevant error is already being surfaced.
        }
      }
      db.setMaintenanceLock(false);
    }

    restoreLog.info("Managed restore completed successfully");
    logFromRequest(req, logLevels.WARN, `Managed backup restored ${backup.archive_filename}`);
    if (selection.restoreDb) {
      audit(getAuditActor(req), 'restore backup', 'backup', backup.backup_id, { selection });
    }
    return {
      ok: true,
      restored: {
        database: selection.restoreDb,
        photos: selection.restorePhotos,
        resources: selection.restoreResources
      },
      restore_log: restoreLog.toString()
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

router.post("/backups/:backupId/restore", async (req, res) => {
  try {
    const backup = readManagedBackupRecord(req.params.backupId);
    if (!backup) {
      return res.status(404).json({ error: "Backup not found." });
    }

    const selection = {
      restoreDb: Boolean(req.body?.restoreDb),
      restorePhotos: Boolean(req.body?.restorePhotos),
      restoreResources: Boolean(req.body?.restoreResources)
    };

    if (!selection.restoreDb && !selection.restorePhotos && !selection.restoreResources) {
      return res.status(400).json({ error: "Select at least one restore component." });
    }

    const result = await restoreManagedBackup(backup, selection, req);
    return res.json({
      message: "Restore completed.",
      ...result
    });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Managed restore failed: ${err.message}`);
    return res.status(400).json({ error: err.message || "Restore failed." });
  }
});


//--------------------------------------------------------------------------
// POST /reset
// API to reset auction (clear items, bids, payments). Requires explicit password
//--------------------------------------------------------------------------

router.post("/reset", checkAuctionState(['setup', 'archived']), (req, res) => {
  const { auction_id, password } = req.body;
  const username = req.user?.username;

  if (!auction_id || !password || !username) {
    return res.status(400).json({ error: "Missing auction_id or password." });
  }

  try {
    const user = getUserByUsername(username);
    if (!user || !user.password) {
      return res.status(403).json({ error: "Incorrect password" });
    }

    const stored = String(user.password || '');
    const valid = stored.startsWith('$2')
      ? bcrypt.compareSync(password, stored)
      : stored === password;

    if (!valid) {
      logFromRequest(req, logLevels.WARN, `Incorrect password attempt for auction reset by ${username}`);
      return res.status(403).json({ error: "Incorrect password" });
    }
  } catch (err) {
    return res.status(500).json({ error: "Error verifying password" });
  }

  try {
  //  db.pragma('defer_foreign_keys = ON');
    const result = db.transaction(id => {

      // Payment intents
      const delIntents = db.prepare(`DELETE FROM payment_intents WHERE bidder_id IN (SELECT id FROM bidders WHERE auction_id = ?)`).run(id).changes;
      
      /* payments */
      const delPay = db.prepare(`DELETE FROM payments WHERE bidder_id IN (SELECT id FROM bidders WHERE auction_id = ?)`).run(id).changes;

      /* items */
      const delItems = db.prepare(`DELETE FROM items WHERE auction_id = ?`).run(id).changes;

      /* bidders */
      const delBidders = db.prepare(`DELETE FROM bidders WHERE auction_id = ?`).run(id).changes;

      return { payment_intents: delIntents, payments: delPay, items: delItems, bidders: delBidders };
    })(auction_id);         // <-- execute the transaction

    res.json({
      ok: true,
      auction_id: auction_id,
      deleted: result        // { payments: n, items: n, bidders: n }
    });
    logFromRequest(req, logLevels.INFO, `Auction ${auction_id} has been reset. Removed: ${result.items} items, ${result.bidders} bidders, ${result.payments} payments, ${result.payment_intents} payment intents. `);
    audit(getAuditActor(req), 'reset auction', 'auction', auction_id, { deleted: result  });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Reset failed' });
  }
 // db.pragma('defer_foreign_keys = OFF');
})

//--------------------------------------------------------------------------
// POST /auctions/purge-deleted-items
// Permanently remove soft-deleted items and their photo files.
//--------------------------------------------------------------------------

router.post("/auctions/purge-deleted-items", (req, res) => {
  const { auction_id, password } = req.body || {};
  const auctionId = Number(auction_id);

  if (!auctionId || !password) {
    return res.status(400).json({ error: "Missing auction_id or password." });
  }

  try {
    verifyMaintenancePassword(req, password);
  } catch (err) {
    if (err.statusCode === 403) {
      logFromRequest(req, logLevels.WARN, `Incorrect password attempt for deleted item purge by ${req.user?.username || "unknown"}`);
    }
    return res.status(err.statusCode || 500).json({ error: err.message || "Error verifying password" });
  }

  try {
    const auction = db.get("SELECT id, short_name FROM auctions WHERE id = ?", [auctionId]);
    if (!auction) {
      return res.status(400).json({ error: "Auction not found." });
    }

    const deletedItems = db.all(`
      SELECT id, description, photo, auction_id, winning_bidder_id, hammer_price
        FROM items
       WHERE auction_id = ?
         AND COALESCE(is_deleted, 0) = 1
       ORDER BY id ASC
    `, [auctionId]);

    const bidBlocked = deletedItems.filter((item) => item.winning_bidder_id != null || item.hammer_price != null);
    if (bidBlocked.length > 0) {
      logFromRequest(req, logLevels.WARN, `Purge blocked for auction ${auctionId}; deleted items with bids: ${bidBlocked.map((item) => item.id).join(", ")}`);
      return res.status(400).json({ error: "Deleted items with bids cannot be purged.", item_ids: bidBlocked.map((item) => item.id) });
    }

    const itemIds = deletedItems.map((item) => Number(item.id));
    if (itemIds.length === 0) {
      return res.json({ ok: true, auction_id: auctionId, purged: { items: 0, photos: 0, photo_errors: [] } });
    }

    deletedItems.forEach((item) => {
      audit(getAuditActor(req), 'purge deleted item', 'item', item.id, {
        auction_id: item.auction_id,
        description: item.description || ''
      });
    });

    const placeholders = itemIds.map(() => "?").join(",");
    const deletedRowCount = db.prepare(`DELETE FROM items WHERE auction_id = ? AND id IN (${placeholders}) AND COALESCE(is_deleted, 0) = 1`).run(auctionId, ...itemIds).changes;

    let photosDeleted = 0;
    const photoErrors = [];
    const photoNames = Array.from(new Set(deletedItems.map((item) => item.photo).filter(Boolean)));
    photoNames.forEach((photo) => {
      [photo, `preview_${photo}`].forEach((filename) => {
        const filePath = path.join(UPLOAD_DIR, filename);
        if (!fs.existsSync(filePath)) return;
        try {
          fs.unlinkSync(filePath);
          photosDeleted += 1;
        } catch (err) {
          photoErrors.push({ file: filename, error: err.message });
          logFromRequest(req, logLevels.WARN, `Failed to delete purged item photo ${filename}: ${err.message}`);
        }
      });
    });

    audit(getAuditActor(req), 'purge deleted items', 'auction', auctionId, {
      item_count: deletedRowCount,
      item_ids: itemIds
    });
    logFromRequest(req, logLevels.INFO, `Purged ${deletedRowCount} deleted item(s) and ${photosDeleted} photo file(s) from auction ${auctionId}`);

    return res.json({
      ok: true,
      auction_id: auctionId,
      purged: {
        items: deletedRowCount,
        photos: photosDeleted,
        photo_errors: photoErrors
      }
    });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Deleted item purge failed for auction ${auctionId}: ${err.message}`);
    return res.status(500).json({ error: "Purge failed" });
  }
});

//--------------------------------------------------------------------------
// GET /export
// API to export items, bidders, and payments to CSV
//--------------------------------------------------------------------------

router.get("/export", (req, res) => {
  try {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `auction_export_${timestamp}.zip`;
    const archive = archiver("zip", { zlib: { level: 9 } });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    archive.on("warning", (err) => {
      console.warn("Export archive warning:", err.message);
    });
    archive.on("error", (err) => {
      console.error("Export archive error:", err.message);
      if (!res.headersSent) {
        res.status(500);
      }
      res.end();
    });

    archive.pipe(res);

    const tables = [
      { table: "auctions", filename: "auctions.csv" },
      { table: "items", filename: "items.csv" },
      { table: "bidders", filename: "bidders.csv" },
      { table: "payment_intents", filename: "payment_intents.csv" },
      { table: "payments", filename: "payments.csv" }
    ];

    const metadata = {
      exported_at: now.toISOString(),
      schema_version: db.schemaVersion,
      db_name: DB_NAME,
      tables: []
    };

    for (const entry of tables) {
      const fields = db.prepare(`PRAGMA table_info(${entry.table})`).all().map(row => row.name);
      const rows = db.prepare(`SELECT * FROM ${entry.table}`).all();
      const parser = new Parser({ fields });
      const csv = parser.parse(rows);

      archive.append('\uFEFF' + csv, { name: entry.filename });
      metadata.tables.push({
        table: entry.table,
        filename: entry.filename,
        rows: rows.length,
        fields
      });
    }

    archive.append(JSON.stringify(metadata, null, 2), { name: "metadata.json" });
    archive.finalize();
    logFromRequest(req, logLevels.INFO, "Bulk CSV export archive complete");
  } catch (err) {
    console.error("Export failed:", err.message);
    res.status(500).json({ error: "Export failed" });
  }
});


//--------------------------------------------------------------------------
// POST /import
// API to Import items from simplified CSV (retaining existing data)
//--------------------------------------------------------------------------

router.post("/import", async (req, res) => {
  logFromRequest(req, logLevels.INFO, "Bulk CSV import requested");

  try {

      await awaitMiddleware(upload.single('csv'))(req, res);

    // ── 1. Read CSV ──────────────────────────────────────────────────────────
    const csv = fs.readFileSync(req.file.path, "utf-8");
    const lines = csv.split("\n").filter(Boolean);
    const headers = lines.shift().split(",").map(h => h.trim().toLowerCase());

    const expected = ["description", "artist", "contributor", "notes", "auction_id"];
    if (!expected.every(h => headers.includes(h))) {
      return res
        .status(400)
        .json({ error: "CSV must contain description, artist, contributor, notes, and auction_id columns." });
    }

    // ── 2. Parse rows → objects  ─────────────────────────────────────────────
    const items = lines.map(line => {
      const cols = line.split(",").map(v => v.trim());
      return Object.fromEntries(headers.map((h, i) => [h, cols[i] || ""]));
    });

    if (items.length === 0) {
      return res.status(400).json({ error: "CSV contains no data rows." });
    }

    // ── 3. Validate auction IDs in one go  ───────────────────────────────────
    const auctionIds = [...new Set(items.map(r => Number(r.auction_id)))];
    const validAuctionId = new Set(
      db.prepare("SELECT id FROM auctions WHERE id IN (" + auctionIds.map(() => "?").join(",") + ")")
        .all(...auctionIds)
        .map(r => r.id)
    );

    const invalid = auctionIds.filter(id => !validAuctionId.has(id));
    if (invalid.length) {
      return res
        .status(400)
        .json({ error: `Auction id(s) not found: ${invalid.join(", ")}` });
    }

    // ── 4. Prepare helpers  ──────────────────────────────────────────────────
    const nextItemStmt = db.prepare(
      "SELECT IFNULL(MAX(item_number),0)+1 AS next FROM items WHERE auction_id = ? AND COALESCE(is_deleted, 0) = 0"
    );
    const insertStmt = db.prepare(
      `INSERT INTO items
         (item_number, description, artist, contributor, notes, auction_id, date)
       VALUES
         (@item_number, @description, @artist, @contributor, @notes, @auction_id,
          strftime('%d-%m-%Y %H:%M:%S','now','localtime'))`
    );

    // keep a local counter per auction to avoid N queries inside the loop
    const nextNumber = Object.fromEntries(
      auctionIds.map(id => [id, nextItemStmt.get(id).next])
    );

    // ── 5. Transactional bulk insert  ────────────────────────────────────────
    const insertMany = db.transaction(list => {
      for (const row of list) {
        const aid = Number(row.auction_id);
        insertStmt.run({
          ...row,
          auction_id: aid,
          item_number: nextNumber[aid]++
        });
      }
    });
    insertMany(items);

    res.json({ message: `${items.length} rows imported.` });
    logFromRequest(
      req,
      logLevels.INFO,
      `Bulk CSV import completed for ${items.length} items`
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
    logFromRequest(req, logLevels.ERROR, `Bulk CSV import failed: ${err.message}`);
  } finally {
    // clean up temp upload
    try { fs.unlinkSync(req.file.path); } catch { }
  }
});

//--------------------------------------------------------------------------
// GET /photo-report
// API to get a Photo storage report
//--------------------------------------------------------------------------

router.get("/photo-report", (req, res) => {
 // const files = fs.readdirSync("./uploads");
  const files = fs.readdirSync( UPLOAD_DIR );
  const totalSize = files.reduce((sum, file) => sum + fs.statSync(path.join(UPLOAD_DIR, file)).size, 0);
  res.json({ count: files.length, totalSize });
  logFromRequest(req, logLevels.INFO, `${files.length} photos stored, ${totalSize / 1024 / 1024} occupied`);
});

//--------------------------------------------------------------------------
// GET /check-integrity
// API to run integrity diagnostics in summary or verbose mode
//--------------------------------------------------------------------------

router.get("/check-integrity", (req, res) => {
  const requestedMode = req.query?.mode;
  const mode = requestedMode === SUMMARY_MODE ? SUMMARY_MODE : VERBOSE_MODE;

  try {
    const result = collectIntegrityChecks(mode);
    res.json(result);
    logFromRequest(
      req,
      result.has_problems ? logLevels.WARN : logLevels.INFO,
      `Integrity check (${mode}) complete: ${result.summary_text}`
    );
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Integrity check failed: ${err.message}`);
    res.status(500).json({ error: 'Integrity check failed.' });
  }
});

router.post("/check-integrity/fix", (req, res) => {
  try {
    const result = applyIntegrityFixes(req);
    res.json(result);
    logFromRequest(
      req,
      result.applied_fix_count > 0 ? logLevels.WARN : logLevels.INFO,
      `Integrity fixes applied: ${result.applied_fix_count}, remaining problems: ${result.remaining_problem_count}`
    );
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Integrity fix failed: ${err.message}`);
    res.status(500).json({ error: 'Integrity fix failed.' });
  }
});
//--------------------------------------------------------------------------
// Remove invalid items API (disabled as this only had limited usecase and feels like more a security risk!)
//--------------------------------------------------------------------------

// router.post("/check-integrity/delete", (req, res) => {
//   const { ids } = req.body;
//   if (!Array.isArray(ids) || ids.length === 0) {
//     logFromRequest(req, logLevels.ERROR, `No item IDs provided for deletion`);
//     return res.status(400).json({ error: "No item IDs provided for deletion" });
//   }

//   const placeholders = ids.map(() => "?").join(",");
//   db.run(`DELETE FROM items WHERE id IN (${placeholders})`, ids, function (err) {
//     if (err) return res.status(500).json({ error: err.message });
//     res.json({ message: `Deleted ${this.changes} invalid item(s).` });
//     logFromRequest(req, logLevels.WARN, `Deleted ${this.changes} invalid item(s).`);

//   });
// });

//--------------------------------------------------------------------------
// User management
//--------------------------------------------------------------------------

router.get("/users", requireManageUsers, (req, res) => {
  try {
    const users = listUsers();
    return res.json({
      users,
      roles: ROLE_LIST,
      permissions: PERMISSION_LIST,
      current_user: req.user?.username || null
    });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Failed to list users: ${err.message}`);
    return res.status(500).json({ error: "Failed to list users." });
  }
});

router.post("/users", requireManageUsers, (req, res) => {
  const { username, password, roles, permissions } = req.body || {};
  const normalizedUsername = normaliseUsername(username);
  const normalizedRoles = normaliseRoles(roles);
  const normalizedPermissions = normalisePermissions(permissions, normalizedRoles);

  if (!isValidUsername(normalizedUsername)) {
    return res.status(400).json({ error: "Invalid username. Use 3-64 chars: a-z, 0-9, ., _, -" });
  }

  if (!password || String(password).length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
  }

  if (normalizedRoles.length === 0 && normalizedPermissions.length === 0) {
    return res.status(400).json({ error: "Assign at least one role or permission." });
  }

  try {
    const hashed = bcrypt.hashSync(password, 12);
    createUser({
      username: normalizedUsername,
      passwordHash: hashed,
      roles: normalizedRoles,
      permissions: normalizedPermissions
    });
    audit(getAuditActor(req), 'create user', 'server', null, {
      username: normalizedUsername,
      roles: normalizedRoles,
      permissions: normalizedPermissions
    });
    logFromRequest(
      req,
      logLevels.INFO,
      `Created user ${normalizedUsername} with roles: ${normalizedRoles.join(", ")} and permissions: ${normalizedPermissions.join(", ")}`
    );
    return res.status(201).json({ message: `User "${normalizedUsername}" created.` });
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: "Username already exists." });
    }
    if (err.message === 'invalid_username') {
      return res.status(400).json({ error: "Invalid username." });
    }
    if (err.message === 'roles_required' || err.message === 'access_required') {
      return res.status(400).json({ error: "Assign at least one role or permission." });
    }
    logFromRequest(req, logLevels.ERROR, `Failed to create user: ${err.message}`);
    return res.status(500).json({ error: "Failed to create user." });
  }
});

router.patch("/users/:username/access", requireManageUsers, (req, res) => {
  const target = normaliseUsername(req.params.username);
  const roles = normaliseRoles(req.body?.roles);
  const permissions = normalisePermissions(req.body?.permissions, roles);

  if (!isValidUsername(target)) {
    return res.status(400).json({ error: "Invalid username." });
  }

  if (roles.length === 0 && permissions.length === 0) {
    return res.status(400).json({ error: "Assign at least one role or permission." });
  }

  try {
    const result = updateUserAccess(target, { roles, permissions });
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const updated = getUserByUsername(target);
    audit(getAuditActor(req), 'update user access', 'server', null, {
      username: target,
      roles: updated?.roles || roles,
      permissions: updated?.permissions || permissions
    });
    logFromRequest(
      req,
      logLevels.INFO,
      `Updated access for user ${target}: roles=${updated?.roles.join(", ") || roles.join(", ")}, permissions=${updated?.permissions.join(", ") || permissions.join(", ")}`
    );
    return res.json({ message: `Permissions updated for "${target}".`, user: updated });
  } catch (err) {
    if (err.message === 'roles_required' || err.message === 'access_required') {
      return res.status(400).json({ error: "Assign at least one role or permission." });
    }
    logFromRequest(req, logLevels.ERROR, `Failed to update user roles for ${target}: ${err.message}`);
    return res.status(500).json({ error: "Failed to update user permissions." });
  }
});

router.patch("/users/:username/roles", requireManageUsers, (req, res) => {
  const target = normaliseUsername(req.params.username);
  const roles = normaliseRoles(req.body?.roles);

  if (!isValidUsername(target)) {
    return res.status(400).json({ error: "Invalid username." });
  }

  if (roles.length === 0) {
    return res.status(400).json({ error: "At least one role is required." });
  }

  try {
    const result = updateUserRoles(target, roles);
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const updated = getUserByUsername(target);
    audit(getAuditActor(req), 'update user roles', 'server', null, {
      username: target,
      roles: updated?.roles || roles,
      permissions: updated?.permissions || []
    });
    logFromRequest(req, logLevels.INFO, `Updated roles for user ${target}: ${updated?.roles.join(", ") || roles.join(", ")}`);
    return res.json({ message: `Permissions updated for "${target}".`, user: updated });
  } catch (err) {
    if (err.message === 'roles_required') {
      return res.status(400).json({ error: "At least one role is required." });
    }
    logFromRequest(req, logLevels.ERROR, `Failed to update user roles for ${target}: ${err.message}`);
    return res.status(500).json({ error: "Failed to update user permissions." });
  }
});

router.post("/users/:username/password", requireManageUsers, (req, res) => {
  const target = normaliseUsername(req.params.username);
  const { newPassword } = req.body || {};

  if (!isValidUsername(target)) {
    return res.status(400).json({ error: "Invalid username." });
  }

  if (!newPassword || String(newPassword).length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
  }

  const currentUser = normaliseUsername(req.user?.username || '');
  logFromRequest(req, logLevels.DEBUG, `Requested password change for ${target} by ${currentUser} `);

  if (target === ROOT_USERNAME && currentUser !== ROOT_USERNAME) {
     logFromRequest(req, logLevels.WARN, `Root password change can only be done by ${target}, attempted by ${currentUser} `);
    return res.status(403).json({ error: `Only ${ROOT_USERNAME} can change this password.` });
  }

  try {
    const hashed = bcrypt.hashSync(newPassword, 12);
    const result = setUserPassword(target, hashed);
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    audit(getAuditActor(req), 'change password', 'server', null, { changed_user: target, requestor: currentUser });
        logFromRequest(req, logLevels.INFO, `Updated password for ${target}`);

    return res.json({ message: `Password updated for "${target}".` });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Failed to update password for ${target}: ${err.message}`);
    return res.status(500).json({ error: "Failed to update password." });
  }
});

router.post("/users/:username/logout-now", requireManageUsers, (req, res) => {
  const target = normaliseUsername(req.params.username);
  const currentUser = normaliseUsername(req.user?.username || '');

  if (!isValidUsername(target)) {
    return res.status(400).json({ error: "Invalid username." });
  }

  const existing = getUserByUsername(target);
  if (!existing) {
    return res.status(404).json({ error: "User not found." });
  }

  try {
    const result = invalidateUserSessions(target);
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    audit(getAuditActor(req), 'logout user sessions', 'server', null, {
      username: target,
      requestor: currentUser
    });
    logFromRequest(req, logLevels.INFO, `Invalidated sessions for ${target} by ${currentUser}`);
    return res.json({ message: `User "${target}" logged out from all sessions.` });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Failed to invalidate sessions for ${target}: ${err.message}`);
    return res.status(500).json({ error: "Failed to log out user." });
  }
});

router.delete("/users/:username", requireManageUsers, (req, res) => {
  const target = normaliseUsername(req.params.username);
  const currentUser = normaliseUsername(req.user?.username || '');

  if (!isValidUsername(target)) {
    return res.status(400).json({ error: "Invalid username." });
  }

  if (target === currentUser) {
    return res.status(400).json({ error: "You cannot delete your own account while logged in." });
  }

  try {
    const result = deleteUser(target);
    if (!result || result.changes === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    audit(getAuditActor(req), 'delete user', 'server', null, { username: target });
    logFromRequest(req, logLevels.INFO, `Deleted user ${target} by ${currentUser}`);
    return res.json({ message: `User "${target}" deleted.` });
  } catch (err) {
    if (err.message === 'root_cannot_be_deleted') {
      return res.status(400).json({ error: 'The root user cannot be deleted.' });
    }
    logFromRequest(req, logLevels.ERROR, `Failed to delete user ${target}: ${err.message}`);
    return res.status(500).json({ error: "Failed to delete user." });
  }
});


//--------------------------------------------------------------------------
// POST /restart
// API to Restart the server
// Tries pm2 first, then systemctl, then user-level systemctl
//--------------------------------------------------------------------------

router.post("/restart", (req, res) => {
  res.json({ message: "Restarting server. Check server log panel for status" });
  logFromRequest(req, logLevels.INFO, `Server restart requested`);

  setTimeout(() => {

    exec(`pm2 restart ${SERVICE_NAME}`, (err) => {
      if (!err) return;
    })
  }, 1000);

  setTimeout(() => {


    const attempts = [
      { label: "systemctl", cmd: `systemctl restart ${SERVICE_NAME}` },
      { label: "systemctl --user", cmd: `systemctl --user restart ${SERVICE_NAME}` },
      { label: "sudo systemctl", cmd: `sudo systemctl restart ${SERVICE_NAME}` },
      { label: "service", cmd: `service ${SERVICE_NAME} restart` },
    ];
    const errors = [];
    const runAttempt = (index) => {
      if (index >= attempts.length) {
        if (errors.length > 0) {
          const details = errors.map((e) => `${e.label}: ${e.error}`).join(" | ");
          logFromRequest(req, logLevels.ERROR, `All restart attempts failed. ${details}`);
        }
        return;
      }
      const attempt = attempts[index];
      exec(attempt.cmd, (err, _stdout, stderr) => {
        if (!err) return;
        const errorText = (stderr || err.message || "unknown error").trim();
        errors.push({ label: attempt.label, error: errorText });
        runAttempt(index + 1);
      });
    };
    runAttempt(0);
  }, 1000);
});

//--------------------------------------------------------------------------
// GET /logs
// API to get recent server logs
//--------------------------------------------------------------------------


router.get("/logs", (req, res) => {
  fs.readFile(logFilePath, 'utf8', (err, data) => {
    if (err) {
      logFromRequest(req, logLevels.ERROR, `Log file read error: ${err}`);

      return res.status(500).json({ error: "Failed to retrieve logs." });
    }

    const lines = data.split('\n').filter(Boolean); // Remove empty lines
    const trimmed = lines.slice(-logLines);

    const startupMarker = "starting up";
    const reversedIndex = [...trimmed].reverse().findIndex(line =>
      line.toLowerCase().includes(startupMarker)
    );

    const startIndex = reversedIndex >= 0 ? trimmed.length - reversedIndex - 1 : -1;
    const filtered = startIndex >= 0 ? trimmed.slice(startIndex).join("\n") : trimmed.join("\n");

    res.json({ log: filtered });
  });
});

//--------------------------------------------------------------------------
// GET /download-full
// API to download a zip file containing the database and all images
//--------------------------------------------------------------------------

router.get("/download-full", (req, res) => {
  logFromRequest(req, logLevels.DEBUG, `Full download requested`);
  const archive = archiver("zip", { zlib: { level: 9 } });

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19); // e.g. 2024-04-10T14-33-58
  const filename = `auction_backup_${timestamp}.zip`;


  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  // close and reopen the database to make sure changes are written back
  db.setMaintenanceLock(true);
  try {
    db.close();
    if (typeof db.reopen === "function") {
      db.reopen({ skipClose: true });
    }
  } finally {
    db.setMaintenanceLock(false);
  }

  archive.pipe(res);

  // Add DB file
  archive.file(path.join(DB_PATH, DB_NAME));

  // Add referenced photos
  db.all("SELECT photo FROM items WHERE photo IS NOT NULL", [], (err, rows) => {
    if (err) {
      archive.append(`Error reading DB: ${err.message}`, { name: "error.txt" });
      archive.finalize();
      return;
    }

    const usedPhotos = new Set(rows.map(r => r.photo));
    for (const filename of usedPhotos) {
      const filePath = path.join(UPLOAD_DIR, filename);
      if (fs.existsSync(filePath)) {
//        archive.file(filePath, { name: `uploads/${filename}` });
        archive.file(filePath, { name: path.join(UPLOAD_DIR, filename) });

      }
    }


    // Include additional image resources from CONFIG_IMG_DIR
    const extraResources = fs.readdirSync(CONFIG_IMG_DIR).filter(f =>
      [".jpg", ".jpeg", ".png"].includes(path.extname(f).toLowerCase())
    );

    for (const resource of extraResources) {
      const resourcePath = path.join(CONFIG_IMG_DIR, resource);
      if (fs.existsSync(resourcePath)) {
        archive.file(resourcePath, { name: `resources/${resource}` });
      }
    }


    archive.finalize();
    logFromRequest(req, logLevels.INFO, `Full download generated`);

  });
});

//--------------------------------------------------------------------------
// GET /orphan-photos
// API to find photos without an owner
//--------------------------------------------------------------------------


router.get("/orphan-photos", (req, res) => {
  db.all(`SELECT photo FROM items WHERE photo IS NOT NULL`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const usedPhotos = new Set();
    rows.forEach(row => {
      if (row.photo) {
        usedPhotos.add(row.photo);
        usedPhotos.add("preview_" + row.photo);
      }
    });

    const allFiles = fs.readdirSync(UPLOAD_DIR);
    const orphaned = allFiles.filter(file => !usedPhotos.has(file));

    logFromRequest(req, logLevels.INFO, `${orphaned.length} orphan photos found`);
    res.json({ count: orphaned.length, orphaned });
  });
});


router.post("/cleanup-orphan-photos", (req, res) => {
  db.all(`SELECT photo FROM items WHERE photo IS NOT NULL`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    // Track both original and preview filenames
    const usedFiles = new Set();
    rows.forEach(row => {
      if (row.photo) {
        usedFiles.add(row.photo);
        usedFiles.add("preview_" + row.photo);
      }
    });

    const allFiles = fs.readdirSync(UPLOAD_DIR);
    const orphaned = allFiles.filter(file => !usedFiles.has(file));
    const orphanSize = orphaned.reduce((sum, file) => sum + fs.statSync(path.join(UPLOAD_DIR, file)).size, 0);
    const orphanSizeMb = (orphanSize / 1024 / 1024).toFixed(2);

    let deleted = 0;
    orphaned.forEach(file => {
      try {
        fs.unlinkSync(path.join(UPLOAD_DIR, file));
        deleted++;
      } catch (e) {
        logFromRequest(req, logLevels.ERROR, `Failed to delete ${file}: ` + e.message);
      }
    });

    res.json({ message: `Deleted ${deleted} orphaned file(s). Recovered ${orphanSizeMb} Mb.`, orphaned });
    logFromRequest(req, logLevels.INFO, `${deleted} orphan photos deleted. Recovered ${orphanSizeMb} Mb.`);
  });
});


function getNextItemNumber(auction_id, callback) {
  db.get(`SELECT MAX(item_number) + 1 AS next FROM items WHERE auction_id = ? AND COALESCE(is_deleted, 0) = 0`, [auction_id], (err, row) => {
    if (err) return callback(err);
    const itemNumber = row?.next || 1;
    callback(null, itemNumber);
  });
}

function getNextItemNumberAsync(auction_id) {
  return new Promise((resolve, reject) => {
    getNextItemNumber(auction_id, (err, itemNumber) => {
      if (err) reject(err);
      else resolve(itemNumber);
    });
  });
}

//--------------------------------------------------------------------------
// POST /generate-test-data
// API to generate test items based on sample-items.json
//--------------------------------------------------------------------------


router.post("/generate-test-data", checkAuctionState(['setup']), async (req, res) => {
  const count = parseInt(req.body.count, 10);
  const { auction_id } = req.body;
  if (!count || count < 1 || count > 1000 || !auction_id) {
    logFromRequest(req, logLevels.ERROR, `Invalid number of test items requested, or no auction id`);
    return res.status(400).json({ error: "Please enter a valid count (1–1000) and auction" });

  }
  logFromRequest(req, logLevels.INFO, `Request to generate ${count} items for ID ${auction_id}`);

  const samplePath = path.join(__dirname, "sample-items.json");
  const photos = fs.readdirSync(SAMPLE_DIR).filter(f => f.endsWith(".jpg"));

  if (!fs.existsSync(samplePath)) {
    logFromRequest(req, logLevels.ERROR, `Test item JSON file not found`);
    return res.status(500).json({ error: "Sample JSON not found." });
  }

  if (photos.length === 0) {
    logFromRequest(req, logLevels.ERROR, `No test item photos found`);
    return res.status(500).json({ error: "No sample photos available." });
  }


  let sampleData;
  try {
    sampleData = JSON.parse(fs.readFileSync(samplePath, "utf-8"));
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Test item JSON failed to parse`);
    return res.status(500).json({ error: "Failed to parse sample JSON." });
  }


  function getRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  const items = Array.from({ length: count }, () => ({
    description: getRandom(sampleData.descriptions),
    contributor: getRandom(sampleData.contributors),
    artist: getRandom(sampleData.artists),
    notes: getRandom(sampleData.notes)
  }));

  const stmt = db.prepare(`INSERT INTO items (description, contributor, artist, notes, photo, auction_id, item_number, date, test_item) VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%d-%m-%Y %H:%M:%S', 'now', 'localtime'), '1')`);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    //   const srcPath = path.join(SAMPLE_DIR, photos[i % photos.length]);
    const srcPath = path.join(SAMPLE_DIR, photos[Math.floor(Math.random() * photos.length)]);

    const baseFilename = `sample_${Date.now()}_${i}.jpg`;
    const resizedFilename = `resized_${baseFilename}`;
    const previewFilename = `preview_resized_${baseFilename}`;

    // const resizedPath = path.join(__dirname, "uploads", resizedFilename);
    // const previewPath = path.join(__dirname, "uploads", previewFilename);

    const resizedPath = path.join(UPLOAD_DIR, resizedFilename);
    const previewPath = path.join(UPLOAD_DIR, previewFilename);

    try {
      await sharp(srcPath)
        .resize(1600, 1600, { fit: 'inside' })
        .jpeg({ quality: 90 })
        .toFile(resizedPath);

      await sharp(srcPath)
        .resize(300, 300, { fit: 'inside' })
        .jpeg({ quality: 70 })
        .toFile(previewPath);
    } catch (err) {
      logFromRequest(req, logLevels.ERROR, `Image processing failed for ${srcPath}:` + err.message);
      continue;
    }



    let itemNumber;
    try {
      itemNumber = await getNextItemNumberAsync(auction_id);
    } catch (err) {
      return res.status(500).json({ error: "Database error getting item number" });
    }

    const taggedNote = `[TEST DATA] ${item.notes || ""}`;
    const result = stmt.run(item.description, item.contributor, item.artist, taggedNote.trim(), resizedFilename, auction_id, itemNumber);

    const itemId = result.lastInsertRowid;

    audit(getAuditActor(req), 'new item (test)', 'item', itemId, { description: item.description, initial_number: itemNumber });

  }


  stmt.finalize();
  res.json({ message: `${items.length} randomized test item(s) inserted.` });
  logFromRequest(req, logLevels.INFO, `${items.length} Test items added to auction ${auction_id}`);

});

//--------------------------------------------------------------------------
// GET /get-pptx-config/:name
// POST /save-pptx-config/:name
// POST /pptx-config/reset
//
// API trio to get, save and reset to default, the pptx configs
//--------------------------------------------------------------------------



router.get('/get-pptx-config/:name', (req, res) => {
  const configName = String(req.params.name || "").trim().toLowerCase();
  const file = CONFIG_PATHS[configName];
  if (!file) {
    logFromRequest(req, logLevels.ERROR, `Unexpected file read requested`);
    return res.status(400).json({ error: 'Invalid config name' });
  }
  fs.readFile(file, 'utf8', (err, data) => {
    if (err) {
      logFromRequest(req, logLevels.ERROR, `Unable to read config`);
      return res.status(500).json({ error: 'Unable to read config' });
    }
    res.type('application/json').send(data);
  });
});


router.post('/save-pptx-config/:name', async (req, res) => {
  const configName = String(req.params.name || "").trim().toLowerCase();
  const file = CONFIG_PATHS[configName];
  if (!file) {
    logFromRequest(req, logLevels.WARN, `Unexpected file write requested`);
    return res.status(400).json({ error: `Invalid config name ${configName}` });
  }

  // ensure we have a parsed JSON object
  if (!req.body || typeof req.body !== 'object') {
    logFromRequest(req, logLevels.WARN, `PPTX config rejected, missing/invalid JSON body`);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  try {
    let ok;
    let errors;
    let normalizedJson;

    if (configName === "slip") {
      ({ ok, errors, normalizedJson } = validateAndNormalizeSlipConfig(req.body));
    } else {
      // validate image paths for pptx/card configs before saving
      ({ ok, errors, normalizedJson } = await validateJsonPaths(req.body, {
        baseImgDir: CONFIG_IMG_DIR,
        allowedExtensions: allowedExtensions,
        requireExistence: true,   // set false if you allow references that will exist later
        contentSniff: true,       // uses sharp under the hood to confirm it's a real image
        checkOnlyKeys: ['image', 'images', 'thumbnail', 'background', 'path'],
        checkKeysRegex: [/image/i, /thumb/i, /background/i, /photo/i, /^background$/i, /path/i],
        outputStyle: 'absolute',
      }));
    }

    if (!ok) {
      logFromRequest(
        req,
        logLevels.WARN,
        `${configName} config rejected: ${errors.length} validation error(s)`
      );

      errors.forEach((e, idx) => {
        logFromRequest(
          req,
          logLevels.WARN,
          `Config validation failed [${idx + 1}/${errors.length}] at ${e.jsonPath}: ${e.error}; value="${preview(e.value)}"`
        );
      });

      return res.status(400).json({
        error: `${configName} configuration validation failed with ${errors.length} error(s)`,
        details: errors
      });
    }

    // save the sanitized JSON produced by the validator (normalized POSIX paths, etc.)
    const json = JSON.stringify(normalizedJson, null, 2);

    fs.writeFile(file, json, 'utf8', (err) => {
      if (err) {
        logFromRequest(req, logLevels.ERROR, `Unable to save config: ${err.message}`);
        return res.status(500).json({ error: 'Unable to save config' });
      }
      res.json({ message: 'Configuration updated successfully.' });
      logFromRequest(req, logLevels.INFO, `Config file ${file} updated`);
    });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Unhandled error in save-pptx-config: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }

// helper to avoid log spam / secrets leakage
function preview(str, max = 180) {
  if (typeof str !== 'string') return String(str);
  const clean = str.replace(/\s+/g, ' ').slice(0, max);
  return clean + (str.length > max ? '…' : '');
}

});

router.post("/pptx-config/reset", (req, res) => {
  const { configType } = req.body;

  if (!configType || !["pptx", "card", "slip"].includes(configType)) {
    logFromRequest(req, logLevels.ERROR, `Invalid config type:` + configType);
    return res.status(400).json({ error: "Invalid config type." });
  }

  // const defaultPath = path.join(__dirname, `./pptx-config/${configType}Config.default.json`);
  // const livePath = path.join(__dirname, `./pptx-config/${configType}Config.json`);

  const defaultPath = path.join(__dirname, `default.${configType}Config.json`);
  const livePath = path.join(PPTX_CONFIG_DIR, `${configType}Config.json`);
  try {
    if (!fs.existsSync(defaultPath)) {
      logFromRequest(req, logLevels.ERROR, `Default config not found:` + defaultPath);

      return res.status(500).json({ error: "Default config not found." });

    }

    fs.copyFileSync(defaultPath, livePath);
    logFromRequest(req, logLevels.INFO, `Reset ${configType}Config.json to default.`);
    res.json({ message: `${configType}Config.json reset to default.` });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Error resetting config:` + err.message);

    res.status(500).json({ error: "Failed to reset config." });
  }
});

//--------------------------------------------------------------------------
// POST /auctions/delete
// API to delete auctions. Includes database full reset on final delete
//--------------------------------------------------------------------------


router.post("/auctions/delete", (req, res) => {
  const { auction_id } = req.body;

  if (!auction_id) {
    return res.status(400).json({ error: "Missing auction_id" });
  }

  // Step 1: Check if auction has items
  db.get("SELECT COUNT(*) AS count FROM items WHERE auction_id = ?", [auction_id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });

    if (result.count > 0) {
      logFromRequest(req, logLevels.WARN, `Can't delete - Auction ${auction_id} contains items`);
      return res.status(400).json({ error: "Cannot delete auction with associated items." });
    }

    // Step 2: Delete the auction
    db.run("DELETE FROM auctions WHERE id = ?", [auction_id], function (err) {
      if (err) {
        logFromRequest(req, logLevels.ERROR, `Delete auction error` + err.message);
        
        return res.status(500).json({ error: err.message });
      }
      
      audit(getAuditActor(req), 'delete auction', 'auction', auction_id, {});
      // Step 3: Check how many auctions remain
      db.get("SELECT COUNT(*) AS count FROM auctions", [], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        // clearup on last auction delete
        if (result.count === 0) {

          try {
            logFromRequest(req, logLevels.INFO, `Deleting last auction. Resetiing database`);

            const deleteBatch = db.transaction(() => {
              db.pragma("foreign_keys = OFF");
              db.prepare("DELETE FROM auctions").run();
              logFromRequest(req, logLevels.DEBUG, `Auctions table cleared`);
              

              db.prepare("DELETE FROM bidders").run();
              logFromRequest(req, logLevels.DEBUG, `Bidders table cleared`);

              db.prepare("DELETE FROM items").run();
              logFromRequest(req, logLevels.DEBUG, `items table cleared`);

              db.prepare("DELETE FROM payments").run();
              logFromRequest(req, logLevels.DEBUG, `Payments table cleared`);

              db.prepare("DELETE FROM payment_intents").run();
              logFromRequest(req, logLevels.DEBUG, `Payment Intents table cleared`);
              db.pragma("foreign_keys = ON");

            });

            deleteBatch(); // execute the transaction

            res.json({ message: "Database reset actions completed successfully." });
            audit(getAuditActor(req), 'reset database', 'database', null, { reason: 'last auction deleted' });

          } catch (err) {
            logFromRequest(req, logLevels.ERROR, `Reset failed: ${err.message}`);
            res.status(500).json({ error: "Reset failed", details: err.message });
          }

        } else {
          // The normal case.....
          logFromRequest(req, logLevels.INFO, `Auction ${auction_id} deleted`);
          audit(getAuditActor(req), 'delete auction', 'auction', auction_id, {});
          return res.json({ message: "Auction deleted." });
        }
      });
    });
  });
});

//--------------------------------------------------------------------------
// POST /auctions/create
// API to add an auction
//--------------------------------------------------------------------------

router.post("/auctions/create", (req, res) => {
  const { short_name, full_name, logo } = req.body;

  const shortNameResult = normaliseAuctionShortName(short_name);
  const fullNameResult = normaliseAuctionFullName(full_name);
  const logoResult = validateAuctionLogo(logo);

  if (!short_name || !full_name) {
    logFromRequest(req, logLevels.ERROR, `Create auction missing short_name or full_name`);
    return res.status(400).json({ error: "Missing short_name or full_name" });
  }

  if (shortNameResult.error) {
    logFromRequest(req, logLevels.ERROR, `Create auction invalid short_name format`);
    return res.status(400).json({ error: shortNameResult.error });
  }

  if (fullNameResult.error) {
    logFromRequest(req, logLevels.ERROR, `Create auction invalid full_name format`);
    return res.status(400).json({ error: fullNameResult.error });
  }

  if (logoResult.error) {
    logFromRequest(req, logLevels.ERROR, `Create auction invalid logo ${logo}`);
    return res.status(400).json({ error: logoResult.error });
  }

  const sanitised_short_name = shortNameResult.value;
  const sanitised_full_name = fullNameResult.value;
  const selectedLogo = logoResult.value;

  try {
    // 2. Uniqueness check (sync)
    const existing = db.get(
      "SELECT id FROM auctions WHERE short_name = ?",
      [sanitised_short_name]
    );
    if (existing)
      return res.status(400).json({ error: "Short name must be unique. This one already exists." });


    const row = db.get("SELECT COUNT(*) AS count FROM auctions");

      if (row.count >= MAX_AUCTIONS) {
        logFromRequest(req, logLevels.WARN, `Auction limit reached. Maximum allowed is ${MAX_AUCTIONS}.`);

        return res.status(400).json({ error: `Cannot create more than ${MAX_AUCTIONS} auctions.` });
      }
    
      // generate a random public_id to support submission links
      const public_id = crypto.randomBytes(16).toString("hex");

    // 3. Insert (remember: params go in ONE array)
    const result = db.run(
      "INSERT INTO auctions (short_name, full_name, logo, public_id, created_at) VALUES (?, ?, ?, ?, strftime('%d-%m-%Y %H:%M:%S', 'now', 'localtime'))",
      [sanitised_short_name, sanitised_full_name, selectedLogo, public_id]
    );
    const NewId = result.lastInsertRowid;
    logFromRequest(req, logLevels.INFO, `Created new auction Id ${NewId} ${sanitised_short_name} with logo: ${selectedLogo}`);
    audit(getAuditActor(req), 'create auction', 'auction', NewId, { short_name: sanitised_short_name, full_name: sanitised_full_name, logo: selectedLogo });
    return res.status(201).json({ message: `Auction ${sanitised_full_name} created.` });
    
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Create auction error: ${err?.stack || err.message}`);
    res.status(500).json({ error: "Could not create auction" + err.message });
  }
});

//--------------------------------------------------------------------------
// POST /auctions/update
// API to update auction metadata
//--------------------------------------------------------------------------

router.post("/auctions/update", (req, res) => {
  const { auction_id, short_name, full_name, logo } = req.body;

  if (!auction_id) {
    return res.status(400).json({ error: "Missing auction ID." });
  }

  const shortNameResult = normaliseAuctionShortName(short_name);
  if (shortNameResult.error) {
    return res.status(400).json({ error: shortNameResult.error });
  }

  const fullNameResult = normaliseAuctionFullName(full_name);
  if (fullNameResult.error) {
    return res.status(400).json({ error: fullNameResult.error });
  }

  const logoResult = validateAuctionLogo(logo);
  if (logoResult.error) {
    return res.status(400).json({ error: logoResult.error });
  }

  const currentAuction = db.prepare(`
    SELECT id, short_name, full_name, logo
    FROM auctions
    WHERE id = ?
  `).get(auction_id);

  if (!currentAuction) {
    return res.status(404).json({ error: "Auction not found." });
  }

  const duplicateAuction = db.prepare(`
    SELECT id
    FROM auctions
    WHERE short_name = ? AND id != ?
  `).get(shortNameResult.value, auction_id);

  if (duplicateAuction) {
    return res.status(400).json({ error: "Short name must be unique. This one already exists." });
  }

  try {
    db.run(
      `UPDATE auctions
       SET short_name = ?, full_name = ?, logo = ?
       WHERE id = ?`,
      [shortNameResult.value, fullNameResult.value, logoResult.value, auction_id]
    );

    logFromRequest(req, logLevels.INFO, `Updated auction ${auction_id} metadata : short_name: "${shortNameResult.value}", full_name: "${fullNameResult.value}", logo: "${logoResult.value}"`);
    audit(getAuditActor(req), "auction settings", "auction", auction_id, {
      short_name: { from: currentAuction.short_name, to: shortNameResult.value },
      full_name: { from: currentAuction.full_name, to: fullNameResult.value },
      logo: { from: currentAuction.logo, to: logoResult.value }
    });

    return res.json({ message: `Auction ${auction_id} updated.` });
  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Auction update error: ${err?.stack || err.message}`);
    return res.status(500).json({ error: "Internal error" });
  }
});

//--------------------------------------------------------------------------
// POST /auctions/list
// API to list auctions
//--------------------------------------------------------------------------

router.post("/auctions/list", async (req, res) => {
  // logFromRequest(req, logLevels.DEBUG, `Auction list (maint) requested`);

  const sql = `
    SELECT a.id, a.short_name, a.full_name, a.logo, a.status, a.admin_can_change_state,
           COUNT(i.id) AS item_count,
           SUM(CASE WHEN COALESCE(i.is_deleted, 0) = 0 THEN 1 ELSE 0 END) AS active_item_count,
           SUM(CASE WHEN COALESCE(i.is_deleted, 0) = 1 THEN 1 ELSE 0 END) AS deleted_item_count
    FROM auctions a
    LEFT JOIN items i ON i.auction_id = a.id
    GROUP BY a.id
    ORDER BY a.id
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {

      logFromRequest(req, logLevels.ERROR, `Failed to retrieve auction: ${err}`);

      return res.status(500).json({ error: "Failed to retrieve auctions" });
    }
    res.json(rows);
  });
});

//--------------------------------------------------------------------------
// POST /resources/upload
// API to upload image assets
//--------------------------------------------------------------------------


router.post("/resources/upload", async (req, res) => {

try {

        await awaitMiddleware(upload.array("images", MAX_UPLOADS))(req, res);

  if (!req.files || req.files.length === 0) {
    logFromRequest(req, logLevels.ERROR, `No files uploaded`);
    return res.status(400).json({ error: "No files uploaded" });
  }

  const currentFiles = fs.readdirSync(CONFIG_IMG_DIR).filter(f =>
    allowedExtensions.includes(path.extname(f).toLowerCase())
  );

  const remainingSlots = MAX_UPLOADS - currentFiles.length;
  if (remainingSlots <= 0) {
    logFromRequest(req, logLevels.ERROR, `Upload rejected: Max image resources reached (${MAX_UPLOADS}).`);
    return res.status(400).json({ error: "Maximum number of image resources already stored." });
  }

  const incoming = req.files.slice(0, remainingSlots);
  const rejected = req.files.slice(remainingSlots);

  const savedFiles = [];

  for (const file of incoming) {

    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      logFromRequest(req, logLevels.WARN, `Rejected file "${file.originalname}": invalid ext`);

      fs.unlinkSync(file.path);
      continue;
    }

    // Step 2: Content validation using sharp
    let isValidImage = true;
    try {
      await sharp(file.path).metadata(); // throws if not a valid image
    } catch (err) {
      console.warn(`Rejected file "${file.originalname}": invalid image`);
      logFromRequest(req, logLevels.WARN, `Rejected file "${file.originalname}": invalid image`);

      fs.unlinkSync(file.path);
      isValidImage = false;
    }
    if (!isValidImage) continue;

    const safeName = file.originalname.replace(/[^a-z0-9_\-.]/gi, "_");
    const destPath = path.join(CONFIG_IMG_DIR, safeName);
    if (!destPath.startsWith(CONFIG_IMG_DIR)) {
      fs.unlinkSync(file.path);
      continue;
    }

    fs.renameSync(file.path, destPath);
    savedFiles.push(safeName);
  }

  // Clean up any rejected files
  for (const file of rejected) {
    fs.unlinkSync(file.path);
  }

  res.json({
    message: `Uploaded ${savedFiles.length} file(s).`,
    saved: savedFiles,
    rejected: rejected.map(f => f.originalname)
  });
  if (savedFiles.length > 0) {
    logFromRequest(req, logLevels.INFO, `Uploaded ${savedFiles.length} image resource(s): ${savedFiles.join(", ")}`);
  }
  } catch {
          logFromRequest(req, logLevels.ERROR, "Error editing: " + err.message);
        res.status(500).json({ error: err.message });

  
  }
});

//--------------------------------------------------------------------------
// GET /resources
// API to get a list of image assets
//--------------------------------------------------------------------------

router.get("/resources", (req, res) => {
  try {
    const files = fs.readdirSync(CONFIG_IMG_DIR)
      .filter(f => allowedExtensions.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const fullPath = path.join(CONFIG_IMG_DIR, f);
        let size = 0;

        try {
          size = fs.statSync(fullPath).size;
        } catch {
          size = null; // file might've been deleted in between
        }

        return { name: f, size };
      });

    //   logFromRequest(req, logLevels.DEBUG, `Listed image resources (${files.length} file(s)).`);
    res.json({ files });

  } catch (err) {
    logFromRequest(req, logLevels.ERROR, `Error listing resource files:` + err.message);
    res.status(500).json({ error: "Failed to list resource files." });
  }
});

//--------------------------------------------------------------------------
// POST /resources/DELETE
// API to delete image assets. Blocks delete of things which are being used
//--------------------------------------------------------------------------

router.post("/resources/delete", (req, res) => {
  const { filename } = req.body;
  if (!filename || filename.includes("..")) {
    logFromRequest(req, logLevels.ERROR, `Invalid filename: ${filename}`);
    return res.status(400).json({ error: "Invalid filename" });
  }

  // Prevent deletion of default logo
  if (filename === "default_logo.png") {
    logFromRequest(req, logLevels.WARN, `Blocked deleting default logo file ${filename}`);
    return res.status(400).json({ error: "Cannot delete the default logo." });
  }

  const filePath = path.join(CONFIG_IMG_DIR, filename);
  if (!filePath.startsWith(CONFIG_IMG_DIR) || !fs.existsSync(filePath)) {
    logFromRequest(req, logLevels.WARN, `File not found ${filename}`);
    return res.status(400).json({ error: "File not found" });
  }

  // Check if any auctions are using this logo
  db.get("SELECT COUNT(*) AS count FROM auctions WHERE logo = ?", [filename], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });

    if (row.count > 0) {
      logFromRequest(req, logLevels.WARN, `Blocked deleting file in use ${filename}`);

      return res.status(400).json({ error: `Cannot delete. ${row.count} auction(s) are using this logo.` });
    }

    // Check if PPTX configs reference the file
    try {
      // const pptxConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      // const cardConfig = JSON.parse(fs.readFileSync(CARD_PATH, "utf-8"));

      const pptxConfig = JSON.parse(fs.readFileSync(CONFIG_PATHS.pptx, "utf-8"));
      const cardConfig = JSON.parse(fs.readFileSync(CONFIG_PATHS.card, "utf-8"));

      const pptxRefs = JSON.stringify(pptxConfig).includes(filename);
      const cardRefs = JSON.stringify(cardConfig).includes(filename);

      if (pptxRefs || cardRefs) {
        logFromRequest(req, logLevels.WARN, `Blocked deleting file in use ${filename}`);
        return res.status(400).json({ error: "Cannot delete. File is referenced in PPTX config files." });
      }
    } catch (configError) {
      console.error("Error reading config files:", configError.message);
      logFromRequest(req, logLevels.ERROR, `Error reading config files:` + configError.message);
      return res.status(500).json({ error: "Server error checking config files." });
    }

    // If passed all checks, delete the file
    fs.unlinkSync(filePath);
    logFromRequest(req, logLevels.INFO, `Deleted resource file: ${filename}`);
    res.json({ message: `Deleted ${filename}` });
  });
});




//--------------------------------------------------------------------------
// POST /auctions/set-admin-state-permission
// API to update the "admin can set state" permission on the auction
//--------------------------------------------------------------------------

router.post('/auctions/set-admin-state-permission', async (req, res) => {
  const { auction_id, admin_can_change_state } = req.body;
  const enabled = !!admin_can_change_state ? 1 : 0;

  logFromRequest(req, logLevels.DEBUG, `Admin state control for ${auction_id} to: ${admin_can_change_state}`);


  if (!auction_id) {

    return res.status(400).json({ error: "Missing auction ID." });
  }

// Check if this has already been set to the requested value
  const auction = db.prepare(`SELECT admin_can_change_state FROM auctions WHERE id = ?`).get(auction_id);
  logFromRequest(req, logLevels.DEBUG, `State control: requested ${enabled}, current ${auction.admin_can_change_state}`);
  if (!auction) {
    return res.status(400).json({ error: "Auction not found." });
  }
 else if (auction.admin_can_change_state === enabled) {
  //logFromRequest(req, logLevels.DEBUG, `No change needed for auction ${auction_id} admin state control.`);

  }

  try {

    db.run(`UPDATE auctions SET admin_can_change_state = ? WHERE id = ?`, [enabled, auction_id]);

    logFromRequest(req, logLevels.INFO, `Updated admin state control for auction ${auction_id} set to: ${enabled}`);
    audit(getAuditActor(req), 'auction settings', 'auction', auction_id, { admin_can_change_state: enabled });
    return res.json({ message: `Auction ${auction_id} admin state control updated` });

  } catch (err) {
    logger.error({ err, auction_id, body: req.body }, 'set-admin-state-permission failed');
    return res.status(500).json({ error: 'Internal error' });
  }
});

//--------------------------------------------------------------------------
// POST /generate-bids
// API to generate random bids. #bidders and #bids are both configurable
//--------------------------------------------------------------------------

router.post("/generate-bids", checkAuctionState(['live', 'settlement']), (req, res) => {
  const { auction_id, num_bids, num_bidders } = req.body;

  if (!auction_id || !Number.isInteger(num_bids) || !Number.isInteger(num_bidders)) {
    return res.status(400).json({ error: "Missing or invalid input." });
  }
      logFromRequest(req, logLevels.DEBUG, `Generate bid request received`);

  // Step 1: get items without bids
  db.all("SELECT id, description FROM items WHERE auction_id = ? AND winning_bidder_id IS NULL AND COALESCE(is_deleted, 0) = 0", [auction_id], (err, items) => {
    if (err) return res.status(500).json({ error: err.message });

    const availableItems = items.map(i => i.id);
    
    if (availableItems.length === 0) return res.status(400).json({ error: "No items / No items without bids." });

    if (num_bids < 1 || num_bids > availableItems.length) {
      return res.status(400).json({ error: `Number of bids must be between 1 and ${availableItems.length}` });
    }

    const shuffledItems = availableItems.sort(() => 0.5 - Math.random()).slice(0, num_bids);
    const bidders = [];

    while (bidders.length < num_bidders) {
      const paddle = Math.floor(Math.random() * 150) + 1;
      if (bidders.find(b => b.paddle === paddle)) continue;

      let existing = db.prepare('SELECT id FROM bidders WHERE paddle_number = ? AND auction_id = ?')
        .get(paddle, auction_id);

      if (!existing) {
        const info = db.prepare(`INSERT INTO bidders (paddle_number, auction_id, created_at) VALUES (?, ?, strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))`)
          .run(paddle, auction_id);
        existing = { id: info.lastInsertRowid };
      }

      bidders.push({ id: existing.id, paddle });
    }

    const logLines = [];


    for (const itemId of shuffledItems) {
      const selected = bidders[Math.floor(Math.random() * bidders.length)];
      const price = Math.floor(Math.random() * 200) + 10;
      const testBid = 1;

      db.prepare(`
        UPDATE items
           SET winning_bidder_id = ?,
               hammer_price = ?,
               test_bid = ?,
               last_bid_update = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
         WHERE id = ?
      `).run(selected.id, price, testBid, itemId);

      logLines.push(`Item ${itemId} → Paddle ${selected.paddle} → £${price}`);
      audit(getAuditActor(req), 'finalize (test)', 'item', itemId, {  bidder: selected.paddle, price, description: items.find(i => i.id === itemId)?.description || ''  });

    }
    logFromRequest(req, logLevels.INFO, `Generated ${num_bids} test bid(s) for auction ${auction_id}:\n` + logLines.join("\n"));
    res.json({ message: `${num_bids} bids added to auction ${auction_id}` });

  });
});

//--------------------------------------------------------------------------
// POST /delete-test-bids
// API to delete all test bids from a specific auction, and prunes unused bidders
//--------------------------------------------------------------------------

router.post("/delete-test-bids", checkAuctionState(['live', 'settlement']), (req, res) => {
  const { auction_id } = req.body;

  if (!auction_id) {
    return res.status(400).json({ error: "Missing auction ID." });
  }

  try {
    db.pragma('foreign_keys = OFF');
    // Clear test bids from the items table
    const result = db.prepare(`
      UPDATE items
      SET winning_bidder_id = NULL,
          hammer_price = NULL,
          test_bid = NULL,
          last_bid_update = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')
      WHERE auction_id = ? AND test_bid = 1
        AND COALESCE(is_deleted, 0) = 0
    `).run(auction_id);

    // Remove unused bidders
    const deleted = db.prepare(`
      DELETE FROM bidders
      WHERE auction_id = ?
        AND id NOT IN (SELECT winning_bidder_id FROM items WHERE auction_id = ? AND winning_bidder_id IS NOT NULL AND COALESCE(is_deleted, 0) = 0)
    `).run(auction_id, auction_id);
    db.pragma('foreign_keys = ON');

    logFromRequest(req, logLevels.INFO, `Deleted ${result.changes} test bid(s) and ${deleted.changes} unreferenced bidder(s) from auction ${auction_id}`);
    audit(getAuditActor(req), 'delete test bids', 'auction', auction_id, { test_bids_deleted: result.changes, bidders_deleted: deleted.changes });
    res.json({
      message: `Removed ${result.changes} test bids and ${deleted.changes} unused bidders.`
    });
  } catch (err) {
    console.error("Error deleting test bids:", err.message);
    res.status(500).json({ error: "Failed to delete test bids." });
  }
});



//--------------------------------------------------------------------------
// GET /audit-log/export
// API to Export audit log to CSV
//--------------------------------------------------------------------------

router.get("/audit-log/export", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT 
        audit_log.*, 
        items.auction_id, 
        items.description, 
        items.item_number
      FROM audit_log
      LEFT JOIN items ON audit_log.object_id = items.id
      ORDER BY audit_log.created_at DESC
    `).all();

    const header = Object.keys(rows[0] || {}).join(",");
    const csvData = rows.map(row => {
      return Object.values(row).map(v => {
        return typeof v === "string" ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(",");
    });

    const csvContent = [header, ...csvData].join("\n");

    res.setHeader("Content-Disposition", "attachment; filename=audit_log.csv");
    //   res.setHeader("Content-Type", "text/csv");
    //    res.send(csvContent);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.end('\uFEFF' + csvContent);

  } catch (err) {
    console.error("Error exporting audit log:", err.message);
    res.status(500).send("Failed to export CSV.");
  }
});


function awaitMiddleware(middleware) {
  return (req, res) =>
    new Promise((resolve, reject) => {
      middleware(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
}

module.exports = router;
