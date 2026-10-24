import React, { useEffect } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Sound from 'react-native-sound';

export const PaymentSuccessModal = ({ visible, transactionData, onClose }) => {
  useEffect(() => {
    if (!visible) return;

    let soundInstance = null;
    try {
      if (Sound && typeof Sound === 'function') {
        soundInstance = new Sound('payment_success.mp3', Sound.MAIN_BUNDLE, (error) => {
          if (!error && soundInstance) {
            soundInstance.play(() => {
              soundInstance.release();
            });
          }
        });
      }
    } catch (err) {
      console.warn('[PaymentSuccessModal] Audio playback skipped:', err.message);
    }

    return () => {
      try {
        soundInstance?.release();
      } catch (_) {}
    };
  }, [visible]);

  if (!visible || !transactionData) return null;

  const displayAmount = Number(transactionData.amount || 0).toFixed(0);
  const displayTxnId = String(transactionData.txnId || transactionData.tokenId || 'OFFLINE_TXN').slice(0, 16);
  const timeValue = transactionData.receivedAt || transactionData.timestamp || Date.now();

  return (
    <Modal
      visible={Boolean(visible)}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <Text style={styles.checkmark}>✓</Text>
          </View>

          <Text style={styles.title}>Payment Successful</Text>
          <Text style={styles.amount}>₹{displayAmount}</Text>

          <View style={styles.metaContainer}>
            <Text style={styles.metaLabel}>Txn ID: {displayTxnId}...</Text>
            <Text style={styles.metaLabel}>
              Time: {new Date(timeValue).toLocaleTimeString()}
            </Text>
          </View>

          <TouchableOpacity style={styles.btn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.btnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '85%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    elevation: 8,
  },
  iconCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#00BAF2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  checkmark: {
    color: '#fff',
    fontSize: 36,
    fontWeight: 'bold',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1F2937',
  },
  amount: {
    fontSize: 36,
    fontWeight: '800',
    color: '#10B981',
    marginVertical: 12,
  },
  metaContainer: {
    width: '100%',
    borderTopWidth: 1,
    borderColor: '#E5E7EB',
    paddingTop: 12,
    marginBottom: 20,
  },
  metaLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginVertical: 2,
    textAlign: 'center',
  },
  btn: {
    backgroundColor: '#00BAF2',
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 8,
  },
  btnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default PaymentSuccessModal;