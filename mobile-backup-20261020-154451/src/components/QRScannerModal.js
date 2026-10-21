```jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Alert,
  StatusBar,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

const BOX_SIZE = 270;

export default function QRScannerModal({
  visible = false,
  onClose,
  onScan,
  title = 'Scan QR Code',
  subtitle = 'Align the QR code inside the frame',
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [isLocked, setIsLocked] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  const lockRef = useRef(false);

  useEffect(() => {
    if (visible) {
      lockRef.current = false;
      setIsLocked(false);
      setCameraReady(false);
    }
  }, [visible]);

  const handleBarcodeScanned = (result) => {
    if (lockRef.current) return;

    lockRef.current = true;
    setIsLocked(true);

    const rawData =
      typeof result === 'string'
        ? result
        : result?.data || '';

    if (rawData) {
      onScan(rawData);
    } else {
      lockRef.current = false;
      setIsLocked(false);
    }
  };

  const handleGrantPermission = async () => {
    try {
      const res = await requestPermission();

      if (!res.granted) {
        Alert.alert(
          'Camera Permission Required',
          'Please allow camera access from your phone settings to scan QR codes.'
        );
      }
    } catch (err) {
      Alert.alert(
        'Permission Error',
        err?.message || 'Unable to request camera permission.'
      );
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar
        barStyle="light-content"
        backgroundColor="#050A14"
      />

      <View style={styles.container}>

        {/* ================================
            PERMISSION LOADING
        ================================= */}
        {!permission && (
          <View style={styles.permissionContainer}>
            <ActivityIndicator
              size="large"
              color="#3B82F6"
            />

            <Text style={styles.permissionTitle}>
              Checking Camera
            </Text>

            <Text style={styles.permissionSubtitle}>
              Please wait while we prepare the scanner
            </Text>

            <TouchableOpacity
              style={styles.textButton}
              onPress={onClose}
            >
              <Text style={styles.textButtonText}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ================================
            PERMISSION DENIED
        ================================= */}
        {permission && !permission.granted && (
          <View style={styles.permissionContainer}>

            <View style={styles.permissionIcon}>
              <Text style={styles.permissionIconText}>
                📷
              </Text>
            </View>

            <Text style={styles.permissionTitle}>
              Camera Access Needed
            </Text>

            <Text style={styles.permissionSubtitle}>
              Camera access is required to scan QR codes
              and make wallet transactions.
            </Text>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleGrantPermission}
            >
              <Text style={styles.primaryButtonText}>
                Allow Camera
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.textButton}
              onPress={onClose}
            >
              <Text style={styles.textButtonText}>
                Not Now
              </Text>
            </TouchableOpacity>

          </View>
        )}

        {/* ================================
            CAMERA
        ================================= */}
        {visible && permission?.granted && (
          <View style={StyleSheet.absoluteFill}>

            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onCameraReady={() => setCameraReady(true)}
              onBarcodeScanned={
                isLocked
                  ? undefined
                  : handleBarcodeScanned
              }
            />

            {/* Dark overlay */}
            <View
              style={styles.overlay}
              pointerEvents="box-none"
            >

              {/* ================================
                  HEADER
              ================================= */}
              <View style={styles.header}>

                <TouchableOpacity
                  style={styles.backButton}
                  onPress={onClose}
                  activeOpacity={0.8}
                >
                  <Text style={styles.backIcon}>
                    ‹
                  </Text>
                </TouchableOpacity>

                <View style={styles.headerText}>
                  <Text style={styles.title}>
                    {title}
                  </Text>

                  <Text style={styles.subtitle}>
                    {cameraReady
                      ? subtitle
                      : 'Starting camera...'}
                  </Text>
                </View>

                <View style={styles.headerSpacer} />

              </View>

              {/* ================================
                  SCANNER AREA
              ================================= */}
              <View style={styles.scannerArea}>

                <View style={styles.scannerBox}>

                  {/* Corner 1 */}
                  <View
                    style={[
                      styles.corner,
                      styles.cornerTopLeft,
                    ]}
                  />

                  {/* Corner 2 */}
                  <View
                    style={[
                      styles.corner,
                      styles.cornerTopRight,
                    ]}
                  />

                  {/* Corner 3 */}
                  <View
                    style={[
                      styles.corner,
                      styles.cornerBottomLeft,
                    ]}
                  />

                  {/* Corner 4 */}
                  <View
                    style={[
                      styles.corner,
                      styles.cornerBottomRight,
                    ]}
                  />

                  {/* Scanning line */}
                  {!isLocked && cameraReady && (
                    <View style={styles.scanLine} />
                  )}

                </View>

              </View>

              {/* ================================
                  BOTTOM CONTENT
              ================================= */}
              <View style={styles.bottomSection}>

                <View style={styles.instructionCard}>

                  <View style={styles.instructionIcon}>
                    <Text style={styles.instructionIconText}>
                      ⌁
                    </Text>
                  </View>

                  <View style={styles.instructionContent}>
                    <Text style={styles.instructionTitle}>
                      Scan a wallet QR code
                    </Text>

                    <Text style={styles.instructionText}>
                      Keep the QR code steady and make sure
                      it is completely visible inside the frame.
                    </Text>
                  </View>

                </View>

                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={onClose}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelButtonText}>
                    Cancel
                  </Text>
                </TouchableOpacity>

              </View>

            </View>
          </View>
        )}

      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({

  /* ========================================
     ROOT
  ======================================== */

  container: {
    flex: 1,
    backgroundColor: '#050A14',
  },

  /* ========================================
     PERMISSION SCREEN
  ======================================== */

  permissionContainer: {
    flex: 1,
    backgroundColor: '#050A14',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },

  permissionIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#172033',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },

  permissionIconText: {
    fontSize: 32,
  },

  permissionTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },

  permissionSubtitle: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 320,
    marginBottom: 28,
  },

  primaryButton: {
    width: '100%',
    maxWidth: 320,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  textButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
  },

  textButtonText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },

  /* ========================================
     CAMERA OVERLAY
  ======================================== */

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },

  header: {
    height: 125,
    paddingTop: 48,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(5, 10, 20, 0.72)',
  },

  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  backIcon: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '300',
    lineHeight: 38,
    marginTop: -4,
  },

  headerText: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 16,
  },

  headerSpacer: {
    width: 44,
  },

  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 5,
  },

  subtitle: {
    color: '#CBD5E1',
    fontSize: 13,
    textAlign: 'center',
  },

  /* ========================================
     SCANNER
  ======================================== */

  scannerArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  scannerBox: {
    width: BOX_SIZE,
    height: BOX_SIZE,
    position: 'relative',
  },

  corner: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderColor: '#3B82F6',
  },

  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 10,
  },

  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 10,
  },

  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 10,
  },

  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 10,
  },

  scanLine: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: '50%',
    height: 2,
    backgroundColor: '#3B82F6',
    opacity: 0.85,
  },

  /* ========================================
     BOTTOM
  ======================================== */

  bottomSection: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 20,
    backgroundColor: 'rgba(5, 10, 20, 0.88)',
  },

  instructionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
  },

  instructionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(37,99,235,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 13,
  },

  instructionIconText: {
    color: '#60A5FA',
    fontSize: 25,
    fontWeight: '700',
  },

  instructionContent: {
    flex: 1,
  },

  instructionTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },

  instructionText: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 17,
  },

  cancelButton: {
    height: 50,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  cancelButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
```
