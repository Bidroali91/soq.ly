const client = require('./client');

(async () => {
  const res = await client.getWalletBalance({ accountType: 'UNIFIED' });
  if (res.retCode !== 0) {
    console.error('Bybit error:', res.retCode, res.retMsg);
    process.exit(1);
  }
  console.log(JSON.stringify(res.result, null, 2));
})();
