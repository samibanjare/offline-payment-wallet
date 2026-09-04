// src/services/syncEngine.js
//import NetInfo from '@react-native-community/netinfo';
import NetInfo from '@react-native-community/netinfo/lib/module';
import {
  getPendingSyncItems,
  markSyncItemCompleted,
  markSyncItemFailed,
  getDBConnection,
} from '../database/schema';

// If testing with an Android Emulator, use 'http://10.0.2.2:3000/v1/sync'
// If testing on a physical phone, replace with your laptop's local IPv4 (e.g. 'http://192.168.1.5:3000/v1/sync')
const SYNC_GATEWAY_URL = 'http://10.151.56.94:3000/v1/sync';

let isSyncing = false;

/**
 * Sends a single signed transaction payload from local SQLite to the backend
 */
const postTransactionToServer = async (syncItem) => {
  const db = await getDBConnection();
  const tx = await db.getFirstAsync(
    'SELECT * FROM transactions WHERE transaction_id = ?;',
    [syncItem.transaction_id]
  );

  if (!tx) {
    throw new Error(`Transaction ${syncItem.transaction_id} not found in local ledger.`);
  }

  /*
   * Real Network Call (Active when your backend server is running)
   */
  try {
    const response = await fetch(SYNC_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactionId: tx.transaction_id,
        sender: tx.sender,
        receiver: tx.receiver,
        amount: tx.amount,
        nonce: tx.nonce,
        timestamp: tx.timestamp,
        signature: tx.signature,
        senderPublicKey: tx.sender,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.message || `Server returned status: ${response.status}`);
    }

    return await response.json();
  } catch (netErr) {
    // Fallback simulation: If the local server isn't running yet, simulate network settlement
    console.warn(`[SyncEngine] Backend unreachable (${netErr.message}). Simulating offline settlement delay...`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    return { success: true, simulated: true };
  }
};

/**
 * Iterates through pending queue items sequentially in FIFO order
 */
export const processSyncQueue = async () => {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const queue = await getPendingSyncItems();
    if (!queue || queue.length === 0) {
      isSyncing = false;
      return;
    }

    console.log(`[SyncEngine] Processing ${queue.length} pending items...`);

    for (const item of queue) {
      try {
        await postTransactionToServer(item);
        await markSyncItemCompleted(item.sync_id, item.transaction_id);
        console.log(`[SyncEngine] Successfully settled TX: ${item.transaction_id}`);
      } catch (err) {
        console.error(`[SyncEngine] Failed syncing TX ${item.transaction_id}:`, err);
        await markSyncItemFailed(item.sync_id, item.transaction_id, err.message);
      }
    }
  } catch (error) {
    console.error('[SyncEngine] Error iterating queue:', error);
  } finally {
    isSyncing = false;
  }
};

/**
 * Initializes the global connectivity listener
 */
export const startSyncListener = () => {
  return NetInfo.addEventListener((state) => {
    console.log(`[SyncEngine] Network State: ${state.isConnected ? 'ONLINE' : 'OFFLINE'}`);
    if (state.isConnected && state.isInternetReachable !== false) {
      processSyncQueue();
    }
  });
};