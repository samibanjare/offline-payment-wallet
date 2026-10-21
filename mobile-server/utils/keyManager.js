const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');
const { encodeBase64, decodeBase64, decodeUTF8 } = require('tweetnacl-util');

const KEYS_DIR = path.join(__dirname, '../keys');
const KEYS_FILE = path.join(KEYS_DIR, 'bank_keys.json');

function initKeys() {
  // 1. If keys are supplied via Render Environment Variables, prioritize them
  if (process.env.BANK_PUBLIC_KEY && process.env.BANK_SECRET_KEY) {
    return {
      publicKey: process.env.BANK_PUBLIC_KEY,
      secretKey: process.env.BANK_SECRET_KEY,
    };
  }

  // 2. Fallback to local keys/bank_keys.json file
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }

  if (fs.existsSync(KEYS_FILE)) {
    try {
      const raw = fs.readFileSync(KEYS_FILE, 'utf-8').trim();
      if (raw.length > 0) {
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn('Existing bank_keys.json empty or corrupted. Regenerating...');
    }
  }

  // 3. Generate fresh pair if nothing exists
  const pair = nacl.sign.keyPair();
  const keys = {
    publicKey: encodeBase64(pair.publicKey),
    secretKey: encodeBase64(pair.secretKey),
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), 'utf-8');
  return keys;
}

const bankKeys = initKeys();

function signPayload(payloadObject) {
  const messageBytes = decodeUTF8(JSON.stringify(payloadObject));
  const secretKeyBytes = decodeBase64(bankKeys.secretKey);
  const signatureBytes = nacl.sign.detached(messageBytes, secretKeyBytes);
  return encodeBase64(signatureBytes);
}

function getBankPublicKey() {
  return bankKeys.publicKey;
}

module.exports = {
  signPayload,
  getBankPublicKey,
};