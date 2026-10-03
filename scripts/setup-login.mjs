import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { randomBytes, scryptSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Run locally. Passwords are neither echoed nor written to disk.
let hidden = false;
const output = new Writable({ write(chunk, encoding, done) { if (!hidden) process.stdout.write(chunk, encoding); done(); } });
const input = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
try {
  const username = (await input.question('Login username / 登录用户名: ')).trim();
  if (!/^[A-Za-z0-9_.@-]{1,100}$/.test(username)) throw new Error('Use 1–100 letters, numbers, or _.@- / 用户名请使用英文字母、数字或 _.@-');
  process.stdout.write('Password (hidden, at least 12 characters) / 密码（隐藏输入，至少 12 位）: ');
  hidden = true; const password = await input.question(''); hidden = false; process.stdout.write('\n');
  if (password.length < 12 || password.length > 200) throw new Error('Password must contain 12–200 characters / 密码需要 12–200 位');
  process.stdout.write('Confirm password / 确认密码: ');
  hidden = true; const confirmation = await input.question(''); hidden = false; process.stdout.write('\n');
  if (password !== confirmation) throw new Error('Passwords do not match / 两次密码不一致');
  const salt = randomBytes(16);
  const hash = `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
  let source = '';
  try { source = await readFile('.env.local', 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Keep unrelated settings; replace only the two explicitly entered account settings.
  source = source.replace(/^(?:LOGIN_USERNAME|LOGIN_PASSWORD_HASH)=.*(?:\r?\n|$)/gm, '').trimEnd();
  await writeFile('.env.local', `${source ? `${source}\n` : ''}LOGIN_USERNAME=${username}\nLOGIN_PASSWORD_HASH=${hash}\n`, { mode: 0o600 });
  console.log('Account configured. Restart the local server. For hosting, set these two values in your deployment environment. / 账号已配置，请重启本地服务。线上部署请在平台环境变量中配置这两个值。');
} catch (error) {
  hidden = false; console.error(error.message); process.exitCode = 1;
} finally { input.close(); }
