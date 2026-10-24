import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { initWalletDB } from '../storage/WalletDatabase';
import { getUniqueDeviceId } from '../services/DeviceIdentityService';

const STATUS_FILTERS = ['All', 'Sent', 'Received', 'Mint', 'Settled'];

export default function TransactionsScreen() {
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [transactions, setTransactions] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [currentDeviceId, setCurrentDeviceId] = useState(null);

  useEffect(() => {
    getUniqueDeviceId().then((id) => setCurrentDeviceId(id));
  }, []);

  const fetchTransactions = async (filterName) => {
    try {
      const db = await initWalletDB();
      let query = `SELECT * FROM transactions`;

      if (filterName === 'Sent') {
        query += ` WHERE type = 'SENT'`;
      } else if (filterName === 'Received') {
        query += ` WHERE type = 'RECEIVED'`;
      } else if (filterName === 'Mint') {
        query += ` WHERE type = 'MINT'`;
      } else if (filterName === 'Settled') {
        query += ` WHERE status = 'SETTLED'`;
      }

      query += ` ORDER BY timestamp DESC;`;

      let rows = [];

      // Safe multi-version Expo SQLite query executor
      if (typeof db.getAllAsync === 'function') {
        rows = await db.getAllAsync(query);
      } else if (typeof db.getAllSync === 'function') {
        rows = db.getAllSync(query);
      } else if (typeof db.execute === 'function') {
        const result = db.execute(query);
        rows = result?.rows?._array || result?.rows || [];
      } else if (typeof db.transaction === 'function') {
        rows = await new Promise((resolve) => {
          db.transaction((tx) => {
            tx.executeSql(query, [], (_, { rows: { _array } }) => resolve(_array || []));
          });
        });
      }

      setTransactions(Array.isArray(rows) ? rows : []);
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
    if (status === 'FAILED') return '#EF4444';
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
        keyExtractor={(item, index) => String(item.txnId || item.tokenId || `tx_${index}`)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => {
          const isSent = item.type === 'SENT';
          const isMint = item.type === 'MINT';
          const isReceived = item.type === 'RECEIVED';

          const displayDate = item.timestamp
            ? new Date(Number(item.timestamp)).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'Pending timestamp';

          // Resolve counterparty display
          let titleText = `To: ${item.counterpartyId || 'Unknown Device'}`;
          if (isReceived) {
            titleText = `From: ${item.counterpartyId || 'Nearby Peer'}`;
          } else if (isMint) {
            titleText = 'Bank Token Mint';
          }

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
                    {item.txnId ? `TXN: ${item.txnId}` : item.tokenId ? `TOKEN: ${item.tokenId}` : ''}
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
                  {Number(item.amount || 0).toFixed(2)}
                </Text>

                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: `${getStatusColor(item.status, item.type)}18` },
                  ]}
                >
                  <Text
                    style={[
                      styles.txStatusTag,
                      { color: getStatusColor(item.status, item.type) },
                    ]}
                  >
                    {item.status || 'RECORDED'}
                  </Text>
                </View>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              No {selectedFilter.toLowerCase()} records found in local vault.
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