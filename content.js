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

// Runs whenever ANY button is clicked — catches the "Start game" splash screen button
document.addEventListener(
	'click',
	(event) => {
		const button = event.target.closest('button');
		if (!button) return;

		// Only react to the LinkedIn launch/start button
		if (button.id !== 'launch-footer-start-button' && !button.classList.contains('launch-footer__btn--start')) return;

		console.log('[Solver] Start game button clicked, waiting for board...');

		chrome.storage.sync.get(['enabled', 'autoSolve'], ({ enabled, autoSolve }) => {
			if (!enabled) return;
			// Always at least highlight; autoSolve controls whether to also apply
			waitForBoard(10000)
				.then(() => handleSolve(autoSolve))
				.catch((err) => console.warn('[Solver] Post-start-button solve failed:', err));
		});
	},
	true, // capture phase so we see it before the page handles it
);

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
	if (game === 'tango') {
		const grid = getTangoGrid();
		if (!grid) return false;
		// Grid container appears before cells are populated — wait for actual cells
		const cells = getTangoCells(grid);
		return cells.length >= 4;
	}
	if (game === 'queens') {
		const grid = document.querySelector('[data-testid="interactive-grid"]');
		if (!grid) return false;
		return grid.querySelectorAll('[data-cell-idx]').length >= 4;
	}
	if (game === 'zip') {
		const grid = document.querySelector('[data-testid="interactive-grid"]');
		if (!grid) return false;
		return grid.querySelectorAll('[data-cell-idx]').length >= 4;
	}
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

// Returns the tango grid element regardless of signed-in vs signed-out DOM variant
function getTangoGrid() {
	return document.querySelector('[data-testid="interactive-grid"]') || document.querySelector('.lotka-grid');
}

// Returns all tango cell button elements
function getTangoCells(grid) {
	// Signed-in: cells have data-testid^="cell-"
	// Signed-out: cells have class lotka-cell and role=button
	const byTestId = grid.querySelectorAll('[data-testid^="cell-"][role="button"]');
	if (byTestId.length) return byTestId;
	return grid.querySelectorAll('.lotka-cell[role="button"]');
}

// Returns { label: "Sun"|"Moon"|"Empty" } from a cell element
function getTangoCellValue(cellEl) {
	// Signed-in: svg with data-testid="cell-zero/one/empty"
	const testIdSvg = cellEl.querySelector('svg[data-testid="cell-zero"], svg[data-testid="cell-one"], svg[data-testid="cell-empty"]');
	if (testIdSvg) return testIdSvg.getAttribute('aria-label');
	// Signed-out: svg with class lotka-cell-content-img
	const lotkaSvg = cellEl.querySelector('svg[aria-label]');
	if (lotkaSvg) return lotkaSvg.getAttribute('aria-label');
	return 'Empty';
}

