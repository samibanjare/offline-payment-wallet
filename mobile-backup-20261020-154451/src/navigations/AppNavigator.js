import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from '../screens/HomeScreen';
import SendPaymentScreen from '../screens/SendPaymentScreen';
import ReceivePaymentScreen from '../screens/ReceivePaymentScreen';
import TransactionScreens from '../screens/TransactionsScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerShown: true,
      }}
    >
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'Offline Payment Wallet' }}
      />

      <Stack.Screen
        name="Transactions"
        component={TransactionScreens}
        options={{ title: 'Transactions' }}
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
    </Stack.Navigator>
  );
}