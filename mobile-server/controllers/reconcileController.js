const nacl = require('tweetnacl');
const { decodeBase64, decodeUTF8 } = require('tweetnacl-util');
const { getBankPublicKey } = require('../utils/keyManager');
const { User, RedeemedToken, createOrUpdateUser, recordLog } = require('../utils/db');

exports.reconcileTokens = async (req, res) => {
  const { receiverId, submissions = [], auditBatch = [] } = req.body;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!receiverId) {
    return res.status(400).json({ success: false, error: 'receiverId is required' });
  }

  // Allow call if there is at least an auditBatch OR submissions to reconcile
  if (!Array.isArray(submissions) || !Array.isArray(auditBatch)) {
    return res.status(400).json({ success: false, error: 'Invalid payload structures' });
  }

  if (submissions.length === 0 && auditBatch.length === 0) {
    return res.status(400).json({ success: false, error: 'No submissions or audit records provided' });
  }

  try {
    const receiver = await createOrUpdateUser(receiverId);

    // 1. Ingest Offline Outbox Audit Logs (Both SENT & RECEIVED records)
    if (auditBatch.length > 0) {
      for (const item of auditBatch) {
        await recordLog(
          receiverId,
          item.type === 'SENT' ? 'OFFLINE_PAYMENT_SENT' : 'OFFLINE_PAYMENT_RECEIVED',
          Number(item.amount) || 0,
          item.status === 'COMMITTED' ? 'SUCCESS' : 'FAILED',
          { txnId: item.txnId, counterparty: item.counterpartyId },
          clientIp
        );
      }
    }

    // 2. Process Token Redemptions (Fiat conversion)
    const bankPublicKeyBytes = decodeBase64(getBankPublicKey());
    const settledTokenIds = [];
    const rejectedTokenIds = [];
    let totalCredited = 0;

    for (const item of submissions) {
      const { tokenData, ackReceipt } = item;
      const { tokenId, amount, issuedTo, issuedAt, expiresAt, bankSignature } = tokenData;

      // Check A: Double-Spend Check
      const alreadyRedeemed = await RedeemedToken.findOne({ tokenId });
      if (alreadyRedeemed) {
        rejectedTokenIds.push({ tokenId, reason: 'DOUBLE_SPEND_DETECTED_ALREADY_REDEEMED' });
        await recordLog(
          receiverId,
          'RECONCILE_REJECTED',
          Number(amount),
          'FAILED',
          `Double spend attempt on ${tokenId}`,
          clientIp
        );
        continue;
      }

      // Check B: Expiry Check
      if (Date.now() > expiresAt) {
        rejectedTokenIds.push({ tokenId, reason: 'TOKEN_EXPIRED' });
        await recordLog(
          receiverId,
          'RECONCILE_REJECTED',
          Number(amount),
          'FAILED',
          `Expired token submission on ${tokenId}`,
          clientIp
        );
        continue;
      }

      // Check C: Cryptographic Signature Verification
      const rawToken = { tokenId, issuedTo, amount, issuedAt, expiresAt };
      const messageBytes = decodeUTF8(JSON.stringify(rawToken));
      const signatureBytes = decodeBase64(bankSignature);

      const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, bankPublicKeyBytes);
      if (!isValid) {
        rejectedTokenIds.push({ tokenId, reason: 'INVALID_BANK_SIGNATURE' });
        await recordLog(
          receiverId,
          'RECONCILE_REJECTED',
          Number(amount),
          'FAILED',
          `Invalid signature on ${tokenId}`,
          clientIp
        );
        continue;
      }

      // Record Redeemed Token in MongoDB
      await RedeemedToken.create({
        tokenId,
        settledBy: receiverId,
        amount: Number(amount),
        settledAt: Date.now(),
        rawAck: ackReceipt || null,
      });

      settledTokenIds.push(tokenId);
      totalCredited += Number(amount);
    }

    // 3. Credit Fiat Balance if any tokens were redeemed
    if (totalCredited > 0) {
      receiver.fiatBalance += totalCredited;
      await receiver.save();
      await recordLog(
        receiverId,
        'RECONCILE_SUCCESS',
        totalCredited,
        'SUCCESS',
        { settledCount: settledTokenIds.length },
        clientIp
      );
    }

    return res.status(200).json({
      success: true,
      receiverId,
      totalCredited,
      newFiatBalance: receiver.fiatBalance,
      settledTokenIds,
      rejectedTokenIds,
      auditProcessed: auditBatch.length,
    });
  } catch (err) {
    console.error('Reconciliation error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};