// Returns all edge SVGs within a cell, with their type (0=equal, 1=cross)
function getTangoEdges(cellEl) {
	const results = [];
	// Signed-in: svg[data-testid="edge-equal/cross"]
	cellEl.querySelectorAll('svg[data-testid="edge-equal"], svg[data-testid="edge-cross"]').forEach((svg) => {
		results.push({ svg, type: svg.getAttribute('data-testid') === 'edge-equal' ? 0 : 1 });
	});
	if (results.length) return results;
	// Signed-out: svg with aria-label="Equal"/"Cross" inside .lotka-cell-edge
	cellEl.querySelectorAll('.lotka-cell-edge svg[aria-label]').forEach((svg) => {
		const label = svg.getAttribute('aria-label');
		if (label === 'Equal' || label === 'Cross') {
			results.push({ svg, type: label === 'Equal' ? 0 : 1 });
		}
	});
	return results;
}
function scrapeTango() {
	const grid = getTangoGrid();
	const cellEls = getTangoCells(grid);
	const size = Math.round(Math.sqrt(cellEls.length));
	const cells = Array.from({ length: size }, () => Array(size).fill(0));
	const constraints = [];

	cellEls.forEach((cellEl) => {
		// Get row/col from aria-describedby — works for both variants since the id always ends in ROW-COL
		const describedBy = cellEl.getAttribute('aria-describedby');
		if (!describedBy) return;
		const parts = describedBy.match(/(\d+)-(\d+)$/);
		if (!parts) return;
		const row = parseInt(parts[1]);
		const col = parseInt(parts[2]);

		// cell value
		const label = getTangoCellValue(cellEl);
		if (label === 'Sun') cells[row][col] = 1;
		else if (label === 'Moon') cells[row][col] = 2;

		// constraints — use bounding rect to determine right vs bottom edge
		getTangoEdges(cellEl).forEach(({ svg, type }) => {
			const cellRect = cellEl.getBoundingClientRect();
			const markerRect = svg.getBoundingClientRect();
			if (markerRect.width === 0 && markerRect.height === 0) return;

			const markerCenterX = markerRect.left + markerRect.width / 2;
			const markerCenterY = markerRect.top + markerRect.height / 2;
			const distFromRight = Math.abs(markerCenterX - cellRect.right);
			const distFromBottom = Math.abs(markerCenterY - cellRect.bottom);

			if (distFromRight < distFromBottom) {
				constraints.push({ a: [row, col], b: [row, col + 1], type });
			} else {
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
	const grid = getTangoGrid();
	const cellEls = getTangoCells(grid);

	for (const cellEl of cellEls) {
		// skip prefilled cells
		if (cellEl.getAttribute('aria-disabled') === 'true') continue;

		// Get row/col from aria-describedby (works for both DOM variants)
		const describedBy = cellEl.getAttribute('aria-describedby');
		if (!describedBy) continue;
		const parts = describedBy.match(/(\d+)-(\d+)$/);
		if (!parts) continue;
		const row = parseInt(parts[1]);
		const col = parseInt(parts[2]);

		const target = board.cells[row][col]; // 1 = SUN, 2 = MOON
		if (target === 0) continue;

		const cellStart = performance.now();

		// Click until the cell shows the target value (read DOM state each time)
		let attempts = 0;
		while (attempts < 4) {
			const currentLabel = getTangoCellValue(cellEl);
			const currentState = currentLabel === 'Sun' ? 1 : currentLabel === 'Moon' ? 2 : 0;

			if (currentState === target) break;

			const rect = cellEl.getBoundingClientRect();
			const x = rect.left + rect.width / 2;
			const y = rect.top + rect.height / 2;
			// elementFromPoint can return the solver highlight overlay even with
			// pointer-events:none, so walk up until we find the actual cell button
			let el = document.elementFromPoint(x, y) || cellEl;
			while (el && !el.hasAttribute('data-cell-idx') && el !== cellEl) el = el.parentElement;
			el = el || cellEl;
			const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true };

			el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, button: 0, buttons: 1 }));
			el.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0, buttons: 1 }));
			el.dispatchEvent(new PointerEvent('pointerup', opts));
			el.dispatchEvent(new MouseEvent('mouseup', { ...opts, button: 0, buttons: 0 }));
			el.dispatchEvent(new MouseEvent('click', { ...opts, button: 0, buttons: 0 }));

			await sleep(100); // wait for DOM to update before re-checking
			attempts++;
		}

		const elapsed = performance.now() - cellStart;
		await sleep(Math.max(50, settings.speed - elapsed));
	}
}

async function applyZip(path, settings) {
	if (!path?.length) return;

	function cellCenter(row, col) {
		const cell = getCellElement(row, col);
		if (!cell) return null;
		const rect = cell.getBoundingClientRect();
		return {
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2,
			target: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) || cell,
		};
	}

	function pointerOpts(x, y, extra = {}) {
		return { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, ...extra };
	}

	const start = cellCenter(path[0][0], path[0][1]);
	if (!start) return;

	// pointerdown on the first cell to begin the drag
	start.target.dispatchEvent(new PointerEvent('pointerdown', pointerOpts(start.x, start.y, { button: 0, buttons: 1 })));
	start.target.dispatchEvent(new MouseEvent('mousedown', { ...pointerOpts(start.x, start.y), button: 0, buttons: 1 }));

	await sleep(30);

	// pointermove through every subsequent cell in the path
	for (let i = 1; i < path.length; i++) {
		const pt = cellCenter(path[i][0], path[i][1]);
		if (!pt) continue;

		pt.target.dispatchEvent(new PointerEvent('pointermove', pointerOpts(pt.x, pt.y, { buttons: 1 })));
		pt.target.dispatchEvent(new MouseEvent('mousemove', { ...pointerOpts(pt.x, pt.y), buttons: 1 }));

		const delay = settings.jitter ? settings.speed + Math.random() * 40 : settings.speed;
		await sleep(Math.max(20, delay));
	}

	// pointerup on the last cell to finish the drag
	const end = cellCenter(path[path.length - 1][0], path[path.length - 1][1]);
	if (end) {
		end.target.dispatchEvent(new PointerEvent('pointerup', pointerOpts(end.x, end.y, { button: 0, buttons: 0 })));
		end.target.dispatchEvent(new MouseEvent('mouseup', { ...pointerOpts(end.x, end.y), button: 0, buttons: 0 }));
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

	// Tango — look up by aria-describedby since the a11y span is a sibling in lotka DOM,
	// not a child, so closest('[role="button"]') from the span doesn't work.
	if (game === 'tango') {
		// Both variants: cell has aria-describedby ending in "-ROW-COL"
		const cell = document.querySelector(`[aria-describedby$="-${row}-${col}"][role="button"]`);
		if (cell) return cell;
		// Fallback for signed-in variant where span is inside the cell
		const a11y = document.querySelector(`[id$="a11y-text-${row}-${col}"]`);
		if (a11y) return a11y.closest('[role="button"]');
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
