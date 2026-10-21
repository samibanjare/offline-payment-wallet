
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import {
  getWalletData,
  getPendingSyncItems,
} from '../database/schema';

export default function HomeScreen({ navigation }) {
  const [wallet, setWallet] = useState(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadWalletState = useCallback(async () => {
    try {
      setLoadError(false);

      const [walletData, syncItems] = await Promise.all([
        getWalletData(),
        getPendingSyncItems(),
      ]);

      setWallet(walletData);
      setPendingSyncCount(
        Array.isArray(syncItems) ? syncItems.length : 0
      );
    } catch (error) {
      console.error('Failed to load wallet state:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadWalletState();
    }, [loadWalletState])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);

    try {
      await loadWalletState();
    } finally {
      setRefreshing(false);
    }
  }, [loadWalletState]);

  const openScreen = (screenName) => {
    if (!wallet) {
      Alert.alert(
        'Wallet Not Ready',
        'Initialize your wallet before making a payment.'
      );
      return;
    }

    navigation.navigate(screenName);
  };

  const balance = Number(wallet?.balance ?? 0);
  const isSyncQueueEmpty = pendingSyncCount === 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={['#2563EB']}
          tintColor="#2563EB"
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Offline Wallet</Text>
          <Text style={styles.pageTitle}>Dashboard</Text>
        </View>

        <View style={styles.offlineBadge}>
          <View style={styles.offlineDot} />
          <Text style={styles.offlineText}>OFFLINE</Text>
        </View>
      </View>

      {/* Sync Status */}
      <View
        style={[
          styles.statusCard,
          isSyncQueueEmpty
            ? styles.statusSuccess
            : styles.statusPending,
        ]}
      >
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor: isSyncQueueEmpty
                ? '#059669'
                : '#D97706',
            },
          ]}
        />

        <View style={styles.statusContent}>
          <Text style={styles.statusTitle}>
            {isSyncQueueEmpty
              ? 'No pending sync items'
              : `${pendingSyncCount} item(s) awaiting sync`}
          </Text>

          <Text style={styles.statusSubtitle}>
            {isSyncQueueEmpty
              ? 'Your local sync queue is empty.'
              : 'Payment records are waiting in the local sync queue.'}
          </Text>
        </View>
      </View>

      {/* Balance Card */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>
          Available Offline Balance
        </Text>

        {loading ? (
          <ActivityIndicator
            size="large"
            color="#FFFFFF"
            style={styles.balanceLoader}
          />
        ) : (
          <Text style={styles.balanceAmount}>
            ₹{balance.toFixed(2)}
          </Text>
        )}

        <View style={styles.balanceDivider} />

        <Text style={styles.walletIdLabel}>WALLET ADDRESS</Text>

        <Text
          style={styles.walletId}
          numberOfLines={2}
          ellipsizeMode="middle"
        >
          {wallet?.wallet_id || 'Wallet not initialized'}
        </Text>

        {wallet?.public_key ? (
          <Text style={styles.identityNote}>
            Ed25519 public key registered
          </Text>
        ) : null}
      </View>

      {/* Error Message */}
      {loadError && (
        <TouchableOpacity
          style={styles.errorCard}
          onPress={loadWalletState}
        >
          <Text style={styles.errorTitle}>
            Unable to load wallet data
          </Text>
          <Text style={styles.errorSubtitle}>
            Tap here to try again.
          </Text>
        </TouchableOpacity>
      )}

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionCard, styles.sendCard]}
          onPress={() => openScreen('SendPayment')}
          disabled={loading || !wallet}
          activeOpacity={0.8}
        >
          <View style={styles.actionIcon}>
            <Text style={styles.actionIconText}>↑</Text>
          </View>

          <Text style={styles.actionTitle}>Send</Text>
          <Text style={styles.actionSubtitle}>
            Pay another wallet
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionCard, styles.receiveCard]}
          onPress={() => openScreen('ReceivePayment')}
          disabled={loading || !wallet}
          activeOpacity={0.8}
        >
          <View style={styles.actionIcon}>
            <Text style={styles.actionIconText}>↓</Text>
          </View>

          <Text style={styles.actionTitle}>Receive</Text>
          <Text style={styles.actionSubtitle}>
            Get a payment
          </Text>
        </TouchableOpacity>
      </View>

      {/* Transactions */}
      <Text style={styles.sectionTitle}>Activity</Text>

      <TouchableOpacity
        style={styles.transactionsCard}
        onPress={() => navigation.navigate('Transactions')}
        activeOpacity={0.8}
      >
        <View style={styles.transactionIcon}>
          <Text style={styles.transactionIconText}>↔</Text>
        </View>

        <View style={styles.transactionContent}>
          <Text style={styles.cardTitle}>Transactions</Text>
          <Text style={styles.cardSubtitle}>
            View pending, completed, failed and synced records
          </Text>
        </View>

        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      {/* Security Notice */}
      <View style={styles.securityCard}>
        <Text style={styles.securityTitle}>
          Offline wallet security
        </Text>
        <Text style={styles.securityText}>
          Your local wallet records remain on this device until
          synchronization is implemented. A queued payment is not
          proof that a payment has been confirmed by a trusted server.
        </Text>
      </View>

      <Text style={styles.footer}>
        Offline Payment Wallet
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  container: {
    padding: 20,
    paddingBottom: 36,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 22,
  },
  greeting: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  pageTitle: {
    color: '#0F172A',
    fontSize: 27,
    fontWeight: '800',
    marginTop: 4,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 20,
  },
  offlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#059669',
    marginRight: 6,
  },
  offlineText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#047857',
    letterSpacing: 0.5,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 18,
    borderWidth: 1,
  },
  statusSuccess: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  statusPending: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginRight: 11,
  },
  statusContent: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  statusSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 3,
    lineHeight: 16,
  },
  balanceCard: {
    backgroundColor: '#0F172A',
    borderRadius: 20,
    padding: 24,
    marginBottom: 28,
    overflow: 'hidden',
  },
  balanceLabel: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  balanceAmount: {
    color: '#FFFFFF',
    fontSize: 35,
    fontWeight: '800',
    marginTop: 10,
  },
  balanceLoader: {
    alignSelf: 'flex-start',
    marginTop: 12,
  },
  balanceDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginTop: 22,
    marginBottom: 16,
  },
  walletIdLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  walletId: {
    color: '#F1F5F9',
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 7,
    lineHeight: 18,
  },
  identityNote: {
    color: '#86EFAC',
    fontSize: 10,
    marginTop: 9,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 13,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  actionCard: {
    flex: 1,
    borderRadius: 16,
    padding: 17,
    minHeight: 150,
    justifyContent: 'center',
  },
  sendCard: {
    backgroundColor: '#2563EB',
  },
  receiveCard: {
    backgroundColor: '#059669',
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 13,
  },
  actionIconText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  actionSubtitle: {
    color: '#DBEAFE',
    fontSize: 11,
    marginTop: 5,
  },
  transactionsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 15,
    padding: 17,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 22,
  },
  transactionIcon: {
    width: 43,
    height: 43,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 13,
  },
  transactionIconText: {
    color: '#2563EB',
    fontSize: 24,
    fontWeight: '700',
  },
  transactionContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  cardSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 5,
    lineHeight: 16,
  },
  chevron: {
    color: '#94A3B8',
    fontSize: 27,
    marginLeft: 8,
  },
  errorCard: {
    padding: 14,
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 20,
  },
  errorTitle: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '700',
  },
  errorSubtitle: {
    color: '#7F1D1D',
    fontSize: 12,
    marginTop: 4,
  },
  securityCard: {
    padding: 15,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  securityTitle: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
  },
  securityText: {
    color: '#64748B',
    fontSize: 11,
    lineHeight: 17,
  },
  footer: {
    color: '#94A3B8',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 24,
  },
});
