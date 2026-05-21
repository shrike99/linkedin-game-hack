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
		.then(() => sleep(800))
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
			// Always at least highlight; autoSolve controls whether to also apply.
			// After the board appears in the DOM, wait an extra settle period so the
			// game's own JS finishes attaching event listeners before we start clicking.
			waitForBoard(10000)
				.then(() => sleep(autoSolve ? 800 : 0))
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
	// DOM-based fallback for signed-out pages where URL may differ
	if (document.querySelector('[data-trail-grid="true"]')) return 'zip';
	if (document.querySelector('#queens-grid')) return 'queens';
	if (document.querySelector('[data-testid="interactive-grid"] [data-cell-idx]')) {
		// Distinguish queens vs zip by checking for color regions in aria-labels
		const firstCell = document.querySelector('[data-cell-idx="0"]');
		if (firstCell) {
			const label = firstCell.getAttribute('aria-label') || '';
			if (/color/i.test(label)) return 'queens';
			if (firstCell.querySelector('[data-cell-content], .trail-cell-content')) return 'zip';
		}
	}
	if (document.querySelector('[data-sudoku-grid="true"]')) return 'sudoku';
	if (document.querySelector('[data-testid="interactive-grid"] [data-testid^="cell-"]')) return 'tango';
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
		const grid = getQueensGrid();
		if (!grid) return false;
		return grid.querySelectorAll('[data-cell-idx]').length >= 4;
	}
	if (game === 'zip') {
		const grid = getZipGrid();
		if (!grid) return false;
		const cells = grid.querySelectorAll('[data-cell-idx]');
		if (cells.length < 4) return false;
		// The start cell gets .trail-cell--filled / trail-cell-segment--circle-start (signed-out)
		// or a similar marker (signed-in) only once the game JS has fully initialised.
		// Without this, pointerdown events land before listeners are attached.
		const hasStartCell = !!grid.querySelector('.trail-cell--filled, [class*="circle-start"], [data-cell-start]');
		// Signed-in zip: the grid gets a tabindex and role once ready
		const gridIsInteractive = grid.getAttribute('tabindex') !== null || grid.getAttribute('role') !== null;
		return hasStartCell || gridIsInteractive;
	}
	if (game === 'sudoku') {
		const grid = document.querySelector('[data-sudoku-grid="true"]');
		if (!grid) return false;
		// Wait for cells AND the number input buttons — both must exist before we can solve
		const hasCells = grid.querySelectorAll('.sudoku-cell, [data-cell-idx]').length >= 4;
		const hasButtons = !!document.querySelector('.sudoku-input-button[data-number]');
		return hasCells && hasButtons;
	}

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

		await applySolution(game, result, settings, board);

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
			// Speed steps: 20, 40, 80, 120, 200 ms — fast enough to feel instant while respecting timing
			(s) => resolve({ ...s, speed: [20, 40, 80, 120, 200][s.speed] }),
		);
	});
}

function scrapeBoard(game) {
	if (game === 'queens') return scrapeQueens();
	if (game === 'tango') return scrapeTango();
	if (game === 'zip') return scrapeZip();
	if (game === 'sudoku') return scrapeSudoku();
}

// Returns the queens grid element regardless of signed-in vs signed-out DOM variant
// Signed-in:  [data-testid="interactive-grid"]
// Signed-out: #queens-grid
function getQueensGrid() {
	return document.querySelector('[data-testid="interactive-grid"]') || document.querySelector('#queens-grid');
}

