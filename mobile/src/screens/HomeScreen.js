import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getWalletData, getPendingSyncItems } from '../database/schema';

export default function HomeScreen({ navigation }) {
  const [wallet, setWallet] = useState(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const loadWalletState = async () => {
    try {
      const data = await getWalletData();
      const syncItems = await getPendingSyncItems();
      setWallet(data);
      setPendingSyncCount(syncItems ? syncItems.length : 0);
    } catch (err) {
      console.error('Failed to load wallet state:', err);
    }
  };

  // Reloads live database records whenever user returns to Home
  useFocusEffect(
    useCallback(() => {
      loadWalletState();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadWalletState();
    setRefreshing(false);
  };

  const isSynced = pendingSyncCount === 0;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Wallet Status / Sync State */}
      <View style={styles.statusBadge}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: isSynced ? '#10B981' : '#F59E0B' },
          ]}
        />
        <Text style={styles.statusText}>
          {isSynced
            ? 'Wallet Status: Offline Ready & Fully Synced'
            : `Wallet Status: ${pendingSyncCount} Action(s) Queued for Sync`}
        </Text>
      </View>

      {/* Balance & Identity Card */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Available Offline Balance</Text>
        <Text style={styles.balanceAmount}>
          ${wallet ? Number(wallet.balance).toFixed(2) : '0.00'}
        </Text>

        {/* Cryptographic Wallet ID Display */}
        <View style={styles.addressBox}>
          <Text style={styles.addressLabel}>Wallet ID (Keystore Public Key)</Text>
          <Text style={styles.addressValue} numberOfLines={1} ellipsizeMode="middle">
            {wallet?.wallet_id || 'Generating Secure Keys...'}
          </Text>
        </View>
      </View>

      {/* Primary Actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: '#2563EB' }]}
          onPress={() => navigation.navigate('SendPayment')}
        >
          <Text style={styles.actionBtnText}>Send Payment</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: '#059669' }]}
          onPress={() => navigation.navigate('ReceivePayment')}
        >
          <Text style={styles.actionBtnText}>Receive Payment</Text>
        </TouchableOpacity>
      </View>

      {/* Transactions Section */}
      <TouchableOpacity
        style={styles.transactionsCard}
        onPress={() => navigation.navigate('Transactions')}
      >
        <View>
          <Text style={styles.cardTitle}>Transactions</Text>
          <Text style={styles.cardSubtitle}>View pending, completed & synced records</Text>
        </View>
        <Text style={styles.chevron}>→</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  statusDot: { width: 9, height: 9, borderRadius: 5, marginRight: 8 },
  statusText: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  balanceCard: { backgroundColor: '#0F172A', borderRadius: 16, padding: 24, marginBottom: 20 },
  balanceLabel: { color: '#94A3B8', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 },
  balanceAmount: { color: '#FFFFFF', fontSize: 36, fontWeight: '800', marginTop: 8 },
  addressBox: { marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#334155' },
  addressLabel: { color: '#64748B', fontSize: 11, textTransform: 'uppercase', fontWeight: '700' },
  addressValue: { color: '#E2E8F0', fontSize: 13, fontFamily: 'monospace', marginTop: 4 },
  actionRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  actionBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  actionBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  transactionsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1E293B' },
  cardSubtitle: { fontSize: 13, color: '#64748B', marginTop: 4 },
  chevron: { fontSize: 20, color: '#94A3B8' },
});