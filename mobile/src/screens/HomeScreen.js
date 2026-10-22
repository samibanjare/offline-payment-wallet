import React, { useState, useCallback, useEffect } from 'react';
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
import NetInfo from '@react-native-community/netinfo';
import { getSpendableBalance } from '../storage/TokenLedgerService';
import { syncOfflineTokensWithBank } from '../services/sync/ReconciliationService';
import { initWalletDB } from '../storage/WalletDatabase';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function HomeScreen({ navigation }) {
  const [offlineTokenBalance, setOfflineTokenBalance] = useState(0);
  // const [fiatBalance, setFiatBalance] = useState(2500.0); // Fetched from bank backend
  const [fiatBalance, setFiatBalance] = useState(null);
  const [isLoadingBankBalance, setIsLoadingBankBalance] = useState(false);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  const USER_ID = 'merchant_9876';
  const SERVER_BASE_URL = 'https://offline-payment-wallet-2.onrender.com';

  // Monitor network status for auto-reconciliation
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected && state.isInternetReachable);
      setIsOnline(online);
      if (online) {
        triggerBankReconciliation();
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchBankBalance = async () => {
    setIsLoadingBankBalance(true);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(
        `${SERVER_BASE_URL}/api/bank/balance/${USER_ID}`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Bank API failed: ${response.status}`);
      }

      const data = await response.json();

      // Read fiatBalance from backend response with fallback to balance
      const balanceValue = data.fiatBalance ?? data.balance;

      if (typeof balanceValue !== 'number' || !Number.isFinite(balanceValue)) {
        throw new Error('Invalid bank balance returned by API');
      }

      setFiatBalance(balanceValue);
    } catch (error) {
      console.error('Failed to fetch bank balance:', error.message);
    } finally {
      setIsLoadingBankBalance(false);
    }
  };

  const loadWalletData = async () => {
    try {
      const db = await initWalletDB();

      // 1. Fetch offline spendable token balance
      const spendable = await getSpendableBalance();
      setOfflineTokenBalance(spendable);

      // 2. Fetch pending sync items (Tokens collected offline waiting for settlement)
      const pendingResult = db.execute(
        `SELECT COUNT(*) as count FROM tokens WHERE status = 'RECEIVED';`
      );
      const pendingCount = pendingResult.rows?._array[0]?.count || 0;
      setPendingSyncCount(pendingCount);

      // 3. Fetch latest 5 transactions
      const txResult = db.execute(
        `SELECT * FROM transactions ORDER BY timestamp DESC LIMIT 5;`
      );
      setRecentTransactions(txResult.rows?._array || []);
    } catch (err) {
      console.error('Failed to load wallet data:', err);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadWalletData();
      fetchBankBalance();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadWalletData();
    if (isOnline) {
      await triggerBankReconciliation();
    }
    setRefreshing(false);
  };

  const triggerBankReconciliation = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await syncOfflineTokensWithBank(USER_ID);
      if (res?.synced && res?.settledCount > 0) {
        setFiatBalance(res.newBalance);
        await loadWalletData();
      }
    } catch (err) {
      console.log('Background sync deferred:', err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Network & Ledger Status */}
      <View style={styles.statusBar}>
        <View style={styles.statusBadge}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: !isOnline ? '#EF4444' : pendingSyncCount === 0 ? '#10B981' : '#F59E0B' },
            ]}
          />
          <Text style={styles.statusText}>
            {!isOnline
              ? 'Mode: Pure Offline (BLE Active)'
              : pendingSyncCount === 0
              ? 'Synced with Bank'
              : `${pendingSyncCount} Token(s) Pending Settlement`}
          </Text>
        </View>

        {isSyncing && <ActivityIndicator size="small" color="#00BAF2" />}
      </View>

      {/* Dual Balance Card */}
      <View style={styles.balanceCard}>
        <View style={styles.balanceSplitRow}>
          <View style={styles.balanceCol}>
            <Text style={styles.balanceSublabel}>Offline Token Balance</Text>
            <Text style={styles.tokenAmount}>₹{offlineTokenBalance.toFixed(2)}</Text>
            <Text style={styles.balanceHint}>Ready for offline BLE pay</Text>
          </View>

          <View style={styles.dividerVertical} />

          <View style={styles.balanceCol}>
            <Text style={styles.balanceSublabel}>Bank Account</Text>
            <Text style={styles.fiatAmount}>
              {isLoadingBankBalance && fiatBalance === null
                ? 'Loading...'
                : fiatBalance !== null
                ? `₹${fiatBalance.toFixed(2)}`
                : 'Unavailable'}
            </Text>

            <Text style={styles.balanceHint}>
              {isLoadingBankBalance
                ? 'Fetching latest balance...'
                : 'Actual money (Online)'}
            </Text>
          </View>
        </View>

        {/* Action to Request Bank Token Conversion */}
        <TouchableOpacity
          style={styles.convertBtn}
          disabled={fiatBalance === null || fiatBalance <= 0}
          onPress={() =>
            navigation.navigate('MintTokens', {
              userId: USER_ID,
              fiatBalance: fiatBalance, // The exact value already loaded on HomeScreen
              onMintSuccess: (deductedAmount) => {
                // Immediately subtract from HomeScreen state
                setFiatBalance((prev) => Math.max(0, (prev || 0) - deductedAmount));
              },
            })
          }
        >
          <Text style={styles.convertBtnText}>+ Convert Fiat to Digital Tokens</Text>
        </TouchableOpacity>
      </View>

      {/* Primary Actions: Send (Central) & Receive (Peripheral) */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: '#00BAF2' }]}
          onPress={() => navigation.navigate('ScanPay')}
        >
          <Text style={styles.actionBtnIcon}><MaterialCommunityIcons
            name="qrcode-scan"
            size={24}
            color="#000000"
          /></Text>
          <Text style={styles.actionBtnText}>Scan QR & Pay</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: '#10B981' }]}
          onPress={() => {
            const availableRoutes = navigation.getState()?.routeNames || [];
            const targetRoute = availableRoutes.includes('ReceiveQrScreen') ? 'ReceiveQrScreen' : 'ReceiveQr';
            navigation.navigate(targetRoute, { receiverId: USER_ID });
          }}
        >
          <Text style={styles.actionBtnIcon}>
            <MaterialCommunityIcons
              name="bluetooth"
              size={24}
              color="#000000"
            />
          </Text>
          <Text style={styles.actionBtnText}>Receive via BLE</Text>
        </TouchableOpacity>
      </View>

      {/* Recent Activity / Audit Ledger */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent Offline Transactions</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Transactions')}>
          <Text style={styles.viewAllText}>View All</Text>
        </TouchableOpacity>
      </View>

      {recentTransactions.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No transactions recorded yet.</Text>
        </View>
      ) : (
        recentTransactions.map((tx) => (
          <View key={tx.txnId} style={styles.txRow}>
            <View style={styles.txLeft}>
              <View
                style={[
                  styles.txTypeCircle,
                  { backgroundColor: tx.type === 'RECEIVED' ? '#ECFDF5' : '#EFF6FF' },
                ]}
              >
                <Text style={{ fontSize: 16 }}>
                  {tx.type === 'RECEIVED' ? '↓' : tx.type === 'MINT' ? '🏦' : '↑'}
                </Text>
              </View>
              <View>
                <Text style={styles.txCounterparty}>
                  {tx.type === 'MINT' ? 'Bank Token Mint' : tx.counterpartyId}
                </Text>
                <Text style={styles.txDate}>
                  {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {tx.status}
                </Text>
              </View>
            </View>

            <Text
              style={[
                styles.txAmount,
                { color: tx.type === 'RECEIVED' ? '#10B981' : tx.type === 'MINT' ? '#00BAF2' : '#1E293B' },
              ]}
            >
              {tx.type === 'RECEIVED' ? '+' : tx.type === 'MINT' ? '' : '-'}₹{tx.amount.toFixed(2)}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#F8FAFC' },
  statusBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  statusBadge: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusText: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  balanceCard: { backgroundColor: '#0F172A', borderRadius: 20, padding: 20, marginBottom: 20 },
  balanceSplitRow: { flexDirection: 'row', justifyContent: 'space-between' },
  balanceCol: { flex: 1 },
  dividerVertical: { width: 1, backgroundColor: '#334155', marginHorizontal: 16 },
  balanceSublabel: { color: '#94A3B8', fontSize: 11, textTransform: 'uppercase', fontWeight: '700' },
  tokenAmount: { color: '#38BDF8', fontSize: 26, fontWeight: '800', marginTop: 4 },
  fiatAmount: { color: '#F8FAFC', fontSize: 26, fontWeight: '800', marginTop: 4 },
  balanceHint: { color: '#64748B', fontSize: 11, marginTop: 4 },
  convertBtn: {
    marginTop: 18,
    paddingVertical: 12,
    backgroundColor: '#1E293B',
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  convertBtnText: { color: '#38BDF8', fontSize: 13, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  actionBtn: { flex: 1, paddingVertical: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  actionBtnIcon: { fontSize: 22, marginBottom: 4 },
  actionBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  viewAllText: { fontSize: 13, color: '#00BAF2', fontWeight: '600' },
  emptyCard: { backgroundColor: '#FFFFFF', padding: 24, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0' },
  emptyText: { color: '#94A3B8', fontSize: 14 },
  txRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  txLeft: { flexDirection: 'row', alignItems: 'center' },
  txTypeCircle: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  txCounterparty: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  txDate: { fontSize: 11, color: '#64748B', marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: '800' },
});