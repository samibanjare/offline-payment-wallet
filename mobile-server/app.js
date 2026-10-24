const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
// require('dotenv').config();

const { connectDB, createOrUpdateUser, recordLog } = require('./utils/db');
const { mintTokens } = require('./controllers/mintController');
const { reconcileTokens } = require('./controllers/reconcileController');
const { getBankPublicKey } = require('./utils/keyManager');

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Connect MongoDB Atlas
connectDB();

const adminRoutes = require('./routes/admin');
app.use(express.static(path.join(__dirname, 'public')));
app.use(adminRoutes);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    bankPublicKey: getBankPublicKey(),
    serverTime: new Date().toISOString(),
  });
});

// GET /api/bank/balance/:userId - Auto-provisions new hardware IDs
app.get('/api/bank/balance/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Finds existing user or creates a new bank account with ₹5,000 initial balance
    const user = await createOrUpdateUser(userId, `Device User (${userId.slice(-6)})`, 'USER', 5000.0);

    // Audit log
    await recordLog(userId, 'BALANCE_CHECK', 0, 'SUCCESS', { fiatBalance: user.fiatBalance }, req.ip);

    return res.status(200).json({
      success: true,
      userId: user.userId,
      fiatBalance: user.fiatBalance,
      currency: 'INR',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Minting & Reconciliation
app.post('/api/wallet/mint-request', mintTokens);
app.post('/api/wallet/reconcile', reconcileTokens);

const PORT = process.env.PORT || 4000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Bank Server running on port ${PORT}`);
  console.log(`Bank Public Key: ${getBankPublicKey()}`);
});