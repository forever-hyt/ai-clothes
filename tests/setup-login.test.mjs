import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { scryptSync } from 'node:crypto';

test('account setup preserves other settings and writes only a salted hash', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'style-muse-login-test-'));
  const filename = path.join(directory, '.env.local');
  const password = 'test-only-password-123';
  try {
    await writeFile(filename, 'PRIVACY_CONTACT=operator@example.test\nLOGIN_USERNAME=old\nLOGIN_PASSWORD_HASH=old\n');
    const child = spawn(process.execPath, [path.resolve('scripts/setup-login.mjs')], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '', stage = 0;
    const timeout = setTimeout(() => child.kill(), 10000);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (stage === 0 && output.includes('Login username')) { stage = 1; child.stdin.write('test-owner\n'); }
      if (stage === 1 && output.includes('Password (hidden')) { stage = 2; child.stdin.write(`${password}\n`); }
      if (stage === 2 && output.includes('Confirm password')) { stage = 3; child.stdin.write(`${password}\n`); }
    });
    child.stderr.on('data', chunk => { errors += chunk; });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    clearTimeout(timeout);
    assert.equal(code, 0, errors);
    const source = await readFile(filename, 'utf8');
    assert.match(source, /PRIVACY_CONTACT=operator@example.test/);
    assert.match(source, /LOGIN_USERNAME=test-owner/);
    assert.equal(source.includes(password), false);
    assert.equal(output.includes(password), false);
    const [, salt, hash] = source.match(/LOGIN_PASSWORD_HASH=([a-f0-9]{32}):([a-f0-9]{128})/);
    assert.equal(scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex'), hash);
    assert.equal(source.match(/LOGIN_USERNAME=/g).length, 1);
  } finally { await unlink(filename); await rmdir(directory); }
});
