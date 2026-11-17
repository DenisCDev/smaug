// HD-2D style hero: a low-resolution pixel scene lit per frame, layered with
// depth-of-field, bloom and particles. Everything is drawn in code.

const W = 384;
const OX = 63; // the dragon sits right of centre; a multiple of the scale width
const H = 216;
const OY = 30; // headroom above the horns; a multiple of the scale height

type Light = { x: number; y: number; z: number; r: number; g: number; b: number; i: number; reach: number };

const BODY = ['#0b0807', '#1a110c', '#2a1c13', '#3d2919', '#573a21', '#7a5128', '#a56e30', '#d49a3e', '#ffbf3f', '#ffd36b'];
const HORN = ['#1d1712', '#3b3127', '#5f5242', '#8f7f66', '#c2b293', '#f0e6cf'];
const GOLD = ['#2a1a08', '#5c3a10', '#94621a', '#c98a26', '#ffbf3f', '#ffd36b', '#fff3c4'];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v / 16 - 0.5) * 0.45);

const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const ramp = (list: string[]) => list.map(hex);
const BODY_RGB = ramp(BODY);
const HORN_RGB = ramp(HORN);
const GOLD_RGB = ramp(GOLD);

// Region ids in the mask.
const NONE = 0, SKULL = 1, NECK = 2, HORNS = 3, MOUTH = 4, EYE = 5, TEETH = 6;

function path(ctx: CanvasRenderingContext2D, pts: number[][]) {
	ctx.beginPath();
	ctx.moveTo(pts[0][0], pts[0][1]);
	for (const p of pts.slice(1)) {
		if (p.length === 2) ctx.lineTo(p[0], p[1]);
		else ctx.quadraticCurveTo(p[0], p[1], p[2], p[3]);
	}
	ctx.closePath();
	ctx.fill();
}

function buildMask(): Uint8Array {
	const c = document.createElement('canvas');
	c.width = W;
	c.height = H;
	const ctx = c.getContext('2d', { willReadFrequently: true })!;
	const layers: [number, (x: CanvasRenderingContext2D) => void][] = [
		[NECK, (x) => {
			path(x, [[236, 58], [300, 80, 336, 186], [262, 190], [236, 140, 196, 112], [214, 96]]);
			for (let k = 0; k < 6; k++) {
				const t = k / 5;
				const bx = 244 + t * 76, by = 62 + t * t * 110;
				path(x, [[bx - 5, by + 2], [bx + 7, by - 9], [bx + 7, by + 6]]);
			}
		}],
		[SKULL, (x) => {
			path(x, [
				[238, 62], [232, 46, 210, 44], [194, 44, 182, 52], [174, 56, 166, 58],
				[150, 64, 136, 72], [126, 76, 124, 82], [124, 88, 130, 90],
				[170, 95], [134, 99], [132, 104, 138, 108], [160, 112, 190, 110], [204, 108, 214, 100],
				[230, 86, 238, 62],
			]);
			// Brow ridge over the eye and the frill behind the jaw.
			path(x, [[168, 56], [180, 46, 196, 48], [184, 52, 172, 60]]);
			for (const [fx, fy] of [[206, 102], [214, 94], [220, 84]]) path(x, [[fx - 4, fy], [fx + 10, fy + 4], [fx + 2, fy + 6]]);
		}],
		[HORNS, (x) => {
			path(x, [[204, 50], [226, 30, 270, 16], [240, 32, 222, 58]]);
			path(x, [[192, 48], [204, 28, 236, 14], [214, 30, 204, 52]]);
		}],
		[MOUTH, (x) => path(x, [[131, 91], [170, 95], [136, 98]])],
		[TEETH, (x) => {
			for (const tx of [138, 146, 154]) path(x, [[tx, 92], [tx + 3, 92], [tx + 1, 96]]);
			for (const tx of [142, 150]) path(x, [[tx, 98], [tx + 3, 98], [tx + 2, 95]]);
		}],
		[EYE, (x) => path(x, [[172, 64], [179, 59, 187, 62], [181, 67, 172, 64]])],
	];
	const mask = new Uint8Array(W * H);
	for (const [id, draw] of layers) {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, W, H);
		ctx.setTransform(1, 0, 0, 1, OX, OY);
		ctx.fillStyle = '#fff';
		draw(ctx);
		const d = ctx.getImageData(0, 0, W, H).data;
		for (let i = 0; i < W * H; i++) if (d[i * 4 + 3] > 127) mask[i] = id;
	}
	return mask;
}

