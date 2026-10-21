
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import {
  getTransactionsByStatus,
  getWalletData,
} from '../database/schema';

const STATUS_FILTERS = [
  'Pending',
  'Completed',
  'Failed',
  'Synced',
];

export default function TransactionsScreen() {
  const [selectedFilter, setSelectedFilter] = useState('Pending');
  const [transactions, setTransactions] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTransactions = useCallback(async (filterName) => {
    try {
      const activeWallet = await getWalletData();
      setWallet(activeWallet);

      const records = await getTransactionsByStatus(
        filterName.toLowerCase()
      );

      setTransactions(records || []);
    } catch (error) {
      console.error('Failed to load transactions:', error);
      setTransactions([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchTransactions(selectedFilter);
    }, [selectedFilter, fetchTransactions])
  );

  const onRefresh = async () => {
    setRefreshing(true);

    try {
      await fetchTransactions(selectedFilter);
    } finally {
      setRefreshing(false);
    }
  };

  const renderTransaction = ({ item }) => {
    const isOutgoing = wallet?.wallet_id === item.sender;

    const displayDate = item.timestamp
      ? new Date(item.timestamp).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Date unavailable';

    const amount = Number(item.amount || 0).toFixed(2);

    return (
      <View style={styles.txRow}>
        <View style={styles.txDetails}>
          <Text
            style={styles.txTitle}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {isOutgoing
              ? `To: ${item.receiver}`
              : `From: ${item.sender}`}
          </Text>

          <Text style={styles.txDate}>{displayDate}</Text>

          <Text
            style={styles.txId}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {item.transaction_id}
          </Text>
        </View>

        <View style={styles.amountContainer}>
          <Text
            style={[
              styles.txAmount,
              isOutgoing ? styles.expense : styles.income,
            ]}
          >
            {isOutgoing ? `-₹${amount}` : `+₹${amount}`}
          </Text>

          <Text style={styles.txStatusTag}>{item.status}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Current Balance</Text>

        <Text style={styles.balanceAmount}>
          ₹{Number(wallet?.balance || 0).toFixed(2)}
        </Text>
      </View>

      <View style={styles.filterRow}>
        {STATUS_FILTERS.map((status) => (
          <TouchableOpacity
            key={status}
            style={[
              styles.filterChip,
              selectedFilter === status && styles.chipActive,
            ]}
            onPress={() => setSelectedFilter(status)}
          >
            <Text
              style={[
                styles.chipText,
                selectedFilter === status && styles.chipTextActive,
              ]}
            >
              {status}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={transactions}
        keyExtractor={(item) => item.transaction_id}
        renderItem={renderTransaction}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No transactions found</Text>

            <Text style={styles.emptyText}>
              No {selectedFilter.toLowerCase()} transactions are
              available in your local ledger.
            </Text>
          </View>
        }
        contentContainerStyle={
          transactions.length === 0 ? styles.emptyList : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#F8FAFC',
  },
  balanceCard: {
    backgroundColor: '#FFFFFF',
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 18,
  },
  balanceLabel: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 6,
  },
  balanceAmount: {
    fontSize: 27,
    fontWeight: '800',
    color: '#059669',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 16,
  },
  filterChip: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
  },
  chipActive: {
    backgroundColor: '#0F172A',
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  txRow: {
    backgroundColor: '#FFFFFF',
    padding: 15,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  txDetails: {
    flex: 1,
    marginRight: 8,
  },
  txTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    fontFamily: 'monospace',
  },
  txDate: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
  },
  txId: {
    fontSize: 10,
    color: '#94A3B8',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  amountContainer: {
    alignItems: 'flex-end',
    maxWidth: 115,
  },
  txAmount: {
    fontSize: 15,
    fontWeight: '700',
  },
  income: {
    color: '#059669',
  },
  expense: {
    color: '#DC2626',
  },
  txStatusTag: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 5,
    textTransform: 'uppercase',
  },
  emptyList: {
    flexGrow: 1,
  },
  emptyContainer: {
    padding: 36,
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#334155',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
});
