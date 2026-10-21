
import { DeviceEventEmitter } from 'react-native';
import BlePeripheral from 'react-native-ble-peripheral';
import { ChunkCollector } from './ChunkEngine';
import { verifyBankToken } from '../crypto/TokenCrypto';

export const WALLET_SERVICE_UUID =
  '0000FFF0-0000-1000-8000-00805F9B34FB';

export const RX_PAYMENT_CHAR_UUID =
  '0000FFF1-0000-1000-8000-00805F9B34FB';

export const TX_ACK_CHAR_UUID =
  '0000FFF2-0000-1000-8000-00805F9B34FB';

const chunkCollector = new ChunkCollector();

const utf8ToBytes = (text) => {
  const encoded = unescape(encodeURIComponent(text));
  return Array.from(encoded, (character) =>
    character.charCodeAt(0)
  );
};

export const startReceiverGattServer = async (
  receiverId,
  onPaymentComplete
) => {
  // Subscribe before starting BLE advertising.
  const subscription = DeviceEventEmitter.addListener(
    'BLEPeripheralCharacteristicWrite',
    async (event) => {
      if (
        event.characteristicUUID?.toLowerCase() !==
        RX_PAYMENT_CHAR_UUID.toLowerCase()
      ) {
        return;
      }

      try {
        const bytes = event.data.map((byte) => byte & 0xff);

        // ChunkCollector must accept byte arrays.
        const fullPayload = chunkCollector.processChunk(bytes);

        if (!fullPayload) return;

        const transaction =
          typeof fullPayload === 'string'
            ? JSON.parse(fullPayload)
            : fullPayload;

        if (!transaction?.tokenData) {
          throw new Error('Missing tokenData in payment payload');
        }

        const isTokenValid = verifyBankToken(
          transaction.tokenData
        );

        if (!isTokenValid) {
          console.warn('Rejected invalid payment token');
          return;
        }

        const ack = {
          status: 'SUCCESS',
          txnId: transaction.tokenData.tokenId,
          amount: transaction.tokenData.amount,
          receivedAt: Date.now(),
          receiverId,
        };

        await BlePeripheral.sendNotificationToDevices(
          WALLET_SERVICE_UUID,
          TX_ACK_CHAR_UUID,
          utf8ToBytes(JSON.stringify(ack))
        );

        onPaymentComplete?.(ack);
      } catch (error) {
        console.error('BLE payment receive failed:', error);
      }
    }
  );

  try {
    await BlePeripheral.setName(`PAY_${receiverId}`);

    await BlePeripheral.addService(
      WALLET_SERVICE_UUID,
      true
    );

    // Writable permission = 16; write-with-response property = 8.
    await BlePeripheral.addCharacteristicToService(
      WALLET_SERVICE_UUID,
      RX_PAYMENT_CHAR_UUID,
      16,
      8
    );

    // Notify property = 16.
    await BlePeripheral.addCharacteristicToService(
      WALLET_SERVICE_UUID,
      TX_ACK_CHAR_UUID,
      1,
      16
    );

    await BlePeripheral.start();

    console.log('BLE receiver started:', receiverId);

    // Return cleanup so the screen can stop the BLE server.
    return () => {
      subscription.remove();

      try {
        BlePeripheral.stop();
      } catch (error) {
        console.warn('BLE cleanup failed:', error);
      }
    };
  } catch (error) {
    subscription.remove();
    console.error('Failed to start BLE receiver:', error);
    throw error;
  }
};
