
import * as SQLite from 'expo-sqlite';

let db = null;

export const getDBConnection = async () => {
  if (db) return db;

  if (typeof SQLite.openDatabaseAsync !== 'function') {
    throw new Error(
      'This database module requires the modern Expo SQLite API. ' +
      'Run: npx expo install expo-sqlite'
    );
  }

  db = await SQLite.openDatabaseAsync('offline_wallet.db');
  return db;
};

export const initDatabase = async () => {
  const connection = await getDBConnection();

  await connection.execAsync(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS wallet (
      wallet_id TEXT PRIMARY KEY NOT NULL,
      public_key TEXT UNIQUE NOT NULL,
      balance REAL DEFAULT 1000.00,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tokens (
      token_id TEXT PRIMARY KEY NOT NULL,
      amount REAL NOT NULL,
      owner_public_key TEXT NOT NULL,
      nonce INTEGER NOT NULL,
      expiry INTEGER,
      signature TEXT NOT NULL,
      status TEXT CHECK (
        status IN ('unspent', 'spent', 'locked', 'expired')
      ) DEFAULT 'unspent'
    );

    CREATE TABLE IF NOT EXISTS transactions (
      transaction_id TEXT PRIMARY KEY NOT NULL,
      sender TEXT NOT NULL,
      receiver TEXT NOT NULL,
      amount REAL NOT NULL,
      token_id TEXT,
      nonce INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      signature TEXT NOT NULL,
      status TEXT CHECK (
        status IN ('pending', 'completed', 'failed', 'synced')
      ) DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY NOT NULL,
      device_name TEXT,
      public_key TEXT UNIQUE NOT NULL,
      last_paired INTEGER NOT NULL,
      trust_level TEXT CHECK (
        trust_level IN ('verified', 'untrusted')
      ) DEFAULT 'untrusted'
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      sync_id TEXT PRIMARY KEY NOT NULL,
      transaction_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      retry_count INTEGER DEFAULT 0,
      status TEXT CHECK (
        status IN ('pending', 'processing', 'failed', 'synced')
      ) DEFAULT 'pending'
    );

    CREATE INDEX IF NOT EXISTS idx_tx_status
      ON transactions(status);

    CREATE INDEX IF NOT EXISTS idx_sync_status
      ON sync_queue(status);

    CREATE INDEX IF NOT EXISTS idx_tx_sender_nonce
      ON transactions(sender, nonce);
  `);
};

export const getWalletData = async () => {
  const connection = await getDBConnection();
  const row = await connection.getFirstAsync(
    'SELECT * FROM wallet LIMIT 1;'
  );

  if (!row) return null;

  return {
    ...row,
    balance: Number(row.balance) || 0,
  };
};

export const createWallet = async (
  walletId,
  publicKey,
  initialBalance = 1000
) => {
  const connection = await getDBConnection();

  return connection.runAsync(
    `INSERT INTO wallet
      (wallet_id, public_key, balance, created_at)
     VALUES (?, ?, ?, ?);`,
    [walletId, publicKey, initialBalance, Date.now()]
  );
};

export const getPendingSyncItems = async () => {
  const connection = await getDBConnection();

  return connection.getAllAsync(
    "SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC;"
  );
};

export const getTransactionsByStatus = async (status) => {
  const connection = await getDBConnection();

  return connection.getAllAsync(
    `SELECT * FROM transactions
     WHERE LOWER(status) = LOWER(?)
     ORDER BY timestamp DESC;`,
    [status]
  );
};

const validateAmount = (amount) => {
  const value = Number(amount);
  const cents = Math.round(value * 100);

  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    !Number.isSafeInteger(cents) ||
    Math.abs(value * 100 - cents) > 1e-7
  ) {
    throw new Error(
      'Amount must be positive and have at most two decimal places.'
    );
  }

  return cents / 100;
};

const validatePayment = ({
  transactionId,
  sender,
  receiver,
  amount,
  nonce,
  signature,
}) => {
  if (
    typeof transactionId !== 'string' ||
    !transactionId.trim() ||
    typeof sender !== 'string' ||
    !sender.trim() ||
    typeof receiver !== 'string' ||
    !receiver.trim() ||
    typeof signature !== 'string' ||
    !signature.trim()
  ) {
    throw new Error('Required payment details are missing.');
  }

  if (sender === receiver) {
    throw new Error('Cannot pay your own wallet.');
  }

  const numericNonce = Number(nonce);

  if (!Number.isSafeInteger(numericNonce) || numericNonce < 1) {
    throw new Error('Invalid transaction nonce.');
  }

  return {
    amount: validateAmount(amount),
    nonce: numericNonce,
  };
};

const assertUnusedTransaction = async (tx, transactionId) => {
  const existing = await tx.getFirstAsync(
    'SELECT transaction_id FROM transactions WHERE transaction_id = ? LIMIT 1;',
    [transactionId]
  );

  if (existing) {
    throw new Error('Transaction ID has already been used.');
  }
};

const assertUnusedNonce = async (tx, sender, nonce) => {
  const existing = await tx.getFirstAsync(
    `SELECT transaction_id FROM transactions
     WHERE sender = ? AND nonce = ? LIMIT 1;`,
    [sender, nonce]
  );

  if (existing) {
    throw new Error('Sender nonce has already been used.');
  }
};

const addSyncItem = async (tx, transactionId, operation, timestamp) => {
  await tx.runAsync(
    `INSERT INTO sync_queue
      (sync_id, transaction_id, operation, created_at, retry_count, status)
     VALUES (?, ?, ?, ?, 0, 'pending');`,
    [
      `sync_${transactionId}`,
      transactionId,
      operation,
      timestamp,
    ]
  );
};

/**
 * Sender: deduct funds and create a pending payment voucher.
 * Call only after the screen has signed the canonical voucher payload.
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

  const validated = validatePayment({
    transactionId,
    sender,
    receiver,
    amount,
    nonce,
    signature,
  });

  const numAmount = validated.amount;
  const numericNonce = validated.nonce;
  const timestamp = Date.now();

  if (typeof connection.withExclusiveTransactionAsync !== 'function') {
    throw new Error(
      'Your Expo SQLite version does not support exclusive transactions. ' +
      'Update expo-sqlite before using payments.'
    );
  }

  await connection.withExclusiveTransactionAsync(async (tx) => {
    await assertUnusedTransaction(tx, transactionId);
    await assertUnusedNonce(tx, sender, numericNonce);

    const wallet = await tx.getFirstAsync(
      'SELECT wallet_id, balance FROM wallet WHERE wallet_id = ? LIMIT 1;',
      [sender]
    );

    if (!wallet) {
      throw new Error('Sender wallet was not found.');
    }

    if (Number(wallet.balance) + 1e-9 < numAmount) {
      throw new Error('Insufficient wallet balance.');
    }

    const debit = await tx.runAsync(
      `UPDATE wallet
       SET balance = ROUND(balance - ?, 2)
       WHERE wallet_id = ? AND balance >= ?;`,
      [numAmount, sender, numAmount]
    );

    if (debit.changes !== 1) {
      throw new Error('Could not safely debit sender wallet.');
    }

    if (tokenId) {
      const tokenUpdate = await tx.runAsync(
        `UPDATE tokens SET status = 'spent'
         WHERE token_id = ? AND status = 'unspent';`,
        [tokenId]
      );

      if (tokenUpdate.changes !== 1) {
        throw new Error('Token is invalid or already spent.');
      }
    }

    await tx.runAsync(
      `INSERT INTO transactions
       (transaction_id, sender, receiver, amount, token_id, nonce,
        timestamp, signature, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending');`,
      [
        transactionId,
        sender,
        receiver,
        numAmount,
        tokenId,
        numericNonce,
        timestamp,
        signature,
      ]
    );

    await addSyncItem(
      tx,
      transactionId,
      'BROADCAST_PAYMENT',
      timestamp
    );
  });

  return { success: true, transactionId };
};

