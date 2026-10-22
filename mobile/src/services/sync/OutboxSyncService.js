import NetInfo from '@react-native-community/netinfo';
import { initWalletDB } from '../../storage/WalletDatabase';

const SERVER_BASE_URL = 'https://offline-payment-wallet-2.onrender.com';

let isSyncInProgress = false;

/**
 * Checks internet reachability and flushes all pending transactions/tokens to MongoDB
 */
export const flushOfflineQueue = async (userId = 'merchant_9876') => {
  // Prevent parallel sync execution
  if (isSyncInProgress) {
    return { success: false, reason: 'SYNC_ALREADY_IN_PROGRESS' };
  }

  // 1. Verify Active Internet Connectivity
  const netState = await NetInfo.fetch();
  if (!netState.isConnected || !netState.isInternetReachable) {
    return { success: false, reason: 'DEVICE_OFFLINE' };
  }

  isSyncInProgress = true;
  const db = await initWalletDB();

  // 2. Fetch pending transaction audit records from local SQLite
  const pendingTxQueryResult = db.execute(`
    SELECT * FROM transactions 
    WHERE sync_status = 'PENDING' 
    ORDER BY timestamp ASC;
  `);

  const pendingTransactions = pendingTxQueryResult?.rows?._array || [];

  // 3. Fetch un-reconciled received tokens that need bank redemption
  const receivedTokensQueryResult = db.execute(`
    SELECT * FROM tokens 
    WHERE status = 'RECEIVED';
  `);

  const receivedTokens = receivedTokensQueryResult?.rows?._array || [];

  // Exit early if queue is completely empty
  if (pendingTransactions.length === 0 && receivedTokens.length === 0) {
    isSyncInProgress = false;
    return { success: true, count: 0, message: 'Queue is clean' };
  }

  // Extract transaction IDs to flag as 'SYNCING'
  const txnIds = pendingTransactions.map((tx) => tx.txnId);
  const placeholders = txnIds.map(() => '?').join(',');

  if (txnIds.length > 0) {
    db.execute(
      `UPDATE transactions SET sync_status = 'SYNCING' WHERE txnId IN (${placeholders});`,
      txnIds
    );
  }

  // Prepare submission payload for the cloud endpoint
  const payload = {
    receiverId: userId,
    submissions: receivedTokens.map((t) => ({
      tokenData: {
        tokenId: t.tokenId,
        amount: Number(t.amount),
        issuedTo: t.issuedTo,
        issuedAt: t.issuedAt,
        expiresAt: t.expiresAt,
        bankSignature: t.bankSignature,
      },
    })),
    auditBatch: pendingTransactions.map((tx) => ({
      txnId: tx.txnId,
      type: tx.type,
      amount: Number(tx.amount),
      counterpartyId: tx.counterpartyId,
      timestamp: tx.timestamp,
      status: tx.status,
      rawAck: tx.rawAck ? JSON.parse(tx.rawAck) : null,
    })),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
    // 4. POST the outbox batch to the Reconciliation endpoint
    const response = await fetch(`${SERVER_BASE_URL}/api/wallet/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || `Server responded with status ${response.status}`);
    }

    // 5. Update SQLite: Mark transactions as 'SETTLED'
    if (txnIds.length > 0) {
      db.execute(
        `UPDATE transactions SET sync_status = 'SETTLED' WHERE txnId IN (${placeholders});`,
        txnIds
      );
    }

    // 6. Update SQLite: Mark received tokens as 'SETTLED'
    if (receivedTokens.length > 0) {
      const tokenIds = receivedTokens.map((t) => t.tokenId);
      const tokenPlaceholders = tokenIds.map(() => '?').join(',');
      db.execute(
        `UPDATE tokens SET status = 'SETTLED' WHERE tokenId IN (${tokenPlaceholders});`,
        tokenIds
      );
    }

    isSyncInProgress = false;
    return {
      success: true,
      settledTxnCount: txnIds.length,
      settledTokenCount: receivedTokens.length,
      totalCredited: result.totalCredited || 0,
      newBalance: result.newFiatBalance,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    console.warn('[OutboxSync] Flush deferred due to network error:', error.message);

    // Rollback 'SYNCING' back to 'PENDING' and increment retryCount
    if (txnIds.length > 0) {
      db.execute(
        `UPDATE transactions 
         SET sync_status = 'PENDING', retryCount = retryCount + 1 
         WHERE txnId IN (${placeholders});`,
        txnIds
      );
    }

    isSyncInProgress = false;
    return { success: false, reason: error.message };
  }
};