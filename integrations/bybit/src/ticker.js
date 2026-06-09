const client = require('./client');

const symbol = process.argv[2] || 'BTCUSDT';

(async () => {
  const res = await client.getTickers({ category: 'spot', symbol });
  if (res.retCode !== 0) {
    console.error('Bybit error:', res.retCode, res.retMsg);
    process.exit(1);
  }
  console.log(JSON.stringify(res.result.list, null, 2));
})();
