chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === 'SOLVE') handleSolve().then(sendResponse);
	if (message.type === 'GET_GAME') sendResponse({ game: detectGame() });
	return true;
});

chrome.storage.sync.get(['enabled', 'autoSolve'], ({ enabled, autoSolve }) => {
	if (!enabled || !autoSolve) return;
	waitForBoard()
		.then(() => handleSolve())
		.catch((err) => console.warn('[Solver] Auto-solve failed:', err));
});

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
	if (game === 'queens') return !!document.querySelector('[data-testid="queens-cell"]'); // TODO: verify
	if (game === 'zip') return !!document.querySelector('[data-testid="zip-cell"]'); // TODO: verify
	if (game === 'sudoku') return !!document.querySelector('[data-testid="sudoku-cell"]'); // TODO: verify
	return false;
}

async function handleSolve() {
	const game = detectGame();
	if (!game) return { success: false, error: 'No game detected' };

	try {
		await waitForBoard();

		const settings = await getSettings();
		if (!settings.enabled) return { success: false, error: 'Solver disabled' };
		if (!settings.games[game]) return { success: false, error: `${game} solver disabled` };

		const board = scrapeBoard(game);

		const solveStart = performance.now();
		const result = solveGame(game, board);
		const solveTime = performance.now() - solveStart;

		if (!result) return { success: false, error: 'No solution found' };

		if (settings.highlight) highlightSolution(game, result);

		// wait at least one speed tick before starting clicks
		const minDelay = settings.speed;
		if (solveTime < minDelay) await sleep(minDelay - solveTime);

		await applySolution(game, result, settings);

		return { success: true };
	} catch (e) {
		console.error('[Solver] Error:', e);
		return { success: false, error: e.toString() };
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
	const cellEls = grid.querySelectorAll('[data-testid^="cell-"]');
	const size = Math.sqrt(cellEls.length);
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
	// TODO: inspect LinkedIn's queens DOM and fill real selectors
	const cells = document.querySelectorAll('[data-testid="queens-cell"]');
	const size = Math.sqrt(cells.length);
	const regions = Array.from({ length: size }, () => Array(size).fill(0));
	cells.forEach((cell) => {
		const row = parseInt(cell.dataset.row);
		const col = parseInt(cell.dataset.col);
		const region = parseInt(cell.dataset.region);
		regions[row][col] = region;
	});
	return { size, regions, queens: Array(size).fill(-1) };
}

function scrapeZip() {
	// TODO: inspect LinkedIn's zip DOM and fill real selectors
	const cells = document.querySelectorAll('[data-testid="zip-cell"]');
	const size = Math.sqrt(cells.length);
	const grid = Array.from({ length: size }, () => Array(size).fill(0));
	cells.forEach((cell) => {
		const row = parseInt(cell.dataset.row);
		const col = parseInt(cell.dataset.col);
		const val = cell.dataset.checkpoint ? parseInt(cell.dataset.checkpoint) : 0;
		grid[row][col] = val;
	});
	return { size, cells: grid, walls: [] };
}

function scrapeSudoku() {
	// TODO: inspect LinkedIn's sudoku DOM and fill real selectors
	const cells = document.querySelectorAll('[data-testid="sudoku-cell"]');
	const board = Array.from({ length: 6 }, () => Array(6).fill(0));
	cells.forEach((cell) => {
		const row = parseInt(cell.dataset.row);
		const col = parseInt(cell.dataset.col);
		const val = cell.dataset.value ? parseInt(cell.dataset.value) : 0;
		board[row][col] = val;
	});
	return board;
}

function solveGame(game, board) {
	if (game === 'queens') return solve(board); // solver-queens.js
	if (game === 'tango') return solve(board); // solver-tango.js
	if (game === 'zip') return solve(board); // solver-zip.js
	if (game === 'sudoku') {
		const copy = board.map((r) => [...r]);
		const solved = solveSudoku(copy); // solver-sudoku.js
		return solved ? copy : null;
	}
}

function highlightSolution(game, result) {
	if (game === 'queens') {
		result.queens.forEach((col, row) => {
			const cell = getCellElement(row, col);
			if (cell) cell.style.outline = '2px solid #22c55e';
		});
	}
	if (game === 'tango') {
		for (let r = 0; r < result.size; r++) {
			for (let c = 0; c < result.size; c++) {
				const cell = getCellElement(r, c);
				if (cell) cell.style.outline = '2px solid #22c55e';
			}
		}
	}
	if (game === 'zip') {
		result.forEach(([row, col]) => {
			const cell = getCellElement(row, col);
			if (cell) cell.style.outline = '2px solid #3b82f6';
		});
	}
	if (game === 'sudoku') {
		for (let r = 0; r < 6; r++) {
			for (let c = 0; c < 6; c++) {
				const cell = getCellElement(r, c);
				if (cell) cell.style.outline = '2px solid #3b82f6';
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
	const cellEls = grid.querySelectorAll('[data-testid^="cell-"]');

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

		// each click cycles: empty → sun → moon → empty
		// so click once for sun, twice for moon
		const clicks = target === 1 ? 1 : target === 2 ? 2 : 0;
		for (let i = 0; i < clicks; i++) {
			cellEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			await sleep(settings.jitter ? settings.speed + Math.random() * 80 - 40 : settings.speed);
		}
	}
}

async function applyZip(path, settings) {
	for (const [row, col] of path) {
		await clickCell(row, col, settings);
	}
}

async function applySudoku(board, settings) {
	for (let r = 0; r < 6; r++) {
		for (let c = 0; c < 6; c++) {
			const val = board[r][c];
			if (val === 0) continue;
			const cell = getCellElement(r, c);
			if (!cell) continue;

			await clickCell(r, c, settings);

			cell.dispatchEvent(new KeyboardEvent('keydown', { key: String(val), bubbles: true }));
			cell.dispatchEvent(new KeyboardEvent('keyup', { key: String(val), bubbles: true }));

			await sleep(settings.speed);
		}
	}
}

function getCellElement(row, col) {
	// for tango, look up by a11y text id
	const a11y = document.querySelector(`[id$="a11y-text-${row}-${col}"]`);
	if (a11y) return a11y.closest('[role="button"]');

	// fallback for other games: data attributes
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
