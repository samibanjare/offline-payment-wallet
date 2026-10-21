import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import QRCode from 'react-native-qrcode-svg';

import QRScannerModal from '@babel/core/src/components/QRScannerModal';

import {
  getWalletData,
  executeOfflinePayment,
  getNextNonce,
} from '../database/schema';

import {
  signPayloadOffline,
  canonicalPaymentPayload,
} from '../services/walletIdentity';

export default function SendPaymentScreen({ navigation }) {
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [wallet, setWallet] = useState(null);
  const [signedQrPayload, setSignedQrPayload] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const loadWallet = useCallback(async () => {
    try {
      const data = await getWalletData();
      setWallet(data);
    } catch (error) {
      console.error('Failed to load wallet:', error);
      Alert.alert('Wallet Error', 'Could not load your wallet.');
    }
  }, []);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  const handleScanSuccess = useCallback((rawData) => {
    setIsScanning(false);

    if (!rawData) return;

    try {
      const parsed =
        typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid receiver QR.');
      }

      if (
        parsed.type &&
        parsed.type !== 'PAYMENT_REQUEST'
      ) {
        throw new Error('This QR is not a payment request.');
      }

      const targetAddress =
        parsed.receiver ||
        parsed.recipient ||
        parsed.wallet_id ||
        parsed.walletId ||
        parsed.address ||
        '';

      if (!targetAddress) {
        throw new Error('Receiver wallet address was not found.');
      }

      setRecipient(String(targetAddress).trim());

      if (parsed.amount !== undefined && parsed.amount !== null) {
        setAmount(String(parsed.amount));
      }

      setSignedQrPayload(null);
    } catch (error) {
      Alert.alert(
        'Invalid QR',
        error.message || 'Scan a valid receiver payment QR.'
      );
    }
  }, []);

  const handleSendPayment = async () => {
    if (!wallet) {
      Alert.alert('Wallet Not Ready', 'Please wait for your wallet to load.');
      return;
    }

    const numAmount = Number(amount);
    const cents = Math.round(numAmount * 100);

    if (
      !Number.isFinite(numAmount) ||
      numAmount <= 0 ||
      !Number.isSafeInteger(cents) ||
      Math.abs(numAmount * 100 - cents) > 1e-7
    ) {
      Alert.alert(
        'Invalid Amount',
        'Enter a positive amount with at most two decimal places.'
      );
      return;
    }

    const target = recipient.trim();

    if (!target) {
      Alert.alert(
        'Missing Recipient',
        'Scan or enter a receiver wallet address.'
      );
      return;
    }

    if (target === wallet.wallet_id) {
      Alert.alert('Invalid Recipient', 'You cannot pay your own wallet.');
      return;
    }

    if (Number(wallet.balance) < numAmount) {
      Alert.alert(
        'Insufficient Balance',
        `Available balance: ₹${Number(wallet.balance).toFixed(2)}`
      );
      return;
    }

    try {
      setIsProcessing(true);
      setSignedQrPayload(null);

      const nonce = await getNextNonce(wallet.wallet_id);
      const timestamp = Date.now();

      const randomId = Crypto.randomUUID
        ? Crypto.randomUUID()
        : `${timestamp}_${Math.random().toString(36).slice(2)}`;

      const transactionId = `tx_${randomId}`;

      const voucherFields = {
        txId: transactionId,
        sender: wallet.wallet_id,
        receiver: target,
        amount: cents / 100,
        nonce,
        timestamp,
        senderPublicKey: wallet.public_key,
      };

      const payload = canonicalPaymentPayload(voucherFields);
      const signature = await signPayloadOffline(payload);

      await executeOfflinePayment({
        transactionId,
        sender: wallet.wallet_id,
        receiver: target,
        amount: cents / 100,
        nonce,
        signature,
      });

      const voucher = JSON.stringify({
        type: 'PAYMENT_VOUCHER',
        ...voucherFields,
        signature,
      });

      setSignedQrPayload(voucher);
      await loadWallet();

      Alert.alert(
        'Voucher Created',
        'Your balance has been debited locally. Show the voucher QR to the receiver to claim the payment.'
      );
    } catch (error) {
      console.error('Offline payment error:', error);

      Alert.alert(
        'Payment Failed',
        error.message || 'Could not create the payment voucher.'
      );

      await loadWallet();
    } finally {
      setIsProcessing(false);
    }
  };

  const formattedBalance = Number(wallet?.balance || 0).toLocaleString(
    'en-IN',
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#101C3A" />

      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Text style={styles.backIcon}>‹</Text>
          </TouchableOpacity>

          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Send Payment</Text>
            <Text style={styles.headerSubtitle}>
              Fast, secure and offline
            </Text>
          </View>

          <View style={styles.secureBadge}>
            <Text style={styles.secureIcon}>✓</Text>
          </View>
        </View>

        {/* Balance card */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceTopRow}>
            <View>
              <Text style={styles.balanceLabel}>AVAILABLE BALANCE</Text>
              <Text style={styles.balanceAmount}>
                ₹{formattedBalance}
              </Text>
            </View>

            <View style={styles.walletIconCircle}>
              <Text style={styles.walletIcon}>▣</Text>
            </View>
          </View>

          <View style={styles.balanceDivider} />

          <View style={styles.balanceBottomRow}>
            <View style={styles.onlineIndicator} />
            <Text style={styles.balanceFooter}>
              Offline wallet · Local balance
            </Text>
            <Text style={styles.balanceCurrency}>INR ₹</Text>
          </View>

          <View style={styles.decorCircleOne} />
          <View style={styles.decorCircleTwo} />
        </View>

        {/* Progress / section heading */}
        <View style={styles.sectionTitleRow}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>01</Text>
          </View>

          <View>
            <Text style={styles.sectionTitle}>Payment details</Text>
            <Text style={styles.sectionSubtitle}>
              Who are you sending money to?
            </Text>
          </View>
        </View>

        {/* Recipient */}
        <View style={styles.fieldCard}>
          <Text style={styles.fieldLabel}>RECIPIENT WALLET ADDRESS</Text>

          <View style={styles.recipientRow}>
            <View style={styles.recipientIcon}>
              <Text style={styles.recipientIconText}>↗</Text>
            </View>

            <TextInput
              style={styles.recipientInput}
              placeholder="Enter wallet address"
              placeholderTextColor="#94A3B8"
              value={recipient}
              onChangeText={(value) => {
                setRecipient(value);
                setSignedQrPayload(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isProcessing}
            />

            <TouchableOpacity
              style={styles.scanButton}
              onPress={() => setIsScanning(true)}
              disabled={isProcessing}
              activeOpacity={0.8}
            >
              <Text style={styles.scanButtonIcon}>▦</Text>
              <Text style={styles.scanButtonText}>Scan</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.helperRow}>
            <Text style={styles.helperIcon}>ⓘ</Text>
            <Text style={styles.helperText}>
              Scan the receiver's payment request QR code.
            </Text>
          </View>
        </View>

        {/* Amount */}
        <View style={styles.sectionTitleRow}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>02</Text>
          </View>

          <View>
            <Text style={styles.sectionTitle}>Enter amount</Text>
            <Text style={styles.sectionSubtitle}>
              How much would you like to send?
            </Text>
          </View>
        </View>

        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>TRANSFER AMOUNT</Text>

          <View style={styles.amountInputRow}>
            <Text style={styles.rupeeSymbol}>₹</Text>

            <TextInput
              style={styles.amountInput}
              placeholder="0.00"
              placeholderTextColor="#CBD5E1"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={(value) => {
                setAmount(value);
                setSignedQrPayload(null);
              }}
              editable={!isProcessing}
            />

            <View style={styles.inrBadge}>
              <Text style={styles.inrText}>INR</Text>
            </View>
          </View>

          <View style={styles.amountDivider} />

          <View style={styles.amountBottomRow}>
            <Text style={styles.amountHint}>Minimum amount: ₹0.01</Text>

            <TouchableOpacity
              onPress={() => {
                setAmount(String(Number(wallet?.balance || 0).toFixed(2)));
                setSignedQrPayload(null);
              }}
              disabled={isProcessing || !wallet}
            >
              <Text style={styles.maxButton}>USE FULL BALANCE</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Security note */}
        <View style={styles.securityCard}>
          <View style={styles.securityIconBox}>
            <Text style={styles.securityIcon}>♢</Text>
          </View>

          <View style={styles.securityTextContainer}>
            <Text style={styles.securityTitle}>Protected by your wallet key</Text>
            <Text style={styles.securityDescription}>
              Your payment voucher is digitally signed before it is
              recorded on your device.
            </Text>
          </View>
        </View>

        {/* Voucher / action area */}
        {signedQrPayload ? (
          <View style={styles.voucherCard}>
            <View style={styles.successIconCircle}>
              <Text style={styles.successIcon}>✓</Text>
            </View>

            <Text style={styles.voucherTitle}>Voucher created!</Text>
            <Text style={styles.voucherDescription}>
              Your local balance has been debited. Let the receiver scan
              this QR code to claim the voucher.
            </Text>

            <View style={styles.voucherAmountBox}>
              <Text style={styles.voucherAmountLabel}>PAYMENT AMOUNT</Text>
              <Text style={styles.voucherAmount}>
                ₹{Number(amount).toFixed(2)}
              </Text>
              <View style={styles.signedPill}>
                <Text style={styles.signedPillText}>
                  ✓ DIGITALLY SIGNED
                </Text>
              </View>
            </View>

            <View style={styles.qrOuter}>
              <QRCode
                value={signedQrPayload}
                size={210}
                backgroundColor="#FFFFFF"
                color="#101C3A"
              />
            </View>

            <Text style={styles.qrCaption}>
              Show this QR code to the receiver
            </Text>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => navigation.navigate('Home')}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryButtonText}>Done</Text>
              <Text style={styles.primaryButtonArrow}>→</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                setSignedQrPayload(null);
                setAmount('');
                setRecipient('');
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>
                Create another voucher
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.actionCard}>
            <View style={styles.actionSummaryRow}>
              <Text style={styles.actionSummaryLabel}>You are sending</Text>
              <Text style={styles.actionSummaryAmount}>
                ₹
                {Number(amount || 0).toLocaleString('en-IN', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                (isProcessing || !wallet) && styles.disabledButton,
              ]}
              onPress={handleSendPayment}
              disabled={isProcessing || !wallet}
              activeOpacity={0.85}
            >
              {isProcessing ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.primaryButtonText}>
                    Sign & Generate Voucher
                  </Text>
                  <Text style={styles.primaryButtonArrow}>→</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.offlineNote}>
              <View style={styles.offlineDot} />
              <Text style={styles.offlineNoteText}>
                No internet required to create the voucher
              </Text>
            </View>
          </View>
        )}

        <Text style={styles.footerText}>
          SECURE OFFLINE DIGITAL WALLET
        </Text>
      </ScrollView>

      <QRScannerModal
        visible={isScanning}
        onClose={() => setIsScanning(false)}
        onScan={handleScanSuccess}
        title="Scan Receiver Request"
        subtitle="Align the receiver's payment request QR within the frame"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F3F6FC',
  },

  container: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },

  backButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5EAF3',
  },

  backIcon: {
    color: '#101C3A',
    fontSize: 34,
    lineHeight: 38,
    marginTop: -4,
  },

  headerTextContainer: {
    flex: 1,
    marginLeft: 14,
  },

  headerTitle: {
    fontSize: 23,
    fontWeight: '800',
    color: '#101C3A',
    letterSpacing: -0.5,
  },

  headerSubtitle: {
    fontSize: 12,
    color: '#77849B',
    marginTop: 3,
  },

  secureBadge: {
    height: 40,
    width: 40,
    borderRadius: 14,
    backgroundColor: '#E0F7EE',
    alignItems: 'center',
    justifyContent: 'center',
  },

  secureIcon: {
    color: '#059669',
    fontSize: 22,
    fontWeight: '800',
  },

  balanceCard: {
    backgroundColor: '#14254B',
    borderRadius: 24,
    padding: 23,
    marginBottom: 30,
    overflow: 'hidden',
    elevation: 7,
    shadowColor: '#101C3A',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
  },

  balanceTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  balanceLabel: {
    color: '#A9B8D7',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 10,
  },

  balanceAmount: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
  },

  walletIconCircle: {
    width: 50,
    height: 50,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  walletIcon: {
    color: '#FFFFFF',
    fontSize: 28,
  },

  balanceDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginTop: 22,
    marginBottom: 15,
  },

  balanceBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  onlineIndicator: {
    height: 7,
    width: 7,
    borderRadius: 4,
    backgroundColor: '#5BE0B0',
    marginRight: 8,
  },

  balanceFooter: {
    color: '#B6C4DF',
    fontSize: 11,
    flex: 1,
  },

  balanceCurrency: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },

  decorCircleOne: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: 'rgba(88,120,200,0.09)',
    top: -95,
    right: -35,
  },

  decorCircleTwo: {
    position: 'absolute',
    width: 115,
    height: 115,
    borderRadius: 58,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    bottom: -72,
    right: 65,
  },

  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },

  stepNumber: {
    width: 39,
    height: 39,
    borderRadius: 13,
    backgroundColor: '#E6EDFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  stepNumberText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#3159D8',
  },

  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#172442',
  },

  sectionSubtitle: {
    color: '#8995AA',
    fontSize: 12,
    marginTop: 3,
  },

  fieldCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 19,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E8EDF5',
    marginBottom: 28,
  },

  fieldLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#8B97AB',
    marginBottom: 13,
  },

  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
  },

  recipientIcon: {
    width: 37,
    height: 37,
    borderRadius: 12,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },

  recipientIconText: {
    fontSize: 23,
    fontWeight: '700',
    color: '#355BE3',
  },

  recipientInput: {
    flex: 1,
    minWidth: 0,
    color: '#172442',
    fontSize: 12,
    paddingVertical: 12,
    paddingHorizontal: 0,
  },

  scanButton: {
    backgroundColor: '#172442',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 43,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 7,
  },

  scanButtonIcon: {
    color: '#FFFFFF',
    fontSize: 19,
    marginRight: 5,
  },

  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

  helperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F3F8',
  },

  helperIcon: {
    color: '#7C8AA5',
    fontSize: 14,
    marginRight: 7,
  },

  helperText: {
    color: '#8995AA',
    fontSize: 11,
    flex: 1,
  },

  amountCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E8EDF5',
    marginBottom: 18,
  },

  amountLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: '#8B97AB',
    marginBottom: 13,
  },

  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  rupeeSymbol: {
    fontSize: 34,
    fontWeight: '700',
    color: '#172442',
    marginRight: 9,
  },

  amountInput: {
    flex: 1,
    minWidth: 0,
    color: '#172442',
    fontSize: 36,
    fontWeight: '800',
    paddingVertical: 4,
    letterSpacing: -1,
  },

  inrBadge: {
    backgroundColor: '#F0F4FA',
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },

  inrText: {
    color: '#65738B',
    fontSize: 11,
    fontWeight: '800',
  },

  amountDivider: {
    height: 1,
    backgroundColor: '#EEF1F6',
    marginTop: 16,
    marginBottom: 14,
  },

  amountBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },

  amountHint: {
    color: '#96A1B4',
    fontSize: 10,
  },

  maxButton: {
    color: '#3159D8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  securityCard: {
    backgroundColor: '#EAF7F2',
    borderRadius: 17,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#D9F0E7',
  },

  securityIconBox: {
    width: 43,
    height: 43,
    borderRadius: 14,
    backgroundColor: '#D5F1E5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  securityIcon: {
    fontSize: 27,
    color: '#087F5B',
  },

  securityTextContainer: {
    flex: 1,
  },

  securityTitle: {
    color: '#11664F',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },

  securityDescription: {
    color: '#578778',
    fontSize: 11,
    lineHeight: 17,
  },

  actionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 21,
    padding: 19,
    borderWidth: 1,
    borderColor: '#E8EDF5',
  },

  actionSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 17,
  },

  actionSummaryLabel: {
    color: '#8995AA',
    fontSize: 12,
    fontWeight: '600',
  },

  actionSummaryAmount: {
    color: '#172442',
    fontSize: 19,
    fontWeight: '800',
  },

  primaryButton: {
    backgroundColor: '#3159D8',
    borderRadius: 15,
    minHeight: 56,
    paddingHorizontal: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#3159D8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 7,
  },

  disabledButton: {
    opacity: 0.6,
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
    textAlign: 'center',
  },

  primaryButtonArrow: {
    color: '#FFFFFF',
    fontSize: 23,
    fontWeight: '600',
    marginLeft: 5,
  },

  offlineNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },

  offlineDot: {
    height: 6,
    width: 6,
    borderRadius: 3,
    backgroundColor: '#0CA678',
    marginRight: 7,
  },

  offlineNoteText: {
    color: '#8995AA',
    fontSize: 10,
  },

  voucherCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 23,
    padding: 21,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5EBF5',
    elevation: 3,
    shadowColor: '#172442',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },

  successIconCircle: {
    width: 53,
    height: 53,
    borderRadius: 27,
    backgroundColor: '#DDF8EC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 13,
  },

  successIcon: {
    color: '#059669',
    fontSize: 28,
    fontWeight: '800',
  },

  voucherTitle: {
    fontSize: 22,
    color: '#172442',
    fontWeight: '800',
    marginBottom: 8,
  },

  voucherDescription: {
    color: '#7C899F',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
  },

  voucherAmountBox: {
    width: '100%',
    backgroundColor: '#F3F6FF',
    borderRadius: 16,
    padding: 17,
    alignItems: 'center',
    marginBottom: 22,
  },

  voucherAmountLabel: {
    color: '#7D8AAF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },

  voucherAmount: {
    fontSize: 31,
    color: '#172442',
    fontWeight: '800',
    marginVertical: 7,
  },

  signedPill: {
    backgroundColor: '#DDF8EC',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },

  signedPillText: {
    color: '#087F5B',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  qrOuter: {
    backgroundColor: '#FFFFFF',
    padding: 17,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E8EDF5',
    elevation: 3,
    shadowColor: '#172442',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },

  qrCaption: {
    color: '#7C899F',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 21,
  },

  secondaryButton: {
    paddingVertical: 16,
    alignItems: 'center',
  },

  secondaryButtonText: {
    color: '#3159D8',
    fontSize: 13,
    fontWeight: '700',
  },

  footerText: {
    textAlign: 'center',
    marginTop: 24,
    color: '#A4AEC0',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
});