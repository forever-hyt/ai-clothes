const $ = id => document.getElementById(id);
const state = { person: null, clothing: null };
const versions = { person: 0, clothing: 0 };
const reading = { person: false, clothing: false };
let busy = false;
let currentUser = null;
const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
const update = () => {
  const count = Number(Boolean(state.person)) + Number(Boolean(state.clothing));
  const loading = reading.person || reading.clothing;
  $('generate').disabled = busy || loading || count !== 2 || !$('privacy-consent').checked;
  $('generate').textContent = busy ? '正在准备预览…' : loading ? '正在读取图片…' : count !== 2 ? `请上传${!state.person ? '人物照片' : '服装图片'}` : !$('privacy-consent').checked ? '请先勾选图片处理授权' : !currentUser ? '登录后开始演示' : !$('result-output').hidden ? '重新运行演示' : '开始演示预览';
  $('clear-images').disabled = busy || (count === 0 && !loading);
  $('privacy-consent').disabled = busy;
  $('logout').disabled = busy;
  $('material-count').textContent = `${count} / 2 已就绪`;
  for (const kind of ['person', 'clothing']) {
    $(`${kind}-zone`).closest('.upload-card').classList.toggle('has-image', Boolean(state[kind]));
    $(`${kind}-badge`).textContent = reading[kind] ? '读取中…' : state[kind] ? '✓ 已上传' : '待上传';
  }
  const complete = !$('result-output').hidden;
  const activeStep = complete ? 'step-result' : (count === 2 ? 'step-process' : 'step-upload');
  for (const id of ['step-upload', 'step-process', 'step-result']) {
    $(id).classList.toggle('active', id === activeStep);
    $(id).classList.toggle('done', id === 'step-upload' && count === 2);
    if (id === activeStep) $(id).setAttribute('aria-current', 'step'); else $(id).removeAttribute('aria-current');
  }
  $('generate').classList.toggle('loading', busy);
  $('generate').setAttribute('aria-busy', String(busy));
  $('result-empty').closest('.results').classList.toggle('is-processing', busy);
};
function resetResult() { $('result-output').hidden = true; $('result-empty').hidden = false; $('result-tag').textContent = '等待预览'; $('result-image').removeAttribute('src'); $('result-note').textContent = ''; $('download-result').removeAttribute('href'); }
async function choose(kind, file) {
  if (!file || busy) return;
  const version = ++versions[kind];
  reading[kind] = false;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) { update(); status('请选择 5MB 以内的 JPG、PNG 或 WebP 图片', true); return; }
  reading[kind] = true; update();
  try {
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    const image = new Image(); image.src = data; await image.decode();
    if (version !== versions[kind]) return;
    if (image.naturalWidth * image.naturalHeight > 20000000) throw new Error('图片超过 2000 万像素，请缩小后再上传');
    state[kind] = data;
    const preview = $(`${kind}-preview`); preview.src = data; preview.hidden = false;
    $(`${kind}-zone`).querySelector('.upload-prompt').hidden = true;
    $(`${kind}-name`).textContent = file.name;
    $(`${kind}-remove`).hidden = false;
    resetResult(); status(state.person && state.clothing ? '素材已就绪，确认图片处理说明后即可预览' : '已上传一张图片，请继续上传另一张'); update();
  } catch (error) { if (version === versions[kind]) status(error.message || '无法读取这张图片，请选择有效的图片文件', true); }
  finally { if (version === versions[kind]) { reading[kind] = false; update(); } }
}
for (const kind of ['person', 'clothing']) {
  const input = $(`${kind}-input`), zone = $(`${kind}-zone`);
  input.addEventListener('change', () => { const file = input.files[0]; input.value = ''; choose(kind, file); });
  for (const event of ['dragenter', 'dragover']) zone.addEventListener(event, e => { e.preventDefault(); if (!busy) zone.classList.add('dragging'); });
  for (const event of ['dragleave', 'drop']) zone.addEventListener(event, e => { e.preventDefault(); zone.classList.remove('dragging'); });
  zone.addEventListener('drop', e => choose(kind, e.dataTransfer.files[0]));
  $(`${kind}-remove`).addEventListener('click', () => {
    if (busy) return; ++versions[kind]; reading[kind] = false; state[kind] = null; input.value = '';
    $(`${kind}-preview`).hidden = true; $(`${kind}-preview`).removeAttribute('src');
    zone.querySelector('.upload-prompt').hidden = false; $(`${kind}-remove`).hidden = true;
    $(`${kind}-name`).textContent = kind === 'person' ? '建议使用清晰、完整的人物正面照片' : '建议使用背景简洁的服装展示图片';
    resetResult(); status('请补齐两张图片，再确认图片处理说明'); update();
  });
}
async function api(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) { if (response.status === 401) renderUser(null); throw new Error(data.error || '请求失败，请重试'); } return data;
}
$('generate').addEventListener('click', async () => {
  if (busy || reading.person || reading.clothing || !state.person || !state.clothing || !$('privacy-consent').checked) return;
  if (!currentUser) { $('login-error').textContent = '请先登录，再提交图片'; $('login-dialog').showModal(); return; }
  busy = true; resetResult(); update();
  for (const kind of ['person', 'clothing']) { $(`${kind}-input`).disabled = true; $(`${kind}-remove`).disabled = true; }
  $('generate').textContent = '正在准备预览…'; $('result-tag').textContent = '正在处理'; status('正在安全处理图片，请稍候');
  try {
    const data = await api('/api/try-on', { personImage: state.person, clothingImage: state.clothing, privacyConsent: $('privacy-consent').checked });
    $('result-image').src = data.resultUrl;
    $('download-result').href = data.resultUrl;
    $('result-image').alt = data.mode === 'demo' ? '演示结果：上传的人物原图，未进行 AI 换装' : 'AI 换装结果';
    $('result-note').textContent = data.message;
    $('result-tag').textContent = data.mode === 'demo' ? '演示预览 · 人物原图' : '生成完成';
    $('result-empty').hidden = true; $('result-output').hidden = false;
    if (window.matchMedia('(max-width: 800px)').matches) $('result-title').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    status(`演示已完成，今日剩余 ${data.remaining} 次。真实 AI 换装尚未接入。`);
  } catch (error) { $('result-tag').textContent = '处理未完成'; status(error.name === 'TimeoutError' ? '请求超时，请重试' : error.message, true); }
  finally {
    busy = false; update();
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
  currentUser = user;
  $('avatar').classList.toggle('signed-in', Boolean(user));
  if (user) $('avatar').textContent = user.username.slice(0, 1).toUpperCase(); else $('avatar').innerHTML = defaultAvatar;
  $('account-label').textContent = user ? `已登录 · ${user.username}` : '欢迎来到衣搭灵感';
  $('account-hint').textContent = user ? '已登录 · 开始创作' : '登录后开始体验';
  $('login-entry').hidden = Boolean(user); $('logout').hidden = !user;
  update();
}
$('login-entry').addEventListener('click', () => { closeMenu(); $('login-error').textContent = ''; $('login-dialog').showModal(); });
$('close-dialog').addEventListener('click', () => $('login-dialog').close());
$('login-dialog').addEventListener('close', () => { $('password').value = ''; });
$('login-form').addEventListener('submit', async e => {
  e.preventDefault(); if ($('login-submit').disabled) return; $('login-submit').disabled = true; $('login-submit').textContent = '正在登录…'; $('login-error').textContent = '';
  try { const data = await api('/api/auth/login', { username: $('username').value, password: $('password').value }); renderUser(data.user); $('login-dialog').close(); status('登录成功，请点击开始演示预览'); if (!$('generate').disabled) $('generate').focus(); }
  catch (error) { $('login-error').textContent = error.message; }
  finally { $('login-submit').disabled = false; $('login-submit').textContent = '登录并继续'; }
});
$('logout').addEventListener('click', async () => { try { await api('/api/auth/logout', {}); renderUser(null); closeMenu(); } catch (error) { status(error.message, true); } });
fetch('/api/auth/me').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => renderUser(data.user)).catch(() => status('账户状态暂时无法加载，请稍后重试', true));
$('privacy-consent').addEventListener('change', () => {
  update();
  if (state.person && state.clothing) status($('privacy-consent').checked ? (currentUser ? '一切就绪，点击开始演示预览' : '确认已完成，点击开始预览后登录账号') : '请先确认图片处理说明');
});
function clearImages() {
  for (const kind of ['person', 'clothing']) $(`${kind}-remove`).click();
  resetResult(); $('download-result').removeAttribute('href');
  $('privacy-consent').checked = false; update();
}
$('clear-images').addEventListener('click', () => { if (!busy) { clearImages(); status('已清除本页面的人物、服装和结果图片'); } });
setInterval(() => { if (!busy && (state.person || state.clothing || reading.person || reading.clothing)) { clearImages(); status('本页面图片已到期清除（最长保留 30 分钟）'); } }, 30 * 60 * 1000);
update();
