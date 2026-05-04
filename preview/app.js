// Spine Player 主逻辑（基于 spine-ts 3.6 webgl runtime）
'use strict';

const PREFIX = '/extracted/';  // 资源 URL 前缀（HTTP server 根目录在 zhsmxb/）
const $ = (id) => document.getElementById(id);

let manifest = null;
let currentItem = null;

// === 渲染状态 ===
let canvas, gl, renderer, assetManager;
let skeleton, skeletonData, animationState;
let lastTime = 0;
let userScale = 1;
let assetX = 0;
let assetY = 0;
let dragState = null;
let userBg = 0;  // 0=棋盘 1=黑 2=白 3=透明
let characterOnly = false;
let needsReload = false;
const PMA = true;  // premultiplied alpha test
const CHARACTER_ONLY_RE = /(^|[\/_\-\s])(?:shadow|shade|bg|background|backdrop|di|diban|floor|ground|texiao|texiaojia|vfx|fx|effect|glow|light|board|box|circle|halo|particle|star|spark|smoke|cloud|hit|multi_hit|shizideng)(?:$|[\/_\-\s\d])/i;

// === 初始化 WebGL（一次性） ===
function initGL() {
  canvas = $('canvas');
  const config = { alpha: true, premultipliedAlpha: PMA };
  gl = canvas.getContext('webgl', config) || canvas.getContext('experimental-webgl', config);
  if (!gl) {
    alert('你的浏览器不支持 WebGL');
    return false;
  }
  renderer = new spine.webgl.SceneRenderer(canvas, gl);
  assetManager = new spine.webgl.AssetManager(gl);
  requestAnimationFrame(render);
  return true;
}

// === 主渲染循环 ===
function render() {
  // 自适应 canvas 物理像素
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * dpr;
  const h = canvas.clientHeight * dpr;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
  }

  // 资源加载完成时切换
  if (needsReload && assetManager.isLoadingComplete()) {
    needsReload = false;
    try { setupSkeleton(); } catch (e) { console.error(e); status('加载失败: ' + e.message); }
  }

  const now = Date.now() / 1000;
  const delta = lastTime ? (now - lastTime) : 0;
  lastTime = now;

  // 清空
  const bgs = [
    [0, 0, 0, 0],            // 0 透明（棋盘格透出）
    [0.117, 0.117, 0.117, 1], // 1 深灰
    [1, 1, 1, 1],             // 2 白
    [0, 0, 0, 0],             // 3 全透明
  ];
  const c = bgs[userBg] || bgs[0];
  gl.clearColor(c[0], c[1], c[2], c[3]);
  gl.clear(gl.COLOR_BUFFER_BIT);

  if (skeleton && animationState) {
    animationState.update(delta * (parseFloat($('speed').value) || 1));
    animationState.apply(skeleton);
    if (characterOnly) hideNonCharacterSlots(skeleton);
    skeleton.x = assetX;
    skeleton.y = assetY;
    skeleton.updateWorldTransform();

    // 自动适配视图
    const bounds = computeBounds(skeleton);
    const targetSize = Math.max(bounds.size.x, bounds.size.y, 1) / userScale;
    renderer.camera.position.x = bounds.offset.x + bounds.size.x / 2 - assetX;
    renderer.camera.position.y = bounds.offset.y + bounds.size.y / 2 - assetY;
    renderer.camera.viewportWidth = targetSize * (canvas.width / canvas.height) * 1.2;
    renderer.camera.viewportHeight = targetSize * 1.2;
    renderer.resize(spine.webgl.ResizeMode.Stretch);

    renderer.begin();
    renderer.drawSkeleton(skeleton, PMA);
    renderer.end();
  }

  requestAnimationFrame(render);
}

function computeBounds(sk) {
  const offset = new spine.Vector2(), size = new spine.Vector2();
  sk.getBounds(offset, size, []);
  // 防止 0 尺寸
  if (size.x < 1) { size.x = 100; offset.x = -50; }
  if (size.y < 1) { size.y = 100; offset.y = -50; }
  return { offset, size };
}

