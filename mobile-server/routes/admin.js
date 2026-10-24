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

// 5. Admin: Create a new bank user account manually
router.post('/api/admin/users', async (req, res) => {
  try {
    const { userId, name, role, initialBalance } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    const existing = await User.findOne({ userId });
    if (existing) {
      return res.status(409).json({ success: false, error: 'User already exists' });
    }

    const user = await User.create({
      userId,
      name: name || 'App User',
      role: role || 'USER',
      fiatBalance: Number(initialBalance) || 5000.0,
    });

    await ActivityLog.create({
      userId,
      action: 'USER_REGISTERED',
      amount: user.fiatBalance,
      status: 'SUCCESS',
      details: { role: user.role, name: user.name },
    });

    return res.status(201).json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Admin: Credit or Adjust User Balance
router.post('/api/admin/users/:userId/balance', async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, actionType } = req.body; // actionType: 'CREDIT' or 'SET'

    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const delta = Number(amount);
    if (isNaN(delta)) {
      return res.status(400).json({ success: false, error: 'Invalid amount' });
    }

    if (actionType === 'SET') {
      user.fiatBalance = Math.max(0, delta);
    } else {
      user.fiatBalance = Math.max(0, user.fiatBalance + delta);
    }

    await user.save();

    await ActivityLog.create({
      userId,
      action: 'RECONCILE_SUCCESS',
      amount: delta,
      status: 'SUCCESS',
      details: { note: 'Admin balance adjustment', newBalance: user.fiatBalance },
    });

    return res.status(200).json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;