// Two pixel buildings side by side. Once on screen, shortcuts land on both:
// on the left they stay, and the cracks spread to the neighbours; on the right each
// one is refused with a gold flash and the window stays lit. An illustration, not data.

const W = 192;
const H = 112;
const COLS = 4;
const ROWS = 6;
const WIN_W = 9;
const WIN_H = 8;

const STONE = ['#140f0c', '#1e1712', '#2a211a', '#3a2e24'];
const LIT = ['#c98a26', '#ffbf3f', '#ffd36b'];
const DARK = '#0a0807';

// The order in which windows are hit: a first break, then its neighbours, then outward.
function spreadOrder() {
	const start = 2 * COLS + 1;
	const order: number[] = [start];
	const seen = new Set(order);
	for (let i = 0; i < order.length; i++) {
		const c = order[i] % COLS, r = Math.floor(order[i] / COLS);
		for (const [dc, dr] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
			const nc = c + dc, nr = r + dr;
			const n = nr * COLS + nc;
			if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS && !seen.has(n)) { seen.add(n); order.push(n); }
		}
	}
	return order;
}

export function mountEntropy(root: HTMLElement) {
	const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext('2d')!;
	const order = spreadOrder();
	const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
	const px = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

	function building(ox: number, hits: number, guarded: boolean, t: number) {
		const bw = COLS * (WIN_W + 6) + 6, bh = ROWS * (WIN_H + 5) + 14;
		const by = H - bh - 6;
		// Facade, roof line and door; the left one darkens with grime as it decays.
		const grime = guarded ? 0 : Math.min(1, hits / order.length);
		px(ox, by, bw, bh, STONE[grime > 0.6 ? 0 : grime > 0.3 ? 1 : 2]);
		px(ox - 2, by - 3, bw + 4, 3, STONE[3]);
		for (let y = by + 4; y < by + bh; y += 6) px(ox, y, bw, 1, STONE[grime > 0.5 ? 0 : 1]);
		px(ox + bw / 2 - 4, H - 6 - 10, 8, 10, DARK);
		for (let i = 0; i < COLS * ROWS; i++) {
			const c = i % COLS, r = Math.floor(i / COLS);
			const x = ox + 6 + c * (WIN_W + 6), y = by + 6 + r * (WIN_H + 5);
			const step = order.indexOf(i);
			const hit = step < hits;
			if (!hit || guarded) {
				const flicker = (Math.sin(t / 700 + i * 1.7) > 0.92) ? 0 : 1;
				px(x, y, WIN_W, WIN_H, LIT[1 + flicker]);
				px(x, y, WIN_W, 1, LIT[0]);
				px(x + 4, y, 1, WIN_H, LIT[0]);
				// The window most recently attacked flashes gold where the gate refused it.
				if (guarded && hit && step >= hits - 2) {
					ctx.strokeStyle = '#fff3c4';
					ctx.lineWidth = 1;
					ctx.strokeRect(x - 1.5, y - 1.5, WIN_W + 3, WIN_H + 3);
				}
				continue;
			}
			// A broken window: dark, a jagged crack, shards on the sill.
			px(x, y, WIN_W, WIN_H, DARK);
			const seed = i * 7;
			for (let k = 0; k < WIN_H; k++) px(x + 2 + ((k * 3 + seed) % 5), y + k, 1, 1, '#4a3a2c');
			px(x + 1, y + WIN_H, 2, 1, '#6e5a44');
			px(x + WIN_W - 3, y + WIN_H, 1, 1, '#6e5a44');
		}
	}

	function frame(p: number, t: number) {
		ctx.clearRect(0, 0, W, H);
		px(0, H - 6, W, 6, STONE[1]);
		const hits = Math.round(p * order.length);
		building(14, hits, false, t);
		building(W - 14 - (COLS * (WIN_W + 6) + 6), hits, true, t);
	}

	// Once on screen it plays: eight seconds of decay, a pause, then it starts over.
	const RUN = 8000, HOLD = 4000;
	if (reduced) { frame(1, 0); return; }
	let raf = 0, start = 0;
	const loop = (t: number) => {
		if (!start) start = t;
		const k = ((t - start) % (RUN + HOLD)) / RUN;
		frame(Math.min(1, k), t);
		raf = requestAnimationFrame(loop);
	};
	new IntersectionObserver(([e]) => {
		if (e.isIntersecting) { start = 0; raf = requestAnimationFrame(loop); } else cancelAnimationFrame(raf);
	}, { threshold: 0.5 }).observe(root);
}
