import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import {
  createWallet,
  getWalletData,
} from '../database/schema';

const PRIVATE_KEY_ALIAS = 'offline_wallet_ed25519_private_key_v1';

const bytesToHex = (bytes) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const sanitizeHex = (hex) => {
  if (typeof hex !== 'string') return '';

  return hex.startsWith('0x') || hex.startsWith('0X')
    ? hex.slice(2)
    : hex;
};

const hexToBytes = (hex) => {
  const cleanHex = sanitizeHex(hex);

  if (!cleanHex || !/^(?:[0-9a-f]{2})+$/i.test(cleanHex)) {
    throw new Error('Invalid hexadecimal data.');
  }

  return Uint8Array.from(
    cleanHex.match(/.{2}/g),
    (byte) => parseInt(byte, 16)
  );
};

const sortObjectKeys = (obj) =>
  Object.keys(obj)
    .sort()
    .reduce((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});

/**
 * Derives a deterministic 20-byte address (0x + 40 hex chars).
 *
 * Important: do not change this derivation after wallets have been created,
 * because existing wallet addresses will no longer match their public keys.
 */
export const deriveWalletAddress = async (publicKeyHex) => {
  const cleanKey = sanitizeHex(publicKeyHex);
  const publicKey = hexToBytes(cleanKey);

  if (publicKey.length !== 32) {
    throw new Error('Invalid Ed25519 public key length.');
  }

  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    cleanKey.toLowerCase()
  );

  return `0x${hash.slice(0, 40)}`;
};

export const initializeWalletIdentity = async () => {
  let privateKeyHex = await SecureStore.getItemAsync(PRIVATE_KEY_ALIAS);

  if (!privateKeyHex) {
    const { secretKey } = ed25519.keygen();
    privateKeyHex = bytesToHex(secretKey);

    await SecureStore.setItemAsync(PRIVATE_KEY_ALIAS, privateKeyHex, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });
  }

  const privateKey = hexToBytes(privateKeyHex);

  if (privateKey.length !== 32) {
    throw new Error('Stored private key has an invalid length.');
  }

  const publicKey = bytesToHex(ed25519.getPublicKey(privateKey));
  const walletAddress = await deriveWalletAddress(publicKey);
  const existingWallet = await getWalletData();

  if (!existingWallet) {
    await createWallet(walletAddress, publicKey, 100000);
  } else {
    const existingPubSanitized = sanitizeHex(
      existingWallet.public_key || ''
    ).toLowerCase();

    const currentPubSanitized = publicKey.toLowerCase();

    const existingAddress = (existingWallet.wallet_id || '').toLowerCase();
    const currentAddress = walletAddress.toLowerCase();

    if (
      existingAddress !== currentAddress ||
      existingPubSanitized !== currentPubSanitized
    ) {
      throw new Error(
        'Wallet key mismatch. Your existing wallet uses another identity. ' +
        'Back up your data and migrate the wallet before continuing.'
      );
    }
  }

  return {
    isNew: !existingWallet,
    walletAddress,
    publicKey,
  };
};

export const canonicalPaymentPayload = ({
  txId,
  sender,
  receiver,
  amountInBaseUnits,
  nonce,
  timestamp,
  senderPublicKey,
}) => {
  const normalized = {
    amount: String(BigInt(amountInBaseUnits)),
    nonce: Number(nonce),
    receiver: sanitizeHex(String(receiver)).toLowerCase(),
    sender: sanitizeHex(String(sender)).toLowerCase(),
    senderPublicKey: sanitizeHex(String(senderPublicKey)).toLowerCase(),
    timestamp: Number(timestamp),
    txId: String(txId),
  };

  return JSON.stringify(sortObjectKeys(normalized));
};

export const signPayloadOffline = async (payloadString) => {
  const privateKeyHex = await SecureStore.getItemAsync(PRIVATE_KEY_ALIAS);

  if (!privateKeyHex) {
    throw new Error('Wallet private key is unavailable.');
  }

  const privateKey = hexToBytes(privateKeyHex);

  if (privateKey.length !== 32) {
    throw new Error('Invalid wallet private key.');
  }

  const signature = ed25519.sign(
    utf8ToBytes(payloadString),
    privateKey
  );

  return bytesToHex(signature);
};

export const verifySignatureOffline = (
  payloadString,
  signatureHex,
  senderPublicKeyHex
) => {
  try {
    const publicKeyBytes = hexToBytes(senderPublicKeyHex);
    const signatureBytes = hexToBytes(signatureHex);

    if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) {
      return false;
    }

    return ed25519.verify(
      signatureBytes,
      utf8ToBytes(payloadString),
      publicKeyBytes
    );
  } catch {
    return false;
  }
};