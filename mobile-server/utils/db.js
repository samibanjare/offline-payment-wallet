const mongoose = require('mongoose');
const { User, MintedToken, RedeemedToken, ActivityLog } = require('../models');

const MONGODB_URI = process.env.MONGODB_URI;

const connectDB = async () => {
  if (!MONGODB_URI) {
    console.warn('⚠️ MONGODB_URI not found in environment. Please set it in .env');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB Atlas');

    // Seed default users if the collection is empty
    const count = await User.countDocuments();
    if (count === 0) {
      await User.create([
        { userId: 'merchant_9876', name: 'Coffee Shop Merchant', role: 'MERCHANT', fiatBalance: 5000.0 },
        { userId: 'sender_001', name: 'Alice Customer', role: 'USER', fiatBalance: 10000.0 },
      ]);
      console.log('🌱 Default users seeded to MongoDB');
    }
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
  }
};

// Helper: Find or initialize a user with starting balance
const createOrUpdateUser = async (userId, name = 'App User', role = 'USER', defaultBalance = 5000.0) => {
  let user = await User.findOne({ userId });
  if (!user) {
    user = await User.create({
      userId,
      name,
      role,
      fiatBalance: defaultBalance,
    });
  }
  return user;
};

// Helper: Write audit/activity log entry to MongoDB
const recordLog = async (userId, action, amount = 0.0, status = 'SUCCESS', details = null, ip = null) => {
  try {
    await ActivityLog.create({
      userId,
      action,
      amount,
      status,
      details,
      ipAddress: ip,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('Failed to write activity log:', err.message);
  }
};

module.exports = {
  connectDB,
  User,
  MintedToken,
  RedeemedToken,
  ActivityLog,
  createOrUpdateUser,
  recordLog,
};