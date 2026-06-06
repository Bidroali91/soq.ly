const client = require('./client');

(async () => {
  const time = await client.getServerTime();
  console.log('Bybit server time:', time.result);

  const acct = await client.getAccountInfo();
  if (acct.retCode === 0) {
    console.log('Account info:', acct.result);
  } else {
    console.error('Auth failed:', acct.retCode, acct.retMsg);
    process.exit(1);
  }
})();
