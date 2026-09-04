// src/database/dbQueries.js
import { getDBConnection } from './schema';

/**
 * 1. Initialize or Load Wallet
 */
export const getWalletData = async () => {
  const db = await getDBConnection();
  const row = await db.getFirstAsync('SELECT * FROM wallet LIMIT 1');
  return row;
};

export const createWallet = async (walletId, publicKey, initialBalance = 0) => {
  const db = await getDBConnection();
  await db.runAsync(
    `INSERT OR IGNORE INTO wallet (wallet_id, public_key, balance, created_at) VALUES (?, ?, ?, ?)`,
    [walletId, publicKey, initialBalance, Date.now()]
  );
};

/**
 * 2. Record an Offline Transaction with Sync Queue Entry
 * Runs inside an atomic transaction to guarantee ACID compliance offline.
 */
export const executeOfflinePayment = async ({
  transactionId,
  sender,
  receiver,
  amount,
  tokenId,
  nonce,
  signature,
}) => {
  const db = await getDBConnection();

  return await db.withTransactionAsync(async () => {
    // A. Deduct / mark token as spent if token-based
    if (tokenId) {
      await db.runAsync(
        `UPDATE tokens SET status = 'spent' WHERE token_id = ? AND status = 'unspent'`,
        [tokenId]
      );
    }

    // B. Decrement Wallet Balance
    await db.runAsync(`UPDATE wallet SET balance = balance - ? WHERE public_key = ?`, [
      amount,
      sender,
    ]);

    // C. Insert the transaction as 'pending'
    await db.runAsync(
      `INSERT INTO transactions (transaction_id, sender, receiver, amount, token_id, nonce, timestamp, signature, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [transactionId, sender, receiver, amount, tokenId, nonce, Date.now(), signature]
    );

    // D. Enqueue in sync_queue for when internet resumes
    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    await db.runAsync(
      `INSERT INTO sync_queue (sync_id, transaction_id, operation, created_at, retry_count, status)
       VALUES (?, ?, 'BROADCAST_PAYMENT', ?, 0, 'pending')`,
      [syncId, transactionId, Date.now()]
    );

    return { success: true, transactionId };
  });
};

/**
 * 3. Fetch Transactions Filtered by Status (Pending, Completed, Failed, Synced)
 */
export const getTransactionsByStatus = async (status) => {
  const db = await getDBConnection();
  return await db.getAllAsync(
    `SELECT * FROM transactions WHERE status = ? ORDER BY timestamp DESC`,
    [status]
  );
};

/**
 * 4. Fetch Pending Sync Queue
 */
export const getPendingSyncItems = async () => {
  const db = await getDBConnection();
  return await db.getAllAsync(
    `SELECT sq.*, t.sender, t.receiver, t.amount, t.signature
     FROM sync_queue sq
     JOIN transactions t ON sq.transaction_id = t.transaction_id
     WHERE sq.status = 'pending'
     ORDER BY sq.created_at ASC`
  );
};