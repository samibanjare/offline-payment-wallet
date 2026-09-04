// src/database/schema.js
import * as SQLite from 'expo-sqlite';

let db = null;

export const getDBConnection = async () => {
  if (db) return db;

  // Modern Expo SQLite API (SDK 51+)
  if (typeof SQLite.openDatabaseAsync === 'function') {
    db = await SQLite.openDatabaseAsync('offline_wallet.db');
    return db;
  }

  // Legacy Expo SQLite API fallback
  if (typeof SQLite.openDatabase === 'function') {
    const legacyDb = SQLite.openDatabase('offline_wallet.db');
    db = {
      execAsync: (sql) =>
        new Promise((resolve, reject) => {
          legacyDb.transaction((tx) => {
            tx.executeSql(
              sql,
              [],
              () => resolve(),
              (_, err) => {
                reject(err);
                return false;
              }
            );
          });
        }),
      runAsync: (sql, params = []) =>
        new Promise((resolve, reject) => {
          legacyDb.transaction((tx) => {
            tx.executeSql(
              sql,
              params,
              (_, result) => resolve(result),
              (_, err) => {
                reject(err);
                return false;
              }
            );
          });
        }),
      getFirstAsync: (sql, params = []) =>
        new Promise((resolve, reject) => {
          legacyDb.transaction((tx) => {
            tx.executeSql(
              sql,
              params,
              (_, { rows }) => resolve(rows.length > 0 ? rows.item(0) : null),
              (_, err) => {
                reject(err);
                return false;
              }
            );
          });
        }),
      getAllAsync: (sql, params = []) =>
        new Promise((resolve, reject) => {
          legacyDb.transaction((tx) => {
            tx.executeSql(
              sql,
              params,
              (_, { rows }) => resolve(rows._array || []),
              (_, err) => {
                reject(err);
                return false;
              }
            );
          });
        }),
    };
    return db;
  }

  throw new Error('SQLite driver could not find an openDatabase method.');
};

