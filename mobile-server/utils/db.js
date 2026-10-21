const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '../db');
const DB_FILE = path.join(DB_DIR, 'store.json');

const defaultState = {
  users: {
    merchant_9876: { fiatBalance: 5000.0 },
    sender_001: { fiatBalance: 10000.0 },
  },
  mintedTokens: {},   // tokenId -> tokenData
  redeemedTokens: {}, // tokenId -> settlementMeta
};

function getDB() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultState, null, 2));
    return defaultState;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (err) {
    return defaultState;
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

module.exports = { getDB, saveDB };