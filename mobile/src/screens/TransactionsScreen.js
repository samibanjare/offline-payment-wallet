import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { initWalletDB } from '../storage/WalletDatabase';

const STATUS_FILTERS = ['All', 'Committed', 'Received', 'Mint', 'Settled'];

export default function TransactionsScreen() {
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [transactions, setTransactions] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTransactions = async (filterName) => {
    try {
      const db = await initWalletDB();
      let query = `SELECT * FROM transactions`;
      let params = [];

      if (filterName === 'Committed') {
        query += ` WHERE status = 'COMMITTED' AND type = 'SENT'`;
      } else if (filterName === 'Received') {
        query += ` WHERE type = 'RECEIVED'`;
      } else if (filterName === 'Mint') {
        query += ` WHERE type = 'MINT'`;
      } else if (filterName === 'Settled') {
        query += ` WHERE status = 'SETTLED'`;
      }

      query += ` ORDER BY timestamp DESC;`;

      const result = db.execute(query, params);
      setTransactions(result?.rows?._array || []);
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

  const getStatusColor = (status, type) => {
    if (status === 'SETTLED') return '#10B981';
    if (type === 'MINT') return '#0284C7';
    if (status === 'COMMITTED') return '#3B82F6';
    return '#F59E0B';
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

      {/* Offline SQLite Transaction List */}
      <FlatList
        data={transactions}
        keyExtractor={(item) => item.txnId}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => {
          const isSent = item.type === 'SENT';
          const isMint = item.type === 'MINT';
          const isReceived = item.type === 'RECEIVED';

          const displayDate = item.timestamp
            ? new Date(item.timestamp).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'Pending timestamp';

          let titleText = `To: ${item.counterpartyId}`;
          if (isReceived) titleText = `From: ${item.counterpartyId}`;
          if (isMint) titleText = 'Bank Token Mint';

          return (
            <View style={styles.txRow}>
              <View style={styles.leftContainer}>
                <View
                  style={[
                    styles.avatarCircle,
                    {
                      backgroundColor: isMint
                        ? '#E0F2FE'
                        : isReceived
                        ? '#ECFDF5'
                        : '#EFF6FF',
                    },
                  ]}
                >
                  <Text style={styles.avatarIcon}>
                    {isMint ? '🏦' : isReceived ? '↓' : '↑'}
                  </Text>
                </View>

                <View style={styles.infoWrapper}>
                  <Text style={styles.txTitle} numberOfLines={1} ellipsizeMode="middle">
                    {titleText}
                  </Text>
                  <Text style={styles.txDate}>{displayDate}</Text>
                  <Text style={styles.txId} numberOfLines={1} ellipsizeMode="middle">
                    ID: {item.txnId}
                  </Text>
                </View>
              </View>

              <View style={styles.amountContainer}>
                <Text
                  style={[
                    styles.txAmount,
                    isReceived
                      ? styles.income
                      : isMint
                      ? styles.mint
                      : styles.expense,
                  ]}
                >
                  {isReceived ? '+₹' : isMint ? '₹' : '-₹'}
                  {Number(item.amount).toFixed(2)}
                </Text>

                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: `${getStatusColor(item.status, item.type)}15` },
                  ]}
                >
                  <Text
                    style={[
                      styles.txStatusTag,
                      { color: getStatusColor(item.status, item.type) },
                    ]}
                  >
                    {item.status}
                  </Text>
                </View>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              No {selectedFilter.toLowerCase()} transactions found in local vault.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#F8FAFC' },
  filterRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  filterChip: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
  },
  chipActive: { backgroundColor: '#0F172A' },
  chipText: { fontSize: 11, fontWeight: '700', color: '#475569' },
  chipTextActive: { color: '#FFFFFF' },
  txRow: {
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  leftContainer: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarIcon: { fontSize: 16 },
  infoWrapper: { flex: 1 },
  txTitle: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  txDate: { fontSize: 11, color: '#64748B', marginTop: 2 },
  txId: { fontSize: 10, color: '#94A3B8', fontFamily: 'monospace', marginTop: 2 },
  amountContainer: { alignItems: 'flex-end' },
  txAmount: { fontSize: 15, fontWeight: '800' },
  income: { color: '#10B981' },
  expense: { color: '#EF4444' },
  mint: { color: '#0284C7' },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  txStatusTag: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#94A3B8', fontSize: 13, textAlign: 'center' },
});