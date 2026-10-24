import { BleManager } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import {
  WALLET_SERVICE_UUID,
  RX_PAYMENT_CHAR_UUID,
  TX_ACK_CHAR_UUID,
} from './BlePeripheralService'; //[cite: 5]

const bleManager = new BleManager(); //[cite: 5]
const CHUNK_SIZE = 120; // Safe BLE MTU boundary[cite: 5]

/**
 * Handles batch array delivery, packet chunking, and verified two-phase ACK.
 */
export const sendPaymentViaBle = async (
  deviceId,
  tokenList,
  senderId,
  transferSessionId,
  onAckReceived
) => {
  let connectedDevice = null; //[cite: 5]
  let subscription = null; //[cite: 5]
  let ackResolved = false; //[cite: 5]

  const tokens = Array.isArray(tokenList) ? tokenList : [tokenList];
  if (tokens.length === 0) {
    throw new Error('No spendable tokens provided for transfer.');
  }

  const expectedAmount = tokens.reduce((sum, t) => sum + Number(t.amount || 0), 0);

  try {
    // 1. Establish connection and discover GATT profiles
    connectedDevice = await bleManager.connectToDevice(deviceId, {
      autoConnect: false,
      requestMTU: 185,
    }); //[cite: 5]
    await connectedDevice.discoverAllServicesAndCharacteristics(); //[cite: 5]

    // 2. Set up listener for the Receiver's ACK notification
    const ackPromise = new Promise((resolve, reject) => {
      subscription = connectedDevice.monitorCharacteristicForService(
        WALLET_SERVICE_UUID,
        TX_ACK_CHAR_UUID,
        async (error, characteristic) => {
          if (error) {
            if (!ackResolved) {
              console.warn('[BleCentral] Monitor error:', error.message); //[cite: 5]
            }
            return;
          }

          if (characteristic?.value && !ackResolved) { //[cite: 5]
            try {
              const rawAck = Buffer.from(characteristic.value, 'base64').toString('utf-8'); //[cite: 5]
              const ackReceipt = JSON.parse(rawAck); //[cite: 5]

              // Validate that the ACK matches our transfer session
              if (
                ackReceipt.transferSessionId === transferSessionId &&
                (ackReceipt.status === 'COMMITTED' || ackReceipt.status === 'SUCCESS') //[cite: 5]
              ) {
                ackResolved = true; //[cite: 5]
                resolve(ackReceipt); //[cite: 5]
              }
            } catch (parseErr) {
              console.error('[BleCentral] Failed parsing ACK payload:', parseErr); //[cite: 5]
            }
          }
        }
      ); //[cite: 5]
    });

    // 3. Serialize the full batch package
    const payload = JSON.stringify({
      transferSessionId,
      senderId,
      tokenCount: tokens.length,
      totalAmount: expectedAmount,
      tokens,
    });

    const totalChunks = Math.ceil(payload.length / CHUNK_SIZE); //[cite: 5]
    for (let i = 0; i < totalChunks; i++) {
      const slice = payload.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE); //[cite: 5]
      const packet = `CHUNK:${i}:${totalChunks}:${slice}`; //[cite: 5]
      const base64Chunk = Buffer.from(packet, 'utf-8').toString('base64'); //[cite: 5]

      await connectedDevice.writeCharacteristicWithResponseForService(
        WALLET_SERVICE_UUID,
        RX_PAYMENT_CHAR_UUID,
        base64Chunk
      ); //[cite: 5]
    }

    // 4. Send EOF delimiter
    const eofBase64 = Buffer.from('EOF', 'utf-8').toString('base64'); //[cite: 5]
    await connectedDevice.writeCharacteristicWithResponseForService(
      WALLET_SERVICE_UUID,
      RX_PAYMENT_CHAR_UUID,
      eofBase64
    ); //[cite: 5]

    // 5. Await validated ACK from receiver
    const ackReceipt = await ackPromise; //[cite: 5]

    // 6. Clean up BLE connection
    subscription?.remove(); //[cite: 5]
    await connectedDevice.cancelConnection().catch(() => {}); //[cite: 5]

    // 7. Invoke successful callback
    if (typeof onAckReceived === 'function') {
      await onAckReceived(ackReceipt); //[cite: 5]
    }
    return ackReceipt;
  } catch (err) {
    subscription?.remove(); //[cite: 5]
    if (connectedDevice) {
      await connectedDevice.cancelConnection().catch(() => {}); //[cite: 5]
    }
    throw err;
  }
};