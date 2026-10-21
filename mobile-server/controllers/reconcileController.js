const nacl = require('tweetnacl');
const { decodeBase64, decodeUTF8 } = require('tweetnacl-util');
const bankKeys = require('../bank_keys.json');

// Mock central database for redeemed tokens & user fiat balances
// In production, use PostgreSQL / Redis with an atomic transaction lock
const REDEEMED_TOKENS = new Set();
const USER_FIAT_BALANCES = {
  merchant_9876: 1500.0,
  sender_001: 5000.0,
};

exports.reconcileTokens = async (req, res) => {
  const { receiverId, submissions } = req.body;

  if (!receiverId || !Array.isArray(submissions) || submissions.length === 0) {
    return res.status(400).json({ error: 'Invalid submission payload' });
  }

  const bankPubKeyUint8 = decodeBase64(bankKeys.publicKey);
  const settledTokenIds = [];
  const rejectedTokenIds = [];
  let totalAmountToCredit = 0;

  for (const item of submissions) {
    const { tokenData, ackReceipt } = item;
    const { tokenId, amount, issuedTo, issuedAt, expiresAt, bankSignature } = tokenData;

    // 1. Double-Spend Check: Has this token already been redeemed?
    if (REDEEMED_TOKENS.has(tokenId)) {
      rejectedTokenIds.push({ tokenId, reason: 'TOKEN_ALREADY_REDEEMED' });
      continue;
    }

    // 2. Expiry Check
    if (Date.now() > expiresAt) {
      rejectedTokenIds.push({ tokenId, reason: 'TOKEN_EXPIRED' });
      continue;
    }

    // 3. Cryptographic Authenticity Check (Verify Bank's own signature)
    const rawToken = { tokenId, issuedTo, amount, issuedAt, expiresAt };
    const messageUint8 = decodeUTF8(JSON.stringify(rawToken));
    const sigUint8 = decodeBase64(bankSignature);

    const isValidSig = nacl.sign.detached.verify(messageUint8, sigUint8, bankPubKeyUint8);
    if (!isValidSig) {
      rejectedTokenIds.push({ tokenId, reason: 'INVALID_SIGNATURE' });
      continue;
    }

    // 4. Mark token as redeemed and accumulate fiat credit
    REDEEMED_TOKENS.add(tokenId);
    settledTokenIds.push(tokenId);
    totalAmountToCredit += Number(amount);
  }

  // 5. Credit fiat balance to the receiver
  if (totalAmountToCredit > 0) {
    USER_FIAT_BALANCES[receiverId] = (USER_FIAT_BALANCES[receiverId] || 0) + totalAmountToCredit;
  }

  return res.status(200).json({
    success: true,
    receiverId,
    totalCredited: totalAmountToCredit,
    newFiatBalance: USER_FIAT_BALANCES[receiverId] || 0,
    settledTokenIds,
    rejectedTokenIds,
  });
};