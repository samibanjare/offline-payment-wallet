import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from './src/screens/HomeScreen';
import SendPaymentScreen from './src/screens/SendPaymentScreen';
import ReceivePaymentScreen from './src/screens/ReceivePaymentScreen';
import TransactionsScreen from './src/screens/TransactionsScreen';

import { initDatabase, testDatabaseOperations } from './src/database/schema';
import { initializeWalletIdentity } from './src/services/walletIdentity';
import { startSyncListener } from './src/services/syncEngine';

const Stack = createNativeStackNavigator();

export default function App() {
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    async function setup() {
      try {
        // 1. Initialize SQLite Database & Tables
        await initDatabase();

        // 2. Run diagnostic query checks
        await testDatabaseOperations();

        // 3. Generate or retrieve hardware identity from Android Keystore & sync to SQLite
        const identity = await initializeWalletIdentity();
        // Start listening for connectivity changes to drain sync queue
        unsubscribeNetWatcher = startSyncListener();
        console.log('✅ Identity loaded:', identity.walletAddress);
      } catch (err) {
        console.error('Failed to initialize app services:', err);
        Alert.alert('Initialization Error', 'Could not load local wallet data.');
      } finally {
        setAppReady(true);
      }
    }

    setup();
    return () => {
      if (unsubscribeNetWatcher) {
        unsubscribeNetWatcher();
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
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: '#0F172A' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: '#F8FAFC' },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'My Wallet' }} />
        <Stack.Screen name="SendPayment" component={SendPaymentScreen} options={{ title: 'Send Payment' }} />
        <Stack.Screen name="ReceivePayment" component={ReceivePaymentScreen} options={{ title: 'Receive Payment' }} />
        <Stack.Screen name="Transactions" component={TransactionsScreen} options={{ title: 'Transaction History' }} />
      </Stack.Navigator>
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