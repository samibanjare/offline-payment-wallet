const crypto = require('crypto');
const { signPayload } = require('../utils/keyManager');
const { User, MintedToken, createOrUpdateUser, recordLog } = require('../utils/db');

// Supported standard denominations for minting
const DENOMINATIONS = [500, 200, 100, 50, 20, 10];

function breakIntoDenominations(totalAmount) {
  let remaining = totalAmount;
  const result = [];

  for (const denom of DENOMINATIONS) {
    while (remaining >= denom) {
      result.push(denom);
      remaining -= denom;
    }
  }

  // Remainder if any
  if (remaining > 0) {
    result.push(remaining);
  }

  return result;
}

exports.mintTokens = async (req, res) => {
  const { userId, amount } = req.body;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId is required' });
  }

  const requestedAmount = Number(amount);
  if (isNaN(requestedAmount) || requestedAmount <= 0) {
    return res.status(400).json({ success: false, error: 'A valid positive amount is required' });
  }

  try {
    // 1. Fetch user account from MongoDB (or bootstrap default)
    const user = await createOrUpdateUser(userId);

    // 2. Validate available bank fiat
    if (user.fiatBalance < requestedAmount) {
      await recordLog(
        userId,
        'MINT_REJECTED',
        requestedAmount,
        'FAILED',
        { reason: 'Insufficient fiat balance', balance: user.fiatBalance },
        clientIp
      );

      return res.status(400).json({
        success: false,
        error: `Insufficient balance. Available: ₹${user.fiatBalance.toFixed(2)}`,
      });
    }

    // 3. Atomically deduct fiat balance
    user.fiatBalance -= requestedAmount;
    await user.save();

    // 4. Break into signed offline tokens (30 days validity)
    const tokenAmounts = breakIntoDenominations(requestedAmount);
    const issuedAt = Date.now();
    const expiresAt = issuedAt + 30 * 24 * 60 * 60 * 1000;
    const generatedTokens = [];

    for (const tokenVal of tokenAmounts) {
      const tokenId = `tok_${crypto.randomBytes(8).toString('hex')}`;
      
      const rawTokenPayload = {
        tokenId,
        issuedTo: userId,
        amount: tokenVal,
        issuedAt,
        expiresAt,
      };

      // Bank detached cryptographic signature
      const bankSignature = signPayload(rawTokenPayload);

      const completeToken = {
        ...rawTokenPayload,
        currency: 'INR',
        bankSignature,
      };

      // Persist minted record to MongoDB for double-spend & audit checks
      await MintedToken.create({
        tokenId,
        issuedTo: userId,
        amount: tokenVal,
        issuedAt,
        expiresAt,
        bankSignature,
      });

      generatedTokens.push(completeToken);
    }

    // 5. Write audit log
    await recordLog(
      userId,
      'MINT_SUCCESS',
      requestedAmount,
      'SUCCESS',
      { tokenCount: generatedTokens.length, tokens: generatedTokens.map((t) => t.tokenId) },
      clientIp
    );

    return res.status(200).json({
      success: true,
      userId,
      mintedAmount: requestedAmount,
      remainingFiatBalance: user.fiatBalance,
      tokenData: generatedTokens, // Array of signed tokens
    });
  } catch (err) {
    console.error('Minting error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};