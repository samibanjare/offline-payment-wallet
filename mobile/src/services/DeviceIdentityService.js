import DeviceInfo from 'react-native-device-info';
import * as SecureStore from 'expo-secure-store';

const DEVICE_ID_KEY = 'offline_wallet_device_id';

/**
 * Returns a persistent, unique hardware/wallet ID for the current phone.
 * Format: "user_<shortHex>" or fallback "wallet_<timestamp>"
 */
export async function getUniqueDeviceId() {
  try {
    // 1. Check if an ID has already been persisted locally
    const cachedId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (cachedId) {
      return cachedId;
    }

    // 2. Fetch the native Android unique hardware ID
    const rawId = await DeviceInfo.getUniqueId();
    // Normalize and shorten: take last 8 chars to avoid BLE advertisement length overflows
    const cleanId = (rawId || '').replace(/[^a-zA-Z0-9]/g, '');
    const shortId = cleanId.length > 8 ? cleanId.slice(-8) : cleanId || Math.random().toString(36).substring(2, 10);
    
    const assignedId = `dev_${shortId}`;

    // 3. Persist so the device keeps the identical ID across restarts
    await SecureStore.setItemAsync(DEVICE_ID_KEY, assignedId);
    return assignedId;
  } catch (error) {
    console.warn('[DeviceIdentity] Fallback to ephemeral ID:', error);
    return `dev_${Math.random().toString(36).substring(2, 10)}`;
  }
}