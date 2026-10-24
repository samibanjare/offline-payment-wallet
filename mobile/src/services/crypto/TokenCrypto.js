import nacl from 'tweetnacl';
import { decodeBase64, decodeUTF8 } from 'tweetnacl-util';

// Default Bank Public Key fallback
export const BANK_PUBLIC_KEY = 'cIbsgiuXwjmfIvmUxN5POUOCwwwfXTWcF/xG2YhFrT4=';

export const verifyBankToken = (tokenData) => {
  try {
    if (!tokenData || !tokenData.bankSignature) {
      console.warn('[TokenCrypto] Missing tokenData or bankSignature');
      return false;
    }

    // 1. Construct exact canonical payload in the exact order the Bank Server signed it
    // This strips out any local SQLite fields (like status, session_id, sync_status)
    const canonicalToken = {
      tokenId: tokenData.tokenId,
      amount: Number(tokenData.amount),
      currency: tokenData.currency || 'INR',
      issuedTo: tokenData.issuedTo,
      issuedAt: Number(tokenData.issuedAt),
      expiresAt: Number(tokenData.expiresAt),
    };

    const signatureUint8 = decodeBase64(tokenData.bankSignature);
    
    // 2. Use the bankPublicKey attached to the minted token (from Render server), or fallback
    const activePubKey = tokenData.bankPublicKey || BANK_PUBLIC_KEY;
    const pubKeyUint8 = decodeBase64(activePubKey);

    const messageUint8 = decodeUTF8(JSON.stringify(canonicalToken));

    const isVerified = nacl.sign.detached.verify(
      messageUint8,
      signatureUint8,
      pubKeyUint8
    );

    if (!isVerified) {
      // Fallback: Try verifying with raw rest-spread in case server signed different keys
      const {
        bankSignature,
        bankPublicKey,
        status,
        sessionId,
        session_id,
        syncStatus,
        sync_status,
        ...cleanRest
      } = tokenData;
      const fallbackMsg = decodeUTF8(JSON.stringify(cleanRest));
      return nacl.sign.detached.verify(fallbackMsg, signatureUint8, pubKeyUint8);
    }

    return true;
  } catch (err) {
    console.error('[TokenCrypto] Offline signature validation error:', err);
    return false;
  }
};

// Export alias so BlePeripheralService.js works seamlessly
export const verifyBankSignature = verifyBankToken;