// Height from the distance to the silhouette edge gives a bevelled normal per pixel.
function buildNormals(mask: Uint8Array) {
	const dist = new Float32Array(W * H).fill(0);
	const solid = (i: number) => mask[i] !== NONE && mask[i] !== MOUTH;
	let frontier: number[] = [];
	for (let i = 0; i < W * H; i++) if (solid(i)) {
		const x = i % W, y = (i / W) | 0;
		const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
			!solid(i - 1) || !solid(i + 1) || !solid(i - W) || !solid(i + W);
		if (edge) { dist[i] = 1; frontier.push(i); }
	}
	for (let level = 2; level <= 10 && frontier.length; level++) {
		const next: number[] = [];
		for (const i of frontier) for (const j of [i - 1, i + 1, i - W, i + W]) {
			if (j >= 0 && j < W * H && solid(j) && dist[j] === 0) { dist[j] = level; next.push(j); }
		}
		frontier = next;
	}
	for (let i = 0; i < W * H; i++) if (solid(i) && dist[i] === 0) dist[i] = 10;
	const h = (i: number) => Math.sqrt(dist[i] || 0);
	const nx = new Float32Array(W * H), ny = new Float32Array(W * H), nz = new Float32Array(W * H);
	for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
		const i = y * W + x;
		if (!solid(i)) continue;
		const gx = h(i + 1) - h(i - 1), gy = h(i + W) - h(i - W);
		const len = Math.hypot(gx, gy, 0.9);
		nx[i] = -gx / len; ny[i] = -gy / len; nz[i] = 0.9 / len;
	}
	return { nx, ny, nz, dist };
}

// Shingled scales on the neck: cell coordinates and the one that is missing.
const SCALE_W = 7, SCALE_H = 6;
const GAP = { cx: 37 + OX / SCALE_W, cy: 18 + OY / SCALE_H };
function scaleAt(x: number, y: number) {
	const cy = Math.floor(y / SCALE_H);
	const off = cy % 2 ? SCALE_W / 2 : 0;
	const cx = Math.floor((x + off) / SCALE_W);
	const u = (x + off) - cx * SCALE_W - SCALE_W / 2;
	const v = y - cy * SCALE_H;
	const r = Math.hypot(u / (SCALE_W / 2), (v - 1) / (SCALE_H - 1));
	return { cx, cy, rim: r > 0.82, top: v <= 1 };
}
export const gapCenter = () => {
	const off = GAP.cy % 2 ? SCALE_W / 2 : 0;
	return { x: GAP.cx * SCALE_W + SCALE_W / 2 - off, y: GAP.cy * SCALE_H + SCALE_H / 2 };
};

