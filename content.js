let cachedSolution = null;
let cachedGame = null;
let cachedBoardHash = null;

function getBoardHash(board) {
	return JSON.stringify(board);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === 'SOLVE') handleSolve(true).then(sendResponse);
	if (message.type === 'GET_GAME') sendResponse({ game: detectGame() });
	return true;
});
chrome.storage.sync.get(['enabled', 'autoSolve'], ({ enabled, autoSolve }) => {
	if (!enabled || !autoSolve) return;
	waitForBoard()
		.then(() => handleSolve())
		.catch((err) => console.warn('[Solver] Auto-solve failed:', err));
});

// Auto-highlight on page load (without solving)
waitForBoard()
	.then(() => handleSolve(false))
	.catch((err) => console.warn('[Solver] Highlight failed:', err));

function detectGame() {
	const url = window.location.href;
	if (url.includes('queens')) return 'queens';
	if (url.includes('tango')) return 'tango';
	if (url.includes('zip')) return 'zip';
	if (url.includes('sudoku')) return 'sudoku';
	return null;
}

function waitForBoard(timeout = 5000) {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const interval = setInterval(() => {
			if (isBoardReady()) {
				clearInterval(interval);
				resolve();
			}
			if (Date.now() - start > timeout) {
				clearInterval(interval);
				reject('Board not found');
			}
		}, 200);
	});
}

function isBoardReady() {
	const game = detectGame();
	if (game === 'tango') return !!document.querySelector('[data-testid="interactive-grid"]');
	if (game === 'queens') return !!document.querySelector('[data-testid="interactive-grid"]');
	if (game === 'zip') return !!document.querySelector('[data-testid="zip-game-container"]');
	if (game === 'sudoku') return !!document.querySelector('[data-sudoku-grid="true"]');

	return false;
}

async function handleSolve(forceSolve = false) {
	const game = detectGame();
	if (!game) {
		return {
			success: false,
			error: 'No game detected',
		};
	}

	try {
		await waitForBoard();

		const settings = await getSettings();

		if (!settings.enabled) {
			return {
				success: false,
				error: 'Solver disabled',
			};
		}

		if (!settings.games[game]) {
			return {
				success: false,
				error: `${game} solver disabled`,
			};
		}

		const board = scrapeBoard(game);
		const boardHash = getBoardHash(board);

		let result = null;

		// reuse cached solution if same board
		const canReuse = cachedSolution && cachedGame === game && cachedBoardHash === boardHash;

		if (canReuse) {
			result = cachedSolution;
		} else {
			const solveStart = performance.now();

			result = solveGame(game, board);

			const solveTime = performance.now() - solveStart;

			console.log(`[Solver] solved in ${solveTime.toFixed(1)}ms`);

			if (!result) {
				return {
					success: false,
					error: 'No solution found',
				};
			}

			// save cache
			cachedSolution = result;
			cachedGame = game;
			cachedBoardHash = boardHash;
		}

		// highlight immediately
		if (settings.highlight) {
			highlightSolution(game, result);
		}

		// don't click unless autosolve or button press
		if (!settings.autoSolve && !forceSolve) {
			return {
				success: true,
				highlighted: true,
			};
		}

		await applySolution(game, result, settings);

		return { success: true };
	} catch (e) {
		console.error('[Solver] Error:', e);

		return {
			success: false,
			error: e.toString(),
		};
	}
}

function getSettings() {
	return new Promise((resolve) => {
		chrome.storage.sync.get(
			{
				enabled: true,
				autoSolve: false,
				highlight: true,
				jitter: true,
				speed: 2,
				games: { queens: true, tango: true, zip: true, sudoku: true },
			},
			(s) => resolve({ ...s, speed: [50, 100, 250, 500, 1000][s.speed] }),
		);
	});
}

function scrapeBoard(game) {
	if (game === 'queens') return scrapeQueens();
	if (game === 'tango') return scrapeTango();
	if (game === 'zip') return scrapeZip();
	if (game === 'sudoku') return scrapeSudoku();
}

