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
    `INSERT INTO transactions (txnId, type, amount, counterpartyId, timestamp, status)
     VALUES (?, 'MINT', ?, 'BANK_ADMIN', ?, 'SUCCESS');`,
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
 */
export const commitSpentTokens = async (sessionId, receiverId, ackReceipt) => {
  const db = await initWalletDB();

  db.execute(
    `UPDATE tokens SET status = 'SPENT' WHERE txSessionId = ?;`,
    [sessionId]
  );

  db.execute(
    `INSERT INTO transactions (txnId, type, amount, counterpartyId, timestamp, status, rawAck)
     VALUES (?, 'SENT', ?, ?, ?, 'COMMITTED', ?);`,
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
    `INSERT INTO transactions (txnId, type, amount, counterpartyId, timestamp, status, rawAck)
     VALUES (?, 'RECEIVED', ?, ?, ?, 'COMMITTED', ?);`,
    [tokenId, amount, senderId, Date.now(), JSON.stringify(ackData)]
  );
};