import { initWalletDB } from './WalletDatabase';

/**
 * Get current spendable balance
 */
export const getSpendableBalance = async () => {
  const db = await initWalletDB();
  const result = db.execute(`
    SELECT SUM(amount) as balance FROM tokens WHERE status = 'AVAILABLE';
  `);
  return result.rows?._array[0]?.balance || 0;
};

/**
 * Save newly minted bank tokens from the server
 * Note: Since minting occurs directly with the cloud bank, its sync_status is 'SETTLED'
 */
export const saveMintedToken = async (tokenData) => {
  const db = await initWalletDB();
  const { tokenId, amount, issuedTo, issuedAt, expiresAt, bankSignature, bankPublicKey } = tokenData;

  db.execute(
    `INSERT INTO tokens (tokenId, amount, issuedTo, issuedAt, expiresAt, bankSignature, bankPublicKey, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'AVAILABLE');`,
    [tokenId, amount, issuedTo, issuedAt, expiresAt, bankSignature, bankPublicKey]
  );

  db.execute(
    `INSERT INTO transactions (txnId, type, amount, counterpartyId, timestamp, status, sync_status, retryCount)
     VALUES (?, 'MINT', ?, 'BANK_ADMIN', ?, 'SUCCESS', 'SETTLED', 0);`,
    [tokenId, amount, Date.now()]
  );
};

/**
 * Step 1: Lock tokens before sending over BLE (Prevents concurrent double-spend)
 */
export const lockTokensForPayment = async (requiredAmount, sessionId) => {
  const db = await initWalletDB();

  // Find available tokens that satisfy the amount (greedy/exact match)
  const availableRows = db.execute(`
    SELECT * FROM tokens WHERE status = 'AVAILABLE' ORDER BY amount ASC;
  `);

  const tokens = availableRows.rows?._array || [];
  let gathered = 0;
  const lockedTokens = [];

  for (const token of tokens) {
    lockedTokens.push(token);
    gathered += token.amount;
    if (gathered >= requiredAmount) break;
  }

  if (gathered < requiredAmount) {
    throw new Error('Insufficient spendable offline balance');
  }

  // Atomically lock them with session ID
  for (const token of lockedTokens) {
    db.execute(
      `UPDATE tokens SET status = 'LOCKED_PENDING', txSessionId = ? WHERE tokenId = ?;`,
      [sessionId, token.tokenId]
    );
  }

  return lockedTokens;
};

/**
 * Step 2: Receiver ACK confirmed -> Mark locked tokens as SPENT
 * Queued locally with sync_status = 'PENDING'
 */
export const commitSpentTokens = async (sessionId, receiverId, ackReceipt) => {
  const db = await initWalletDB();

  db.execute(
    `UPDATE tokens SET status = 'SPENT' WHERE txSessionId = ?;`,
    [sessionId]
  );

  db.execute(
    `INSERT INTO transactions (txnId, type, amount, counterpartyId, timestamp, status, sync_status, retryCount, rawAck)
     VALUES (?, 'SENT', ?, ?, ?, 'COMMITTED', 'PENDING', 0, ?);`,
    [ackReceipt.txnId, ackReceipt.amount, receiverId, Date.now(), JSON.stringify(ackReceipt)]
  );
};

/**
 * Rollback: If BLE connection fails or times out before ACK
 */
export const rollbackLockedTokens = async (sessionId) => {
  const db = await initWalletDB();
  db.execute(
    `UPDATE tokens SET status = 'AVAILABLE', txSessionId = NULL WHERE txSessionId = ?;`,
    [sessionId]
  );
};

/**
 * Receiver Side: Save incoming validated token from BLE
 * Queued locally with sync_status = 'PENDING'
 */
export const recordReceivedToken = async (tokenData, senderId, ackData) => {
  const db = await initWalletDB();
  const { tokenId, amount, issuedTo, issuedAt, expiresAt, bankSignature, bankPublicKey } = tokenData;

  db.execute(
    `INSERT INTO tokens (tokenId, amount, issuedTo, issuedAt, expiresAt, bankSignature, bankPublicKey, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'RECEIVED');`,
    [tokenId, amount, issuedTo, issuedAt, expiresAt, bankSignature, bankPublicKey]
  );

  db.execute(
    `INSERT INTO transactions (txnId, type, amount, counterpartyId, timestamp, status, sync_status, retryCount, rawAck)
     VALUES (?, 'RECEIVED', ?, ?, ?, 'COMMITTED', 'PENDING', 0, ?);`,
    [tokenId, amount, senderId, Date.now(), JSON.stringify(ackData)]
  );
};

/**
 * Helper: Fetch pending items count for the outbox UI badge
 */
export const getPendingOutboxCount = async () => {
  const db = await initWalletDB();
  const result = db.execute(`
    SELECT COUNT(*) as pendingCount FROM transactions WHERE sync_status = 'PENDING';
  `);
  return result.rows?._array[0]?.pendingCount || 0;
};