#!/usr/bin/env node
// T-047: CLI for ad-hoc scans from local dev or any CI system.
// Token persistence: macOS keychain via `security`, Linux libsecret via `secret-tool`.
import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';

const TOKEN_KEY = 'a11y-cli';
const FALLBACK_FILE = resolve(homedir(), '.a11y-cli', 'token');

function readToken(): string | null {
  try {
    if (platform() === 'darwin') {
      return execFileSync(
        'security',
        ['find-generic-password', '-a', TOKEN_KEY, '-s', TOKEN_KEY, '-w'],
        { encoding: 'utf8' },
      ).trim();
    }
    if (platform() === 'linux') {
      return execFileSync('secret-tool', ['lookup', 'service', TOKEN_KEY], {
        encoding: 'utf8',
      }).trim();
    }
  } catch {
    /* fall through */
  }
  if (existsSync(FALLBACK_FILE)) return readFileSync(FALLBACK_FILE, 'utf8').trim();
  return null;
}

function writeToken(token: string): void {
  try {
    if (platform() === 'darwin') {
      execFileSync('security', [
        'add-generic-password',
        '-a',
        TOKEN_KEY,
        '-s',
        TOKEN_KEY,
        '-w',
        token,
        '-U',
      ]);
      return;
    }
    if (platform() === 'linux') {
      execFileSync('secret-tool', ['store', '--label=a11y-cli', 'service', TOKEN_KEY], {
        input: token + '\n',
        encoding: 'utf8',
      });
      return;
    }
  } catch {
    /* fall through */
  }
  mkdirSync(dirname(FALLBACK_FILE), { recursive: true });
  writeFileSync(FALLBACK_FILE, token, { mode: 0o600 });
}

const apiBase = (): string => process.env['A11Y_API_BASE'] ?? 'http://localhost:3001';

const program = new Command();
program.name('a11y').description('CLI for the internal A11y Audit Tool').version('0.1.0');

program
  .command('login')
  .description('Save your API token (interactive prompt by default; --token-env to read from env).')
  .option('--token-env', 'read the token from the A11Y_TOKEN env var instead of prompting')
  .action(async (opts: { tokenEnv?: boolean }) => {
    let t: string | undefined;
    if (opts.tokenEnv) {
      t = process.env['A11Y_TOKEN'];
      if (!t) {
        console.error('Set A11Y_TOKEN env var, then re-run with --token-env.');
        process.exit(2);
      }
    } else {
      // S-22: prompt with echo disabled so the token never lands in shell history.
      t = await promptHidden('API token: ');
      if (!t) {
        console.error('No token entered.');
        process.exit(2);
      }
    }
    writeToken(t);
    console.log('token saved.');
  });

// Reads a single line from stdin without echoing it. Falls back to a regular
// read when stdin is not a TTY (e.g. piped from a CI script).
async function promptHidden(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk: string) => {
        buf += chunk;
      });
      process.stdin.on('end', () => resolve(buf.trim()));
    });
  }
  const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (m: boolean) => void };
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return await new Promise<string>((resolve) => {
    let buf = '';
    const onData = (key: string): void => {
      // Ctrl-C / Ctrl-D
      if (key === '') {
        stdin.setRawMode?.(false);
        stdin.pause();
        process.exit(130);
      }
      if (key === '\r' || key === '\n' || key === '') {
        stdin.removeListener('data', onData);
        stdin.setRawMode?.(false);
        stdin.pause();
        process.stderr.write('\n');
        resolve(buf);
        return;
      }
      // Backspace
      if (key === '' || key === '\b') {
        buf = buf.slice(0, -1);
        return;
      }
      buf += key;
    };
    stdin.on('data', onData);
  });
}

program
  .command('scan <url>')
  .description('Submit a scan and wait for results.')
  .option('--json', 'output JSON instead of human-readable')
  .option('--site-id <id>', 'attach scan to a registered site')
  .action(async (url: string, opts: { json?: boolean; siteId?: string }) => {
    const token = readToken();
    if (!token) {
      console.error('not logged in. Run `a11y login` first.');
      process.exit(2);
    }
    const submit = await fetch(`${apiBase()}/v1/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ url, ...(opts.siteId ? { siteId: opts.siteId } : {}) }),
    });
    if (!submit.ok) {
      console.error('submit failed:', submit.status);
      process.exit(1);
    }
    const { scan } = (await submit.json()) as { scan: { id: string } };
    process.stderr.write('scanning…');
    let body: { status: string; violations: unknown[] } | null = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const r = await fetch(`${apiBase()}/v1/scans/${scan.id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) continue;
      body = (await r.json()) as { status: string; violations: unknown[] };
      if (body.status === 'completed' || body.status === 'failed') break;
      process.stderr.write('.');
    }
    process.stderr.write('\n');
    if (!body) {
      console.error('timeout');
      process.exit(1);
    }
    if (opts.json) console.log(JSON.stringify(body, null, 2));
    else console.log(`status=${body.status} violations=${body.violations.length}`);
  });

program
  .command('status <id>')
  .description('Get the current state of a scan.')
  .action(async (id: string) => {
    const token = readToken();
    if (!token) {
      console.error('not logged in.');
      process.exit(2);
    }
    const r = await fetch(`${apiBase()}/v1/scans/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      console.error(r.status);
      process.exit(1);
    }
    console.log(await r.text());
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
