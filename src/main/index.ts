import { createApp } from './server.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const app = createApp();
app.listen(env.PORT, () => {
  console.log(`Hunter platform API listening on port ${env.PORT}`);
});
