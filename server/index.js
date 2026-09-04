// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory central ledger store (simulates database)
const centralLedger = {
  wallets: {},                    // wallet_id -> { lastSettledNonce, balance }
  settledTransactions: new Map(), // txId -> transaction record
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'online', timestamp: Date.now() });
});

/**
 * Reconciliation Endpoint: POST /v1/sync
 * Receives signed offline payloads when phones reconnect
 */
app.post('/v1/sync', (req, res) => {
  const {
    transactionId,
    sender,
    receiver,
    amount,
    nonce,
    timestamp,
    signature,
    senderPublicKey,
  } = req.body;

  console.log(`\n[Clearance] Inbound TX: ${transactionId}`);
  console.log(`[Clearance] Sender: ${sender} -> Receiver: ${receiver} | Amount: $${amount} | Nonce: ${nonce}`);

  // 1. Validate payload completeness
  if (!transactionId || !sender || !receiver || !amount || nonce === undefined) {
    return res.status(400).json({ error: 'Incomplete transaction payload' });
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Invalid transaction amount' });
  }

  // 2. Anti-Replay: Transaction already settled
  if (centralLedger.settledTransactions.has(transactionId)) {
    console.log(`[Clearance] TX ${transactionId} already finalized earlier.`);
    return res.status(200).json({
      status: 'already_synced',
      message: 'Transaction already settled on central ledger.',
      transactionId,
    });
  }

  // 3. Retrieve or initialize wallet states
  const senderState = centralLedger.wallets[sender] || { lastSettledNonce: 0, balance: 1000.0 };
  const receiverState = centralLedger.wallets[receiver] || { lastSettledNonce: 0, balance: 1000.0 };

  // 4. Monotonic Nonce & Double-Spend Gate
  if (nonce <= senderState.lastSettledNonce) {
    console.error(
      `🚨 [DOUBLE-SPEND DETECTED] Rejected TX ${transactionId}. Nonce ${nonce} <= Last settled nonce ${senderState.lastSettledNonce}`
    );
    return res.status(409).json({
      error: 'DOUBLE_SPEND_REJECTED',
      message: `Invalid Nonce: Transaction branch already settled up to nonce ${senderState.lastSettledNonce}.`,
    });
  }

  // 5. Balance Validation Gate
  if (senderState.balance < parsedAmount) {
    console.error(`🚨 [INSUFFICIENT FUNDS] TX ${transactionId}. Balance: ${senderState.balance} < Amount: ${parsedAmount}`);
    return res.status(400).json({
      error: 'INSUFFICIENT_FUNDS',
      message: `Sender balance ($${senderState.balance}) cannot cover amount ($${parsedAmount}).`,
    });
  }

  // 6. Update Central Ledger State
  senderState.lastSettledNonce = nonce;
  senderState.balance = Math.round((senderState.balance - parsedAmount) * 100) / 100;
  centralLedger.wallets[sender] = senderState;

  receiverState.balance = Math.round((receiverState.balance + parsedAmount) * 100) / 100;
  centralLedger.wallets[receiver] = receiverState;

  const record = {
    transactionId,
    sender,
    receiver,
    amount: parsedAmount,
    nonce,
    signature,
    settledAt: Date.now(),
    status: 'synced',
  };

  centralLedger.settledTransactions.set(transactionId, record);
  console.log(`✅ [Settled] TX ${transactionId} finalized. Sender new central balance: $${senderState.balance}`);

  return res.status(200).json({
    status: 'success',
    message: 'Transaction finalized and settled on central ledger.',
    record,
  });
});

/**
 * Inspection Endpoint: GET /v1/ledger
 */
app.get('/v1/ledger', (req, res) => {
  res.json({
    totalSettled: centralLedger.settledTransactions.size,
    wallets: centralLedger.wallets,
    transactions: Array.from(centralLedger.settledTransactions.values()),
  });
});

// Add this right before or after app.get('/health', ...)
app.get('/', (req, res) => {
  res.json({
    service: 'Offline Payment Wallet Reconciliation Gateway',
    status: 'online',
    endpoints: {
      health: '/health',
      ledger: '/v1/ledger',
      sync: 'POST /v1/sync',
    },
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Reconciliation Gateway online on http://0.0.0.0:${PORT}`);
  console.log(`👉 View live central ledger at http://localhost:${PORT}/v1/ledger`);
});