import { initWalletDB } from './WalletDatabase';

/**
 * Returns the total sum of tokens available for spending.
 */
export async function getSpendableBalance() {
  const db = await initWalletDB();
  const res = db.getAllSync
    ? db.getAllSync(`SELECT SUM(amount) as total FROM tokens WHERE status = 'RECEIVED';`)
    : db.execute(`SELECT SUM(amount) as total FROM tokens WHERE status = 'RECEIVED';`).rows?._array;
  return res?.[0]?.total || 0;
}

/**
 * Locks tokens atomically up to required amount with a session identifier.
 */
export async function lockTokensForPayment(targetAmount, transferSessionId) {
  const db = await initWalletDB();

  return db.withTransactionSync
    ? db.withTransactionSync(() => executeLock(db, targetAmount, transferSessionId))
    : executeLock(db, targetAmount, transferSessionId);
}

function executeLock(db, targetAmount, transferSessionId) {
  // Query available unspent tokens
  const query = `SELECT * FROM tokens WHERE status = 'RECEIVED' ORDER BY amount ASC;`;
  const availableTokens = db.getAllSync ? db.getAllSync(query) : (db.execute(query).rows?._array || []);

  let accumulated = 0;
  const selected = [];

  for (const token of availableTokens) {
    selected.push(token);
    accumulated += Number(token.amount);
    if (accumulated >= targetAmount) break;
  }

  if (accumulated < targetAmount) {
    throw new Error(`Insufficient offline balance. Needed ₹${targetAmount}, available ₹${accumulated}`);
  }

  // Atomically lock all chosen tokens
  const tokenIds = selected.map((t) => `'${t.tokenId}'`).join(',');
  const lockQuery = `
    UPDATE tokens 
    SET status = 'LOCKED', lockSessionId = '${transferSessionId}' 
    WHERE tokenId IN (${tokenIds});
  `;

  if (db.execSync) {
    db.execSync(lockQuery);
  } else {
    db.execute(lockQuery);
  }

  return selected;
}

/**
 * Transitions locked tokens to SPENT and logs the transaction.
 */
export async function commitSpentTokens(transferSessionId, counterpartyId, ackReceipt) {
  const db = await initWalletDB();
  const now = Date.now();

  const commitWork = () => {
    // 1. Get tokens to calculate exact total deducted
    const selectQuery = `SELECT * FROM tokens WHERE lockSessionId = '${transferSessionId}';`;
    const lockedTokens = db.getAllSync ? db.getAllSync(selectQuery) : (db.execute(selectQuery).rows?._array || []);
    const totalSpent = lockedTokens.reduce((sum, t) => sum + Number(t.amount || 0), 0);

    // 2. Mark tokens SPENT
    const updateQuery = `
      UPDATE tokens 
      SET status = 'SPENT', lockSessionId = NULL 
      WHERE lockSessionId = '${transferSessionId}';
    `;
    if (db.execSync) db.execSync(updateQuery);
    else db.execute(updateQuery);

    // 3. Record in transactions log
    const txId = ackReceipt?.txnId || `tx_sent_${now}`;
    const insertTx = `
      INSERT INTO transactions (txnId, type, amount, status, counterpartyId, timestamp)
      VALUES ('${txId}', 'SENT', ${totalSpent}, 'COMMITTED', '${counterpartyId}', ${now});
    `;
    if (db.execSync) db.execSync(insertTx);
    else db.execute(insertTx);

    return { txId, totalSpent };
  };

  return db.withTransactionSync ? db.withTransactionSync(commitWork) : commitWork();
}

/**
 * Safe Rollback: unlocks tokens if ACK was not received.
 */
export async function rollbackLockedTokens(transferSessionId) {
  const db = await initWalletDB();
  const query = `
    UPDATE tokens 
    SET status = 'RECEIVED', lockSessionId = NULL 
    WHERE lockSessionId = '${transferSessionId}' AND status = 'LOCKED';
  `;
  if (db.execSync) db.execSync(query);
  else db.execute(query);
}

/**
 * Receiver side: stores full batch idempotently.
 */
export async function recordReceivedTokensBatch(tokens, senderId, receiverId, transferSessionId) {
  const db = await initWalletDB();
  const now = Date.now();

  const batchWork = () => {
    let totalReceived = 0;

    for (const token of tokens) {
      totalReceived += Number(token.amount || 0);
      const insertToken = `
        INSERT OR IGNORE INTO tokens (tokenId, amount, currency, status, rawData, signature, lockSessionId)
        VALUES ('${token.tokenId}', ${Number(token.amount)}, '${token.currency || 'INR'}', 'RECEIVED', '${JSON.stringify(token)}', '${token.signature || ''}', NULL);
      `;
      if (db.execSync) db.execSync(insertToken);
      else db.execute(insertToken);
    }

    const txnId = `tx_recv_${transferSessionId}`;
    const insertTx = `
      INSERT OR IGNORE INTO transactions (txnId, type, amount, status, counterpartyId, timestamp)
      VALUES ('${txnId}', 'RECEIVED', ${totalReceived}, 'COMMITTED', '${senderId}', ${now});
    `;
    if (db.execSync) db.execSync(insertTx);
    else db.execute(insertTx);

    return { txnId, totalReceived };
  };

  return db.withTransactionSync ? db.withTransactionSync(batchWork) : batchWork();
}