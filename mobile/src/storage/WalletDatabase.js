import { open } from 'react-native-quick-sqlite';
import { getOrCreateDatabaseKey } from './SecurityKeyService';

let dbInstance = null;

export const initWalletDB = async () => {
  if (dbInstance) return dbInstance;

  const encryptionKey = await getOrCreateDatabaseKey();

  // Open encrypted SQLite database
  dbInstance = open({
    name: 'offline_wallet.db',
    encryptionKey: encryptionKey,
  });

  // Table 1: Tokens (Minted, Received, Spent, or Reconciled)
  dbInstance.execute(`
    CREATE TABLE IF NOT EXISTS tokens (
      tokenId TEXT PRIMARY KEY,
      amount REAL NOT NULL,
      issuedTo TEXT NOT NULL,
      issuedAt INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL,
      bankSignature TEXT NOT NULL,
      bankPublicKey TEXT NOT NULL,
      status TEXT CHECK(status IN ('AVAILABLE', 'LOCKED_PENDING', 'SPENT', 'RECEIVED', 'SETTLED')) NOT NULL DEFAULT 'AVAILABLE',
      txSessionId TEXT
    );
  `);

  // Table 2: Audit Ledger & Receipts with Sync Outbox State
  dbInstance.execute(`
    CREATE TABLE IF NOT EXISTS transactions (
      txnId TEXT PRIMARY KEY,
      type TEXT CHECK(type IN ('SENT', 'RECEIVED', 'MINT')) NOT NULL,
      amount REAL NOT NULL,
      counterpartyId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      sync_status TEXT CHECK(sync_status IN ('PENDING', 'SYNCING', 'SETTLED')) NOT NULL DEFAULT 'PENDING',
      retryCount INTEGER NOT NULL DEFAULT 0,
      rawAck TEXT
    );
  `);

  // Schema Migrations (Ensures existing DB files get new columns without data loss)
  try {
    dbInstance.execute(`ALTER TABLE transactions ADD COLUMN sync_status TEXT DEFAULT 'PENDING';`);
  } catch (e) {
    // Column already exists, safe to ignore
  }

  try {
    dbInstance.execute(`ALTER TABLE transactions ADD COLUMN retryCount INTEGER DEFAULT 0;`);
  } catch (e) {
    // Column already exists, safe to ignore
  }

  return dbInstance;
};