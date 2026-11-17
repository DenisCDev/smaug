const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function reveals() {
	const items = [...document.querySelectorAll<HTMLElement>('.reveal')];
	if (reduced() || !('IntersectionObserver' in window)) return;
	document.documentElement.classList.add('motion');
	const io = new IntersectionObserver((entries) => {
		for (const e of entries) {
			if (!e.isIntersecting) continue;
			const el = e.target as HTMLElement;
			const siblings = [...(el.parentElement?.querySelectorAll(':scope > .reveal') ?? [])];
			el.style.transitionDelay = `${Math.max(0, siblings.indexOf(el)) * 80}ms`;
			el.classList.add('in');
			io.unobserve(el);
		}
	}, { rootMargin: '0px 0px -10% 0px' });
	items.forEach((el) => io.observe(el));
}

// A tiny portcullis for the status bar, drawn in the status colour.
function drawGate(canvas: HTMLCanvasElement) {
	const ctx = canvas.getContext('2d')!;
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = getComputedStyle(canvas).color;
	for (const y of [2, 6]) ctx.fillRect(0, y, 12, 1);
	for (const x of [1, 4, 7, 10]) { ctx.fillRect(x, 0, 1, 9); ctx.fillRect(x, 9, 1, 1); }
}

// The demo plays a short scene per sample: the write is refused with each problem pinned
// to its line, then the agent fixes the file and the same check runs again.
function demo() {
	const term = document.querySelector<HTMLElement>('[data-terminal]');
	if (!term) return;
	const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
	const steps = [...term.querySelectorAll<HTMLButtonElement>('[data-go]')];
	let timer = 0;
	const go = (step: number) => {
		const s = term.querySelector<HTMLElement>('[data-sample]:not([hidden])')!;
		const state = step === 0 ? 'before' : 'after';
		for (const pane of s.querySelectorAll<HTMLElement>('[data-state]')) pane.hidden = pane.dataset.state !== state;
		const pane = s.querySelector<HTMLElement>(`[data-state=${state}]`)!;
		pane.querySelectorAll<HTMLCanvasElement>('[data-gate]').forEach(drawGate);
		// Restart the entrance of the pinned comments and the status, one after another.
		pane.querySelectorAll<HTMLElement>('.comment, .status').forEach((el, i) => {
			el.classList.remove('in');
			el.style.animationDelay = reduced() ? '0ms' : `${200 + i * 160}ms`;
			void el.offsetWidth;
			el.classList.add('in');
		});
		term.dataset.step = String(step);
		steps.forEach((b, i) => b.setAttribute('aria-pressed', String(i === step)));
	};
	const play = () => {
		clearTimeout(timer);
		go(0);
		if (!reduced()) timer = window.setTimeout(() => go(1), 6000);
	};
	tabs.forEach((t) => t.addEventListener('click', () => {
		for (const x of tabs) x.setAttribute('aria-selected', String(x === t));
		for (const s of term.querySelectorAll<HTMLElement>('[data-sample]')) s.hidden = s.dataset.sample !== t.dataset.tab;
		play();
	}));
	steps.forEach((b, i) => b.addEventListener('click', () => { clearTimeout(timer); go(i); }));
	term.querySelector('[data-replay]')!.addEventListener('click', play);
	go(0);
	new IntersectionObserver(([e], io) => {
		if (!e.isIntersecting) return;
		io.disconnect();
		play();
	}, { threshold: 0.4 }).observe(term);
}

function board() {
	const rows = [...document.querySelectorAll<HTMLElement>('[data-board] .row')];
	const open = (row: HTMLElement) => {
		for (const r of rows) {
			const isOpen = r === row;
			r.classList.toggle('open', isOpen);
			r.querySelector('button')!.setAttribute('aria-expanded', String(isOpen));
		}
	};
	// A mouse opens a row by pointing at it; touch and keyboard still use tap, click and focus.
	const hover = matchMedia('(hover: hover) and (pointer: fine)');
	for (const row of rows) {
		const button = row.querySelector('button')!;
		button.addEventListener('click', () => open(row));
		button.addEventListener('focus', () => open(row));
		row.addEventListener('mouseenter', () => { if (hover.matches) open(row); });
	}
}