function drawBackground(canvas: HTMLCanvasElement) {
	const ctx = canvas.getContext('2d')!;
	const img = ctx.createImageData(W, H);
	const rand = mulberry(7);
	const stalactites = Array.from({ length: 34 }, () => ({ x: rand() * W, len: 8 + rand() * 50, w: 3 + rand() * 9 }));
	const rock = (x: number, y: number) => Math.sin(x * 0.21 + Math.sin(y * 0.13) * 2) * Math.sin(y * 0.17 + x * 0.05);
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		// Dark rock, lit only by the hoard's glow on the floor.
		const floor = Math.max(0, 1 - Math.hypot((x - 270) / 230, (y - H - 16) / 100));
		let v = 0.05 + floor * 0.3 + rock(x, y) * 0.025;
		for (const s of stalactites) {
			const dx = Math.abs(x - s.x);
			if (y < s.len * (1 - dx / s.w) ) v *= 0.35;
		}
		const k = Math.max(0, Math.min(5, Math.floor(v * 10 + BAYER[(y % 4) * 4 + (x % 4)])));
		const warm = BODY_RGB[k];
		const i = (y * W + x) * 4;
		for (let c = 0; c < 3; c++) img.data[i + c] = warm[c];
		img.data[i + 3] = 255;
	}
	ctx.putImageData(img, 0, 0);
	// A folded wing behind the neck, far enough back to sit in the blurred layer.
	ctx.setTransform(1, 0, 0, 1, 0, OY);
	ctx.fillStyle = '#1c130d';
	path(ctx, [[300, 40], [340, 6, 384, 0], [384, 120], [360, 90, 330, 96], [344, 70, 318, 74], [326, 54, 300, 40]]);
	ctx.fillStyle = '#3d2919';
	path(ctx, [[300, 40], [340, 6, 384, 0], [384, 4], [344, 12, 306, 42]]);
}

function drawForeground(canvas: HTMLCanvasElement) {
	const ctx = canvas.getContext('2d')!;
	ctx.setTransform(1, 0, 0, 1, 0, H - 180);
	ctx.fillStyle = '#060504';
	path(ctx, [[0, 180], [0, 128], [22, 118, 40, 134], [60, 142, 74, 160], [92, 168, 104, 180]]);
	path(ctx, [[384, 0], [340, 0], [354, 10, 368, 8], [380, 20, 384, 34]]);
	ctx.fillStyle = '#0d0a08';
	path(ctx, [[0, 140], [14, 134, 30, 146], [46, 156, 52, 180], [0, 180]]);
}

