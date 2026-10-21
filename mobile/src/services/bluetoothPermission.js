
import { PermissionsAndroid, Platform } from 'react-native';

export async function requestBluetoothPermissions() {
  if (Platform.OS !== 'android') {
    return true;
  }

  try {
    if (Number(Platform.Version) >= 31) {
      const permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
      ];

      const results = await PermissionsAndroid.requestMultiple(permissions);

      return permissions.every(
        permission =>
          results[permission] === PermissionsAndroid.RESULTS.GRANTED
      );
    }

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );

    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch (error) {
    console.error('Error requesting Bluetooth permissions:', error);
    return false;
  }
}
