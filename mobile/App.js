import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';

import { initDatabase, testDatabaseOperations } from './src/database/schema';
import { initializeWalletIdentity } from './src/services/walletIdentity';
import { startSyncListener } from './src/services/syncEngine';

import AppNavigator from './src/navigations/AppNavigator';

export default function App() {
  const [appReady, setAppReady] = useState(false);
  const unsubscribeNetWatcherRef = useRef(null);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;

    async function setup() {
      try {
        console.log('[INIT 1] Starting database initialization');
        await initDatabase();
        console.log('[INIT 1] Database initialized');

        console.log('[INIT 2] Starting database tests');
        await testDatabaseOperations();
        console.log('[INIT 2] Database tests completed');

        console.log('[INIT 3] Initializing wallet identity');
        const identity = await initializeWalletIdentity();
        console.log('[INIT 3] Wallet identity initialized');

        if (!isMountedRef.current) return;

        console.log('[INIT 4] Starting sync listener');
        const unsubscribe = startSyncListener();
        console.log('[INIT 4] Sync listener started');

        if (typeof unsubscribe === 'function') {
          unsubscribeNetWatcherRef.current = unsubscribe;
        }

        console.log('Wallet identity loaded:', identity.walletAddress);
      } catch (err) {
        console.error('[INIT ERROR]', err?.stack || err);

        if (isMountedRef.current) {
          Alert.alert(
            'Initialization Error',
            err?.message || 'Could not load local wallet data.'
          );
        }
      } finally {
        if (isMountedRef.current) {
          setAppReady(true);
        }
      }
    }

    setup();

    return () => {
      isMountedRef.current = false;

      if (typeof unsubscribeNetWatcherRef.current === 'function') {
        unsubscribeNetWatcherRef.current();
        unsubscribeNetWatcherRef.current = null;
      }
    };
  }, []);

  if (!appReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {/* <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: '#0F172A' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: '#F8FAFC' },
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: 'My Wallet' }}
        />
        <Stack.Screen
          name="SendPayment"
          component={SendPaymentScreen}
          options={{ title: 'Send Payment' }}
        />
        <Stack.Screen
          name="ReceivePayment"
          component={ReceivePaymentScreen}
          options={{ title: 'Receive Payment' }}
        />
        <Stack.Screen
          name="Transactions"
          component={TransactionsScreen}
          options={{ title: 'Transaction History' }}
        />
        <Stack.Screen
          name="ReceiveQr"
          component={ReceiveQrScreen}
          options={{ title: 'Receive QR' }}
        />
      </Stack.Navigator> */}
      <AppNavigator />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
});