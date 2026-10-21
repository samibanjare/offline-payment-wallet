const express = require('express');
const cors = require('cors');
const { mintTokens } = require('./controllers/mintController');
const { reconcileTokens } = require('./controllers/reconcileController');


const app = express();
app.use(cors());
app.use(express.json());

// Token conversion / mint request endpoint
app.post('/api/wallet/mint-request', mintTokens);
// Settlement & Reconcile route
app.post('/api/wallet/reconcile', reconcileTokens);

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`Bank Minting Server running on port ${PORT}`);
});