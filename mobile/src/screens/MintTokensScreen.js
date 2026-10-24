import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { verifyBankToken } from '../services/crypto/TokenCrypto';
import { saveMintedToken } from '../storage/TokenLedgerService';
import { getUniqueDeviceId } from '../services/DeviceIdentityService';

const SERVER_BASE_URL = 'https://offline-payment-wallet-2.onrender.com';

export default function MintTokensScreen({ navigation, route }) {
  const [userId, setUserId] = useState(route.params?.userId || null);
  const [currentFiat, setCurrentFiat] = useState(Number(route.params?.fiatBalance ?? 0));
  const onMintSuccess = route.params?.onMintSuccess;

  const [amount, setAmount] = useState('500');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const quickPicks = [100, 200, 500, 1000];

  // Ensure dynamic device ID is loaded if not passed in navigation params
  useEffect(() => {
    if (!userId) {
      getUniqueDeviceId().then((id) => setUserId(id));
    }
  }, [userId]);

  const handleMintRequest = async () => {
    const numericAmount = parseFloat(amount);

    if (isNaN(numericAmount) || numericAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount to convert.');
      return;
    }

    if (numericAmount > currentFiat) {
      Alert.alert(
        'Insufficient Balance',
        `Requested amount (₹${numericAmount}) exceeds your available bank balance (₹${Number(currentFiat).toFixed(2)}).`
      );
      return;
    }

    const activeUserId = userId || (await getUniqueDeviceId());

    setLoading(true);
    setStatusMessage('Contacting Bank Gateway...');

    try {
      // 1. Submit conversion request to Bank Gateway
      const response = await fetch(`${SERVER_BASE_URL}/api/wallet/mint-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: activeUserId,
          amount: numericAmount,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Bank rejected the minting request.');
      }

      setStatusMessage('Validating Cryptographic Signature...');

      // 2. Handle both single token object and token array responses
      const tokensToSave = Array.isArray(data.tokenData)
        ? data.tokenData
        : Array.isArray(data.tokens)
        ? data.tokens
        : [data.tokenData];

      // Verify cryptographic signature for every token
      for (const token of tokensToSave) {
        if (!token) continue;
        const isAuthentic = verifyBankToken(token);
        if (!isAuthentic) {
          throw new Error(`Security Error: Token ${token.tokenId || ''} failed bank signature validation.`);
        }
      }

      setStatusMessage('Encrypting & Saving to Local Vault...');

      // 3. Atomically write minted tokens to local SQLite DB
      for (const token of tokensToSave) {
        if (!token) continue;
        await saveMintedToken(token);
      }

      const updatedFiat = Math.max(0, currentFiat - numericAmount);
      setCurrentFiat(updatedFiat);

      if (typeof onMintSuccess === 'function') {
        onMintSuccess(numericAmount);
      }

      setLoading(false);
      Alert.alert(
        'Conversion Successful',
        `₹${numericAmount.toFixed(2)} minted into offline tokens.`,
        [{ text: 'Back to Wallet', onPress: () => navigation.goBack() }]
      );
    } catch (err) {
      setLoading(false);
      setStatusMessage('');
      Alert.alert('Minting Failed', err.message);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Convert Fiat to Digital Tokens</Text>
        <Text style={styles.subtitle}>
          Tokens are cryptographically signed by the bank and stored locally for offline Bluetooth payments.
        </Text>

        {/* Bank Balance Info Banner */}
        <View style={styles.infoBanner}>
          <Text style={styles.infoLabel}>Available Bank Fiat:</Text>
          <Text style={styles.infoValue}>₹{Number(currentFiat || 0).toFixed(2)}</Text>
        </View>

        {/* Amount Input */}
        <Text style={styles.inputLabel}>Enter Amount (₹)</Text>
        <View style={styles.inputWrapper}>
          <Text style={styles.currencyPrefix}>₹</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={amount}
            onChangeText={(val) => setAmount(val.replace(/[^0-9]/g, ''))}
            placeholder="0"
            editable={!loading}
          />
        </View>

        {/* Quick Pick Chips */}
        <View style={styles.chipRow}>
          {quickPicks.map((val) => (
            <TouchableOpacity
              key={val}
              style={[
                styles.chip,
                amount === String(val) && styles.chipSelected,
              ]}
              onPress={() => setAmount(String(val))}
              disabled={loading}
            >
              <Text
                style={[
                  styles.chipText,
                  amount === String(val) && styles.chipTextSelected,
                ]}
              >
                ₹{val}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Status / Submit Action */}
        {loading ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="small" color="#0284C7" />
            <Text style={styles.loadingText}>{statusMessage}</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.mintButton,
              (currentFiat <= 0 || !amount || parseFloat(amount) <= 0) && styles.mintButtonDisabled,
            ]}
            onPress={handleMintRequest}
            disabled={currentFiat <= 0}
          >
            <Text style={styles.mintButtonText}>Request & Download Tokens</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 20,
  },
  infoBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
  },
  infoLabel: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '700',
  },
  inputLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    color: '#64748B',
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  currencyPrefix: {
    fontSize: 26,
    fontWeight: '700',
    color: '#0F172A',
    marginRight: 6,
  },
  input: {
    flex: 1,
    fontSize: 26,
    fontWeight: '700',
    color: '#0F172A',
    paddingVertical: 12,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  chip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
  },
  chipSelected: {
    backgroundColor: '#E0F2FE',
    borderColor: '#38BDF8',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  chipTextSelected: {
    color: '#0284C7',
    fontWeight: '700',
  },
  mintButton: {
    backgroundColor: '#0284C7',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  mintButtonDisabled: {
    backgroundColor: '#94A3B8',
  },
  mintButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  loaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  loadingText: {
    marginLeft: 10,
    fontSize: 13,
    color: '#475569',
    fontWeight: '500',
  },
});