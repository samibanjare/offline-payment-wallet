import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
  useWindowDimensions,
} from 'react-native';
import * as ExpoCamera from 'expo-camera';
import { BleManager } from 'react-native-ble-plx';
import { sendPaymentViaBle } from '../services/ble/BleCentralService';
import * as PaymentSuccessModalModule from './PaymentSuccessModal';
import {
  lockTokensForPayment,
  commitSpentTokens,
  rollbackLockedTokens,
} from '../storage/TokenLedgerService';
import { getUniqueDeviceId } from '../services/DeviceIdentityService';


const ResolvedPaymentModal =
  PaymentSuccessModalModule.default ||
  PaymentSuccessModalModule.PaymentSuccessModal ||
  null;


const CameraComponent = ExpoCamera.CameraView;


const useCameraPerms =
  ExpoCamera.useCameraPermissions ||
  (() => [
    { granted: true, canAskAgain: true },
    async () => ({ granted: true }),
  ]);


const bleCentral = new BleManager();


const ScanPayScreen = ({ route, navigation }) => {
  const [senderId, setSenderId] = useState(route.params?.senderId || null);

  useEffect(() => {
    if (!senderId) {
      getUniqueDeviceId().then((id) => setSenderId(id));
    }
  }, [senderId]);

  const { height: screenHeight, width: screenWidth } =
    useWindowDimensions();


  const [permission, requestPermission] = useCameraPerms();
  const [scannedData, setScannedData] = useState(null);
  const [transferAmount, setTransferAmount] = useState('100');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [completedTxn, setCompletedTxn] = useState(null);


  const isScanningActive = useRef(true);
  const transactionInProgress = useRef(false);


  const isCompact = screenHeight < 750;
  const scanSize = Math.min(
    screenWidth - 104,
    isCompact ? 220 : 250
  );


  useEffect(() => {
    let mounted = true;


    const checkPermission = async () => {
      try {
        if (permission?.granted) return;


        if (permission?.canAskAgain) {
          const result = await requestPermission();


          if (mounted) {
            console.log(
              '[ScanPay] Camera permission result:',
              result
            );
          }
        }
      } catch (error) {
        console.error(
          '[ScanPay] Camera permission request failed:',
          error
        );
      }
    };


    checkPermission();


    return () => {
      mounted = false;
    };
  }, [
    permission?.granted,
    permission?.canAskAgain,
    requestPermission,
  ]);


  useEffect(() => {
    return () => {
      bleCentral.stopDeviceScan();
    };
  }, []);


  const handleQrScanned = ({ data }) => {
    if (!isScanningActive.current || !data) return;


    try {
      const parsed = JSON.parse(data);


      if (
        typeof parsed.advertisedName === 'string' &&
        typeof parsed.serviceUuid === 'string' &&
        typeof parsed.receiverId === 'string'
      ) {
        isScanningActive.current = false;
        setScannedData(parsed);
      }
    } catch {
      // Ignore QR codes that are not wallet receiver data.
    }
  };


 const handleStartBleTransaction = async () => {
    if (transactionInProgress.current) return;
    transactionInProgress.current = true;

    const activeSender = senderId || (await getUniqueDeviceId());
    const sessionId = `tx_${senderId || 'dev'}_${Date.now()}`;
    let selectedTokens = [];

    try {
      selectedTokens = await lockTokensForPayment(Number(transferAmount), sessionId);
    } catch (err) {
      transactionInProgress.current = false;
      Alert.alert('Balance Error', err.message);
      return;
    }

    setIsProcessing(true);
    setStatusMessage('Scanning for receiver...');

    let ackReceived = false;
    let isConnecting = false;

    // Safety timeout: rollback if ACK is not received within 15 seconds
    const timeoutId = setTimeout(async () => {
      if (!ackReceived) {
        bleCentral.stopDeviceScan();
        await rollbackLockedTokens(sessionId);
        setIsProcessing(false);
        setStatusMessage('');
        transactionInProgress.current = false;
        Alert.alert(
          'Payment Timed Out',
          'No confirmation received from the receiver. Your balance has been restored.'
        );
      }
    }, 15000);

    try {
      bleCentral.startDeviceScan(
        [scannedData.serviceUuid],
        { allowDuplicates: false },
        async (error, scannedDevice) => {
          if (error) {
            console.error('[ScanPay] Scan error:', error);
            return;
          }

          // Check both name and localName against QR advertised name
          const deviceName = scannedDevice?.name || scannedDevice?.localName;
          const targetName = scannedData.advertisedName;

          if (!isConnecting && (deviceName === targetName || scannedDevice?.id)) {
            isConnecting = true;
            bleCentral.stopDeviceScan();
            setStatusMessage('Connecting & transferring tokens...');

            try {
              // Pass the full selectedTokens array (or first token)
              await sendPaymentViaBle(scannedDevice.id, selectedTokens, senderId, sessionId, async (ackReceipt) => {
                ackReceived = true;
                clearTimeout(timeoutId);

                // Commit tokens to SPENT only after valid ACK
                await commitSpentTokens(sessionId, scannedData.receiverId, ackReceipt);
                setIsProcessing(false);
                setStatusMessage('');
                transactionInProgress.current = false;
                setCompletedTxn(ackReceipt);
              });
            } catch (transferErr) {
              clearTimeout(timeoutId);
              await rollbackLockedTokens(sessionId);
              setIsProcessing(false);
              setStatusMessage('');
              transactionInProgress.current = false;
              Alert.alert('Transfer Error', transferErr.message || 'Payment transfer failed.');
            }
          }
        }
      );
    } catch (err) {
      clearTimeout(timeoutId);
      bleCentral.stopDeviceScan();
      await rollbackLockedTokens(sessionId);
      setIsProcessing(false);
      setStatusMessage('');
      transactionInProgress.current = false;
      Alert.alert('Connection Failed', err.message);
    }
  };


  const handleScanAgain = () => {
    if (transactionInProgress.current) return;


    setScannedData(null);
    setTransferAmount('100');
    isScanningActive.current = true;
  };


  // Camera permission loading.
  if (!permission) {
    return (
      <View style={styles.permissionScreen}>
        <StatusBar barStyle="dark-content" backgroundColor="#F4F7FC" />
        <ActivityIndicator size="large" color="#0879E8" />
        <Text style={styles.permissionText}>
          Preparing your scanner...
        </Text>
      </View>
    );
  }


  // Camera permission request.
  if (!permission.granted) {
    return (
      <View style={styles.permissionScreen}>
        <StatusBar barStyle="dark-content" backgroundColor="#F4F7FC" />


        <View style={styles.permissionIcon}>
          <Text style={styles.permissionEmoji}>▣</Text>
        </View>


        <Text style={styles.permissionTitle}>
          Camera permission needed
        </Text>


        <Text style={styles.permissionText}>
          Allow camera access to scan the receiver's payment QR code.
        </Text>


        <TouchableOpacity
          style={styles.primaryButton}
          onPress={async () => {
            try {
              if (!permission.canAskAgain) {
                Alert.alert(
                  'Camera Permission',
                  'Open Android Settings → Apps → Offline Payment Wallet → Permissions → Camera.'
                );
                return;
              }


              const result = await requestPermission();


              if (!result.granted) {
                Alert.alert(
                  'Permission Denied',
                  'Camera access is required to scan QR codes.'
                );
              }
            } catch (error) {
              Alert.alert(
                'Permission Error',
                error?.message || 'Unable to request camera access.'
              );
            }
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryButtonText}>
            Allow Camera Access
          </Text>
        </TouchableOpacity>
      </View>
    );
  }


  return (
    <View style={styles.container}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="#073B9A"
      />


      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>P</Text>
          </View>


          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>Scan & Pay</Text>
            <Text style={styles.headerSubtitle}>
              Offline Wallet Payments
            </Text>
          </View>


          <View style={styles.secureBadge}>
            <Text style={styles.secureBadgeText}>
              {'✓  SECURE'}
            </Text>
          </View>
        </View>


        <Text style={styles.headerDescription}>
          Fast, secure payments directly between nearby devices.
        </Text>


        <View style={styles.headerFeatureRow}>
          <View style={styles.headerFeature}>
            <Text style={styles.headerFeatureIcon}>⌁</Text>
            <Text style={styles.headerFeatureText}>Offline ready</Text>
          </View>


          <View style={styles.headerFeatureDivider} />


          <View style={styles.headerFeature}>
            <Text style={styles.headerFeatureIcon}>⌑</Text>
            <Text style={styles.headerFeatureText}>QR powered</Text>
          </View>
        </View>
      </View>


      {!scannedData ? (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.scannerContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Scanner card */}
          <View style={styles.scannerCard}>
            <View style={styles.scannerCardHeader}>
              <View>
                <Text style={styles.sectionTitle}>
                  Scan receiver QR
                </Text>
                <Text style={styles.sectionSubtitle}>
                  Align the QR code inside the frame
                </Text>
              </View>


              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveBadgeText}>LIVE</Text>
              </View>
            </View>


     

<View
  style={{
    width: '100%',
    height: 330,
    backgroundColor: '#000',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 17,
  }}
>
  <ExpoCamera.CameraView
    style={{
      flex: 1,
      width: '100%',
    }}
    facing="back"
    barcodeScannerSettings={{
      barcodeTypes: ['qr'],
    }}
    onBarcodeScanned={handleQrScanned}
    onCameraReady={() => {
      console.log('[ScanPay] Camera preview ready');
    }}
    onMountError={(error) => {
      console.error('[ScanPay] Camera error:', error);

      Alert.alert(
        'Camera Error',
        error?.message || 'Unable to start the camera preview.'
      );
    }}
  />

  {/* Fog outside the QR frame */}
  <View
    pointerEvents="none"
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    }}
  >
    {/* Top */}
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '20%',
        backgroundColor: 'rgba(220, 232, 242, 0.28)',
      }}
    />

    {/* Bottom */}
    <View
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '20%',
        backgroundColor: 'rgba(220, 232, 242, 0.28)',
      }}
    />

    {/* Left — only between the top and bottom panels */}
    <View
      style={{
        position: 'absolute',
        top: '20%',
        bottom: '20%',
        left: 0,
        width: '12%',
        backgroundColor: 'rgba(220, 232, 242, 0.28)',
      }}
    />

    {/* Right — only between the top and bottom panels */}
    <View
      style={{
        position: 'absolute',
        top: '20%',
        bottom: '20%',
        right: 0,
        width: '12%',
        backgroundColor: 'rgba(220, 232, 242, 0.28)',
      }}
    />
  </View>

  {/* QR frame corners */}
  <View
    pointerEvents="none"
    style={{
      position: 'absolute',
      top: '20%',
      left: '12%',
      right: '12%',
      bottom: '20%',
      backgroundColor: 'transparent',
    }}
  >
    {/* Top-left */}
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 35,
        height: 35,
        borderTopWidth: 4,
        borderLeftWidth: 4,
        borderColor: '#42E8FF',
        borderTopLeftRadius: 10,
      }}
    />

    {/* Top-right */}
    <View
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 35,
        height: 35,
        borderTopWidth: 4,
        borderRightWidth: 4,
        borderColor: '#42E8FF',
        borderTopRightRadius: 10,
      }}
    />

    {/* Bottom-left */}
    <View
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        width: 35,
        height: 35,
        borderBottomWidth: 4,
        borderLeftWidth: 4,
        borderColor: '#42E8FF',
        borderBottomLeftRadius: 10,
      }}
    />

    {/* Bottom-right */}
    <View
      style={{
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 35,
        height: 35,
        borderBottomWidth: 4,
        borderRightWidth: 4,
        borderColor: '#42E8FF',
        borderBottomRightRadius: 10,
      }}
    />

    {/* Center scanning line */}
    <View
      style={{
        position: 'absolute',
        top: '50%',
        left: '5%',
        right: '5%',
        height: 2,
        backgroundColor: '#42E8FF',
        opacity: 0.8,
      }}
    />
  </View>

  {/* Bottom hint */}
  <View
    pointerEvents="none"
    style={{
      position: 'absolute',
      bottom: 12,
      left: 12,
      right: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 11,
      paddingHorizontal: 8,
      borderRadius: 12,
      backgroundColor: 'rgba(7, 20, 38, 0.78)',
    }}
  >
    <View
      style={{
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: '#42E8FF',
        marginRight: 8,
      }}
    />

    <Text
      style={{
        flexShrink: 1,
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '600',
        textAlign: 'center',
      }}
    >
      Align receiver QR code inside the frame
    </Text>
  </View>
