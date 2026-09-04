import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { getWalletData, processIncomingOfflinePayment } from '../database/schema';
import { verifySignatureOffline } from '../services/walletIdentity';

export default function ReceivePaymentScreen({ navigation }) {
  const [tab, setTab] = useState('QR'); // 'QR', 'SCAN_PAYER', or 'NFC'
  const [wallet, setWallet] = useState(null);
  const [isReceivingNFC, setIsReceivingNFC] = useState(false);
  const [isProcessingScan, setIsProcessingScan] = useState(false);

  // Camera permissions hook
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    async function loadIdentity() {
      const data = await getWalletData();
      setWallet(data);
    }
    loadIdentity();
  }, []);

  // Verified offline cryptographic settlement
  const handleInboundPaymentPayload = async (rawJsonPayload) => {
    try {
      let tx;
      try {
        tx = JSON.parse(rawJsonPayload);
      } catch {
        throw new Error('Scanned code is not a valid transaction payload.');
      }

      if (!tx.txId || !tx.sender || !tx.amount || !tx.signature) {
        throw new Error('Invalid or incomplete transaction package.');
      }

      // 1. Verify that this device is the designated recipient
      if (tx.receiver !== wallet?.wallet_id) {
        Alert.alert(
          'Recipient Mismatch',
          `This payment is addressed to ${tx.receiver.substring(0, 10)}..., not your wallet ID.`
        );
        setIsProcessingScan(false);
        return;
      }

      // 2. Rebuild the canonical signature string: id:sender:receiver:amount:nonce:timestamp
      const canonicalPayload = `${tx.txId}:${tx.sender}:${tx.receiver}:${tx.amount}:${tx.nonce}:${tx.timestamp}`;

      // 3. Cryptographically verify signature against sender's public key
      const isValid = await verifySignatureOffline(canonicalPayload, tx.signature, tx.senderPublicKey);
      if (!isValid) {
        Alert.alert('Verification Failed', 'Digital signature does not match sender public key.');
        setIsProcessingScan(false);
        return;
      }

      // 4. Record credit to local balance & queue sync item in SQLite
      await processIncomingOfflinePayment({
        transactionId: tx.txId,
        sender: tx.sender,
        receiver: wallet.wallet_id,
        amount: parseFloat(tx.amount),
        nonce: tx.nonce,
        signature: tx.signature,
      });

      Alert.alert(
        'Payment Claimed!',
        `Received $${Number(tx.amount).toFixed(2)} offline from ${tx.sender.substring(0, 10)}...`,
        [{ text: 'View Balance', onPress: () => navigation.navigate('Home') }]
      );
    } catch (err) {
      console.error('Failed to claim inbound payment:', err);
      Alert.alert('Transaction Error', err.message || 'Could not process incoming payment.');
      setIsProcessingScan(false);
    }
  };

  const handleBarCodeScanned = ({ data }) => {
    if (isProcessingScan) return;
    setIsProcessingScan(true);
    handleInboundPaymentPayload(data);
  };

  const handleOpenScannerTab = async () => {
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) {
        Alert.alert('Permission Denied', 'Camera permission is required to scan payer QR codes.');
        return;
      }
    }
    setIsProcessingScan(false);
    setTab('SCAN_PAYER');
  };

  const toggleNfcListener = () => {
    setIsReceivingNFC(!isReceivingNFC);
    if (!isReceivingNFC) {
      Alert.alert('NFC Polling Active', 'Hold payer device against your device to receive payment.');
    }
  };

  return (
    <View style={styles.container}>
      {/* 3-Way Navigation Segment */}
      <View style={styles.segmentContainer}>
        <TouchableOpacity
          style={[styles.segmentBtn, tab === 'QR' && styles.segmentActive]}
          onPress={() => setTab('QR')}
        >
          <Text style={[styles.segmentText, tab === 'QR' && styles.segmentTextActive]}>
            My Address
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segmentBtn, tab === 'SCAN_PAYER' && styles.segmentActive]}
          onPress={handleOpenScannerTab}
        >
          <Text style={[styles.segmentText, tab === 'SCAN_PAYER' && styles.segmentTextActive]}>
            Scan Payer
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segmentBtn, tab === 'NFC' && styles.segmentActive]}
          onPress={() => setTab('NFC')}
        >
          <Text style={[styles.segmentText, tab === 'NFC' && styles.segmentTextActive]}>
            NFC
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tab 1: Static Address QR */}
      {tab === 'QR' && (
        <View style={styles.card}>
          <Text style={styles.title}>Scan to Pay Me</Text>

          <View style={styles.qrWrapper}>
            {wallet?.wallet_id ? (
              <QRCode value={wallet.wallet_id} size={180} />
            ) : (
              <ActivityIndicator size="small" color="#2563EB" />
            )}
          </View>

          <Text style={styles.addressDisplay} numberOfLines={1} ellipsizeMode="middle">
            {wallet?.wallet_id || 'Deriving Wallet ID...'}
          </Text>
          <Text style={styles.subtext}>
            Have the payer scan your address to sign an offline payment.
          </Text>
        </View>
      )}

      {/* Tab 2: Live Viewfinder to Scan Signed Payment */}
      {tab === 'SCAN_PAYER' && (
        <View style={styles.scannerWrapper}>
          {!permission?.granted ? (
            <View style={styles.permissionBox}>
              <Text style={styles.permissionText}>Camera permission is needed to scan payments.</Text>
              <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
                <Text style={styles.permissionBtnText}>Grant Access</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={StyleSheet.absoluteFillObject}>
              <CameraView
                style={StyleSheet.absoluteFillObject}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={isProcessingScan ? undefined : handleBarCodeScanned}
              />
              <View style={styles.scannerOverlay}>
                <Text style={styles.scannerPrompt}>Scan Payer's Payment Code</Text>
                <View style={styles.scanReticle} />
                <Text style={styles.scannerHint}>
                  {isProcessingScan ? 'Verifying offline signature...' : 'Align code inside box'}
                </Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Tab 3: NFC Receiver */}
      {tab === 'NFC' && (
        <View style={styles.card}>
          <Text style={styles.title}>Ready to Receive</Text>

          <TouchableOpacity onPress={toggleNfcListener} activeOpacity={0.8}>
            <View style={[styles.nfcWaveCircle, isReceivingNFC && styles.nfcActiveCircle]}>
              <Text style={[styles.nfcIcon, isReceivingNFC && { color: '#10B981' }]}>
                (( • ))
              </Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.statusLabel}>
            {isReceivingNFC ? 'NFC Listening for Peer...' : 'Tap icon to toggle NFC listening'}
          </Text>

          <Text style={styles.subtext}>
            Hold payer's device against your phone to accept funds peer-to-peer.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#F8FAFC' },
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
  },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  segmentActive: { backgroundColor: '#FFFFFF' },
  segmentText: { fontWeight: '600', color: '#64748B', fontSize: 13 },
  segmentTextActive: { color: '#0F172A' },
  card: {
    backgroundColor: '#FFFFFF',
    padding: 28,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#0F172A', marginBottom: 20 },
  qrWrapper: {
    width: 200,
    height: 200,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginBottom: 16,
  },
  addressDisplay: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: '#0F172A',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    maxWidth: '90%',
    textAlign: 'center',
  },
  subtext: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 10,
  },
  scannerWrapper: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  permissionBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  permissionText: {
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 16,
    fontSize: 15,
  },
  permissionBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  permissionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 50,
  },
  scannerPrompt: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  scanReticle: {
    width: 230,
    height: 230,
    borderWidth: 2,
    borderColor: '#10B981',
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  scannerHint: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
  },
  nfcWaveCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 20,
    borderWidth: 2,
    borderColor: '#BFDBFE',
  },
  nfcActiveCircle: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  nfcIcon: { fontSize: 24, fontWeight: '800', color: '#2563EB' },
  statusLabel: { fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 4 },
});