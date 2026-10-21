
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useFocusEffect } from '@react-navigation/native';

import QRScannerModal from '../components/QRScannerModal';

import {
  getWalletData,
  processIncomingOfflinePayment,
} from '../database/schema';

import {
  verifySignatureOffline,
  canonicalPaymentPayload,
  deriveWalletAddress,
} from '../services/walletIdentity';

export default function ReceivePaymentScreen({ navigation }) {
  const [wallet, setWallet] = useState(null);
  const [isProcessingClaim, setIsProcessingClaim] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  const loadIdentity = useCallback(async () => {
    try {
      const data = await getWalletData();
      setWallet(data);
    } catch (error) {
      console.error('Failed to load wallet:', error);
      Alert.alert('Wallet Error', 'Could not load wallet data.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadIdentity();
    }, [loadIdentity])
  );

  const requestPayload = useMemo(() => {
    if (!wallet?.wallet_id || !wallet?.public_key) return '';

    return JSON.stringify({
      type: 'PAYMENT_REQUEST',
      receiver: wallet.wallet_id,
      publicKey: wallet.public_key,
    });
  }, [wallet?.wallet_id, wallet?.public_key]);

  const handleVoucherScanned = async (rawPayload) => {
    setIsScannerOpen(false);

    if (!rawPayload) return;

    try {
      setIsProcessingClaim(true);

      let tx;

      try {
        tx =
          typeof rawPayload === 'string'
            ? JSON.parse(rawPayload)
            : rawPayload;
      } catch {
        throw new Error('The scanned QR is not valid JSON.');
      }

      if (!tx || tx.type !== 'PAYMENT_VOUCHER') {
        throw new Error('This QR is not a payment voucher.');
      }

      if (
        !tx.txId ||
        !tx.sender ||
        !tx.receiver ||
        !tx.senderPublicKey ||
        !tx.signature ||
        tx.amount === undefined ||
        tx.nonce === undefined ||
        tx.timestamp === undefined
      ) {
        throw new Error('Payment voucher is missing required fields.');
      }

      if (!wallet?.wallet_id || !wallet?.public_key) {
        throw new Error('Your receiver wallet is not ready.');
      }

      // Require an exact recipient match.
      if (tx.receiver !== wallet.wallet_id) {
        throw new Error(
          'This voucher was created for a different wallet.'
        );
      }

      const amount = Number(tx.amount);
      const cents = Math.round(amount * 100);
      const nonce = Number(tx.nonce);
      const timestamp = Number(tx.timestamp);

      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !Number.isSafeInteger(cents) ||
        Math.abs(amount * 100 - cents) > 1e-7
      ) {
        throw new Error('Voucher amount is invalid.');
      }

      if (!Number.isSafeInteger(nonce) || nonce < 1) {
        throw new Error('Voucher nonce is invalid.');
      }

      if (
        !Number.isSafeInteger(timestamp) ||
        timestamp <= 0
      ) {
        throw new Error('Voucher timestamp is invalid.');
      }

      // Confirm that the sender address matches the public key.
      const derivedSender = await deriveWalletAddress(
        tx.senderPublicKey
      );

      if (derivedSender !== tx.sender) {
        throw new Error(
          'Sender address does not match the supplied public key.'
        );
      }

      const canonicalPayload = canonicalPaymentPayload({
        txId: tx.txId,
        sender: tx.sender,
        receiver: tx.receiver,
        amount,
        nonce,
        timestamp,
        senderPublicKey: tx.senderPublicKey,
      });

      const isValid = await verifySignatureOffline(
        canonicalPayload,
        tx.signature,
        tx.senderPublicKey
      );

      if (!isValid) {
        throw new Error(
          'Signature verification failed. The voucher may have been altered.'
        );
      }

      // The database rejects duplicate transaction IDs and reused nonces.
      await processIncomingOfflinePayment({
        transactionId: tx.txId,
        sender: tx.sender,
        receiver: wallet.wallet_id,
        amount: cents / 100,
        nonce,
        signature: tx.signature,
      });

      await loadIdentity();

      Alert.alert(
        'Payment Received',
        `Received ₹${(cents / 100).toFixed(2)}.\nYour local wallet has been updated.`,
        [
          {
            text: 'View Balance',
            onPress: () => navigation.navigate('Home'),
          },
        ]
      );
    } catch (error) {
      console.error('Payment claim failed:', error);

      Alert.alert(
        'Claim Rejected',
        error.message || 'Could not verify or claim this voucher.'
      );
    } finally {
      setIsProcessingClaim(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Receive Offline Payment</Text>

        <Text style={styles.subtitle}>
          Show your request QR to the payer. After they create a
          voucher, scan their voucher QR to claim the payment.
        </Text>

        <View style={styles.qrWrapper}>
          {requestPayload ? (
            <QRCode value={requestPayload} size={190} />
          ) : (
            <ActivityIndicator size="large" color="#2563EB" />
          )}
        </View>

        <Text style={styles.balanceLabel}>
          Balance: ₹{Number(wallet?.balance || 0).toFixed(2)}
        </Text>

        <Text
          style={styles.addressDisplay}
          numberOfLines={2}
          ellipsizeMode="middle"
        >
          {wallet?.wallet_id || 'Loading wallet address...'}
        </Text>

        <TouchableOpacity
          style={styles.claimBtn}
          onPress={() => setIsScannerOpen(true)}
          disabled={isProcessingClaim || !wallet}
        >
          {isProcessingClaim ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.claimBtnText}>
              Scan Payment Voucher
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <QRScannerModal
        visible={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleVoucherScanned}
        title="Scan Payment Voucher"
        subtitle="Align the payer's signed voucher QR within the frame"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: '#F8FAFC',
  },
  card: {
    backgroundColor: '#FFFFFF',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  qrWrapper: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  balanceLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: '#059669',
    marginBottom: 12,
  },
  addressDisplay: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#0F172A',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    width: '100%',
    textAlign: 'center',
    marginBottom: 20,
  },
  claimBtn: {
    backgroundColor: '#059669',
    width: '100%',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