</View>




            <View style={styles.scannerFooter}>
              <View style={styles.footerIconCircle}>
                <Text style={styles.footerIcon}>⌖</Text>
              </View>


              <View style={styles.scannerFooterText}>
                <Text style={styles.scannerFooterTitle}>
                  Ready to scan
                </Text>
                <Text style={styles.scannerFooterSubtitle}>
                  Hold your phone steady for best results.
                </Text>
              </View>
            </View>
          </View>


          {/* How it works */}
          <View style={styles.instructionPanel}>
            <Text style={styles.panelTitle}>Simple. Fast. Offline.</Text>


            <Text style={styles.panelDescription}>
              Send project credits to a nearby wallet without an
              internet connection.
            </Text>


            <View style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Text style={styles.featureIconText}>↔</Text>
              </View>


              <View style={styles.featureContent}>
                <Text style={styles.featureTitle}>
                  Bluetooth transfer
                </Text>
                <Text style={styles.featureDescription}>
                  Transfer tokens directly between devices.
                </Text>
              </View>
            </View>


            <View style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Text style={styles.featureIconText}>✓</Text>
              </View>


              <View style={styles.featureContent}>
                <Text style={styles.featureTitle}>
                  Ledger protection
                </Text>
                <Text style={styles.featureDescription}>
                  Eligible tokens are reserved before payment.
                </Text>
              </View>
            </View>


            <View style={styles.securityNotice}>
              <Text style={styles.securityIcon}>!</Text>
              <Text style={styles.securityText}>
                Always verify the receiver and payment amount before
                confirming a transfer.
              </Text>
            </View>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.paymentContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Payment heading */}
          <View style={styles.paymentHeading}>
            <Text style={styles.sectionTitle}>Payment details</Text>
            <Text style={styles.sectionSubtitle}>
              Review the receiver and enter an amount.
            </Text>
          </View>


          {/* Receiver */}
          <View style={styles.receiverCard}>
            <View style={styles.receiverAvatar}>
              <Text style={styles.receiverAvatarText}>
                {String(scannedData.receiverId || 'R')
                  .charAt(0)
                  .toUpperCase()}
              </Text>
            </View>


            <View style={styles.receiverInfo}>
              <Text style={styles.receiverLabel}>PAYING TO</Text>


              <Text
                style={styles.receiverTitle}
                numberOfLines={2}
              >
                {scannedData.receiverId}
              </Text>


              <View style={styles.receiverStatusRow}>
                <View style={styles.receiverStatusDot} />
                <Text style={styles.receiverStatus}>
                  QR detected
                </Text>
              </View>
            </View>


            <View style={styles.verifiedMark}>
              <Text style={styles.verifiedMarkText}>✓</Text>
            </View>
          </View>


          {/* Amount */}
          <View style={styles.amountCard}>
            <View style={styles.amountCardHeader}>
              <Text style={styles.amountLabel}>PAYMENT AMOUNT</Text>
              <View style={styles.currencyBadge}>
                <Text style={styles.currencyBadgeText}>INR · ₹</Text>
              </View>
            </View>


            <View style={styles.amountInputRow}>
              <Text style={styles.rupeeSymbol}>₹</Text>


              <TextInput
                style={styles.amountInput}
                value={transferAmount}
                onChangeText={(value) =>
                  setTransferAmount(value.replace(/[^0-9]/g, ''))
                }
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor="#AAB5C5"
                editable={!isProcessing}
                maxLength={9}
                accessibilityLabel="Payment amount in rupees"
              />
            </View>


            <View style={styles.amountDivider} />


            <View style={styles.amountBottomRow}>
              <Text style={styles.amountFootnote}>
                Enter amount in whole rupees
              </Text>
              <Text style={styles.amountFootnote}>
                No decimals
              </Text>
            </View>
          </View>


          {/* Transfer method */}
          <View style={styles.bleInfoCard}>
            <View style={styles.bluetoothIconBox}>
              <Text style={styles.bluetoothIcon}>ᛒ</Text>
            </View>


            <View style={styles.bleInfoText}>
              <Text style={styles.bleTitle}>
                Bluetooth payment
              </Text>
              <Text
                style={styles.bleSubtitle}
                numberOfLines={1}
              >
                {scannedData.advertisedName}
              </Text>
            </View>


            <View style={styles.offlineBadge}>
              <View style={styles.offlineDot} />
              <Text style={styles.offlineBadgeText}>OFFLINE</Text>
            </View>
          </View>


          {/* Processing indicator */}
          {isProcessing ? (
            <View style={styles.processingCard}>
              <ActivityIndicator size="small" color="#0879E8" />


              <View style={styles.processingContent}>
                <Text style={styles.processingTitle}>
                  Processing payment
                </Text>
                <Text style={styles.processingText}>
                  {statusMessage || 'Please wait...'}
                </Text>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleStartBleTransaction}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel={`Pay ${transferAmount || 0} rupees`}
            >
              <View style={styles.payButtonInner}>
                <Text style={styles.primaryButtonText}>
                  Pay ₹{transferAmount || '0'}
                </Text>
                <Text style={styles.payButtonArrow}>→</Text>
              </View>
            </TouchableOpacity>
          )}


          <TouchableOpacity
            style={[
              styles.scanAgainButton,
              isProcessing && styles.disabledButton,
            ]}
            disabled={isProcessing}
            onPress={handleScanAgain}
            activeOpacity={0.75}
          >
            <Text style={styles.scanAgainIcon}>↻</Text>
            <Text style={styles.scanAgainText}>
              Scan another QR code
            </Text>
          </TouchableOpacity>


          <View style={styles.paymentDisclaimer}>
            <Text style={styles.disclaimerIcon}>ⓘ</Text>
            <Text style={styles.disclaimerText}>
              Verify the receiver before paying. If a transfer has an
              uncertain status, reconcile it before attempting another
              payment.
            </Text>
          </View>
        </ScrollView>
      )}


      {/* Existing payment success modal */}
      {ResolvedPaymentModal ? (
        <ResolvedPaymentModal
          visible={!!completedTxn}
          transactionData={completedTxn}
          onClose={() => {
            setCompletedTxn(null);
            handleScanAgain();
          }}
        />
      ) : null}
    </View>
  );
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F6FB',
  },


  // Header
  header: {
    backgroundColor: '#073B9A',
    paddingTop: Platform.OS === 'android' ? 16 : 12,
    paddingHorizontal: 22,
    paddingBottom: 21,
    borderBottomLeftRadius: 27,
    borderBottomRightRadius: 27,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandMark: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: '#00B9F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: {
    fontSize: 29,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  headerText: {
    flex: 1,
    marginLeft: 13,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    color: '#D3E3FF',
    fontSize: 12,
    marginTop: 4,
  },
  secureBadge: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  secureBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerDescription: {
    color: '#E3ECFF',
    fontSize: 12,
    lineHeight: 19,
    marginTop: 17,
  },
  headerFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 17,
  },
  headerFeature: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerFeatureIcon: {
    color: '#80E7FF',
    fontSize: 18,
    fontWeight: '800',
    marginRight: 7,
  },
  headerFeatureText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  headerFeatureDivider: {
    height: 17,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginHorizontal: 17,
  },


  // Shared scroll content
  content: {
    flex: 1,
  },
  scannerContent: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 28,
  },
  paymentContent: {
    paddingHorizontal: 18,
    paddingTop: 23,
    paddingBottom: 30,
  },


  // Scanner card
  scannerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 23,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E9EEF6',
    elevation: 3,
    shadowColor: '#152D52',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  scannerCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
    paddingHorizontal: 3,
  },
  sectionTitle: {
    color: '#152744',
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  sectionSubtitle: {
    color: '#8592A7',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 5,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E9FAF3',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  liveBadgeText: {
    color: '#07835F',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
 cameraWrapper: {
  width: '100%',
  height: 330,
  position: 'relative',
  overflow: 'hidden',
  borderRadius: 17,
  backgroundColor: '#101D30',
  zIndex: 0,
  elevation: 0,
},

cameraPreview: {
  ...StyleSheet.absoluteFillObject,
  zIndex: 0,
  elevation: 0,
},

scannerOverlay: {
  ...StyleSheet.absoluteFillObject,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'transparent',
  zIndex: 2,
  elevation: 2,
},

cameraHint: {
  position: 'absolute',
  bottom: 13,
  left: 12,
  right: 12,
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: 10,
  paddingVertical: 10,
  borderRadius: 12,
  backgroundColor: 'rgba(7,20,38,0.65)',
  zIndex: 3,
  elevation: 3,
},
  cameraHintText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  scannerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 15,
    paddingHorizontal: 3,
  },
  footerIconCircle: {
    width: 37,
    height: 37,
    borderRadius: 13,
    backgroundColor: '#E8F6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerIcon: {
    color: '#0879E8',
    fontSize: 23,
    fontWeight: '700',
  },
  scannerFooterText: {
    flex: 1,
    marginLeft: 11,
  },
  scannerFooterTitle: {
    color: '#1A2D4B',
    fontSize: 12,
    fontWeight: '800',
  },
  scannerFooterSubtitle: {
    color: '#8996AA',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 4,
  },


  // Scanner instructions
  instructionPanel: {
    backgroundColor: '#FFFFFF',
    marginTop: 15,
    borderRadius: 21,
    padding: 19,
    borderWidth: 1,
    borderColor: '#E9EEF6',
    elevation: 2,
    shadowColor: '#132B50',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  panelTitle: {
    color: '#172B4D',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  panelDescription: {
    color: '#78869B',
    fontSize: 11,
    lineHeight: 18,
    marginTop: 7,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 17,
  },
  featureIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#E6F7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureIconText: {
    fontSize: 23,
    fontWeight: '800',
    color: '#009FD5',
  },
  featureContent: {
    flex: 1,
    marginLeft: 12,
  },
  featureTitle: {
    color: '#172B4D',
    fontSize: 12,
    fontWeight: '800',
  },
  featureDescription: {
    color: '#8491A5',
    fontSize: 10,
    lineHeight: 16,
    marginTop: 4,
  },
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    padding: 12,
    borderRadius: 13,
    backgroundColor: '#EFFAF6',
  },
  securityIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
    textAlign: 'center',
    textAlignVertical: 'center',
    backgroundColor: '#D5F4E7',
    color: '#07835F',
    fontSize: 13,
    fontWeight: '900',
    marginRight: 9,
  },
  securityText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 16,
    color: '#467B6A',
  },


  // Payment details
  paymentHeading: {
    marginBottom: 19,
  },
  receiverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 19,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E9EEF6',
    elevation: 2,
    shadowColor: '#132B50',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  receiverAvatar: {
    width: 49,
    height: 49,
    borderRadius: 16,
    backgroundColor: '#E5F7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiverAvatarText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#008FCB',
  },
  receiverInfo: {
    flex: 1,
    marginLeft: 13,
    minWidth: 0,
  },
  scannerMiddle: {
  flexDirection: 'row',
},
  receiverLabel: {
    color: '#8B97AA',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  receiverTitle: {
    color: '#172B4D',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 5,
  },
  receiverStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  receiverStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#0B9A70',
    marginRight: 5,
  },
  receiverStatus: {
    color: '#0B9A70',
    fontSize: 10,
    fontWeight: '600',
  },
  verifiedMark: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#E0F8EF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  verifiedMarkText: {
    color: '#07966D',
    fontSize: 15,
    fontWeight: '900',
  },


  // Amount input
  amountCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 19,
    padding: 20,
    marginTop: 15,
    borderWidth: 1,
    borderColor: '#E9EEF6',
    elevation: 2,
    shadowColor: '#132B50',
    shadowOpacity: 0.035,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  amountCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  amountLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#8995A8',
  },
  currencyBadge: {
    backgroundColor: '#F0F6FF',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
  },
  currencyBadgeText: {
    color: '#1769D2',
    fontSize: 9,
    fontWeight: '800',
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 13,
  },
  rupeeSymbol: {
    fontSize: 32,
    fontWeight: '700',
    color: '#172B4D',
    marginRight: 10,
  },
  amountInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 35,
    fontWeight: '800',
    color: '#172B4D',
    paddingVertical: 5,
  },
  amountDivider: {
    height: 1,
    backgroundColor: '#E8EDF4',
    marginTop: 11,
  },
  amountBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  amountFootnote: {
    color: '#929DB0',
    fontSize: 10,
  },


  // Bluetooth card
  bleInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 17,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#E9EEF6',
  },
  bluetoothIconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#E8F3FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bluetoothIcon: {
    fontSize: 24,
    color: '#1769D2',
    fontWeight: '800',
  },
  bleInfoText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 11,
  },
  bleTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#172B4D',
  },
  bleSubtitle: {
    fontSize: 10,
    color: '#8995A8',
    marginTop: 4,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F9F1',
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 9,
    marginLeft: 8,
  },
  offlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#07835F',
    marginRight: 5,
  },
  offlineBadgeText: {
    color: '#07835F',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.3,
  },


  // Buttons and processing
  primaryButton: {
    backgroundColor: '#0879E8',
    minHeight: 56,
    paddingHorizontal: 18,
    borderRadius: 16,
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#0879E8',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  payButtonInner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shade: {
  flex: 1,
  backgroundColor: 'rgba(0, 0, 0, 0.45)',
},
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  payButtonArrow: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginLeft: 12,
  },
  scanAgainButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 17,
  },
  scanAgainIcon: {
    color: '#0879E8',
    fontSize: 20,
    fontWeight: '700',
    marginRight: 7,
  },
  scanAgainText: {
    color: '#0879E8',
    fontSize: 12,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.45,
  },
  processingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 17,
    marginTop: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E4ECF8',
  },
  processingContent: {
    flex: 1,
    marginLeft: 12,
  },
  processingTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#172B4D',
  },
  processingText: {
    fontSize: 11,
    color: '#7D8AA0',
    marginTop: 4,
    lineHeight: 17,
  },
  paymentDisclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 5,
    paddingTop: 5,
  },
  disclaimerIcon: {
    fontSize: 14,
    color: '#8996A8',
    marginRight: 7,
  },
  disclaimerText: {
    flex: 1,
    textAlign: 'left',
    fontSize: 10,
    lineHeight: 16,
    color: '#8A96A8',
  },


  // Camera permission
  permissionScreen: {
    flex: 1,
    backgroundColor: '#F3F6FB',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  permissionIcon: {
    width: 78,
    height: 78,
    borderRadius: 25,
    backgroundColor: '#DFF5FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  permissionEmoji: {
    fontSize: 35,
    color: '#0879E8',
  },
  permissionTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: '#172B4D',
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 13,
    color: '#7D8AA0',
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 22,
  },
});


export default ScanPayScreen;