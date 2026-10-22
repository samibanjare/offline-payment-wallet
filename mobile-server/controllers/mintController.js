const { v4: uuidv4 } = require('uuid');
const { signPayload, getBankPublicKey } = require('../utils/keyManager');
const { User, MintedToken, createOrUpdateUser, recordLog } = require('../utils/db');

exports.mintTokens = async (req, res) => {
  const { userId, amount } = req.body;
  const numericAmount = parseFloat(amount);
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!userId || isNaN(numericAmount) || numericAmount <= 0) {
    await recordLog(userId || 'UNKNOWN', 'MINT_REJECTED', 0, 'FAILED', 'Invalid amount or missing userId', clientIp);
    return res.status(400).json({ success: false, error: 'Valid userId and positive amount required' });
  }

  try {
    // 1. Fetch or initialize the user from MongoDB
    const user = await createOrUpdateUser(userId);

    // 2. Check fiat balance
    if (user.fiatBalance < numericAmount) {
      await recordLog(userId, 'MINT_REJECTED', numericAmount, 'FAILED', 'Insufficient fiat balance', clientIp);
      return res.status(400).json({
        success: false,
        error: `Insufficient bank fiat balance. Current: ₹${user.fiatBalance.toFixed(2)}, Requested: ₹${numericAmount.toFixed(2)}`,
      });
    }

    // 3. Construct canonical token object
    const tokenId = `tok_${uuidv4()}`;
    const now = Date.now();
    const tokenPayload = {
      tokenId,
      issuedTo: userId,
      amount: numericAmount,
      issuedAt: now,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000, // 30 days validity
    };

    // 4. Sign token with Bank private key
    const signature = signPayload(tokenPayload);

    // 5. Debit fiat balance and update MongoDB user record
    user.fiatBalance -= numericAmount;
    await user.save();

    // 6. Record newly minted token in MongoDB
    await MintedToken.create({
      tokenId,
      issuedTo: userId,
      amount: numericAmount,
      issuedAt: now,
      expiresAt: tokenPayload.expiresAt,
      bankSignature: signature,
    });

    // 7. Write audit log to MongoDB for the Admin Dashboard
    await recordLog(userId, 'MINT_SUCCESS', numericAmount, 'SUCCESS', { tokenId }, clientIp);

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
  } catch (err) {
    console.error('Error during token minting:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};