function scrapeTango() {
	const grid = document.querySelector('[data-testid="interactive-grid"]');
	const cellEls = grid.querySelectorAll('[data-testid^="cell-"][role="button"]');
	const size = Math.round(Math.sqrt(cellEls.length));
	const cells = Array.from({ length: size }, () => Array(size).fill(0));
	const constraints = [];

	cellEls.forEach((cellEl) => {
		// row/col from a11y span: id="tango-cell-position-a11y-text-ROW-COL"
		const a11y = cellEl.querySelector('[id^="tango-cell-position-a11y-text-"]');
		if (!a11y) return;
		const parts = a11y.id.match(/(\d+)-(\d+)$/);
		if (!parts) return;
		const row = parseInt(parts[1]);
		const col = parseInt(parts[2]);

		// cell value from SVG aria-label: "Sun" = 1, "Moon" = 2, "Empty" = 0
		const valueSvg = cellEl.querySelector('svg[data-testid="cell-zero"], svg[data-testid="cell-one"]');
		if (valueSvg) {
			cells[row][col] = valueSvg.getAttribute('aria-label') === 'Sun' ? 1 : 2;
		}

		// constraints — edge marker SVGs inside ._83d57617 wrapper
		// _5fcd6a0b = right edge  → constraint with cell to the right [row, col+1]
		// _64a25184 = bottom edge → constraint with cell below        [row+1, col]
		const edgeSvgs = cellEl.querySelectorAll('svg[data-testid="edge-equal"], svg[data-testid="edge-cross"]');
		edgeSvgs.forEach((edgeSvg) => {
			const type = edgeSvg.getAttribute('data-testid') === 'edge-equal' ? 0 : 1;
			const wrapper = edgeSvg.closest('._83d57617');
			if (!wrapper) return;

			if (wrapper.classList.contains('_5fcd6a0b')) {
				// right edge
				constraints.push({ a: [row, col], b: [row, col + 1], type });
			} else if (wrapper.classList.contains('_64a25184')) {
				// bottom edge
				constraints.push({ a: [row, col], b: [row + 1, col], type });
			}
		});
	});

	return { size, cells, constraints };
}

function scrapeQueens() {
	const grid = document.querySelector('[data-testid="interactive-grid"]');

	if (!grid) {
		throw new Error('Queens grid not found');
	}

	const cellEls = [...grid.querySelectorAll('[data-cell-idx]')];

	const size = Math.round(Math.sqrt(cellEls.length));

	// region matrix
	const regions = Array.from({ length: size }, () => Array(size).fill(0));

	// queens[row] = col
	const queens = Array(size).fill(-1);

	// map region names/colors -> numeric ids
	const regionMap = new Map();

	let nextRegionId = 1;

	for (const cell of cellEls) {
		const idx = Number(cell.dataset.cellIdx);

		const row = Math.floor(idx / size);
		const col = idx % size;

		const label = cell.getAttribute('aria-label') || '';

		// extract region/color name
		// example aria-label usually contains:
		// "Row 1 Column 2 color blue"
		const regionMatch = label.match(/color ([^,]+)/i);

		const regionName = regionMatch ? regionMatch[1].trim().toLowerCase() : 'unknown';

		// assign stable numeric region ids
		if (!regionMap.has(regionName)) {
			regionMap.set(regionName, nextRegionId++);
		}

		regions[row][col] = regionMap.get(regionName);

		// existing queen
		if (/queen/i.test(label)) {
			queens[row] = col;
		}
	}

	return {
		size,
		regions,
		queens,
	};
}

function scrapeZip() {
	const gridEl = document.querySelector('[data-testid="interactive-grid"]');

	if (!gridEl) return null;

	const cellEls = gridEl.querySelectorAll('[data-cell-idx]');

	const size = Math.round(Math.sqrt(cellEls.length));

	const grid = Array.from({ length: size }, () => Array(size).fill(0));

	cellEls.forEach((cell) => {
		const idx = parseInt(cell.dataset.cellIdx);

		const row = Math.floor(idx / size);
		const col = idx % size;

		const content = cell.querySelector('[data-cell-content]');

		if (content) {
			const value = parseInt(content.textContent.trim());

			grid[row][col] = Number.isNaN(value) ? 0 : value;
		}
	});

	return {
		size,
		cells: grid,
		walls: [],
	};
}

function scrapeSudoku() {
	const grid = document.querySelector('[data-sudoku-grid="true"]');
	if (!grid) return null;

	const cellEls = grid.querySelectorAll('.sudoku-cell');

	const size = 6;
	const board = Array.from({ length: size }, () => Array(size).fill(0));

	cellEls.forEach((cell) => {
		const idx = parseInt(cell.dataset.cellIdx);

		const row = Math.floor(idx / size);
		const col = idx % size;

		const content = cell.querySelector('.sudoku-cell-content');

		const value = parseInt(content?.textContent?.trim());

		board[row][col] = Number.isNaN(value) ? 0 : value;
	});

	return board;
}

