// Set the admin password:  npm run hash-password
// Prompts for the password without echoing it (or reads it from stdin when piped),
// hashes it with Argon2id, and writes ADMIN_PASSWORD_HASH into .env — no copy-paste,
// so a terminal can't wrap the long line. The password itself is never stored.
//   --print   only print the line instead of updating .env (e.g. for a server's env file)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';

const MIN_LENGTH = 12;
const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
const printOnly = process.argv.includes('--print');

function ask(question) {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      let input = '';
      process.stdin.on('data', (chunk) => { input += chunk; });
      process.stdin.on('end', () => resolve(input.replace(/\r?\n$/, '')));
    });
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); }; // hide typed characters
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

// Replaces the ADMIN_PASSWORD_HASH entry (including one broken across lines by an
// earlier paste) or appends it; every other line of .env is left untouched.
function writeToEnv(line) {
  const existing = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const entry = /^ADMIN_PASSWORD_HASH=(?:'[^']*'|"[^"]*"|[^\r\n]*)[ \t]*$/m;
  const updated = entry.test(existing)
    ? existing.replace(entry, () => line)
    : `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${line}\n`;
  fs.writeFileSync(ENV_FILE, updated, { mode: 0o600 });
}

const password = await ask('New admin password: ');
if (password.length < MIN_LENGTH) {
  console.error(`Use at least ${MIN_LENGTH} characters (a few random words works well).`);
  process.exit(1);
}
if (process.stdin.isTTY && (await ask('Repeat the password: ')) !== password) {
  console.error('The passwords did not match.');
  process.exit(1);
}

// OWASP-recommended Argon2id settings: 64 MiB memory, 3 passes, 4 lanes.
const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
const line = `ADMIN_PASSWORD_HASH='${hash}'`;

if (printOnly) {
  console.log(`\nPut this on ONE line in your environment file (single quotes keep the $ intact):\n\n${line}\n`);
} else {
  writeToEnv(line);
  console.log(`Saved the new password hash to ${path.basename(ENV_FILE)}. Restart the server to use it.`);
}
