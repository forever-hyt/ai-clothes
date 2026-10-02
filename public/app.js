const $ = id => document.getElementById(id);
const state = { person: null, clothing: null };
const versions = { person: 0, clothing: 0 };
let busy = false;
const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
const update = () => { $('generate').disabled = busy || !state.person || !state.clothing; };
function resetResult() { $('result-output').hidden = true; $('result-empty').hidden = false; $('result-tag').textContent = '等待你的灵感'; $('result-image').removeAttribute('src'); }
async function choose(kind, file) {
  if (!file || busy) return;
  const version = ++versions[kind];
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { status('请选择 5MB 以内的 JPG、PNG 或 WebP 图片', true); return; }
  try {
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    const image = new Image(); image.src = data; await image.decode();
    if (version !== versions[kind]) return;
    state[kind] = data;
    const preview = $(`${kind}-preview`); preview.src = data; preview.hidden = false;
    $(`${kind}-zone`).querySelector('.upload-prompt').hidden = true;
    $(`${kind}-name`).textContent = file.name;
    $(`${kind}-remove`).hidden = false;
    resetResult(); status(state.person && state.clothing ? '图片已就绪，开始你的穿搭实验' : '请继续上传另一张图片'); update();
  } catch { if (version === versions[kind]) status('无法读取这张图片，请选择有效的图片文件', true); }
}
for (const kind of ['person', 'clothing']) {
  const input = $(`${kind}-input`), zone = $(`${kind}-zone`);
  input.addEventListener('change', () => choose(kind, input.files[0]));
  for (const event of ['dragenter', 'dragover']) zone.addEventListener(event, e => { e.preventDefault(); if (!busy) zone.classList.add('dragging'); });
  for (const event of ['dragleave', 'drop']) zone.addEventListener(event, e => { e.preventDefault(); zone.classList.remove('dragging'); });
  zone.addEventListener('drop', e => choose(kind, e.dataTransfer.files[0]));
  $(`${kind}-remove`).addEventListener('click', () => {
    if (busy) return; ++versions[kind]; state[kind] = null; input.value = '';
    $(`${kind}-preview`).hidden = true; $(`${kind}-preview`).removeAttribute('src');
    zone.querySelector('.upload-prompt').hidden = false; $(`${kind}-remove`).hidden = true;
    $(`${kind}-name`).textContent = kind === 'person' ? '建议使用清晰、完整的人物正面照片' : '建议使用背景简洁的服装展示图片';
    resetResult(); status('上传两张图片，即可开始体验'); update();
  });
}
async function api(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求失败，请重试'); return data;
}
$('generate').addEventListener('click', async () => {
  if (busy || !state.person || !state.clothing) return;
  busy = true; update(); resetResult();
  for (const kind of ['person', 'clothing']) { $(`${kind}-input`).disabled = true; $(`${kind}-remove`).disabled = true; }
  $('generate').textContent = '正在处理…'; status('正在运行演示流程，请稍候');
  try {
    const data = await api('/api/try-on', { personImage: state.person, clothingImage: state.clothing });
    $('result-image').src = data.mode === 'demo' ? state.person : data.resultUrl;
    $('result-image').alt = data.mode === 'demo' ? '演示结果：上传的人物原图，未进行 AI 换装' : 'AI 换装结果';
    $('result-note').textContent = data.message;
    $('result-tag').textContent = data.mode === 'demo' ? '演示预览 · 人物原图' : '生成完成';
    $('result-empty').hidden = true; $('result-output').hidden = false;
    status('演示流程已完成，真实 AI 换装功能将在接入模型后开放');
  } catch (error) { status(error.name === 'TimeoutError' ? '请求超时，请重试' : error.message, true); }
  finally {
    busy = false; update(); $('generate').textContent = '✦  开始 AI 换装  →';
    for (const kind of ['person', 'clothing']) { $(`${kind}-input`).disabled = false; $(`${kind}-remove`).disabled = false; }
  }
});
const menu = $('account-menu');
$('avatar').addEventListener('click', () => { menu.hidden = !menu.hidden; $('avatar').setAttribute('aria-expanded', String(!menu.hidden)); });
function closeMenu() { menu.hidden = true; $('avatar').setAttribute('aria-expanded', 'false'); }
document.addEventListener('click', e => { if (!e.target.closest('.account')) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
const defaultAvatar = $('avatar').innerHTML;
function renderUser(user) {
  $('avatar').classList.toggle('signed-in', Boolean(user));
  if (user) $('avatar').textContent = user.username.slice(0, 1).toUpperCase(); else $('avatar').innerHTML = defaultAvatar;
  $('account-label').textContent = user ? `已登录 · ${user.username}` : '欢迎来到衣境 AI';
  $('login-entry').hidden = Boolean(user); $('logout').hidden = !user;
}
$('login-entry').addEventListener('click', () => { closeMenu(); $('login-error').textContent = ''; $('login-dialog').showModal(); });
$('close-dialog').addEventListener('click', () => $('login-dialog').close());
$('login-form').addEventListener('submit', async e => {
  e.preventDefault(); $('login-submit').disabled = true; $('login-error').textContent = '';
  try { const data = await api('/api/auth/login', { username: $('username').value, password: $('password').value }); renderUser(data.user); $('login-dialog').close(); $('password').value = ''; }
  catch (error) { $('login-error').textContent = error.message; }
  finally { $('login-submit').disabled = false; }
});
$('logout').addEventListener('click', async () => { try { await api('/api/auth/logout', {}); renderUser(null); closeMenu(); } catch (error) { status(error.message, true); } });
fetch('/api/auth/me').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => renderUser(data.user)).catch(() => status('账户状态暂时无法加载，图片体验仍可使用', true));