function solveGame(game, board) {
	if (game === 'queens') {
		const solved = queensSolver.solve(board);

		if (!solved) return null;

		// solver mutates board.queens
		return {
			size: board.size,
			queens: [...board.queens],
		};
	}
	if (game === 'tango') return tangoSolver.solve(board);
	if (game === 'zip') return zipSolver.solve(board);
	if (game === 'sudoku') {
		const copy = board.map((r) => [...r]);
		const solved = sudokuSolver.solve(copy);
		return solved ? copy : null;
	}
}

function highlightSolution(game, result) {
	if (game === 'queens') {
		// clear old highlights
		document.querySelectorAll('.solver-queen-overlay').forEach((el) => el.remove());

		// solver may return raw array OR object
		const queens = Array.isArray(result) ? result : result.queens;

		if (!queens) {
			console.error('[Queens] Invalid result:', result);
			return;
		}

		queens.forEach((col, row) => {
			if (col < 0) return;

			const cell = getCellElement(row, col);

			if (!cell) {
				console.warn('[Queens] Missing cell:', row, col);
				return;
			}

			cell.style.position = 'relative';

			const overlay = document.createElement('div');

			overlay.className = 'solver-queen-overlay';

			Object.assign(overlay.style, {
				position: 'absolute',
				inset: '3px',
				borderRadius: '10px',
				background: 'rgba(34,197,94,0.12)',
				boxShadow: 'inset 0 0 0 3px rgba(34,197,94,0.95)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				pointerEvents: 'none',
				zIndex: '9999',
			});

			overlay.innerHTML = `
			<div style="
				font-size:20px;
				font-weight:700;
				color:#22c55e;
			">
				♛
			</div>
		`;

			cell.appendChild(overlay);
		});
	}
	if (game === 'tango') {
		const SUN = 1;
		const MOON = 2;

		// remove old highlights first
		document.querySelectorAll('.solver-highlight').forEach((el) => el.remove());

		for (let r = 0; r < result.size; r++) {
			for (let c = 0; c < result.size; c++) {
				const cell = getCellElement(r, c);
				if (!cell) continue;

				// skip prefilled cells
				if (cell.getAttribute('aria-disabled') === 'true') continue;

				const val = result.cells[r][c];
				if (!val) continue;

				// make sure cell can contain absolute child
				cell.style.position = 'relative';

				// create overlay
				const overlay = document.createElement('div');
				overlay.className = 'solver-highlight';

				overlay.style.position = 'absolute';
				overlay.style.inset = '4px';
				overlay.style.borderRadius = '8px';
				overlay.style.pointerEvents = 'none';
				overlay.style.zIndex = '999';

				if (val === SUN) {
					overlay.style.boxShadow = 'inset 0 0 0 3px rgba(245,158,11,0.9)';
					overlay.style.background = 'rgba(245,158,11,0.10)';
				} else if (val === MOON) {
					overlay.style.boxShadow = 'inset 0 0 0 3px rgba(99,102,241,0.9)';
					overlay.style.background = 'rgba(99,102,241,0.10)';
				}

				cell.appendChild(overlay);
			}
		}
	}
	if (game === 'zip') {
		// clear old zip highlights
		document.querySelectorAll('.solver-zip-overlay').forEach((el) => el.remove());

		// result is ordered path coordinates
		result.forEach(([row, col], index) => {
			const cell = getCellElement(row, col);
			if (!cell) return;

			cell.style.position = 'relative';

			const overlay = document.createElement('div');
			overlay.className = 'solver-zip-overlay';

			Object.assign(overlay.style, {
				position: 'absolute',
				inset: '3px',
				border: '3px solid rgba(59,130,246,0.9)',
				borderRadius: '10px',
				pointerEvents: 'none',
				zIndex: '50',
				boxSizing: 'border-box',
			});

			cell.appendChild(overlay);

			// connection line to next point
			const next = result[index + 1];
			if (!next) return;

			const [nextRow, nextCol] = next;

			const line = document.createElement('div');
			line.className = 'solver-zip-overlay';

			Object.assign(line.style, {
				position: 'absolute',
				background: 'rgba(59,130,246,0.9)',
				pointerEvents: 'none',
				zIndex: '40',
				transformOrigin: 'left center',
			});

			const dx = nextCol - col;
			const dy = nextRow - row;

			const length = Math.sqrt(dx * dx + dy * dy) * cell.offsetWidth;

			const angle = Math.atan2(dy, dx) * (180 / Math.PI);

			line.style.width = `${length}px`;
			line.style.height = '6px';
			line.style.left = `${cell.offsetWidth / 2}px`;
			line.style.top = `${cell.offsetHeight / 2 - 3}px`;
			line.style.transform = `rotate(${angle}deg)`;

			cell.appendChild(line);
		});
	}
	if (game === 'sudoku') {
		// clear old highlights
		document.querySelectorAll('.solver-sudoku-overlay').forEach((el) => el.remove());

		for (let r = 0; r < 6; r++) {
			for (let c = 0; c < 6; c++) {
				const cell = getCellElement(r, c);
				if (!cell) continue;

				// don't touch prefilled cells
				if (cell.classList.contains('sudoku-cell-prefilled')) {
					continue;
				}

				const solvedValue = result[r][c];
				if (!solvedValue) continue;

				cell.style.position = 'relative';

				// subtle cell highlight
				const overlay = document.createElement('div');

				overlay.className = 'solver-sudoku-overlay';

				Object.assign(overlay.style, {
					position: 'absolute',
					inset: '2px',
					borderRadius: '6px',
					background: 'rgba(59,130,246,0.10)',
					boxShadow: 'inset 0 0 0 2px rgba(59,130,246,0.75)',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontSize: '28px',
					fontWeight: '700',
					color: '#60a5fa',
					pointerEvents: 'none',
					zIndex: '20',
					fontFamily: 'var(--artdeco-font-family-sans)',
				});

				// show solved number
				overlay.textContent = String(solvedValue);

				cell.appendChild(overlay);
			}
		}
	}
}

