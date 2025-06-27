const path = require('path');
const rawConfig = require('./config.json');

module.exports = {
  CONFIG_IMG_DIR: path.join(__dirname, rawConfig.CONFIG_IMG_DIR),
  SAMPLE_DIR: path.join(__dirname, rawConfig.SAMPLE_DIR),
  BACKUP_DIR: path.join(__dirname, rawConfig.BACKUP_DIR),
  MAX_UPLOADS: rawConfig.MAX_UPLOADS,
  allowedExtensions: rawConfig.allowedExtensions,
  DB_PATH: rawConfig.DB_PATH,
  UPLOAD_DIR: path.join(__dirname, rawConfig.UPLOAD_DIR),
  SECRET_KEY: rawConfig.SECRET_KEY,
  port: rawConfig.port,
  LOG_LEVEL: rawConfig.LOG_LEVEL,
  MAX_AUCTIONS: rawConfig.MAX_AUCTIONS,
  MAX_ITEMS: rawConfig.MAX_ITEMS



};
