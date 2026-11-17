// Footer scene: a night lake, a town burning on its shore, the lone mountain with
// a crack of gold light, and the dragon flying in from far away. Drawn in code at
// low resolution, lit per frame, with a bloom layer on top.

import { mulberry } from './scene';

const W = 384;
const H = 168;
const SHORE = 118; // the waterline

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v / 16 - 0.5) * 0.5);
const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const SKY = ['#05060c', '#090b16', '#0e1120', '#15172b', '#211a2a', '#3a1f22', '#5c2a1c', '#8a3c18'].map(hex);
const ROCK = ['#030305', '#07070b', '#0c0b12', '#141219', '#1d1920'].map(hex);
const FIRE = ['#3a1206', '#7a2408', '#c2410c', '#f07a18', '#ffb02e', '#ffd36b', '#fff3c4'].map(hex);
const WARM = ['#120d08', '#22170b', '#3a2610', '#5c3a10', '#7a5018'].map(hex);
const GOLD = ['#5c3a10', '#c98a26', '#ffbf3f', '#ffd36b', '#fff3c4'].map(hex);
const HOUSE = hex('#050407');
const SMOKE = [40, 30, 32];

function maskOf(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
	const c = document.createElement('canvas');
	c.width = w; c.height = h;
	const ctx = c.getContext('2d', { willReadFrequently: true })!;
	ctx.fillStyle = '#fff';
	draw(ctx);
	const d = ctx.getImageData(0, 0, w, h).data;
	const m = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
	return m;
}

// Where the mountain's hidden door lets the light out.
const DOOR = { x: 268, y: 82, h: 9 };
const MOON = { x: 184, y: 50, r: 11 };