export function mulberry(seed: number) {
	return () => {
		seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; kind: 'ember' | 'smoke' | 'spark' };

export function mountScene(root: HTMLElement) {
	const bg = root.querySelector<HTMLCanvasElement>('[data-layer=bg]')!;
	const main = root.querySelector<HTMLCanvasElement>('[data-layer=main]')!;
	const bloom = root.querySelector<HTMLCanvasElement>('[data-layer=bloom]')!;
	const fg = root.querySelector<HTMLCanvasElement>('[data-layer=fg]')!;
	for (const c of [bg, main, bloom, fg]) { c.width = W; c.height = H; }
	drawBackground(bg);
	drawForeground(fg);

	const mask = buildMask();
	const { nx, ny, nz, dist } = buildNormals(mask);
	const rand = mulberry(42);
	// The hoard: a mound under the neck, packed with coins.
	const heap = (x: number) => H - 30 * Math.exp(-(((x - 268) / 110) ** 2)) - 6 * Math.exp(-(((x - 130) / 40) ** 2));
	const coins = Array.from({ length: 700 }, () => {
		const x = rand() * W, base = heap(x);
		return { x, y: base + rand() ** 1.6 * (H + 2 - base), tw: rand() * 100 };
	}).sort((a, b) => a.y - b.y);
	const ctx = main.getContext('2d')!;
	const bctx = bloom.getContext('2d')!;
	const img = ctx.createImageData(W, H);
	const bimg = bctx.createImageData(W, H);
	const particles: Particle[] = [];
	const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
	let blinkUntil = 0, nextBlink = 2500, nextSpark = 3000, flash = 0;
	const gap = gapCenter();

	const put = (data: Uint8ClampedArray, i: number, rgb: number[], a = 255) => {
		data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = a;
	};

	function frame(t: number) {
		const breath = Math.sin(t / 900) * 0.5 + 0.5;
		const flicker = 0.75 + 0.25 * Math.sin(t / 70) * Math.sin(t / 173) + 0.1 * Math.sin(t / 31);
		const lights: Light[] = [
			{ x: 268, y: H + 25, z: 40, r: 1, g: 0.72, b: 0.3, i: 1.5 + breath * 0.2, reach: 140 },
			{ x: 212, y: 96 + OY, z: 10, r: 1, g: 0.5, b: 0.2, i: 0.9 * flicker * (0.7 + breath * 0.6), reach: 46 },
			{ x: gap.x, y: gap.y, z: 6, r: 1, g: 0.8, b: 0.35, i: 0.45 + 0.35 * Math.sin(t / 400) + flash, reach: 26 },
		];
		const rim = { x: -0.55, y: -0.75, z: 0.35, i: 0.42 };
		const lift = Math.round(breath * 1.5);
		if (t > nextBlink) { blinkUntil = t + 140; nextBlink = t + 3000 + rand() * 3500; }

		img.data.fill(0);
		bimg.data.fill(0);
		for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
			const sy = y + lift;
			if (sy >= H) continue;
			const si = sy * W + x;
			const id = mask[si];
			if (id === NONE) continue;
			const i = y * W + x;
			const dither = BAYER[(y % 4) * 4 + (x % 4)];
			if (id === MOUTH) {
				const k = Math.max(0, Math.min(6, Math.round(2 + flicker * 3 + dither)));
				put(img.data, i, GOLD_RGB[k]);
				if (k >= 4) put(bimg.data, i, GOLD_RGB[k]);
				continue;
			}
			if (id === EYE) {
				const rgb = t < blinkUntil ? BODY_RGB[4] : (x === 180 + OX ? BODY_RGB[0] : GOLD_RGB[6]);
				put(img.data, i, rgb);
				if (t >= blinkUntil) put(bimg.data, i, GOLD_RGB[5]);
				continue;
			}
			let light = 0.06;
			const n0 = nx[si], n1 = ny[si], n2 = nz[si];
			for (const L of lights) {
				const dx = L.x - x, dy = L.y - sy, dz = L.z;
				const d = Math.hypot(dx, dy, dz);
				const ndl = Math.max(0, (n0 * dx + n1 * dy + n2 * dz) / d);
				light += L.i * ndl / (1 + (d / L.reach) ** 2);
			}
			light += rim.i * Math.max(0, n0 * rim.x + n1 * rim.y + n2 * rim.z) * (dist[si] <= 2 ? 1 : 0.25);
			const isHorn = id === HORNS || id === TEETH;
			const tones = isHorn ? HORN_RGB : BODY_RGB;
			let k = light * (tones.length - 1) * 0.9 + dither;
			if (id === NECK) {
				const s = scaleAt(x, sy);
				if (s.cx === GAP.cx && s.cy === GAP.cy) {
					const glow = 0.5 + 0.5 * Math.sin(t / 400) + flash * 3;
					const g = Math.max(0, Math.min(6, Math.round(glow * 3 + dither)));
					put(img.data, i, g < 1 ? BODY_RGB[0] : GOLD_RGB[g]);
					if (g >= 4) put(bimg.data, i, GOLD_RGB[g]);
					continue;
				}
				if (s.rim) k -= 2.2; else if (s.top) k += 0.8;
			}
			const idx = Math.max(0, Math.min(tones.length - 1, Math.round(k)));
			put(img.data, i, tones[idx]);
			if (!isHorn && idx >= BODY.length - 2) put(bimg.data, i, tones[idx], 160);
		}

		// The hoard.
		for (const c of coins) {
			const x = Math.round(c.x), y = Math.round(c.y);
			if (y >= H || x < 0 || x >= W) continue;
			const near = Math.max(0, 1 - Math.hypot(x - 268, y - H - 20) / 150 * 0.8);
			const tw = Math.sin(t / 300 + c.tw) > 0.985;
			const k = tw ? 6 : Math.max(0, Math.min(5, Math.round(near * 5.5 + BAYER[(y % 4) * 4 + (x % 4)])));
			for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1]]) {
				const px = x + dx, py = y + dy;
				if (px < 0 || px >= W || py >= H) continue;
				put(img.data, py * W + px, GOLD_RGB[dy ? Math.max(0, k - 2) : k]);
			}
			if (tw) for (const [dx, dy] of [[0, -1], [0, -2], [2, 0], [-2, 0]]) {
				const px = x + dx, py = y + dy;
				if (px >= 0 && px < W && py >= 0) { put(img.data, py * W + px, GOLD_RGB[6]); put(bimg.data, py * W + px, GOLD_RGB[6]); }
			}
		}

		// Embers from the hoard and the mouth, smoke from the nostril, and now and then
		// a spark that tries the gap in the scales and is put out.
		if (!reduced) {
			if (rand() < 0.35) particles.push({ x: 150 + rand() * 234, y: H - 12, vx: (rand() - 0.5) * 0.15, vy: -0.15 - rand() * 0.25, life: 0, max: 200 + rand() * 200, kind: 'ember' });
			if (rand() < 0.08) particles.push({ x: 126 + OX, y: 80 + OY + lift, vx: -0.08, vy: -0.12, life: 0, max: 160, kind: 'smoke' });
			if (t > nextSpark) {
				nextSpark = t + 5200 + rand() * 3000;
				particles.push({ x: gap.x - 70, y: gap.y + 40, vx: 0, vy: 0, life: 0, max: 90, kind: 'spark' });
			}
		}
		flash *= 0.9;
		for (let p = particles.length - 1; p >= 0; p--) {
			const q = particles[p];
			q.life++;
			if (q.kind === 'spark') {
				const k = q.life / q.max;
				q.x = gap.x - 70 * (1 - k); q.y = gap.y + lift + 40 * (1 - k) - Math.sin(k * Math.PI) * 18;
				if (q.life >= q.max) { flash = 0.6; burst(q.x, q.y); particles.splice(p, 1); continue; }
			} else {
				q.x += q.vx + Math.sin((q.life + q.x) / 30) * 0.08; q.y += q.vy;
			}
			if (q.life > q.max || q.y < 0) { particles.splice(p, 1); continue; }
			const x = Math.round(q.x), y = Math.round(q.y);
			if (x < 0 || x >= W || y < 0 || y >= H) continue;
			const fade = 1 - q.life / q.max;
			if (q.kind === 'smoke') {
				const a = Math.round(70 * fade);
				for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(img.data, (y + dy) * W + x + dx, [90, 80, 70], a);
			} else {
				const rgb = GOLD_RGB[q.kind === 'spark' ? 6 : Math.max(3, Math.round(fade * 6))];
				put(img.data, y * W + x, rgb);
				put(bimg.data, y * W + x, rgb);
			}
		}
		ctx.putImageData(img, 0, 0);
		bctx.putImageData(bimg, 0, 0);
	}

	function burst(x: number, y: number) {
		for (let k = 0; k < 10; k++) {
			const a = (k / 10) * Math.PI * 2;
			particles.push({ x, y, vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.6, life: 0, max: 22, kind: 'ember' });
		}
	}

	// Depth: layers drift at different rates under the pointer.
	const layers: [HTMLElement, number][] = [[bg, 6], [main, 2], [bloom, 2], [fg, 14]];
	if (!reduced) root.addEventListener('pointermove', (e) => {
		const r = root.getBoundingClientRect();
		const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
		for (const [el, depth] of layers) el.style.translate = `${-px * depth}px ${-py * depth}px`;
	});

	if (reduced) { frame(1200); return; }
	let raf = 0, last = 0;
	const loop = (t: number) => {
		if (t - last > 33) { frame(t); last = t; }
		raf = requestAnimationFrame(loop);
	};
	new IntersectionObserver(([e]) => {
		if (e.isIntersecting) raf = requestAnimationFrame(loop); else cancelAnimationFrame(raf);
	}).observe(root);
}
