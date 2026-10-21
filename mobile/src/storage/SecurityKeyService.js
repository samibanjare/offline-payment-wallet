import * as Keychain from 'react-native-keychain';

const KEYCHAIN_SERVICE = 'OFFLINE_WALLET_ENCRYPTION_KEY';

export const getOrCreateDatabaseKey = async () => {
  const credentials = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
  if (credentials) {
    return credentials.password;
  }

  // Generate a random 32-character key for PRAGMA key
  const randomKey = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 36).toString(36)
  ).join('');

  await Keychain.setGenericPassword('db_user', randomKey, { service: KEYCHAIN_SERVICE });
  return randomKey;
};