export const getNextNonce = async (walletAddress) => {
  const connection = await getDBConnection();

  const row = await connection.getFirstAsync(
    `SELECT COALESCE(MAX(nonce), 0) AS maxNonce
     FROM transactions
     WHERE sender = ?;`,
    [walletAddress]
  );

  return Number(row?.maxNonce || 0) + 1;
};

/**
 * Receiver: verify the voucher in the screen first, then credit the
 * exact local receiver wallet and record the claim atomically.
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

  const validated = validatePayment({
    transactionId,
    sender,
    receiver,
    amount,
    nonce,
    signature,
  });

  const numAmount = validated.amount;
  const numericNonce = validated.nonce;
  const timestamp = Date.now();

  if (typeof connection.withExclusiveTransactionAsync !== 'function') {
    throw new Error(
      'Your Expo SQLite version does not support exclusive transactions. ' +
      'Update expo-sqlite before using payments.'
    );
  }

  await connection.withExclusiveTransactionAsync(async (tx) => {
    await assertUnusedTransaction(tx, transactionId);
    await assertUnusedNonce(tx, sender, numericNonce);

    const wallet = await tx.getFirstAsync(
      'SELECT wallet_id FROM wallet WHERE wallet_id = ? LIMIT 1;',
      [receiver]
    );

    if (!wallet) {
      throw new Error('Receiver wallet was not found.');
    }

    const credit = await tx.runAsync(
      `UPDATE wallet
       SET balance = ROUND(balance + ?, 2)
       WHERE wallet_id = ?;`,
      [numAmount, receiver]
    );

    if (credit.changes !== 1) {
      throw new Error('Could not credit receiver wallet.');
    }

    await tx.runAsync(
      `INSERT INTO transactions
       (transaction_id, sender, receiver, amount, token_id, nonce,
        timestamp, signature, status)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'completed');`,
      [
        transactionId,
        sender,
        receiver,
        numAmount,
        numericNonce,
        timestamp,
        signature,
      ]
    );

    await addSyncItem(
      tx,
      transactionId,
      'CLAIM_PAYMENT',
      timestamp
    );
  });

  return true;
};

export const markSyncItemCompleted = async (
  syncId,
  transactionId
) => {
  const connection = await getDBConnection();

  await connection.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      "UPDATE sync_queue SET status = 'synced' WHERE sync_id = ?;",
      [syncId]
    );

    await tx.runAsync(
      "UPDATE transactions SET status = 'synced' WHERE transaction_id = ?;",
      [transactionId]
    );
  });
};

export const markSyncItemFailed = async (
  syncId,
  transactionId,
  errorReason
) => {
  const connection = await getDBConnection();

  console.warn('Sync failed:', errorReason);

  await connection.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      `UPDATE sync_queue
       SET status = 'failed', retry_count = retry_count + 1
       WHERE sync_id = ?;`,
      [syncId]
    );

    await tx.runAsync(
      "UPDATE transactions SET status = 'failed' WHERE transaction_id = ?;",
      [transactionId]
    );
  });
};

export const testDatabaseOperations = async () => {
  try {
    const connection = await getDBConnection();

    const tables = await connection.getAllAsync(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%';`
    );

    console.log('Connected to SQLite. Tables:', tables.map((t) => t.name));

    return { success: true, tables };
  } catch (error) {
    console.error('Database check failed:', error);

    return { success: false, error };
  }
};
