const nacl = require('tweetnacl');
const { decodeBase64, encodeBase64, decodeUTF8 } = require('tweetnacl-util');
const { v4: uuidv4 } = require('uuid');
const bankKeys = require('../bank_keys.json');

const secretKeyUint8 = decodeBase64(bankKeys.secretKey);

exports.mintTokens = (req, res) => {
  const { userId, amount } = req.body;

  if (!userId || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid userId and amount required' });
  }

  // Token bundle: Split amount into discrete tokens (e.g., denomination array)
  const token = {
    tokenId: uuidv4(),
    issuedTo: userId,
    amount: Number(amount),
    issuedAt: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days validity
  };

  // Sign token payload using Bank's private key
  const messageBytes = decodeUTF8(JSON.stringify(token));
  const signatureBytes = nacl.sign.detached(messageBytes, secretKeyUint8);
  const signature = encodeBase64(signatureBytes);

  return res.status(200).json({
    success: true,
    message: 'Tokens minted successfully',
    tokenData: {
      ...token,
      bankSignature: signature,
      bankPublicKey: bankKeys.publicKey,
    },
  });
};