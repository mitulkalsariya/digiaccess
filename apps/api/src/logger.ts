import type { LoggerOptions } from 'pino';
import type { AppConfig } from './config.js';

export function createLoggerOptions(config: AppConfig): LoggerOptions {
  const isDev = config.nodeEnv === 'development';
  const opts: LoggerOptions = {
    level: config.logLevel,
    redact: {
      // S-10: comprehensive redaction. Anything that could be a credential, a
      // session artefact, or a vault payload must never reach the logs.
      paths: [
        // Request/response headers
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
        // Common credential field names
        '*.password',
        '*.passwd',
        '*.token',
        '*.secret',
        '*.apiToken',
        '*.api_token',
        '*.accessToken',
        '*.access_token',
        '*.refreshToken',
        '*.refresh_token',
        '*.idToken',
        '*.id_token',
        '*.client_secret',
        '*.clientSecret',
        '*.privateKey',
        '*.private_key',
        // OAuth flow internals
        '*.codeVerifier',
        '*.code_verifier',
        '*.nonce',
        '*.state',
        // Vault decrypted payloads
        '*.value',
        '*.configEnc',
        '*.config_enc',
        // Form-auth credentials submitted via request body
        'req.body.password',
        'req.body.username',
        'req.body.cookies',
        'req.body.config',
        // Webhook URLs are credentials too
        '*.webhookUrl',
        '*.slackWebhookUrl',
        '*.teamsWebhookUrl',
        // Misc
        'context.password',
      ],
      remove: true,
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    base: {
      service: 'a11y-api',
      version: config.version,
      env: config.nodeEnv,
    },
  };
  if (isDev) {
    opts.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
    };
  }
  return opts;
}
