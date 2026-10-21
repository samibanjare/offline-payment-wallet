import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Linking,
} from 'react-native';
import {
  CameraView,
  useCameraPermissions,
} from 'expo-camera';

  const QRScannerModal = ({
  visible,
  onClose,
  onScan,
  title = 'Scan QR Code',
  subtitle = 'Position the QR code inside the frame',
}) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [isScanned, setIsScanned] = useState(false);

  useEffect(() => {
    if (visible) {
      setIsScanned(false);
    }
  }, [visible]);

  const handleBarcodeScanned = useCallback(
    ({ data }) => {
      if (isScanned || !data) return;

      setIsScanned(true);

      if (typeof onScan === 'function') {
        onScan(data);
      }
    },
    [isScanned, onScan]
  );

  const closeScanner = () => {
    setIsScanned(false);
    onClose?.();
  };

  const scanAgain = () => {
    setIsScanned(false);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={closeScanner}
    >
      <StatusBar
        backgroundColor="#101C3A"
        barStyle="light-content"
      />

      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={closeScanner}
            activeOpacity={0.8}
          >
            <Text style={styles.closeIcon}>×</Text>
          </TouchableOpacity>

          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>{title}</Text>
            <Text style={styles.headerSubtitle}>{subtitle}</Text>
          </View>

          <View style={styles.qrBadge}>
            <Text style={styles.qrBadgeText}>QR</Text>
          </View>
        </View>

        {/* Camera / Permission */}
        {!permission ? (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color="#3159D8" />
            <Text style={styles.infoText}>
              Checking camera permission...
            </Text>
          </View>
        ) : !permission.granted ? (
          <View style={styles.permissionContainer}>
            <View style={styles.cameraIconCircle}>
              <Text style={styles.cameraIcon}>▣</Text>
            </View>

            <Text style={styles.permissionTitle}>
              Camera access required
            </Text>

            <Text style={styles.permissionDescription}>
              Allow camera access to scan payment QR codes and
              receive offline wallet payments.
            </Text>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={async () => {
                try {
                  if (permission.canAskAgain) {
                    await requestPermission();
                  } else {
                    await Linking.openSettings();
                  }
                } catch (error) {
                  console.error(
                    'Camera permission error:',
                    error
                  );
                }
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryButtonText}>
                {permission.canAskAgain
                  ? 'Allow Camera Access'
                  : 'Open App Settings'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={closeScanner}
            >
              <Text style={styles.cancelButtonText}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.cameraContainer}>
              <CameraView
                style={StyleSheet.absoluteFillObject}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: ['qr'],
                }}
                onBarcodeScanned={
                  isScanned ? undefined : handleBarcodeScanned
                }
              />

              {/* Scanning overlay */}
              <View
                pointerEvents="none"
                style={styles.overlay}
              >
                <View style={styles.overlayTop} />

                <View style={styles.middleRow}>
                  <View style={styles.overlaySide} />

                  <View style={styles.scanFrame}>
                    <View style={[styles.corner, styles.topLeft]} />
                    <View style={[styles.corner, styles.topRight]} />
                    <View style={[styles.corner, styles.bottomLeft]} />
                    <View style={[styles.corner, styles.bottomRight]} />

                    {!isScanned && (
                      <View style={styles.scanLine} />
                    )}
                  </View>

                  <View style={styles.overlaySide} />
                </View>

                <View style={styles.overlayBottom} />
              </View>

              <View style={styles.cameraInstructions}>
                <View style={styles.instructionPill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.instructionText}>
                    {isScanned
                      ? 'QR code detected'
                      : 'Align QR code within the frame'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
              {isScanned ? (
                <>
                  <View style={styles.detectedBadge}>
                    <Text style={styles.detectedIcon}>✓</Text>
                  </View>

                  <Text style={styles.footerTitle}>
                    QR code scanned
                  </Text>

                  <Text style={styles.footerDescription}>
                    Processing the scanned QR data.
                  </Text>

                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={scanAgain}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.primaryButtonText}>
                      Scan Again
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.footerTitle}>
                    Scan payment request
                  </Text>

                  <Text style={styles.footerDescription}>
                    Hold your phone steady and keep the entire
                    QR code inside the scanning frame.
                  </Text>

                  <View style={styles.securityNote}>
                    <Text style={styles.securityIcon}>⌑</Text>
                    <Text style={styles.securityText}>
                      Verify the recipient and amount before
                      creating a payment voucher.
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={closeScanner}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cancelButtonText}>
                      Cancel Scanning
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F7FC',
  },

  header: {
    backgroundColor: '#101C3A',
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 55,
    paddingBottom: 22,
    paddingHorizontal: 20,
  },

  closeButton: {
    width: 43,
    height: 43,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  closeIcon: {
    color: '#FFFFFF',
    fontSize: 31,
    lineHeight: 34,
    marginTop: -3,
  },

  headerText: {
    flex: 1,
    marginLeft: 13,
  },

  headerTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
  },

  headerSubtitle: {
    color: '#B8C5DF',
    fontSize: 11,
    marginTop: 5,
    lineHeight: 16,
  },

  qrBadge: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#3159D8',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },

  qrBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },

  cameraContainer: {
    flex: 1,
    backgroundColor: '#101C3A',
    overflow: 'hidden',
    position: 'relative',
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
  },

  overlayTop: {
    flex: 1,
    backgroundColor: 'rgba(8,16,36,0.55)',
  },

  middleRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 260,
  },

  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(8,16,36,0.55)',
  },

  scanFrame: {
    width: 260,
    maxWidth: '85%',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    position: 'relative',
    overflow: 'hidden',
  },

  corner: {
    position: 'absolute',
    width: 35,
    height: 35,
    borderColor: '#72E6BB',
  },

  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 5,
    borderLeftWidth: 5,
    borderTopLeftRadius: 18,
  },

  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 5,
    borderRightWidth: 5,
    borderTopRightRadius: 18,
  },

  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 5,
    borderLeftWidth: 5,
    borderBottomLeftRadius: 18,
  },

  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 5,
    borderRightWidth: 5,
    borderBottomRightRadius: 18,
  },

  scanLine: {
    position: 'absolute',
    top: '50%',
    left: 12,
    right: 12,
    height: 2,
    backgroundColor: '#72E6BB',
    opacity: 0.9,
  },

  overlayBottom: {
    flex: 1,
    backgroundColor: 'rgba(8,16,36,0.55)',
  },

  cameraInstructions: {
    position: 'absolute',
    bottom: 26,
    alignSelf: 'center',
  },

  instructionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16,28,58,0.88)',
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 30,
  },

  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#72E6BB',
    marginRight: 9,
  },

  instructionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },

  footer: {
    backgroundColor: '#F4F7FC',
    paddingHorizontal: 24,
    paddingTop: 25,
    paddingBottom: 28,
    alignItems: 'center',
  },

  footerTitle: {
    color: '#172442',
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
  },

  footerDescription: {
    color: '#8491A7',
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 19,
  },

  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E7F6EF',
    borderRadius: 13,
    padding: 13,
    width: '100%',
    marginBottom: 16,
  },

  securityIcon: {
    color: '#087F5B',
    fontSize: 23,
    marginRight: 10,
  },

  securityText: {
    flex: 1,
    color: '#397C66',
    fontSize: 11,
    lineHeight: 17,
  },

  primaryButton: {
    width: '100%',
    minHeight: 52,
    borderRadius: 15,
    backgroundColor: '#3159D8',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },

  cancelButton: {
    width: '100%',
    minHeight: 49,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },

  cancelButtonText: {
    color: '#697790',
    fontSize: 13,
    fontWeight: '700',
  },

  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  infoText: {
    marginTop: 14,
    color: '#697790',
    fontSize: 13,
  },

  permissionContainer: {
    flex: 1,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  cameraIconCircle: {
    width: 82,
    height: 82,
    borderRadius: 27,
    backgroundColor: '#E4EBFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },

  cameraIcon: {
    color: '#3159D8',
    fontSize: 37,
  },

  permissionTitle: {
    color: '#172442',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },

  permissionDescription: {
    color: '#8491A7',
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 27,
  },

  detectedBadge: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#DDF8EC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 13,
  },

  detectedIcon: {
    color: '#059669',
    fontSize: 27,
    fontWeight: '800',
  },
});

export default QRScannerModal;