// The install panel: a tab per platform, and Copy takes the visible command.
function install() {
	const panel = document.querySelector<HTMLElement>('[data-install]');
	if (!panel) return;
	const tabs = [...panel.querySelectorAll<HTMLButtonElement>('[data-install-tab]')];
	const blocks = [...panel.querySelectorAll<HTMLElement>('[data-install-panel]')];
	for (const tab of tabs) {
		tab.addEventListener('click', () => {
			for (const t of tabs) t.setAttribute('aria-selected', String(t === tab));
			for (const b of blocks) b.hidden = b.dataset.installPanel !== tab.dataset.installTab;
		});
	}
	const btn = panel.querySelector<HTMLButtonElement>('[data-copy]')!;
	const label = btn.textContent;
	btn.addEventListener('click', async () => {
		const visible = blocks.find((b) => !b.hidden);
		try {
			await navigator.clipboard.writeText(visible?.textContent ?? '');
			btn.textContent = btn.dataset.copied ?? '';
		} catch (err) {
			btn.textContent = btn.dataset.failed ?? '';
			console.warn('clipboard unavailable', err);
		}
		setTimeout(() => (btn.textContent = label), 1800);
	});
}

// Scroll progress of an element through the viewport: 0 as its top reaches the
// bottom of the screen, 1 as its bottom leaves the top.
const progress = (el: HTMLElement) => {
	const r = el.getBoundingClientRect();
	return Math.max(0, Math.min(1, (innerHeight - r.top) / (r.height + innerHeight)));
};

// Checkpoint cards stick and stack: as the next card slides over, the one under it
// steps back and dims.
function stack() {
	const cards = [...document.querySelectorAll<HTMLElement>('[data-stack] .card')];
	return () => {
		cards.forEach((card, i) => {
			const next = cards[i + 1];
			if (!next) { card.style.setProperty('--behind', '0'); return; }
			const gap = next.getBoundingClientRect().top - card.getBoundingClientRect().top;
			const covered = Math.max(0, Math.min(1, 1 - gap / card.offsetHeight));
			card.style.setProperty('--behind', covered.toFixed(3));
		});
	};
}

// The statement lights up word by word as its section scrolls through.
function words() {
	const section = document.querySelector<HTMLElement>('[data-words]');
	if (!section) return () => {};
	const spans = [...section.querySelectorAll<HTMLElement>('.w')];
	return () => {
		const p = Math.max(0, Math.min(1, (progress(section) - 0.18) / 0.5));
		const lit = Math.round(p * spans.length);
		spans.forEach((s, i) => s.classList.toggle('lit', i < lit));
	};
}

// Platform cards fan out the first time they come into view.
function fan() {
	const el = document.querySelector<HTMLElement>('[data-fan]');
	if (!el) return;
	new IntersectionObserver(([e], io) => {
		if (!e.isIntersecting) return;
		el.classList.add('open');
		io.disconnect();
	}, { threshold: 0.35 }).observe(el);
}

// The numbers count up once, the first time the panel is seen.
function counters() {
	const items = [...document.querySelectorAll<HTMLElement>('[data-count]')];
	if (!items.length) return;
	new IntersectionObserver(([e], io) => {
		if (!e.isIntersecting) return;
		io.disconnect();
		const start = performance.now();
		const tick = (t: number) => {
			const k = Math.min(1, (t - start) / 1200);
			const ease = 1 - (1 - k) ** 3;
			for (const el of items) el.textContent = String(Math.round(Number(el.dataset.count) * ease));
			if (k < 1) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, { threshold: 0.5 }).observe(items[0].closest('section')!);
}

export function mountPage() {
	reveals();
	demo();
	board();
	install();
	if (reduced()) {
		document.querySelector('[data-fan]')?.classList.add('open');
		document.querySelectorAll('[data-words] .w').forEach((w) => w.classList.add('lit'));
		return;
	}
	document.documentElement.classList.add('scrolly');
	fan();
	counters();
	const onScroll = [stack(), words()];
	let queued = false;
	const run = () => { queued = false; onScroll.forEach((f) => f()); };
	addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(run); } }, { passive: true });
	run();
}
