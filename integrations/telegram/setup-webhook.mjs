import { configFrom, telegram } from './relay.mjs';

// Run only after deployment, owner pairing, and explicit authorization to activate this bot.
const config = configFrom(process.env);
const origin = new URL(process.env.TELEGRAM_RELAY_URL);
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash) throw new Error('Configure the HTTPS relay origin');
const me = await telegram(config.token, 'getMe', {});
if (me.username !== process.env.TELEGRAM_EXPECTED_BOT_USERNAME) throw new Error('Bot username differs; webhook was not changed');
const previous = await telegram(config.token, 'getWebhookInfo', {});
const url = origin.origin + '/telegram/webhook';
if (previous.url && previous.url !== url) throw new Error('Bot has a different webhook; explicit migration required');
await telegram(config.token, 'setWebhook', { url, secret_token: config.secret, allowed_updates: ['message'], max_connections: 1, drop_pending_updates: false });
const current = await telegram(config.token, 'getWebhookInfo', {});
if (current.url !== url) throw new Error('Webhook verification failed');
console.log(`Webhook verified for @${me.username}; pending updates: ${current.pending_update_count}; end-to-end delivery still needs an owner test`);
