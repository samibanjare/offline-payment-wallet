import { BleManager } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { chunkPayload } from './ChunkEngine';
import {
  WALLET_SERVICE_UUID,
  RX_PAYMENT_CHAR_UUID,
  TX_ACK_CHAR_UUID,
} from './BlePeripheralService';

const bleManager = new BleManager();

export const sendPaymentViaBle = async (targetDeviceId, tokenData, onAckSuccess) => {
  // 1. Establish connection to receiver
  const device = await bleManager.connectToDevice(targetDeviceId, { autoConnect: false });
  await device.discoverAllServicesAndCharacteristics();
  await device.requestMTU(512);

  // 2. Listen for Receiver's ACK notification
  const ackSubscription = device.monitorCharacteristicForService(
    WALLET_SERVICE_UUID,
    TX_ACK_CHAR_UUID,
    (error, characteristic) => {
      if (error || !characteristic?.value) return;

      const rawAck = Buffer.from(characteristic.value, 'base64').toString('utf-8');
      const parsedAck = JSON.parse(rawAck);

      if (parsedAck.status === 'SUCCESS') {
        ackSubscription.remove();
        device.cancelConnection();
        onAckSuccess(parsedAck);
      }
    }
  );

  // 3. Chunk and transmit the signed token
  const payloadString = JSON.stringify({ tokenData });
  const chunks = chunkPayload(payloadString);

  for (const chunk of chunks) {
    const base64Chunk = Buffer.from(chunk).toString('base64');
    await device.writeCharacteristicWithResponseForService(
      WALLET_SERVICE_UUID,
      RX_PAYMENT_CHAR_UUID,
      base64Chunk
    );
  }
};