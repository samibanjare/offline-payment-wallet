import { initWalletDB } from '../../storage/WalletDatabase';

const SERVER_BASE_URL = 'https://offline-payment-wallet-2.onrender.com';

/**
 * Pushes all received offline tokens and unsynced outbox transactions to the bank.
 */
export async function syncOfflineTokensWithBank(userId) {
  if (!userId) {
    console.warn('[ReconciliationService] Skipped sync: No userId provided.');
    return { synced: false, settledCount: 0 };
  }

  const db = await initWalletDB();

  // 1. Gather all received tokens that have not been settled to fiat yet
  const tokenQuery = `SELECT * FROM tokens WHERE status = 'RECEIVED';`;
  const receivedTokens = db.getAllSync
    ? db.getAllSync(tokenQuery)
    : (db.execute(tokenQuery)?.rows?._array || []);

  // 2. Gather unsynced transactions for audit trail ingestion
  const txQuery = `SELECT * FROM transactions WHERE status = 'COMMITTED';`;
  const pendingTxns = db.getAllSync
    ? db.getAllSync(txQuery)
    : (db.execute(txQuery)?.rows?._array || []);

  if (receivedTokens.length === 0 && pendingTxns.length === 0) {
    return { synced: true, settledCount: 0 };
  }

  // 3. Format payload matching reconcileController expectations
  const submissions = receivedTokens.map((row) => {
    let parsedTokenData = null;
    try {
      parsedTokenData = typeof row.rawData === 'string' ? JSON.parse(row.rawData) : row.rawData;
    } catch (_) {
      parsedTokenData = {
        tokenId: row.tokenId,
        amount: Number(row.amount),
        issuedTo: row.issuedTo || 'unknown',
        bankSignature: row.signature,
      };
    }

    return {
      tokenData: parsedTokenData,
      ackReceipt: {
        tokenId: row.tokenId,
        amount: row.amount,
        status: 'COMMITTED',
      },
    };
  });

  const auditBatch = pendingTxns.map((tx) => ({
    txnId: tx.txnId,
    type: tx.type,
    amount: tx.amount,
    status: tx.status,
    counterpartyId: tx.counterpartyId,
    timestamp: tx.timestamp,
  }));

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(`${SERVER_BASE_URL}/api/wallet/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receiverId: userId,
        submissions,
        auditBatch,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || `Server responded with status ${response.status}`);
    }

    // 4. Mark accepted tokens as SETTLED in SQLite
    const settledIds = result.settledTokenIds || [];
    if (settledIds.length > 0) {
      const formattedIds = settledIds.map((id) => `'${id}'`).join(',');
      const updateTokenQuery = `
        UPDATE tokens 
        SET status = 'SETTLED' 
        WHERE tokenId IN (${formattedIds});
      `;
      if (db.execSync) db.execSync(updateTokenQuery);
      else db.execute(updateTokenQuery);
    }

    // 5. Update synced transaction statuses to SETTLED
    if (pendingTxns.length > 0) {
      const txIds = pendingTxns.map((t) => `'${t.txnId}'`).join(',');
      const updateTxQuery = `
        UPDATE transactions 
        SET status = 'SETTLED' 
        WHERE txnId IN (${txIds});
      `;
      if (db.execSync) db.execSync(updateTxQuery);
      else db.execute(updateTxQuery);
    }

    return {
      synced: true,
      settledCount: settledIds.length,
      rejectedCount: (result.rejectedTokenIds || []).length,
      newBalance: result.newFiatBalance,
    };
  } catch (err) {
    console.warn('[ReconciliationService] Settlement deferred:', err.message);
    throw err;
  }
}