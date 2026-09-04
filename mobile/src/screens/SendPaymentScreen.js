import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { getWalletData, executeOfflinePayment, getNextNonce } from '../database/schema';
import { signPayloadOffline } from '../services/walletIdentity';

export default function SendPaymentScreen({ navigation }) {
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [method, setMethod] = useState('QR'); // 'QR' or 'NFC'
  const [wallet, setWallet] = useState(null);
  const [signedQrPayload, setSignedQrPayload] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Camera scanner state
  const [isScanning, setIsScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    async function loadWallet() {
      const data = await getWalletData();
      setWallet(data);
    }
    loadWallet();
  }, []);

  const openCameraScanner = async () => {
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) {
        Alert.alert('Permission Denied', 'Camera permission is required to scan QR codes.');
        return;
      }
    }
    setIsScanning(true);
  };

  const handleBarCodeScanned = ({ data }) => {
    setIsScanning(false);
    if (data) {
      try {
        const parsed = JSON.parse(data);
        setRecipient(parsed.wallet_id || parsed.address || data);
      } catch {
        setRecipient(data);
      }
    }
  };

  const handleSendPayment = async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid transfer amount.');
      return;
    }
    if (!recipient.trim()) {
      Alert.alert('Missing Recipient', 'Please scan or enter the receiver wallet address.');
      return;
    }

    if (!wallet || wallet.balance < numAmount) {
      Alert.alert(
        'Insufficient Balance',
        `Current available balance: $${wallet ? Number(wallet.balance).toFixed(2) : '0.00'}`
      );
      return;
    }

    try {
      setIsProcessing(true);

      const nonce = await getNextNonce(wallet.wallet_id);
      const timestamp = Date.now();
      const transactionId = `tx_${timestamp}_${Math.random().toString(36).substring(7)}`;

      // 1. Canonical payload string for hardware-backed signing
      const rawPayload = `${transactionId}:${wallet.wallet_id}:${recipient.trim()}:${numAmount}:${nonce}:${timestamp}`;
      const signature = await signPayloadOffline(rawPayload);

      // 2. Commit deduction and save pending state in SQLite
      await executeOfflinePayment({
        transactionId,
        sender: wallet.wallet_id,
        receiver: recipient.trim(),
        amount: numAmount,
        nonce,
        signature,
      });

      // 3. Structured cryptographic package for QR / NFC transmission
      const transferPackage = JSON.stringify({
        txId: transactionId,
        sender: wallet.wallet_id,
        senderPublicKey: wallet.public_key,
        receiver: recipient.trim(),
        amount: numAmount,
        nonce,
        timestamp,
        signature,
      });

      if (method === 'QR') {
        setSignedQrPayload(transferPackage);
      } else {
        Alert.alert(
          'NFC Beam Ready',
          `Payment of $${numAmount.toFixed(2)} is signed. Hold back-to-back with receiving device.`
        );
      }
    } catch (err) {
      console.error('Offline Payment Error:', err);
      Alert.alert('Transaction Failed', err.message || 'Could not sign payment offline.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Recipient Address Input + Integrated Scanner Button */}
      <Text style={styles.sectionHeader}>Recipient Wallet Address</Text>
      <View style={styles.recipientRow}>
        <TextInput
          style={[styles.textInput, { flex: 1, marginBottom: 0 }]}
          placeholder="0x... or scan QR"
          placeholderTextColor="#94A3B8"
          value={recipient}
          onChangeText={setRecipient}
          autoCapitalize="none"
          editable={!signedQrPayload}
        />
        <TouchableOpacity
          style={styles.scanBtn}
          onPress={openCameraScanner}
          disabled={!!signedQrPayload}
        >
          <Text style={styles.scanBtnText}>Scan</Text>
        </TouchableOpacity>
      </View>

      {/* Enter Amount */}
      <Text style={styles.sectionHeader}>Enter Amount</Text>
      <View style={styles.inputContainer}>
        <Text style={styles.currencySymbol}>$</Text>
        <TextInput
          style={styles.amountInput}
          placeholder="0.00"
          placeholderTextColor="#94A3B8"
          keyboardType="numeric"
          value={amount}
          onChangeText={setAmount}
          editable={!signedQrPayload}
        />
      </View>

      {/* Select Payment Method */}
      <Text style={styles.sectionHeader}>Select Payment Method</Text>
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, method === 'QR' && styles.toggleActive]}
          onPress={() => {
            setMethod('QR');
            setSignedQrPayload(null);
          }}
        >
          <Text style={[styles.toggleText, method === 'QR' && styles.toggleTextActive]}>
            QR Code
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toggleBtn, method === 'NFC' && styles.toggleActive]}
          onPress={() => {
            setMethod('NFC');
            setSignedQrPayload(null);
          }}
        >
          <Text style={[styles.toggleText, method === 'NFC' && styles.toggleTextActive]}>
            NFC
          </Text>
        </TouchableOpacity>
      </View>

      {/* Dynamic Action Area */}
      <View style={styles.displayCard}>
        {method === 'QR' ? (
          signedQrPayload ? (
            <>
              <Text style={styles.modeHeader}>Scan to Claim</Text>
              <Text style={styles.modeDescription}>
                Let the receiver scan this signed transaction payload to collect funds.
              </Text>
              <View style={styles.qrWrapper}>
                <QRCode value={signedQrPayload} size={200} />
              </View>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#0F172A', marginTop: 20 }]}
                onPress={() => navigation.navigate('Home')}
              >
                <Text style={styles.actionBtnText}>Done</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.modeHeader}>QR Code Transfer</Text>
              <Text style={styles.modeDescription}>
                Scan the recipient address or enter it manually, then sign the payment.
              </Text>
              <View style={styles.actionButtonRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#475569', marginRight: 10 }]}
                  onPress={openCameraScanner}
                >
                  <Text style={styles.actionBtnText}>Scan Code</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, isProcessing && { opacity: 0.6 }]}
                  onPress={handleSendPayment}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.actionBtnText}>Sign & Send</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )
        ) : (
          <>
            <Text style={styles.modeHeader}>NFC Payment</Text>
            <Text style={styles.modeDescription}>
              Hold the top of your device near the recipient's NFC terminal or peer device.
            </Text>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#334155' }]}
              onPress={handleSendPayment}
              disabled={isProcessing}
            >
              <Text style={styles.actionBtnText}>
                {isProcessing ? 'Signing...' : 'Ready to Tap (NFC)'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Embedded Scanner Modal */}
      <Modal visible={isScanning} animationType="slide" transparent={false}>
        <View style={styles.scannerContainer}>
          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarCodeScanned}
          />
          <View style={styles.scannerOverlay}>
            <Text style={styles.scannerTitle}>Align Recipient QR Code</Text>
            <View style={styles.scanTargetBox} />
            <TouchableOpacity
              style={styles.closeScanBtn}
              onPress={() => setIsScanning(false)}
            >
              <Text style={styles.closeScanBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  recipientRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 52,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    color: '#1E293B',
    fontFamily: 'monospace',
  },
  scanBtn: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  scanBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 24,
  },
  currencySymbol: { fontSize: 24, fontWeight: '700', color: '#1E293B', marginRight: 8 },
  amountInput: { flex: 1, height: 56, fontSize: 24, fontWeight: '700', color: '#1E293B' },
  toggleRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  toggleActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  toggleText: { fontWeight: '600', color: '#475569' },
  toggleTextActive: { color: '#FFFFFF' },
  displayCard: {
    backgroundColor: '#FFFFFF',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  modeHeader: { fontSize: 18, fontWeight: '700', color: '#0F172A', marginBottom: 6 },
  modeDescription: { fontSize: 14, color: '#64748B', textAlign: 'center', marginBottom: 20 },
  actionButtonRow: { flexDirection: 'row', justifyContent: 'center' },
  actionBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 10,
    alignItems: 'center',
    minWidth: 130,
  },
  actionBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  qrWrapper: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  scannerContainer: { flex: 1, backgroundColor: '#000000' },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 60,
  },
  scannerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  scanTargetBox: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: '#2563EB',
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  closeScanBtn: {
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  closeScanBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
});