function hideNonCharacterSlots(sk) {
  for (const slot of sk.slots) {
    const slotName = slot.data.name || '';
    const attachment = slot.getAttachment();
    const attachmentName = attachment ? attachment.name || '' : '';
    if (isNonCharacterPart(slotName, attachmentName)) slot.setAttachment(null);
  }
}

function isNonCharacterPart(slotName, attachmentName) {
  const name = `${slotName} ${attachmentName}`.toLowerCase();
  if (/^(?:\d+\s*)+$/.test(slotName)) return true;
  return CHARACTER_ONLY_RE.test(name);
}

function setupCanvasDrag() {
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    dragState = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
    };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', e => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;

    const dx = e.clientX - dragState.x;
    const dy = e.clientY - dragState.y;
    dragState.x = e.clientX;
    dragState.y = e.clientY;

    const worldPerCssPixelX = renderer.camera.viewportWidth / Math.max(canvas.clientWidth, 1);
    const worldPerCssPixelY = renderer.camera.viewportHeight / Math.max(canvas.clientHeight, 1);
    assetX += dx * worldPerCssPixelX;
    assetY -= dy * worldPerCssPixelY;
  });

  const stopDrag = e => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    dragState = null;
    canvas.classList.remove('dragging');
  };

  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('lostpointercapture', () => {
    dragState = null;
    canvas.classList.remove('dragging');
  });
}

// === 加载新资源 ===
function loadItem(item) {
  if (currentItem === item) return;
  currentItem = item;
  $('empty').style.display = 'none';
  $('title').textContent = `${item.cat} / ${item.name}`;

  // 高亮
  document.querySelectorAll('.item').forEach(el => el.classList.toggle('active', el.dataset.idx === String(item._idx)));

  const dir = PREFIX + item.path;
  const skelUrl = `${dir}/${item.base}.${item.ext}`;
  const atlasUrl = `${dir}/${item.base}.atlas`;

  // 重置 assetManager（卸载之前的）
  assetManager.removeAll();
  skeleton = null; animationState = null; needsReload = false;
  assetX = 0; assetY = 0;

  // .skel must be loaded as bytes; decoding it as text corrupts the binary data.
  if (item.ext === 'skel') assetManager.loadBinary(skelUrl);
  else assetManager.loadText(skelUrl);
  assetManager.loadTextureAtlas(atlasUrl);
  needsReload = true;
  status(`加载中：${item.path} ...`);

}

function setupSkeleton() {
  if (!currentItem) return;
  const item = currentItem;
  const dir = PREFIX + item.path;
  const skelUrl = `${dir}/${item.base}.${item.ext}`;
  const atlasUrl = `${dir}/${item.base}.atlas`;

  const errors = assetManager.getErrors();
  if (Object.keys(errors).length > 0) {
    status('错误: ' + Object.keys(errors).join(', '));
    return;
  }

  const atlas = assetManager.get(atlasUrl);
  const atlasLoader = new spine.AtlasAttachmentLoader(atlas);

  const raw = assetManager.get(skelUrl);

  const parser = item.ext === 'skel' ? new spine.SkeletonBinary(atlasLoader) : new spine.SkeletonJson(atlasLoader);
  parser.scale = 1;
  try {
    skeletonData = parser.readSkeletonData(raw);
  } catch (e) {
    status('解析失败: ' + e.message);
    console.error(e);
    return;
  }

  skeleton = new spine.Skeleton(skeletonData);
  const stateData = new spine.AnimationStateData(skeletonData);
  stateData.defaultMix = 0.1;
  animationState = new spine.AnimationState(stateData);

  const sel = $('anim');
  sel.innerHTML = '';
  if (skeletonData.animations.length === 0) {
    sel.innerHTML = '<option>(无动画)</option>';
  } else {
    skeletonData.animations.forEach((a, i) => {
      const opt = document.createElement('option');
      opt.value = a.name;
      opt.textContent = `${a.name}  (${a.duration.toFixed(2)}s)`;
      sel.appendChild(opt);
    });
    animationState.setAnimation(0, skeletonData.animations[0].name, $('loop').checked);
  }

  status(`✓ ${skeletonData.animations.length} 个动画 · ${skeletonData.bones.length} 块骨骼 · ${skeletonData.skins.length} 个皮肤`);
}

