const nacl = require('tweetnacl');
const { decodeBase64, decodeUTF8 } = require('tweetnacl-util');
const { getBankPublicKey } = require('../utils/keyManager');
const { getDB, saveDB } = require('../utils/db');

exports.reconcileTokens = (req, res) => {
  const { receiverId, submissions } = req.body;

  if (!receiverId || !Array.isArray(submissions) || submissions.length === 0) {
    return res.status(400).json({ success: false, error: 'Invalid submission format' });
  }

  const db = getDB();
  if (!db.users[receiverId]) {
    db.users[receiverId] = { fiatBalance: 0.0 };
  }

  const bankPublicKeyBytes = decodeBase64(getBankPublicKey());
  const settledTokenIds = [];
  const rejectedTokenIds = [];
  let totalCredited = 0;

  for (const item of submissions) {
    const { tokenData, ackReceipt } = item;
    const { tokenId, amount, issuedTo, issuedAt, expiresAt, bankSignature } = tokenData;

    // Check 1: Has this token already been redeemed?
    if (db.redeemedTokens[tokenId]) {
      rejectedTokenIds.push({ tokenId, reason: 'DOUBLE_SPEND_DETECTED_ALREADY_REDEEMED' });
      continue;
    }

    // Check 2: Expiry check
    if (Date.now() > expiresAt) {
      rejectedTokenIds.push({ tokenId, reason: 'TOKEN_EXPIRED' });
      continue;
    }

    // Check 3: Cryptographic Signature Verification
    const rawToken = { tokenId, issuedTo, amount, issuedAt, expiresAt };
    const messageBytes = decodeUTF8(JSON.stringify(rawToken));
    const signatureBytes = decodeBase64(bankSignature);

    const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, bankPublicKeyBytes);
    if (!isValid) {
      rejectedTokenIds.push({ tokenId, reason: 'INVALID_BANK_SIGNATURE' });
      continue;
    }

    // Accept token: Burn token & prepare credit
    db.redeemedTokens[tokenId] = {
      settledBy: receiverId,
      settledAt: Date.now(),
      amount: Number(amount),
      receipt: ackReceipt || null,
    };

    settledTokenIds.push(tokenId);
    totalCredited += Number(amount);
  }

  // Credit receiver account
  db.users[receiverId].fiatBalance += totalCredited;
  saveDB(db);

  console.log(`[RECONCILE] Credited ₹${totalCredited} to ${receiverId}. Settled count: ${settledTokenIds.length}`);

  return res.status(200).json({
    success: true,
    receiverId,
    totalCredited,
    newFiatBalance: db.users[receiverId].fiatBalance,
    settledTokenIds,
    rejectedTokenIds,
  });
};