import NetInfo from '@react-native-community/netinfo';
import { initWalletDB } from '../../storage/WalletDatabase';

const SERVER_BASE_URL = 'https://offline-payment-wallet-2.onrender.com'; // Android emulator localhost alias

/**
 * Checks connectivity and syncs all offline-collected tokens to the bank
 */
export const syncOfflineTokensWithBank = async (receiverId) => {
  // 1. Verify Internet Connectivity
  const networkState = await NetInfo.fetch();
  if (!networkState.isConnected || !networkState.isInternetReachable) {
    return { synced: false, message: 'Device is offline. Will retry when connected.' };
  }

  const db = await initWalletDB();

  // 2. Fetch all collected tokens that need settlement
  const queryResult = db.execute(`
    SELECT t.*, tr.rawAck 
    FROM tokens t 
    LEFT JOIN transactions tr ON t.tokenId = tr.txnId 
    WHERE t.status = 'RECEIVED';
  `);

  const pendingTokens = queryResult.rows?._array || [];
  if (pendingTokens.length === 0) {
    return { synced: true, message: 'No pending tokens to reconcile.' };
  }

  // 3. Prepare payload for the server
  const submissions = pendingTokens.map((row) => ({
    tokenData: {
      tokenId: row.tokenId,
      amount: row.amount,
      issuedTo: row.issuedTo,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      bankSignature: row.bankSignature,
    },
    ackReceipt: row.rawAck ? JSON.parse(row.rawAck) : null,
  }));

  try {
    // 4. Hit Bank Reconciliation Endpoint
    const response = await fetch(`${SERVER_BASE_URL}/api/wallet/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiverId, submissions }),
    });

    const result = await response.json();

    if (result.success) {
      // 5. Update SQLite state: mark settled tokens as 'SETTLED'
      for (const tokenId of result.settledTokenIds) {
        db.execute(
          `UPDATE tokens SET status = 'SETTLED' WHERE tokenId = ?;`,
          [tokenId]
        );
        db.execute(
          `UPDATE transactions SET status = 'SETTLED' WHERE txnId = ?;`,
          [tokenId]
        );
      }

      return {
        synced: true,
        settledCount: result.settledTokenIds.length,
        totalCredited: result.totalCredited,
        newBalance: result.newFiatBalance,
        rejected: result.rejectedTokenIds,
      };
    } else {
      throw new Error(result.error || 'Reconciliation failed');
    }
  } catch (err) {
    return { synced: false, error: err.message };
  }
};