#!/usr/bin/env node
/**
 * isolate-subject.mjs — 从抠图结果里只留「人物」，剪掉悬空的背景道具
 *
 * 为什么需要这一步：
 * 插画里常有风铃、吊灯、气球、招牌这类悬在角色上方的元素。BiRefNet 会把它
 * 和人物一起抠出来（都是非背景），Hunyuan3D 于是把它也生成立体物件 —— 结果
 * 就是一个悬空的灯罩挂在头顶，包围盒被撑高，前端归一化后人物缩在画面下角，
 * 看起来像「头身分离」。
 *
 * 做法：把非白像素做连通域分析，保留最大连通域外接框里的内容（人物），
 * 其余（道具）用白底覆盖。不依赖任何图像库，纯 Node 读写 PNG。
 *
 * 用法：node scripts/3d/isolate-subject.mjs in.png out.png
 */
import { readFile, writeFile } from 'node:fs/promises';
import { inflateSync, deflateSync } from 'node:zlib';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('用法: node scripts/3d/isolate-subject.mjs <in.png> <out.png>');
  process.exit(1);
}

/* ---------- 最小 PNG 读写（只处理 8bit RGB/RGBA 非隔行） ---------- */

function readPNG(buf) {
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let palette = null, trns = null;

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IEND') break;
    off += 12 + len;
  }

  if (bitDepth !== 8) throw new Error(`只支持 8bit PNG，收到 ${bitDepth}bit`);
  if (interlace) throw new Error('不支持隔行 PNG');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`不支持的 colorType ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(width * height * channels);

  // 反 filter
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`未知 filter ${filter}`);
      }
      cur[x] = v & 0xff;
    }
  }

  // 统一转 RGB
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    if (colorType === 2 || colorType === 6) {
      rgb[i * 3] = px[i * channels];
      rgb[i * 3 + 1] = px[i * channels + 1];
      rgb[i * 3 + 2] = px[i * channels + 2];
    } else if (colorType === 3) {
      const pi = px[i] * 3;
      rgb[i * 3] = palette[pi];
      rgb[i * 3 + 1] = palette[pi + 1];
      rgb[i * 3 + 2] = palette[pi + 2];
    } else {
      const g = px[i * channels];
      const alpha = channels === 2 ? px[i * channels + 1] : 255;
      // 透明像素当作白
      rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = Math.round(g * (alpha / 255) + 255 * (1 - alpha / 255));
    }
  }
  return { width, height, rgb };
}

function writePNG({ width, height, rgb }) {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunks = [];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcTable = writePNG.crcTable || (writePNG.crcTable = (() => {
      const t = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
      }
      return t;
    })());
    let crc = -1;
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE((crc ^ -1) >>> 0);
    chunks.push(len, body, crcBuf);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunk('IHDR', ihdr);
  chunk('IDAT', deflateSync(raw, { level: 9 }));
  chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

/* ---------- 连通域 ---------- */

const { width, height, rgb } = readPNG(await readFile(input));
const N = width * height;

// 白底判定：三通道都很亮就算空白
const isInk = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
  // 细线条常常接近白（#dff2ff 之类），阈值放宽到 246 才不会把头发丝切断
  isInk[i] = r < 246 || g < 246 || b < 246 ? 1 : 0;
}

const label = new Int32Array(N).fill(-1);
const stack = new Int32Array(N);
const comps = [];

for (let start = 0; start < N; start++) {
  if (!isInk[start] || label[start] !== -1) continue;
  const id = comps.length;
  let sp = 0;
  stack[sp++] = start;
  label[start] = id;
  let count = 0;
  let minX = width, maxX = 0, minY = height, maxY = 0;
  while (sp) {
    const p = stack[--sp];
    count++;
    const x = p % width, y = (p / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x > 0 && isInk[p - 1] && label[p - 1] === -1) { label[p - 1] = id; stack[sp++] = p - 1; }
    if (x < width - 1 && isInk[p + 1] && label[p + 1] === -1) { label[p + 1] = id; stack[sp++] = p + 1; }
    if (y > 0 && isInk[p - width] && label[p - width] === -1) { label[p - width] = id; stack[sp++] = p - width; }
    if (y < height - 1 && isInk[p + width] && label[p + width] === -1) { label[p + width] = id; stack[sp++] = p + width; }
  }
  comps.push({ id, count, minX, maxX, minY, maxY });
}

comps.sort((a, b) => b.count - a.count);
const main = comps[0];
if (!main) {
  console.log('  主体裁切：整张几乎全白，跳过');
  await writeFile(output, await readFile(input));
  process.exit(0);
}

// 主体外接框往外放 3% 余量，避免贴边裁掉裙摆/发梢
const padX = Math.round((main.maxX - main.minX) * 0.03);
const padY = Math.round((main.maxY - main.minY) * 0.03);
const box = {
  x0: Math.max(0, main.minX - padX),
  x1: Math.min(width - 1, main.maxX + padX),
  y0: Math.max(0, main.minY - padY),
  y1: Math.min(height - 1, main.maxY + padY),
};

// 只保留落在外接框内的像素，其余刷白
const out = Buffer.from(rgb);
let cleared = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) continue;
    const i = (y * width + x) * 3;
    if (out[i] !== 255 || out[i + 1] !== 255 || out[i + 2] !== 255) cleared++;
    out[i] = 255; out[i + 1] = 255; out[i + 2] = 255;
  }
}

const dropped = comps.filter((c) => c.id !== main.id && c.count > main.count * 0.02);
console.log(
  `  主体裁切：主块 ${main.count}px 占 ${((main.count / N) * 100).toFixed(1)}%，` +
  `移除 ${dropped.length} 个 ≥2% 的分离块，清掉 ${cleared} 个像素`
);

// 二次裁切：把人物重新框满画布。抠图节点本来按整体内容做过一次 pad 裁切，
// 但道具一去掉人物就偏小了，不重新框的话 Hunyuan3D 只拿到一小块主体，细节全糊。
const { x0, x1, y0, y1 } = box;
const bw = x1 - x0 + 1;
const bh = y1 - y0 + 1;
const side = Math.round(Math.max(bw, bh) * 1.06); // 留 6% 边距，和上游 pad 1.05 对齐
const cx = Math.round((x0 + x1) / 2);
const cy = Math.round((y0 + y1) / 2);
const startX = cx - Math.round(side / 2);
const startY = cy - Math.round(side / 2);

const square = Buffer.alloc(side * side * 3, 255);
for (let y = 0; y < side; y++) {
  const sy = startY + y;
  if (sy < 0 || sy >= height) continue;
  for (let x = 0; x < side; x++) {
    const sx = startX + x;
    if (sx < 0 || sx >= width) continue;
    const si = (sy * width + sx) * 3;
    const di = (y * side + x) * 3;
    // 只拷贝框内（主体区域）的像素，框外已经是白的
    square[di] = out[si];
    square[di + 1] = out[si + 1];
    square[di + 2] = out[si + 2];
  }
}
console.log(`  重新框满：${bw}×${bh} → ${side}×${side} 居中`);
await writeFile(output, writePNG({ width: side, height: side, rgb: square }));
