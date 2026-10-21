import nacl from 'tweetnacl';
import { decodeBase64, decodeUTF8 } from 'tweetnacl-util';

// Hardcoded Bank Public Key generated in Step 1
export const BANK_PUBLIC_KEY = 'cIbsgiuXwjmfIvmUxN5POUOCwwwfXTWcF/xG2YhFrT4=';//after testing change it to the real and in .env file


export const verifyBankToken = (tokenData) => {
  try {
    const { bankSignature, bankPublicKey, ...rawToken } = tokenData;

    const signatureUint8 = decodeBase64(bankSignature);
    const pubKeyUint8 = decodeBase64(BANK_PUBLIC_KEY);
    const messageUint8 = decodeUTF8(JSON.stringify(rawToken));

    return nacl.sign.detached.verify(messageUint8, signatureUint8, pubKeyUint8);
  } catch (err) {
    console.error('Offline signature validation failed:', err);
    return false;
  }
};