function status(msg) { $('status').textContent = msg; }

// === 侧边栏渲染 ===
function renderSidebar() {
  const list = $('list');
  list.innerHTML = '';
  const groups = {};
  manifest.items.forEach((item, idx) => {
    item._idx = idx;
    (groups[item.cat] = groups[item.cat] || []).push(item);
  });

  const order = ['hero', 'ui', 'battle', 'fight', 'pet', 'monster', 'mecha', 'robot', 'roguelike', 'minecontest', 'refugee', 'face'];
  const cats = Object.keys(groups).sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  cats.forEach(cat => {
    const items = groups[cat];
    const catEl = document.createElement('div');
    catEl.className = 'cat';
    catEl.innerHTML = `📁 ${cat} <span class="count">(${items.length})</span>`;
    catEl.onclick = () => catEl.classList.toggle('collapsed');
    list.appendChild(catEl);

    const wrap = document.createElement('div');
    wrap.className = 'cat-items';
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'item' + (item.ext === 'json' ? ' has-json' : ' has-skel');
      el.dataset.idx = item._idx;
      el.dataset.ext = item.ext;
      el.dataset.search = (item.cat + ' ' + item.path + ' ' + item.name).toLowerCase();
      const badge = item.ext === 'json' ? '<span class="badge ok">●</span>' : '<span class="badge wait">⏳</span>';
      el.innerHTML = `${badge}${item.name}`;
      el.onclick = () => loadItem(item);
      wrap.appendChild(el);
    });
    list.appendChild(wrap);
  });

  $('stats').textContent = `共 ${manifest.items.length} 个资源 · ${cats.length} 个分类`;
}

// === 搜索过滤 ===
function applyFilter() {
  const q = $('search').value.trim().toLowerCase();
  document.querySelectorAll('.item').forEach(el => {
    el.classList.toggle('hidden', q && !el.dataset.search.includes(q));
  });
  // 隐藏全空的分类
  document.querySelectorAll('.cat-items').forEach(wrap => {
    const visible = wrap.querySelectorAll('.item:not(.hidden)').length;
    wrap.style.display = visible ? '' : 'none';
    wrap.previousElementSibling.style.display = visible ? '' : 'none';
  });
}

// === 主入口 ===
async function main() {
  if (!initGL()) return;
  setupCanvasDrag();

  try {
    const res = await fetch('manifest.json');
    manifest = await res.json();
  } catch (e) {
    $('stats').textContent = '加载 manifest.json 失败';
    return;
  }

  renderSidebar();

  $('search').addEventListener('input', applyFilter);
  $('anim').addEventListener('change', e => {
    if (animationState) animationState.setAnimation(0, e.target.value, $('loop').checked);
  });
  $('loop').addEventListener('change', e => {
    if (animationState && skeletonData?.animations.length) {
      const cur = animationState.getCurrent(0);
      if (cur) animationState.setAnimation(0, cur.animation.name, e.target.checked);
    }
  });
  $('character-only').addEventListener('change', e => {
    characterOnly = e.target.checked;
  });
  $('speed').addEventListener('input', e => $('speed-val').textContent = parseFloat(e.target.value).toFixed(1) + 'x');
  $('scale').addEventListener('input', e => {
    userScale = parseFloat(e.target.value);
    $('scale-val').textContent = userScale.toFixed(2) + 'x';
  });
  $('reset').addEventListener('click', () => {
    $('scale').value = 1; userScale = 1; $('scale-val').textContent = '1.0x';
    $('speed').value = 1; $('speed-val').textContent = '1.0x';
    assetX = 0; assetY = 0;
  });
  $('bg').addEventListener('click', () => userBg = (userBg + 1) % 3);
}

main();
