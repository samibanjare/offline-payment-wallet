const { v4: uuidv4 } = require('uuid');
const { signPayload, getBankPublicKey } = require('../utils/keyManager');
const { getDB, saveDB } = require('../utils/db');

exports.mintTokens = (req, res) => {
  const { userId, amount } = req.body;
  const numericAmount = parseFloat(amount);

  if (!userId || isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Valid userId and positive amount required' });
  }

  const db = getDB();

  // Create user record if not present
  if (!db.users[userId]) {
    db.users[userId] = { fiatBalance: 5000.0 }; // Initial bootstrap balance
  }

  const user = db.users[userId];

  // Check fiat balance
  if (user.fiatBalance < numericAmount) {
    return res.status(400).json({
      success: false,
      error: `Insufficient bank fiat balance. Current: ₹${user.fiatBalance.toFixed(2)}, Requested: ₹${numericAmount.toFixed(2)}`,
    });
  }

  // 1. Debit fiat from central balance
  user.fiatBalance -= numericAmount;

  // 2. Construct canonical token object
  const tokenId = `tok_${uuidv4()}`;
  const now = Date.now();
  const tokenPayload = {
    tokenId,
    issuedTo: userId,
    amount: numericAmount,
    issuedAt: now,
    expiresAt: now + 30 * 24 * 60 * 60 * 1000, // 30 days validity
  };

  // 3. Cryptographic signature
  const signature = signPayload(tokenPayload);

  // 4. Archive minted token
  db.mintedTokens[tokenId] = {
    ...tokenPayload,
    bankSignature: signature,
    createdAt: new Date().toISOString(),
  };

  saveDB(db);

  console.log(`[MINT SUCCESS] Issued ₹${numericAmount} token (${tokenId}) to user: ${userId}`);

  return res.status(200).json({
    success: true,
    message: 'Tokens successfully minted',
    fiatRemaining: user.fiatBalance,
    tokenData: {
      ...tokenPayload,
      bankSignature: signature,
      bankPublicKey: getBankPublicKey(),
    },
  });
};