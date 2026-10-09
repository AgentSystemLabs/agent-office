import { configFrom, createRelay } from './relay.mjs';

// Hostinger imports the entry module, so the server must start unconditionally.
const server = createRelay(configFrom(process.env));
server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => {
  console.log('Telegram relay started; posting OFF');
});
