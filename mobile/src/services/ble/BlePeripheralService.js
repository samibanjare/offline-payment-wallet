import { NativeModules, Platform } from 'react-native';
import * as BlePeripheralLib from 'react-native-ble-peripheral';
import { Buffer } from 'buffer';
import { recordReceivedToken } from '../../storage/TokenLedgerService';
import { verifyBankSignature } from '../crypto/TokenCrypto';

export const WALLET_SERVICE_UUID = '0000180F-0000-1000-8000-00805F9B34FB';
export const RX_PAYMENT_CHAR_UUID = '00002A19-0000-1000-8000-00805F9B34FB';
export const TX_ACK_CHAR_UUID = '00002A20-0000-1000-8000-00805F9B34FB';

// Handle variations in how react-native-ble-peripheral exports its native module
const NativeBle =
  NativeModules.BlePeripheral ||
  BlePeripheralLib.default ||
  BlePeripheralLib;

let chunkStore = {};

export const startReceiverGattServer = async (receiverId, onPaymentReceived) => {
  try {
    if (!NativeBle) {
      throw new Error(
        'BlePeripheral native module not found in NativeModules. Rebuild the app with gradlew assembleRelease.'
      );
    }

    chunkStore[receiverId] = [];

    // 1. Initialize or clear previous services
    if (typeof NativeBle.stop === 'function') {
      try { await NativeBle.stop(); } catch (_) {}
    }

    // 2. Add Service
    if (typeof NativeBle.addService === 'function') {
      await NativeBle.addService(WALLET_SERVICE_UUID, true);
    }

    // 3. Add Characteristics (RX for incoming tokens, TX for ACK)
    if (typeof NativeBle.addCharacteristicToService === 'function') {
      // RX: Write + Write Without Response (permissions: Read + Write)
      await NativeBle.addCharacteristicToService(
        WALLET_SERVICE_UUID,
        RX_PAYMENT_CHAR_UUID,
        16 | 8,
        1 | 2
      );
      // TX: Notify + Read (permissions: Read)
      await NativeBle.addCharacteristicToService(
        WALLET_SERVICE_UUID,
        TX_ACK_CHAR_UUID,
        16 | 2,
        1
      );
    }

    // 4. Handle incoming chunks from Central (ScanPayScreen)
    const onWriteCallback = async (rawPayload) => {
      try {
        let base64Val = '';
        if (typeof rawPayload === 'string') {
          base64Val = rawPayload;
        } else if (rawPayload?.value) {
          base64Val = rawPayload.value;
        }

        const decoded = Buffer.from(base64Val, 'base64').toString('utf-8');

        if (decoded.startsWith('CHUNK:')) {
          const parts = decoded.split(':');
          const index = parseInt(parts[1], 10);
          const chunkData = parts.slice(3).join(':');
          chunkStore[receiverId][index] = chunkData;
        } else if (decoded === 'EOF') {
          const fullJsonString = chunkStore[receiverId].join('');
          chunkStore[receiverId] = []; // reset buffer

          const payload = JSON.parse(fullJsonString);
          const { transferSessionId, senderId, tokens } = payload;

          // 1. Verify signatures on all incoming tokens
          for (const token of tokens) {
            const isValid = await verifyBankSignature(token);
            if (!isValid) {
              console.error('[BlePeripheral] Invalid bank signature on token:', token.tokenId);
              return;
            }
          }

          // Record token in local SQLite ledger
          const { txnId, totalReceived } = await recordReceivedToken(tokens, senderId, receiverId, transferSessionId);

          const ackReceipt = {
            status: 'COMMITTED',
            transferSessionId,
            txnId,
            amount: totalReceived,
            receiverId,
            senderId,
            timestamp: Date.now(),
          };

          // Send ACK notification back to central
          const ackBase64 = Buffer.from(JSON.stringify(ackReceipt), 'utf-8').toString('base64');
          if (typeof NativeBle.sendNotificationToDevices === 'function') {
            await NativeBle.sendNotificationToDevices(
              WALLET_SERVICE_UUID,
              TX_ACK_CHAR_UUID,
              ackBase64
            );
          }

          if (typeof onPaymentReceived === 'function') {
            onPaymentReceived(ackReceipt);
          }
        }
      } catch (err) {
        console.error('[BlePeripheral] Error processing packet:', err);
      }
    };

    // Set listener based on supported API method name
    if (typeof NativeBle.setCharacteristicWriteListener === 'function') {
      NativeBle.setCharacteristicWriteListener(RX_PAYMENT_CHAR_UUID, onWriteCallback);
    } else if (typeof NativeBle.onCharacteristicWrite === 'function') {
      NativeBle.onCharacteristicWrite(onWriteCallback);
    }

    // 5. Start Advertising
    const advertisedName = `PAY_${receiverId}`.substring(0, 16);

    if (typeof NativeBle.startAdvertising === 'function') {
      await NativeBle.startAdvertising(advertisedName, [WALLET_SERVICE_UUID]);
    } else if (typeof NativeBle.start === 'function') {
      if (typeof NativeBle.setName === 'function') {
        await NativeBle.setName(advertisedName);
      }
      await NativeBle.start();
    } else {
      console.warn('[BlePeripheral] No known start advertising method found on native object:', Object.keys(NativeBle));
    }

    console.log('[BlePeripheral] Advertising started successfully as', advertisedName);

    return async () => {
      try {
        if (typeof NativeBle.stopAdvertising === 'function') {
          await NativeBle.stopAdvertising();
        } else if (typeof NativeBle.stop === 'function') {
          await NativeBle.stop();
        }
      } catch (_) {}
    };
  } catch (err) {
    console.error('[BlePeripheral] Gatt server initialization error:', err);
    throw err;
  }
};