// Returns the zip/trail grid element regardless of signed-in vs signed-out DOM variant
// Signed-in:  [data-testid="interactive-grid"]
// Signed-out: [data-trail-grid="true"] .trail-grid
function getZipGrid() {
	return document.querySelector('[data-testid="interactive-grid"]') || document.querySelector('[data-trail-grid="true"] .trail-grid');
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
	const grid = getQueensGrid();

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
	const gridEl = getZipGrid();

	if (!gridEl) return null;

	const cellEls = gridEl.querySelectorAll('[data-cell-idx]');

	const size = Math.round(Math.sqrt(cellEls.length));

	const grid = Array.from({ length: size }, () => Array(size).fill(0));

	cellEls.forEach((cell) => {
		const idx = parseInt(cell.dataset.cellIdx);

		const row = Math.floor(idx / size);
		const col = idx % size;

		// Signed-in:  child element with [data-cell-content] attribute
		// Signed-out: div.trail-cell-content (text content only, no attribute)
		const content = cell.querySelector('[data-cell-content]') || cell.querySelector('.trail-cell-content');

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

	// Signed-in uses .sudoku-cell; signed-out may use a different selector.
	// Try specific first, fall back to any [data-cell-idx] child.
	const cellEls = grid.querySelectorAll('.sudoku-cell, [data-cell-idx]');

	const size = 6;
	// board[r][c] = value (0 = empty/unknown)
	// prefilled[r][c] = true if this cell is a clue the player cannot change
	const board = Array.from({ length: size }, () => Array(size).fill(0));
	const prefilled = Array.from({ length: size }, () => Array(size).fill(false));

	cellEls.forEach((cell) => {
		const idx = parseInt(cell.dataset.cellIdx);
		if (isNaN(idx)) return;

		const row = Math.floor(idx / size);
		const col = idx % size;

		// Read the displayed value from whichever content element exists
		const content = cell.querySelector('.sudoku-cell-content, [data-cell-content], .trail-cell-content');
		const value = parseInt(content?.textContent?.trim());
		const v = Number.isNaN(value) ? 0 : value;
		board[row][col] = v;

		// Mark as pre-filled if ANY of these signals are present:
		// - the signed-in class
		// - aria-disabled / aria-readonly
		// - data-prefilled attribute
		if (cell.classList.contains('sudoku-cell-prefilled') || cell.getAttribute('aria-disabled') === 'true' || cell.getAttribute('aria-readonly') === 'true' || cell.dataset.prefilled === 'true' || cell.dataset.prefilled === '1') {
			prefilled[row][col] = true;
		}
	});

	// Attach prefilled map to board so applySudoku can use it
	board._prefilled = prefilled;
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
				if (cell.classList.contains('sudoku-cell-prefilled') || cell.getAttribute('aria-disabled') === 'true' || cell.getAttribute('aria-readonly') === 'true') {
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

async function applySolution(game, result, settings, originalBoard) {
	if (game === 'queens') await applyQueens(result, settings);
	if (game === 'tango') await applyTango(result, settings);
	if (game === 'zip') await applyZip(result, settings);
	if (game === 'sudoku') await applySudoku(result, settings, originalBoard);
}

// Checks whether a queens cell has been marked (has a queen SVG or aria-label containing "queen")
// Works for both signed-in (data-testid grid) and signed-out (#queens-grid) DOM variants
function queensCellHasQueen(cell) {
	if (!cell) return false;
	const label = cell.getAttribute('aria-label') || '';
	// Both variants update aria-label to start with "Queen" when placed
	if (/^queen/i.test(label)) return true;
	// Fallback: queen SVG span is present (signed-out uses .cell-input--queen)
	if (cell.querySelector('.cell-input--queen')) return true;
	// Signed-in: data-testid marker
	if (cell.querySelector('[data-testid*="queen" i]')) return true;
	return false;
}

async function applyQueens(board, settings) {
	for (let row = 0; row < board.size; row++) {
		const col = board.queens[row];
		const stepStart = performance.now();

		await clickCellWithVerify(row, col, (cell) => queensCellHasQueen(cell), settings);

		// Pace remaining time so total per-cell time = settings.speed
		const elapsed = performance.now() - stepStart;
		await sleep(Math.max(0, settings.speed - elapsed));
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

			// Wait for DOM to update then verify before moving on
			await sleep(30);
			attempts++;
		}

		const elapsed = performance.now() - cellStart;
		await sleep(Math.max(0, settings.speed - elapsed));
	}
}

async function applyZip(path, settings) {
	if (!path?.length) return;

	const grid = getZipGrid();
	if (!grid) {
		console.error('[Zip] grid not found');
		return;
	}

	console.log('[Zip] starting drag solve');

	// wait until game listeners are attached
	let wait = 0;

	while (wait < 4000) {
		const ready = grid.querySelector('.trail-cell--filled') || grid.querySelector('[class*="circle-start"]') || grid.querySelector('[data-cell-start]');

		if (ready) break;

		await sleep(100);
		wait += 100;
	}

	function getCellCenter(row, col) {
		const cell = getCellElement(row, col);
		if (!cell) return null;

		const rect = cell.getBoundingClientRect();

		return {
			cell,
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2,
		};
	}

	function fire(type, x, y, buttons = 1) {
		const target = document.elementFromPoint(x, y) || document.body;

		const opts = {
			bubbles: true,
			cancelable: true,
			composed: true,

			clientX: x,
			clientY: y,

			screenX: x,
			screenY: y,

			pointerId: 1,
			pointerType: 'mouse',
			isPrimary: true,

			buttons,
			button: buttons ? 0 : -1,
		};

		target.dispatchEvent(new PointerEvent(type, opts));

		const mouseType = type.replace('pointer', 'mouse');

		target.dispatchEvent(new MouseEvent(mouseType, opts));
	}

	function lerp(a, b, t) {
		return a + (b - a) * t;
	}

	grid.scrollIntoView({
		block: 'center',
		inline: 'center',
	});

	await sleep(120);

	const start = getCellCenter(path[0][0], path[0][1]);

	if (!start) {
		console.error('[Zip] missing start');
		return;
	}

	grid.focus?.();

	await sleep(60);

	// START DRAG
	fire('pointerdown', start.x, start.y, 1);
	fire('mousedown', start.x, start.y, 1);

	await sleep(60);

	let prevX = start.x;
	let prevY = start.y;

	for (let i = 1; i < path.length; i++) {
		const next = getCellCenter(path[i][0], path[i][1]);

		if (!next) continue;

		// many small moves is REQUIRED for signed-out zip
		const steps = 14;

		for (let s = 1; s <= steps; s++) {
			const t = s / steps;

			const x = lerp(prevX, next.x, t);
			const y = lerp(prevY, next.y, t);

			fire('pointermove', x, y, 1);
			fire('mousemove', x, y, 1);

			await sleep(5);
		}

		prevX = next.x;
		prevY = next.y;

		await sleep(Math.max(10, settings.speed / 2));
	}

	// END DRAG
	fire('pointerup', prevX, prevY, 0);
	fire('mouseup', prevX, prevY, 0);
	fire('click', prevX, prevY, 0);

	console.log('[Zip] drag completed');
}
// Returns the current displayed value of a sudoku cell (0 if empty)
function getSudokuCellValue(cell) {
	const content = cell.querySelector('.sudoku-cell-content');
	const v = parseInt(content?.textContent?.trim());
	return Number.isNaN(v) ? 0 : v;
}

async function applySudoku(board, settings, originalBoard) {
	// Use the prefilled map from the original scrape if available.
	// Falls back to the solved board's own _prefilled, then to DOM class checks.
	const prefilled = originalBoard?._prefilled || board._prefilled || null;

	// Ensure the number input buttons are present and clickable before starting.
	// They can appear after the grid itself on slow/autosolve paths.
	let buttonWait = 0;
	while (!document.querySelector('.sudoku-input-button[data-number]') && buttonWait < 3000) {
		await sleep(100);
		buttonWait += 100;
	}
	if (!document.querySelector('.sudoku-input-button[data-number]')) {
		console.warn('[Sudoku] Input buttons never appeared — aborting');
		return;
	}

	for (let r = 0; r < 6; r++) {
		for (let c = 0; c < 6; c++) {
			const cell = getCellElement(r, c);
			if (!cell) continue;

			// Skip if pre-filled — check map first (most reliable), then DOM classes
			const isPrefilledByMap = prefilled?.[r]?.[c] === true;
			const isPrefilledByClass = cell.classList.contains('sudoku-cell-prefilled') || cell.getAttribute('aria-disabled') === 'true' || cell.getAttribute('aria-readonly') === 'true' || cell.dataset.prefilled === 'true';

			if (isPrefilledByMap || isPrefilledByClass) continue;

			const value = board[r][c];
			if (!value) continue;

			// Also skip if cell already shows the correct value (e.g. from a previous partial run)
			if (getSudokuCellValue(cell) === value) continue;

			const stepStart = performance.now();

			// remove visual overlay before click
			const overlay = cell.querySelector('.solver-sudoku-overlay');
			if (overlay) overlay.remove();

			// Select cell — retry until it registers as selected
			let selected = false;
			for (let attempt = 0; attempt < 3 && !selected; attempt++) {
				cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
				cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
				cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
				await sleep(25);
				// Check selection by seeing if game highlights this cell (aria-selected or similar)
				selected = cell.getAttribute('aria-selected') === 'true' || cell.classList.contains('sudoku-cell-selected') || cell.classList.contains('selected');
				if (!selected) await sleep(15);
			}

			// Click matching number button — retry until value appears in cell
			const button = document.querySelector(`.sudoku-input-button[data-number="${value}"]`);
			if (!button) continue;

			let filled = false;
			for (let attempt = 0; attempt < 3 && !filled; attempt++) {
				button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
				button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
				button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
				await sleep(25);
				filled = getSudokuCellValue(cell) === value;
				if (!filled) await sleep(15);
			}

			if (!filled) {
				console.warn(`[Sudoku] Cell [${r},${c}] did not register value ${value} after retries`);
			}

			// Pace so total per-cell time = settings.speed
			const elapsed = performance.now() - stepStart;
			await sleep(Math.max(0, settings.speed - elapsed));
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
		// Signed-in: .sudoku-cell; signed-out: any [data-cell-idx] inside the sudoku grid
		return document.querySelector(`.sudoku-cell[data-cell-idx="${idx}"]`) || document.querySelector(`[data-sudoku-grid="true"] [data-cell-idx="${idx}"]`);
	}

	// Zip + Queens
	if (game === 'zip' || game === 'queens') {
		const grid = game === 'queens' ? getQueensGrid() : getZipGrid();

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

/**
 * Click a cell and verify the expected DOM state before proceeding.
 * Retries up to maxAttempts times if verification fails.
 */
async function clickCellWithVerify(row, col, verifyFn, settings, maxAttempts = 3) {
	const cell = getCellElement(row, col);
	if (!cell) return;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
		cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		// Give the page a moment to react, then verify
		await sleep(25);
		if (verifyFn(cell)) return; // confirmed — move on
		await sleep(20); // brief extra pause before retry
	}

	console.warn(`[Solver] Cell [${row},${col}] did not verify after ${maxAttempts} attempts`);
}

async function clickCell(row, col, settings) {
	const delay = settings.jitter ? settings.speed + Math.random() * 80 - 40 : settings.speed;
	await clickCellWithVerify(row, col, () => true, settings);
	await sleep(Math.max(0, delay - 45)); // 45ms already spent in verify loop
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
