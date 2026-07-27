const { config } = require('dotenv');
config({ path: '.env.local' });
const { OKXFacilitatorClient } = require('@okxweb3/app-x402-core');
const client = new OKXFacilitatorClient({
  apiKey: process.env.OKX_API_KEY,
  secretKey: process.env.OKX_SECRET_KEY,
  passphrase: process.env.OKX_PASSPHRASE,
  syncSettle: true,
});
(async () => {
  try {
    const res = await Promise.race([
      client.getSupported(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000)),
    ]);
    console.log('RESULT_OK');
    console.log(JSON.stringify(res));
  } catch (err) {
    console.log('RESULT_ERR');
    console.log(err && err.message ? err.message : String(err));
    process.exit(1);
  }
})();