async function applySolution(game, result, settings) {
	if (game === 'queens') await applyQueens(result, settings);
	if (game === 'tango') await applyTango(result, settings);
	if (game === 'zip') await applyZip(result, settings);
	if (game === 'sudoku') await applySudoku(result, settings);
}

async function applyQueens(board, settings) {
	for (let row = 0; row < board.size; row++) {
		await clickCell(row, board.queens[row], settings);
	}
}

async function applyTango(board, settings) {
	// only click empty cells — prefilled ones (aria-disabled="true") can't be clicked
	const grid = document.querySelector('[data-testid="interactive-grid"]');
	const cellEls = grid.querySelectorAll('[data-testid^="cell-"][role="button"]');

	for (const cellEl of cellEls) {
		// skip prefilled cells
		if (cellEl.getAttribute('aria-disabled') === 'true') continue;

		const a11y = cellEl.querySelector('[id^="tango-cell-position-a11y-text-"]');
		if (!a11y) continue;
		const parts = a11y.id.match(/(\d+)-(\d+)$/);
		if (!parts) continue;
		const row = parseInt(parts[1]);
		const col = parseInt(parts[2]);

		const target = board.cells[row][col]; // 1 = SUN, 2 = MOON
		if (target === 0) continue;

		const rect = cellEl.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		const realTarget = document.elementFromPoint(x, y);
		const baseOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true };
		const cellStart = performance.now();

		if (target === 1) {
			// SUN: one left click (empty -> sun)
			realTarget.dispatchEvent(new PointerEvent('pointerover', baseOpts));
			realTarget.dispatchEvent(new PointerEvent('pointerenter', baseOpts));
			realTarget.dispatchEvent(new PointerEvent('pointerdown', baseOpts));
			realTarget.dispatchEvent(new MouseEvent('mousedown', { ...baseOpts, button: 0, buttons: 1 }));
			realTarget.dispatchEvent(new PointerEvent('pointerup', baseOpts));
			realTarget.dispatchEvent(new MouseEvent('mouseup', { ...baseOpts, button: 0, buttons: 0 }));
			realTarget.dispatchEvent(new MouseEvent('click', { ...baseOpts, button: 0, buttons: 0 }));
		} else {
			// MOON: right-click (empty -> moon directly)
			const rightOpts = { ...baseOpts, button: 2, buttons: 2 };
			realTarget.dispatchEvent(new PointerEvent('pointerover', baseOpts));
			realTarget.dispatchEvent(new PointerEvent('pointerenter', baseOpts));
			realTarget.dispatchEvent(new PointerEvent('pointerdown', rightOpts));
			realTarget.dispatchEvent(new MouseEvent('mousedown', rightOpts));
			realTarget.dispatchEvent(new PointerEvent('pointerup', rightOpts));
			realTarget.dispatchEvent(new MouseEvent('mouseup', rightOpts));
			realTarget.dispatchEvent(new MouseEvent('contextmenu', rightOpts));
		}

		const elapsed = performance.now() - cellStart;
		await sleep(Math.max(30, settings.speed - elapsed));
	}
}

