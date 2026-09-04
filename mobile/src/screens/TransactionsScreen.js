import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getTransactionsByStatus, getWalletData } from '../database/schema';

const STATUS_FILTERS = ['Pending', 'Completed', 'Failed', 'Synced'];

export default function TransactionsScreen() {
  const [selectedFilter, setSelectedFilter] = useState('Pending');
  const [transactions, setTransactions] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTransactions = async (filterName) => {
    try {
      const activeWallet = await getWalletData();
      setWallet(activeWallet);

      // Map UI title case to lowercase database status
      const dbStatus = filterName.toLowerCase();
      const records = await getTransactionsByStatus(dbStatus);
      setTransactions(records || []);
    } catch (error) {
      console.error('Failed to query transactions from SQLite:', error);
      setTransactions([]);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchTransactions(selectedFilter);
    }, [selectedFilter])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTransactions(selectedFilter);
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      {/* Status Filter Chips */}
      <View style={styles.filterRow}>
        {STATUS_FILTERS.map((status) => (
          <TouchableOpacity
            key={status}
            style={[styles.filterChip, selectedFilter === status && styles.chipActive]}
            onPress={() => setSelectedFilter(status)}
          >
            <Text style={[styles.chipText, selectedFilter === status && styles.chipTextActive]}>
              {status}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Real SQLite Transaction List */}
      <FlatList
        data={transactions}
        keyExtractor={(item) => item.transaction_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => {
          const isOutgoing = wallet?.wallet_id === item.sender;
          const displayDate = item.timestamp
            ? new Date(item.timestamp).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'Pending settlement';

          return (
            <View style={styles.txRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.txTitle} numberOfLines={1} ellipsizeMode="middle">
                  {isOutgoing ? `To: ${item.receiver}` : `From: ${item.sender}`}
                </Text>
                <Text style={styles.txDate}>{displayDate}</Text>
                <Text style={styles.txId} numberOfLines={1} ellipsizeMode="middle">
                  {item.transaction_id}
                </Text>
              </View>

              <View style={styles.amountContainer}>
                <Text style={[styles.txAmount, isOutgoing ? styles.expense : styles.income]}>
                  {isOutgoing ? `-$${Number(item.amount).toFixed(2)}` : `+$${Number(item.amount).toFixed(2)}`}
                </Text>
                <Text style={styles.txStatusTag}>{item.status}</Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No {selectedFilter.toLowerCase()} transactions found in SQLite.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#F8FAFC' },
  filterRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  filterChip: { flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: '#E2E8F0', borderRadius: 8 },
  chipActive: { backgroundColor: '#0F172A' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  chipTextActive: { color: '#FFFFFF' },
  txRow: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: '#F1F5F9' },
  txTitle: { fontSize: 14, fontWeight: '700', color: '#1E293B', fontFamily: 'monospace' },
  txDate: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  txId: { fontSize: 10, color: '#CBD5E1', fontFamily: 'monospace', marginTop: 2 },
  amountContainer: { alignItems: 'flex-end' },
  txAmount: { fontSize: 16, fontWeight: '700' },
  income: { color: '#059669' },
  expense: { color: '#DC2626' },
  txStatusTag: { fontSize: 10, fontWeight: '600', color: '#64748B', marginTop: 2, textTransform: 'uppercase' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#94A3B8', fontSize: 14 },
});