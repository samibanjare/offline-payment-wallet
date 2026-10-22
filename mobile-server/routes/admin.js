const express = require('express');
const router = express.Router();
const { User, MintedToken, RedeemedToken, ActivityLog } = require('../models');

// 1. Get Aggregated System Statistics
router.get('/api/admin/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    
    // Sum total bank fiat reserves
    const fiatAggregate = await User.aggregate([
      { $group: { _id: null, totalFiat: { $sum: '$fiatBalance' } } },
    ]);
    const totalFiat = fiatAggregate[0]?.totalFiat || 0;

    // Sum total minted tokens volume
    const mintedAggregate = await MintedToken.aggregate([
      { $group: { _id: null, totalMinted: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    const totalMinted = mintedAggregate[0]?.totalMinted || 0;
    const mintedCount = mintedAggregate[0]?.count || 0;

    // Sum total redeemed/settled tokens volume
    const redeemedAggregate = await RedeemedToken.aggregate([
      { $group: { _id: null, totalRedeemed: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    const totalRedeemed = redeemedAggregate[0]?.totalRedeemed || 0;
    const redeemedCount = redeemedAggregate[0]?.count || 0;

    // Tokens currently in active circulation offline
    const activeCirculation = Math.max(0, totalMinted - totalRedeemed);

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers,
        totalFiat,
        totalMinted,
        mintedCount,
        totalRedeemed,
        redeemedCount,
        activeCirculation,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Get All Registered Users
router.get('/api/admin/users', async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, users });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Get Recent Activity / Audit Logs
router.get('/api/admin/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const logs = await ActivityLog.find().sort({ timestamp: -1 }).limit(limit);
    return res.status(200).json({ success: true, logs });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Get Token Ledger (Minted vs Redeemed)
router.get('/api/admin/tokens', async (req, res) => {
  try {
    const minted = await MintedToken.find().sort({ issuedAt: -1 }).limit(20);
    const redeemed = await RedeemedToken.find().sort({ settledAt: -1 }).limit(20);
    return res.status(200).json({ success: true, minted, redeemed });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;