const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

// require('dotenv').config();
const { connectDB } = require('./utils/db');

const { mintTokens } = require('./controllers/mintController');
const { reconcileTokens } = require('./controllers/reconcileController');
const { getBankPublicKey } = require('./utils/keyManager');
const { getDB } = require('./utils/db');

const app = express();
const path = require('path');

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

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

// User balance lookup
app.get('/api/wallet/user/:userId', (req, res) => {
  const db = getDB();
  const user = db.users[req.params.userId] || { fiatBalance: 0 };
  res.json({ userId: req.params.userId, fiatBalance: user.fiatBalance });
});

// GET /api/bank/balance/:userId
app.get('/api/bank/balance/:userId', (req, res) => {
  const { userId } = req.params;
  const db = getDB();

  // If user does not exist in store, bootstrap them with a default balance
  if (!db.users[userId]) {
    db.users[userId] = { fiatBalance: 5000.0 };
    saveDB(db);
  }

  const user = db.users[userId];

  return res.status(200).json({
    success: true,
    userId,
    fiatBalance: user.fiatBalance,
    currency: 'INR',
    timestamp: new Date().toISOString(),
  });
});

// Minting & Reconciliation
app.post('/api/wallet/mint-request', mintTokens);
app.post('/api/wallet/reconcile', reconcileTokens);

// Use Render's dynamic port or default to 4000 locally
const PORT = process.env.PORT || 4000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Bank Server running on port ${PORT}`);
  console.log(`Bank Public Key: ${getBankPublicKey()}`);
});