const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { mintTokens } = require('./controllers/mintController');
const { reconcileTokens } = require('./controllers/reconcileController');
const { getBankPublicKey } = require('./utils/keyManager');
const { getDB } = require('./utils/db');

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

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