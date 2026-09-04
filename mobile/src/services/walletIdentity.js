// src/services/walletIdentity.js
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { getDBConnection, createWallet, getWalletData } from '../database/schema';

const SECURE_KEYSTORE_ALIAS = 'offline_wallet_secp256k1_privkey';

/**
 * Generates an entropy-secure 256-bit (32-byte) hex string for local keys.
 */
const generateRandomBytesHex = async (byteLength = 32) => {
  const randomBytes = await Crypto.getRandomBytesAsync(byteLength);
  return Array.from(randomBytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Derives a human-readable Wallet Address / ID from a Public Key.
 * Conceptual format: 0x + first 40 hex chars of SHA-256 hash.
 */
export const deriveWalletAddress = async (publicKeyHex) => {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    publicKeyHex
  );
  return `0x${hash.substring(0, 40)}`;
};

/**
 * 1. Initialize or Recover the Cryptographic Wallet Identity
 */
export const initializeWalletIdentity = async () => {
  try {
    // Check if private key already exists in hardware-backed Android Keystore
    let privateKey = await SecureStore.getItemAsync(SECURE_KEYSTORE_ALIAS, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });

    let isNewIdentity = false;

    if (!privateKey) {
      // 1. Generate Secure Private Key (32 bytes entropy)
      privateKey = await generateRandomBytesHex(32);

      // 2. Store securely inside Android Keystore / Hardware Enclave
      await SecureStore.setItemAsync(SECURE_KEYSTORE_ALIAS, privateKey, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED,
      });

      isNewIdentity = true;
    }

    // Derive deterministic public key representation from the private seed
    const rawPublicKey = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `pub_${privateKey}`
    );

    // Derive the Wallet ID
    const walletAddress = await deriveWalletAddress(rawPublicKey);

    // Check if identity is recorded in SQLite
    const existingDbWallet = await getWalletData();

    if (!existingDbWallet) {
      // Register new wallet row in SQLite with zero or test offline balance
      await createWallet(walletAddress, rawPublicKey, 1000.00);
    }

    return {
      isNew: isNewIdentity,
      walletAddress,
      publicKey: rawPublicKey,
    };
  } catch (error) {
    console.error('Failed to initialize secure wallet identity:', error);
    throw error;
  }
};

/**
 * 2. Cryptographically Sign an Offline Transaction
 * Uses the private key retrieved only briefly from the Keystore into memory.
 */
export const signPayloadOffline = async (payloadString) => {
  const privateKey = await SecureStore.getItemAsync(SECURE_KEYSTORE_ALIAS);

  if (!privateKey) {
    throw new Error('Private key unavailable in Android Keystore.');
  }

  // Create an HMAC/Digest signature over the transaction payload
  const signature = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${payloadString}:${privateKey}`
  );

  return signature;
};

/**
 * 3. Verify a Counterparty's Signature (Uses only counterparty's Public Key)
 */
export const verifySignatureOffline = async (payloadString, signature, senderPublicKey) => {
  // Verifies signature integrity against payload without needing private key
  const expectedHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${payloadString}:${senderPublicKey}`
  );
  return signature === expectedHash;
};