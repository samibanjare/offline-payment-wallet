import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import {
  getPendingSyncItems,
  markSyncItemCompleted,
  markSyncItemFailed,
  getDBConnection,
} from '../database/schema';

// ---------------------------------------------------------------------------
// Production Gateway Configuration
// ---------------------------------------------------------------------------
export const DEFAULT_GATEWAY_URL = 'https://offline-wallet-gateway.onrender.com/v1/sync';
const GATEWAY_STORAGE_KEY = 'wallet_gateway_endpoint';

export const getStoredGatewayUrl = async () => {
  try {
    const saved = await SecureStore.getItemAsync(GATEWAY_STORAGE_KEY);
    return saved || DEFAULT_GATEWAY_URL;
  } catch {
    return DEFAULT_GATEWAY_URL;
  }
};

export const setStoredGatewayUrl = async (url) => {
  try {
    await SecureStore.setItemAsync(GATEWAY_STORAGE_KEY, url.trim());
  } catch (e) {
    console.warn('[SyncEngine] Failed to persist gateway url:', e);
  }
};

let isSyncing = false;

/**
 * Transmits a single offline-signed transaction to the central reconciliation server.
 */
const postTransactionToServer = async (syncItem) => {
  const db = await getDBConnection();
  const tx = await db.getFirstAsync(
    'SELECT * FROM transactions WHERE transaction_id = ?;',
    [syncItem.transaction_id]
  );

  if (!tx) {
    throw new Error(`Transaction ${syncItem.transaction_id} not found locally.`);
  }

  const endpoint = await getStoredGatewayUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout threshold

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
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
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const body = await response.json().catch(() => ({}));

    // Server rejected with an error status
    if (!response.ok) {
      const errorMsg = body.message || body.error || `HTTP ${response.status}`;
      const err = new Error(errorMsg);
      err.status = response.status;
      err.data = body;
      throw err;
    }

    return body;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
};

/**
 * Processes FIFO queue of pending transactions.
 */
export const processSyncQueue = async () => {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const queue = await getPendingSyncItems();
    if (!queue || queue.length === 0) return;

    for (const item of queue) {
      try {
        await postTransactionToServer(item);
        // Settlement verified on central ledger -> mark complete locally
        await markSyncItemCompleted(item.sync_id, item.transaction_id);
      } catch (err) {
        // Handle permanent rejections (409 Conflict / Double Spend / Invalid Signature)
        if (
          err.status === 409 ||
          err.message.includes('Invalid Nonce') ||
          err.message.includes('DOUBLE_SPEND') ||
          err.message.includes('signature')
        ) {
          console.error(`[SyncEngine] Permanent failure for TX ${item.transaction_id}: ${err.message}`);
          await markSyncItemFailed(item.sync_id, item.transaction_id, err.message);
        } else {
          // Ephemeral network failure: leave in queue to retry on next reconnect
          console.warn(`[SyncEngine] Network blip for TX ${item.transaction_id}, will retry later.`);
          break; // Pause iteration until connectivity recovers
        }
      }
    }
  } finally {
    isSyncing = false;
  }
};

/**
 * Subscribes to device network connectivity changes.
 */
export const startSyncListener = () => {
  return NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      processSyncQueue();
    }
  });
};