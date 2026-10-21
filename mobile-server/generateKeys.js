const nacl = require('tweetnacl');
const { encodeBase64 } = require('tweetnacl-util');
const fs = require('fs');

const keyPair = nacl.sign.keyPair();

const keys = {
  publicKey: encodeBase64(keyPair.publicKey),
  secretKey: encodeBase64(keyPair.secretKey),
};

fs.writeFileSync('./bank_keys.json', JSON.stringify(keys, null, 2));
console.log('Bank Keypair generated successfully.');
console.log('Bank Public Key (embed in mobile app):', keys.publicKey);