async function applyZip(path, settings) {
	if (!path?.length) return;

	const first = getCellElement(path[0][0], path[0][1]);

	if (!first) return;

	// focus starting cell
	first.focus();
	first.click();

	await sleep(50);

	for (let i = 1; i < path.length; i++) {
		const [pr, pc] = path[i - 1];
		const [r, c] = path[i];

		const dr = r - pr;
		const dc = c - pc;

		let key = null;

		if (dr === -1) key = 'ArrowUp';
		else if (dr === 1) key = 'ArrowDown';
		else if (dc === -1) key = 'ArrowLeft';
		else if (dc === 1) key = 'ArrowRight';

		if (!key) continue;

		const event = new KeyboardEvent('keydown', {
			key,
			code: key,
			bubbles: true,
			cancelable: true,
		});

		document.activeElement.dispatchEvent(event);

		// LinkedIn listens to keyup too
		const upEvent = new KeyboardEvent('keyup', {
			key,
			code: key,
			bubbles: true,
			cancelable: true,
		});

		document.activeElement.dispatchEvent(upEvent);

		const delay = settings.jitter ? settings.speed + Math.random() * 40 : settings.speed;

		await sleep(Math.max(25, delay));
	}
}

async function applySudoku(board, settings) {
	for (let r = 0; r < 6; r++) {
		for (let c = 0; c < 6; c++) {
			const cell = getCellElement(r, c);
			if (!cell) continue;

			// skip original clues
			if (cell.classList.contains('sudoku-cell-prefilled')) {
				continue;
			}

			const value = board[r][c];
			if (!value) continue;

			// remove visual overlay before click
			const overlay = cell.querySelector('.solver-sudoku-overlay');
			if (overlay) overlay.remove();

			// select cell
			cell.dispatchEvent(
				new MouseEvent('mousedown', {
					bubbles: true,
				}),
			);

			cell.dispatchEvent(
				new MouseEvent('mouseup', {
					bubbles: true,
				}),
			);

			cell.dispatchEvent(
				new MouseEvent('click', {
					bubbles: true,
				}),
			);

			// let LinkedIn register selection
			await sleep(80);

			// click matching number button
			const button = document.querySelector(`.sudoku-input-button[data-number="${value}"]`);

			if (!button) continue;

			button.dispatchEvent(
				new MouseEvent('mousedown', {
					bubbles: true,
				}),
			);

			button.dispatchEvent(
				new MouseEvent('mouseup', {
					bubbles: true,
				}),
			);

			button.dispatchEvent(
				new MouseEvent('click', {
					bubbles: true,
				}),
			);

			// human-ish pacing
			const delay = settings.jitter ? settings.speed + Math.random() * 80 - 40 : settings.speed;

			await sleep(Math.max(60, delay));
		}
	}
}

function getCellElement(row, col) {
	const game = detectGame();

	// Tango
	if (game === 'tango') {
		const a11y = document.querySelector(`[id$="a11y-text-${row}-${col}"]`);

		if (a11y) {
			return a11y.closest('[role="button"]');
		}
	}

	// Sudoku
	if (game === 'sudoku') {
		const idx = row * 6 + col;

		return document.querySelector(`.sudoku-cell[data-cell-idx="${idx}"]`);
	}

	// Zip + Queens
	if (game === 'zip' || game === 'queens') {
		const grid = document.querySelector('[data-testid="interactive-grid"]');

		if (!grid) {
			console.error('[Solver] Board not found');
			return null;
		}

		const cells = grid.querySelectorAll('[data-cell-idx]');

		const size = Math.sqrt(cells.length);

		const idx = row * size + col;

		const cell = grid.querySelector(`[data-cell-idx="${idx}"]`);

		if (cell) {
			cell.tabIndex = 0;
		}

		return cell;
	}

	// generic fallback
	return document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
}

async function clickCell(row, col, settings) {
	const cell = getCellElement(row, col);
	if (!cell) return;

	cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
	cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
	cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

	const delay = settings.jitter ? settings.speed + Math.random() * 80 - 40 : settings.speed;

	await sleep(delay);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