export function mountNight(root: HTMLElement) {
	const main = root.querySelector<HTMLCanvasElement>('[data-layer=main]')!;
	const bloom = root.querySelector<HTMLCanvasElement>('[data-layer=bloom]')!;
	for (const c of [main, bloom]) { c.width = W; c.height = H; }
	const ctx = main.getContext('2d')!;
	const bctx = bloom.getContext('2d')!;
	const img = ctx.createImageData(W, H);
	const bimg = bctx.createImageData(W, H);
	const rand = mulberry(11);
	const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

	const mountain = maskOf(W, H, (c) => {
		c.beginPath();
		c.moveTo(150, SHORE + 1);
		c.lineTo(196, 92); c.lineTo(214, 88); c.lineTo(236, 62); c.lineTo(250, 54);
		c.lineTo(262, 40); c.lineTo(272, 44); c.lineTo(284, 38); c.lineTo(298, 56);
		c.lineTo(318, 70); c.lineTo(336, 86); c.lineTo(362, 98); c.lineTo(384, 104); c.lineTo(384, SHORE + 1);
		c.closePath(); c.fill();
	});
	// A rough height for shading the mountain: distance below its ridge.
	const ridge = new Int16Array(W).fill(H);
	for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (mountain[y * W + x]) { ridge[x] = y; break; }

	// The town on the left shore: roofs, a tower, a hall.
	const houses: { x: number; w: number; h: number; roof: number }[] = [];
	for (let x = 8; x < 150; ) {
		const w = 5 + Math.floor(rand() * 7);
		houses.push({ x, w, h: 5 + Math.floor(rand() * 9), roof: 2 + Math.floor(rand() * 4) });
		x += w + Math.floor(rand() * 2);
	}
	houses.push({ x: 70, w: 6, h: 24, roof: 6 }, { x: 104, w: 18, h: 13, roof: 7 });
	const town = maskOf(W, H, (c) => {
		for (const hs of houses) {
			c.fillRect(hs.x, SHORE - hs.h, hs.w, hs.h + 1);
			c.beginPath();
			c.moveTo(hs.x - 1, SHORE - hs.h); c.lineTo(hs.x + hs.w / 2, SHORE - hs.h - hs.roof); c.lineTo(hs.x + hs.w + 1, SHORE - hs.h);
			c.closePath(); c.fill();
		}
		c.fillRect(0, SHORE - 2, 156, 3); // the pier
	});
	const fires = houses.filter(() => rand() < 0.45).map((hs) => ({ x: hs.x + hs.w / 2, y: SHORE - hs.h - hs.roof + 1, w: hs.w, phase: rand() * 10 }));
	const windows = houses.flatMap((hs) => (rand() < 0.6 ? [{ x: hs.x + 1 + Math.floor(rand() * Math.max(1, hs.w - 2)), y: SHORE - 2 - Math.floor(rand() * Math.max(1, hs.h - 3)) }] : []));
	const stars = Array.from({ length: 140 }, () => ({ x: Math.floor(rand() * W), y: Math.floor(rand() * 80), p: rand() * 100, b: rand() }));

	type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; kind: 'ember' | 'smoke' };
	const parts: P[] = [];

	// The dragon: drawn small into its own buffer each frame, then stamped in.
	const DW = 48, DH = 32;
	const dcan = document.createElement('canvas');
	dcan.width = DW; dcan.height = DH;
	const dctx = dcan.getContext('2d', { willReadFrequently: true })!;
	const poly = (pts: number[][]) => {
		dctx.beginPath();
		dctx.moveTo(pts[0][0], pts[0][1]);
		for (const [x, y] of pts.slice(1)) dctx.lineTo(x, y);
		dctx.closePath(); dctx.fill();
	};
	function dragonMask(flap: number) {
		dctx.clearRect(0, 0, DW, DH);
		dctx.fillStyle = '#fff';
		const cy = 20, up = 8 + flap * 7; // wings never fully level, so the shape reads as wings
		// Head and neck to the left, body, then a long tail to the right.
		poly([[1, cy - 3], [5, cy - 5], [9, cy - 5], [15, cy - 2], [22, cy - 2], [31, cy - 1], [40, cy + 1], [47, cy + 5],
			[39, cy + 3], [31, cy + 2], [22, cy + 3], [15, cy + 2], [9, cy - 1], [5, cy - 1], [1, cy - 1]]);
		// The far wing, smaller, then the near wing with a scalloped trailing edge.
		poly([[20, cy - 1], [24, cy - 2 - up * 0.8], [30, cy - 1 - up * 0.6], [28, cy]]);
		poly([[16, cy - 1], [7, cy - 3 - up * 1.3], [12, cy - 2 - up], [15, cy - up * 0.45], [19, cy - 1 - up * 0.7], [22, cy - up * 0.35], [26, cy - up * 0.5], [29, cy]]);
		// Horns.
		poly([[6, cy - 5], [9, cy - 9], [9, cy - 5]]);
		const d = dctx.getImageData(0, 0, DW, DH).data;
		const m = new Uint8Array(DW * DH);
		for (let i = 0; i < DW * DH; i++) m[i] = d[i * 4 + 3] > 110 ? 1 : 0;
		return m;
	}

	const put = (data: Uint8ClampedArray, i: number, rgb: number[], a = 255) => {
		data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = a;
	};
	const clampIdx = (v: number, n: number) => Math.max(0, Math.min(n - 1, Math.round(v)));

	function frame(t: number) {
		const flicker = 0.8 + 0.2 * Math.sin(t / 90) * Math.sin(t / 211);
		const door = 0.75 + 0.25 * Math.sin(t / 1300);
		img.data.fill(0);
		bimg.data.fill(0);

		// Sky and mountain above the waterline.
		for (let y = 0; y < SHORE; y++) for (let x = 0; x < W; x++) {
			const i = y * W + x;
			const dither = BAYER[(y % 4) * 4 + (x % 4)];
			if (mountain[i]) {
				const depth = (y - ridge[x]) / 60;
				const fireLit = Math.max(0, 1 - Math.hypot(x - 80, y - SHORE) / 200) * flicker;
				const doorLit = Math.max(0, 1 - Math.hypot(x - DOOR.x, (y - DOOR.y - 4) * 0.7) / 17) * door;
				if (doorLit * 3 + dither * 1.5 > 0.9) {
					put(img.data, i, WARM[clampIdx(doorLit * 4.5 - 0.8 + dither, WARM.length)]);
					continue;
				}
				let k = 1.2 - depth + fireLit * 1.6 + dither * 2;
				if (y - ridge[x] < 2) k += x < 272 ? 1.6 : 1; // rim lit by the moon and the burning town
				put(img.data, i, ROCK[clampIdx(k, ROCK.length)]);
				continue;
			}
			const md = Math.hypot(x - MOON.x, y - MOON.y);
			if (md <= MOON.r) {
				const crater = Math.sin(x * 1.7) * Math.sin(y * 2.3) > 0.55 ? 1 : 0;
				const rgb = md > MOON.r - 1.2 ? [196, 190, 170] : crater ? [206, 198, 176] : [236, 230, 210];
				put(img.data, i, rgb); put(bimg.data, i, rgb, 120);
				continue;
			}
			const halo = Math.max(0, 1 - (md - MOON.r) / 40);
			const glow = Math.max(0, 1 - Math.hypot((x - 80) / 160, (y - SHORE) / 70)) * flicker;
			const k = 0.4 + (y / SHORE) * 2 + glow * 5.5 + halo * 2.2 + dither * 1.6;
			put(img.data, i, glow > halo ? SKY[clampIdx(k, SKY.length)] : [SKY[clampIdx(k, SKY.length)][0] + halo * 18, SKY[clampIdx(k, SKY.length)][1] + halo * 20, SKY[clampIdx(k, SKY.length)][2] + halo * 26]);
		}
		for (const s of stars) {
			const i = s.y * W + s.x;
			if (mountain[i]) continue;
			const tw = 0.5 + 0.5 * Math.sin(t / 700 + s.p);
			if (tw * s.b > 0.35) put(img.data, i, tw * s.b > 0.7 ? [230, 226, 210] : [120, 118, 130]);
		}
		// The crack in the mountain and the light it lets out.
		for (let k = 0; k < DOOR.h; k++) {
			const i = (DOOR.y + k) * W + DOOR.x;
			const rgb = GOLD[clampIdx(1.5 + door * 1.5, GOLD.length)];
			put(img.data, i, rgb); put(bimg.data, i, rgb);
		}
		// A soft halo where the light leaves the crack.
		for (let y = DOOR.y - 5; y < DOOR.y + DOOR.h + 5; y++) for (let x = DOOR.x - 4; x <= DOOR.x + 4; x++) {
			const d = Math.hypot(x - DOOR.x, (y - DOOR.y - DOOR.h / 2) * 0.5) / 4;
			if (d < 1) put(bimg.data, y * W + x, GOLD[2], Math.round(150 * door * (1 - d)));
		}

		// The town, its lit windows and the fires on its roofs.
		for (let y = 0; y < SHORE + 2; y++) for (let x = 0; x < 160; x++) {
			const i = y * W + x;
			if (town[i]) put(img.data, i, HOUSE);
		}
		for (const w of windows) {
			const rgb = FIRE[clampIdx(3 + flicker * 2 + Math.sin(t / 130 + w.x), FIRE.length)];
			put(img.data, w.y * W + w.x, rgb); put(bimg.data, w.y * W + w.x, rgb);
		}
		for (const f of fires) {
			for (let k = 0; k < 9; k++) {
				const hgt = (3 + Math.sin(t / 80 + f.phase + k) * 2 + (k % 3)) | 0;
				const x = Math.round(f.x - f.w / 2 + (k * f.w) / 8);
				for (let dy = 0; dy < hgt; dy++) {
					const y = f.y - dy + 2;
					if (y < 0) continue;
					const rgb = FIRE[clampIdx(6 - dy * 1.3 + flicker, FIRE.length)];
					put(img.data, y * W + x, rgb); put(bimg.data, y * W + x, rgb);
				}
			}
			if (!reduced && rand() < 0.25) parts.push({ x: f.x + (rand() - 0.5) * f.w, y: f.y - 3, vx: (rand() - 0.3) * 0.2, vy: -0.25 - rand() * 0.3, life: 0, max: 60 + rand() * 90, kind: 'ember' });
			if (!reduced && rand() < 0.2) parts.push({ x: f.x, y: f.y - 4, vx: 0.12 + rand() * 0.1, vy: -0.2, life: 0, max: 220, kind: 'smoke' });
		}

		// Far off, the dragon circles the peak in a slow orbit with no start or end: a
		// little larger on the near side, hidden by the mountain on the far side.
		{
			const theta = (t / 42000) * Math.PI * 2;
			const near = Math.sin(theta);
			const dx = 214 + Math.cos(theta) * 50;
			const dy = 44 + near * 8 + Math.sin(theta * 2) * 1.5;
			const scale = 0.45 + (near + 1) * 0.12;
			const headingRight = Math.sin(theta) < 0; // the sign of the x velocity
			const flap = Math.sin(t / 170);
			const m = dragonMask(flap);
			// Sample the mask for each screen pixel so an enlarged dragon has no holes.
			const at = (mx: number, my: number) => mx >= 0 && mx < DW && my >= 0 && my < DH && m[my * DW + mx] === 1;
			const x0 = Math.floor(dx - (DW / 2) * scale), y0 = Math.floor(dy - (DH / 2) * scale);
			for (let sy = y0; sy < y0 + DH * scale + 1; sy++) for (let sx = x0; sx < x0 + DW * scale + 1; sx++) {
				// The mask faces left; mirror it so the head always leads.
				const mx = Math.floor((sx - dx) / scale + DW / 2);
				const x = headingRight ? DW - 1 - mx : mx, y = Math.floor((sy - dy) / scale + DH / 2);
				if (!at(x, y) || sx < 0 || sx >= W || sy < 0 || sy >= SHORE) continue;
				if (near < 0 && mountain[sy * W + sx]) continue;
				const back = !at(x, Math.floor((sy - 1 - dy) / scale + DH / 2));
				put(img.data, sy * W + sx, back ? [62, 60, 76] : [6, 5, 8]);
			}
		}

		for (let n = parts.length - 1; n >= 0; n--) {
			const q = parts[n];
			q.life++; q.x += q.vx; q.y += q.vy;
			if (q.kind === 'smoke') q.vx += 0.002;
			if (q.life > q.max || q.y < 0 || q.y >= SHORE || q.x < 0 || q.x >= W) { parts.splice(n, 1); continue; }
			const x = Math.round(q.x), y = Math.round(q.y), i = y * W + x;
			const fade = 1 - q.life / q.max;
			if (q.kind === 'smoke') {
				const a = Math.round(120 * fade);
				for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0]]) {
					const j = (y + oy) * W + x + ox;
					if (j >= 0 && j < SHORE * W && !mountain[j]) {
						const o = j * 4, s = a / 255;
						img.data[o] = img.data[o] * (1 - s) + SMOKE[0] * s;
						img.data[o + 1] = img.data[o + 1] * (1 - s) + SMOKE[1] * s;
						img.data[o + 2] = img.data[o + 2] * (1 - s) + SMOKE[2] * s;
					}
				}
			} else {
				const rgb = FIRE[clampIdx(2 + fade * 4, FIRE.length)];
				put(img.data, i, rgb); put(bimg.data, i, rgb);
			}
		}

		// The lake mirrors everything above the shore, broken by ripples.
		for (let y = SHORE + 1; y < H; y++) {
			const depth = y - SHORE;
			const srcY = SHORE - depth;
			if (srcY < 0) break;
			for (let x = 0; x < W; x++) {
				const ripple = Math.round(Math.sin(y * 0.9 + t / 300 + x * 0.05) * Math.min(3, depth / 10));
				const sx = Math.max(0, Math.min(W - 1, x + ripple));
				const si = (srcY * W + sx) * 4, di = (y * W + x) * 4;
				const dim = 0.42 - depth / (H - SHORE) * 0.2 + (BAYER[(y % 4) * 4 + (x % 4)] * 0.08);
				img.data[di] = img.data[si] * dim; img.data[di + 1] = img.data[si + 1] * dim; img.data[di + 2] = img.data[si + 2] * dim + 4;
				img.data[di + 3] = 255;
				if (bimg.data[si + 3] && ((y + (t / 120 | 0)) % 3)) {
					bimg.data[di] = bimg.data[si]; bimg.data[di + 1] = bimg.data[si + 1]; bimg.data[di + 2] = bimg.data[si + 2];
					bimg.data[di + 3] = bimg.data[si + 3] * 0.45;
				}
			}
		}
		ctx.putImageData(img, 0, 0);
		bctx.putImageData(bimg, 0, 0);
	}

	if (reduced) { frame(13000); return; }
	let raf = 0, last = 0;
	const loop = (t: number) => {
		if (t - last > 33) { frame(t); last = t; }
		raf = requestAnimationFrame(loop);
	};
	new IntersectionObserver(([e]) => {
		if (e.isIntersecting) raf = requestAnimationFrame(loop); else cancelAnimationFrame(raf);
	}).observe(root);
}
