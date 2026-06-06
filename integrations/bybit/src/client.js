require('dotenv').config();
const { RestClientV5 } = require('bybit-api');

const key = process.env.BYBIT_API_KEY;
const secret = process.env.BYBIT_API_SECRET;
const testnet = process.env.BYBIT_TESTNET === 'true';

if (!key || !secret) {
  throw new Error('BYBIT_API_KEY and BYBIT_API_SECRET must be set in .env');
}

module.exports = new RestClientV5({
  key,
  secret,
  testnet,
  recv_window: 5000,
});
