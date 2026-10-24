import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Linking,
  Platform,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import DeviceInfo from 'react-native-device-info';
import { getUniqueDeviceId } from '../services/DeviceIdentityService';

import {
  startReceiverGattServer,
  WALLET_SERVICE_UUID,
} from '../services/ble/BlePeripheralService';

import { PaymentSuccessModal } from './PaymentSuccessModal';
import { requestBlePermissions } from '../services/ble/BlePermissions';

const ReceiveQrScreen = ({ route, navigation }) => {
  const [receiverId, setReceiverId] = useState(route.params?.receiverId || null);
  const [deviceId, setDeviceId] = useState(null);
  const [isAdvertising, setIsAdvertising] = useState(false);
  const [completedTxn, setCompletedTxn] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);


  useEffect(() => {
    if (!receiverId) {
      getUniqueDeviceId().then((id) => setReceiverId(id));
    }
  }, [receiverId]);

  const safeAdvertisedName = receiverId 
    ? `PAY_${receiverId.replace(/[^a-zA-Z0-9]/g, '')}`.substring(0, 16)
    : 'PAY_RECEIVER';

  const initializeReceiver = useCallback(
    async (isMounted) => {
      if (!receiverId) return null; // Wait until device receiverId is resolved
      setError(null);
      setIsAdvertising(false);

      try {
        const granted = await requestBlePermissions();

        if (!isMounted()) return null;

        if (!granted) {
          throw new Error(
            'Bluetooth permissions are required. Allow Nearby devices in Android Settings and try again.'
          );
        }

        setDeviceId(receiverId);
        console.log('[ReceiveQrScreen] Starting BLE receiver...');

        // Start GATT peripheral and receive cleanup closure
        const cleanupGattServer = await startReceiverGattServer(
          receiverId,
          (receipt) => {
            if (isMounted()) {
              console.log('[ReceiveQrScreen] Payment receipt received:', receipt);
              setCompletedTxn(receipt);
            }
          }
        );

        if (!isMounted()) {
          cleanupGattServer?.();
          return null;
        }

        setIsAdvertising(true);
        console.log('[ReceiveQrScreen] BLE receiver started');

        return cleanupGattServer;
      } catch (err) {
        if (!isMounted()) return null;

        console.error('[ReceiveQrScreen] Initialization failed:', err);

        const message = String(err?.message || err || '');
        const code = String(err?.code || '');

        if (
          code === 'BLUETOOTH_OFF' ||
          /bluetooth.*(off|disabled|not enabled)|adapter.*disabled/i.test(message)
        ) {
          setError('Bluetooth is turned off. Turn on Bluetooth to receive offline payments.');
        } else if (
          code === 'BLE_ADVERTISING_UNAVAILABLE' ||
          /advertiser.*null|advertising.*unavailable/i.test(message)
        ) {
          setError(
            'BLE advertising is unavailable. Turn on Bluetooth and check whether this phone supports Bluetooth LE advertising.'
          );
        } else if (
          /permission|not authorized|securityexception/i.test(message)
        ) {
          setError(
            'Bluetooth permission is missing. Allow Nearby devices in Android Settings, then retry.'
          );
        } else {
          setError(message || 'Could not start the Bluetooth receiver.');
        }

        setIsAdvertising(false);
        return null;
      }
    },
    [receiverId]
  );

  useEffect(() => {
    let mounted = true;
    let activeCleanup = null;

    const runSetup = async () => {
      const cleanup = await initializeReceiver(() => mounted);
      if (!mounted) {
        cleanup?.();
      } else {
        activeCleanup = cleanup;
      }
    };

    runSetup();

    return () => {
      mounted = false;
      activeCleanup?.();
    };
  }, [initializeReceiver, attempt]);

  const handleRetry = () => {
    setAttempt((previous) => previous + 1);
  };

  const handleEnableBluetooth = () => {
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() => {
        Linking.openSettings();
      });
    } else {
      Alert.alert(
        'Enable Bluetooth',
        'Please turn on Bluetooth in your device settings, then return and retry.'
      );
    }
  };

  const qrPayload = JSON.stringify({
    receiverId,
    serviceUuid: WALLET_SERVICE_UUID,
    advertisedName: safeAdvertisedName,
  });

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Scan to Pay</Text>

      <Text style={styles.subtext}>Receiver ID: {receiverId}</Text>

      <View style={styles.qrContainer}>
        {error ? (
          <>
            <Text style={styles.errorTitle}>Bluetooth receiver unavailable</Text>
            <Text style={styles.errorText}>{error}</Text>

            {/turn on bluetooth|turned off/i.test(error) && (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleEnableBluetooth}
              >
                <Text style={styles.buttonText}>Open Bluetooth Settings</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.secondaryButton} onPress={handleRetry}>
              <Text style={styles.secondaryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </>
        ) :  (
          <QRCode
            value={qrPayload}
            size={240}
            color="#1F2937"
            backgroundColor="#FFFFFF"
          />
        // ) : (
        //   <View style={styles.loadingContainer}>
        //     <ActivityIndicator size="large" color="#00BAF2" />
        //     <Text style={styles.statusText}>Initializing Bluetooth receiver...</Text>
        //   </View>
        // )
        )}
      </View>

      <View style={styles.indicatorBadge}>
        <View
          style={[
            styles.dot,
            isAdvertising && !error && styles.dotActive,
            error && styles.dotError,
          ]}
        />

        <Text style={styles.indicatorText}>
          {error
            ? 'Bluetooth setup failed'
            : isAdvertising
            ? 'Bluetooth receiver started'
            : 'Setting up connection...'}
        </Text>
      </View>

      {deviceId ? <Text style={styles.deviceId}>Device: {deviceId}</Text> : null}

      <PaymentSuccessModal
        visible={!!completedTxn}
        transactionData={completedTxn}
        onClose={() => {
          setCompletedTxn(null);
          if (navigation?.canGoBack()) {
            navigation.navigate('Home', { refresh: Date.now() });
          }
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  subtext: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 28,
  },
  qrContainer: {
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    elevation: 4,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 280,
    minWidth: 280,
    maxWidth: '100%',
  },
  loadingContainer: {
    alignItems: 'center',
  },
  statusText: {
    marginTop: 12,
    color: '#6B7280',
    fontSize: 13,
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#B91C1C',
    textAlign: 'center',
    marginBottom: 10,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 260,
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: '#00BAF2',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  secondaryButtonText: {
    color: '#374151',
    fontWeight: '600',
  },
  indicatorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 28,
    backgroundColor: '#EFF6FF',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#9CA3AF',
    marginRight: 8,
  },
  dotActive: {
    backgroundColor: '#10B981',
  },
  dotError: {
    backgroundColor: '#EF4444',
  },
  indicatorText: {
    fontSize: 13,
    color: '#1E40AF',
    fontWeight: '500',
  },
  deviceId: {
    marginTop: 12,
    fontSize: 11,
    color: '#9CA3AF',
  },
});

export default ReceiveQrScreen;