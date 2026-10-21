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

  // Table 1: Tokens (Minted or Received)
  dbInstance.execute(`
    CREATE TABLE IF NOT EXISTS tokens (
      tokenId TEXT PRIMARY KEY,
      amount REAL NOT NULL,
      issuedTo TEXT NOT NULL,
      issuedAt INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL,
      bankSignature TEXT NOT NULL,
      bankPublicKey TEXT NOT NULL,
      status TEXT CHECK(status IN ('AVAILABLE', 'LOCKED_PENDING', 'SPENT', 'RECEIVED')) NOT NULL DEFAULT 'AVAILABLE',
      txSessionId TEXT
    );
  `);

  // Table 2: Audit Ledger & Receipts
  dbInstance.execute(`
    CREATE TABLE IF NOT EXISTS transactions (
      txnId TEXT PRIMARY KEY,
      type TEXT CHECK(type IN ('SENT', 'RECEIVED', 'MINT')) NOT NULL,
      amount REAL NOT NULL,
      counterpartyId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      rawAck TEXT
    );
  `);

  return dbInstance;
};