export const initDatabase = async () => {
  const connection = await getDBConnection();

  try {
    await connection.execAsync('PRAGMA foreign_keys = ON;');
  } catch (e) {
    console.warn('PRAGMA foreign_keys not supported on this driver');
  }

  await connection.execAsync(`
    CREATE TABLE IF NOT EXISTS wallet (
      wallet_id TEXT PRIMARY KEY NOT NULL,
      public_key TEXT UNIQUE NOT NULL,
      balance REAL DEFAULT 1000.00,
      created_at INTEGER NOT NULL
    );
  `);

  await connection.execAsync(`
    CREATE TABLE IF NOT EXISTS tokens (
      token_id TEXT PRIMARY KEY NOT NULL,
      amount REAL NOT NULL,
      owner_public_key TEXT NOT NULL,
      nonce INTEGER NOT NULL,
      expiry INTEGER,
      signature TEXT NOT NULL,
      status TEXT CHECK(status IN ('unspent', 'spent', 'locked', 'expired')) DEFAULT 'unspent'
    );
  `);

  await connection.execAsync(`
    CREATE TABLE IF NOT EXISTS transactions (
      transaction_id TEXT PRIMARY KEY NOT NULL,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      amount REAL NOT NULL,
      token_id TEXT,
      nonce INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      signature TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'completed', 'failed', 'synced')) DEFAULT 'pending'
    );
  `);

  await connection.execAsync(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY NOT NULL,
      device_name TEXT,
      public_key TEXT UNIQUE NOT NULL,
      last_paired INTEGER NOT NULL,
      trust_level TEXT CHECK(trust_level IN ('verified', 'untrusted')) DEFAULT 'untrusted'
    );
  `);

  await connection.execAsync(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      sync_id TEXT PRIMARY KEY NOT NULL,
      transaction_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      retry_count INTEGER DEFAULT 0,
      status TEXT CHECK(status IN ('pending', 'processing', 'failed', 'synced')) DEFAULT 'pending'
    );
  `);

  await connection.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
    CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_queue(status);
  `);
};

export const getWalletData = async () => {
  const connection = await getDBConnection();
  const row = await connection.getFirstAsync('SELECT * FROM wallet LIMIT 1;');
  if (!row) return null;
  return {
    ...row,
    balance: parseFloat(row.balance) || 0.0,
  };
};

export const createWallet = async (walletId, publicKey, initialBalance = 1000.0) => {
  const connection = await getDBConnection();
  return await connection.runAsync(
    'INSERT OR IGNORE INTO wallet (wallet_id, public_key, balance, created_at) VALUES (?, ?, ?, ?);',
    [walletId, publicKey, initialBalance, Date.now()]
  );
};

export const getPendingSyncItems = async () => {
  const connection = await getDBConnection();
  return await connection.getAllAsync("SELECT * FROM sync_queue WHERE status = 'pending';");
};

export const getTransactionsByStatus = async (status) => {
  const connection = await getDBConnection();
  return await connection.getAllAsync(
    'SELECT * FROM transactions WHERE LOWER(status) = LOWER(?) ORDER BY timestamp DESC;',
    [status]
  );
};

/**
 * Deducts balance from sender and logs pending state.
 * Uses `wallet_id = ? OR rowid = (SELECT rowid FROM wallet LIMIT 1)` to guarantee
 * the single local wallet record is updated.
 */
export const executeOfflinePayment = async ({
  transactionId,
  sender,
  receiver,
  amount,
  tokenId = null,
  nonce,
  signature,
}) => {
  const connection = await getDBConnection();

  const numAmount = parseFloat(amount);

  // Deduct balance from sender's wallet row
  await connection.runAsync(
    `UPDATE wallet
     SET balance = CAST(balance AS REAL) - ?
     WHERE wallet_id = ? OR rowid = (SELECT rowid FROM wallet LIMIT 1);`,
    [numAmount, sender]
  );

  // Mark token spent if token-based
  if (tokenId) {
    await connection.runAsync(
      "UPDATE tokens SET status = 'spent' WHERE token_id = ? AND status = 'unspent';",
      [tokenId]
    );
  }

  // Insert transaction into local ledger
  await connection.runAsync(
    `INSERT INTO transactions (transaction_id, sender, receiver, amount, token_id, nonce, timestamp, signature, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending');`,
    [transactionId, sender, receiver, numAmount, tokenId, nonce, Date.now(), signature]
  );

  // Insert into sync_queue
  const syncId = `sync_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  await connection.runAsync(
    `INSERT INTO sync_queue (sync_id, transaction_id, operation, created_at, retry_count, status)
     VALUES (?, ?, 'BROADCAST_PAYMENT', ?, 0, 'pending');`,
    [syncId, transactionId, Date.now()]
  );

  return { success: true, transactionId };
};

export const getNextNonce = async (walletAddress) => {
  const connection = await getDBConnection();
  const row = await connection.getFirstAsync(
    'SELECT COUNT(*) as count FROM transactions WHERE sender = ?;',
    [walletAddress]
  );
  return (row?.count || 0) + 1;
};

/**
 * Receiver: Records incoming payment and credits local wallet balance.
 */
export const processIncomingOfflinePayment = async ({
  transactionId,
  sender,
  receiver,
  amount,
  nonce,
  signature,
}) => {
  const connection = await getDBConnection();

  const existing = await connection.getFirstAsync(
    'SELECT transaction_id FROM transactions WHERE transaction_id = ?;',
    [transactionId]
  );
  if (existing) {
    throw new Error('Transaction has already been processed.');
  }

  const numAmount = parseFloat(amount);

  // 1. Credit local balance
  await connection.runAsync(
    `UPDATE wallet
     SET balance = CAST(balance AS REAL) + ?
     WHERE wallet_id = ? OR rowid = (SELECT rowid FROM wallet LIMIT 1);`,
    [numAmount, receiver]
  );

  // 2. Insert transaction as completed locally
  await connection.runAsync(
    `INSERT INTO transactions (transaction_id, sender, receiver, amount, nonce, timestamp, signature, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'completed');`,
    [transactionId, sender, receiver, numAmount, nonce, Date.now(), signature]
  );

  // 3. Queue for remote sync
  const syncId = `sync_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  await connection.runAsync(
    `INSERT INTO sync_queue (sync_id, transaction_id, operation, created_at, retry_count, status)
     VALUES (?, ?, 'CLAIM_PAYMENT', ?, 0, 'pending');`,
    [syncId, transactionId, Date.now()]
  );

  return true;
};

/**
 * Sync Engine Helpers
 */
export const markSyncItemCompleted = async (syncId, transactionId) => {
  const connection = await getDBConnection();
  await connection.runAsync(
    "UPDATE sync_queue SET status = 'synced' WHERE sync_id = ?;",
    [syncId]
  );
  await connection.runAsync(
    "UPDATE transactions SET status = 'synced' WHERE transaction_id = ?;",
    [transactionId]
  );
};

export const markSyncItemFailed = async (syncId, transactionId, errorReason) => {
  const connection = await getDBConnection();
  await connection.runAsync(
    "UPDATE sync_queue SET status = 'failed', retry_count = retry_count + 1 WHERE sync_id = ?;",
    [syncId]
  );
  await connection.runAsync(
    "UPDATE transactions SET status = 'failed' WHERE transaction_id = ?;",
    [transactionId]
  );
};

export const testDatabaseOperations = async () => {
  try {
    const db = await getDBConnection();
    const tables = await db.getAllAsync(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
    );
    console.log('✅ Connected! Existing tables:', tables.map(t => t.name));
    return { success: true, tables };
  } catch (error) {
    console.error('❌ Database check failed:', error);
    return { success: false, error };
  }
};