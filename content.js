let cachedSolution = null;
let cachedGame = null;
let cachedBoardHash = null;

function getBoardHash(board) {
	return JSON.stringify(board);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	// With all_frames:true this listener fires in every frame simultaneously.
	// We only want the frame that actually contains the game to respond.
	// Returning false (without calling sendResponse) means "not handled here"
	// so Chrome continues waiting for another frame to respond.
	if (message.type === 'SOLVE') {
		// If this frame has no game, silently ignore — let the game frame respond.
		if (!detectGame()) return false;

		handleSolve(true)
			.then((response) => {
				sendResponse(response);
			})
			.catch((err) => {
				sendResponse({ success: false, error: err.toString() });
			});
		return true; // Keep channel open asynchronously
	}
	if (message.type === 'GET_GAME') {
		// Same: only the game frame should reply.
		const game = detectGame();
		if (!game) return false;
		sendResponse({ game });
		return false;
	}
});

chrome.storage.sync.get(['enabled', 'autoSolve'], ({ enabled, autoSolve }) => {
	if (!enabled || !autoSolve) return;
	waitForBoard()
		.then(() => sleep(800))
		.then(() => {
			console.log('[Solver Log] Triggering auto-solve...');
			return handleSolve();
		})
		.catch((err) => console.warn('[Solver] Auto-solve failed:', err));
});

// Runs whenever ANY button is clicked — catches the "Start game" splash screen button
document.addEventListener(
	'click',
	(event) => {
		const button = event.target.closest('button');
		if (!button) return;

		if (button.id !== 'launch-footer-start-button' && !button.classList.contains('launch-footer__btn--start')) return;

		console.log('[Solver] Start game button clicked, waiting for board...');

		chrome.storage.sync.get(['enabled', 'autoSolve'], ({ enabled, autoSolve }) => {
			if (!enabled) return;
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
	.then(() => {
		console.log('[Solver Log] Board loaded, triggering initial highlight map.');
		return handleSolve(false);
	})
	.catch((err) => console.warn('[Solver] Highlight failed:', err));

function detectGame() {
	const url = window.location.href;
	if (url.includes('queens')) return 'queens';
	if (url.includes('tango')) return 'tango';
	if (url.includes('zip')) return 'zip';
	if (url.includes('sudoku')) return 'sudoku';

	if (document.querySelector('[data-trail-grid="true"]')) return 'zip';
	if (document.querySelector('#queens-grid')) return 'queens';
	if (document.querySelector('[data-testid="interactive-grid"] [data-cell-idx]')) {
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
		const hasStartCell = !!grid.querySelector('.trail-cell--filled, [class*="circle-start"], [data-cell-start]');
		const gridIsInteractive = grid.getAttribute('tabindex') !== null || grid.getAttribute('role') !== null;
		return hasStartCell || gridIsInteractive;
	}
	if (game === 'sudoku') {
		const grid = document.querySelector('[data-sudoku-grid="true"]');
		if (!grid) return false;
		const hasCells = grid.querySelectorAll('.sudoku-cell, [data-cell-idx]').length >= 4;
		const hasButtons = !!document.querySelector('.sudoku-input-button[data-number]');
		return hasCells && hasButtons;
	}
	return false;
}

/**
 * Strips away visual enhancements to avoid polluting innerText scrapers.
 */
function cleanSolverOverlays() {
	const selectors = ['.solver-queen-overlay', '.solver-highlight', '.solver-zip-overlay', '.solver-sudoku-overlay'];
	selectors.forEach((selector) => {
		document.querySelectorAll(selector).forEach((el) => el.remove());
	});
}

async function handleSolve(forceSolve = false) {
	const game = detectGame() || cachedGame;
	if (!game) {
		return { success: false, error: 'No game detected' };
	}

	// Persist the game type so future calls (e.g. after completion screen changes URL/DOM) can fall back to it
	cachedGame = game;

	try {
		// waitForBoard may reject if the board selectors don't match (e.g. completed-state DOM).
		// As long as the game was detected above, treat that as a non-fatal warning and proceed.
		await waitForBoard().catch(() => {
			console.warn('[Solver Log] waitForBoard timed out — board selectors did not match, but game was detected. Proceeding anyway.');
		});

		// CRITICAL: Clean old visualization elements so text scrapers extract native game values only
		cleanSolverOverlays();

		const settings = await getSettings();
		if (!settings.enabled) {
			return { success: false, error: 'Solver disabled' };
		}
		if (!settings.games[game]) {
			return { success: false, error: `${game} solver disabled` };
		}

		// Scrape fresh clean board
		const board = scrapeBoard(game);
		const boardHash = getBoardHash(board);

		console.log(`[Solver Log] Detected Game: "${game}". Freshly scraped board structure:`, JSON.parse(JSON.stringify(board)));

		let result = null;
		const canReuse = cachedSolution && cachedGame === game && cachedBoardHash === boardHash;

		if (canReuse) {
			console.log('[Solver Log] Match found. Reusing cached solution payload.');
			result = cachedSolution;
		} else {
			const solveStart = performance.now();
			result = solveGame(game, board);
			const solveTime = performance.now() - solveStart;

			console.log(`[Solver Log] Calculation Engine finished in ${solveTime.toFixed(1)}ms. Result status:`, result ? 'SUCCESS' : 'FAILED / NULL');

			if (!result) {
				return {
					success: false,
					error: 'No solution found',
				};
			}

			// Save cache
			cachedSolution = result;
			cachedGame = game;
			cachedBoardHash = boardHash;
		}

		// Brief pause to allow any DOM modifications to settle
		await sleep(50);

		if (settings.highlight) {
			highlightSolution(game, result);
		}

		if (!settings.autoSolve && !forceSolve) {
			return { success: true, highlighted: true };
		}

		// DO NOT use 'await' here. Fire and forget!
		applySolution(game, result, settings, board).catch((e) => console.error(e));

		// Instantly return success to the popup
		return { success: true };
	} catch (e) {
		console.error('[Solver Error] Error caught inside handleSolve workflow:', e);
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

function getQueensGrid() {
	return document.querySelector('[data-testid="interactive-grid"]') || document.querySelector('#queens-grid');
}

function getZipGrid() {
	return document.querySelector('[data-testid="interactive-grid"]') || document.querySelector('[data-trail-grid="true"] .trail-grid');
}

function getTangoGrid() {
	return document.querySelector('[data-testid="interactive-grid"]') || document.querySelector('.lotka-grid');
}

function getTangoCells(grid) {
	if (!grid) return [];
	const byTestId = grid.querySelectorAll('[data-testid^="cell-"][role="button"]');
	if (byTestId.length) return byTestId;
	return grid.querySelectorAll('.lotka-cell[role="button"]');
}

function getTangoCellValue(cellEl) {
	if (!cellEl) return 'Empty';
	const testIdSvg = cellEl.querySelector('svg[data-testid="cell-zero"], svg[data-testid="cell-one"], svg[data-testid="cell-empty"]');
	if (testIdSvg) return testIdSvg.getAttribute('aria-label');
	const lotkaSvg = cellEl.querySelector('svg[aria-label]');
	if (lotkaSvg) return lotkaSvg.getAttribute('aria-label');
	return 'Empty';
}

function getTangoEdges(cellEl) {
	const results = [];
	if (!cellEl) return results;
	cellEl.querySelectorAll('svg[data-testid="edge-equal"], svg[data-testid="edge-cross"]').forEach((svg) => {
		results.push({ svg, type: svg.getAttribute('data-testid') === 'edge-equal' ? 0 : 1 });
	});
	if (results.length) return results;
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
		const describedBy = cellEl.getAttribute('aria-describedby');
		if (!describedBy) return;
		const parts = describedBy.match(/(\d+)-(\d+)$/);
		if (!parts) return;
		const row = parseInt(parts[1]);
		const col = parseInt(parts[2]);

		const label = getTangoCellValue(cellEl);
		if (label === 'Sun') cells[row][col] = 1;
		else if (label === 'Moon') cells[row][col] = 2;

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
	if (!grid) throw new Error('Queens grid not found');

	const cellEls = [...grid.querySelectorAll('[data-cell-idx]')];
	const size = Math.round(Math.sqrt(cellEls.length));
	const regions = Array.from({ length: size }, () => Array(size).fill(0));
	const queens = Array(size).fill(-1);
	const regionMap = new Map();
	let nextRegionId = 1;

	for (const cell of cellEls) {
		const idx = Number(cell.dataset.cellIdx);
		const row = Math.floor(idx / size);
		const col = idx % size;

		const label = cell.getAttribute('aria-label') || '';
		const regionMatch = label.match(/color ([^,]+)/i);
		const regionName = regionMatch ? regionMatch[1].trim().toLowerCase() : 'unknown';

		if (!regionMap.has(regionName)) {
			regionMap.set(regionName, nextRegionId++);
		}

		regions[row][col] = regionMap.get(regionName);

		if (/queen/i.test(label)) {
			queens[row] = col;
		}
	}

	return { size, regions, queens };
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

		const content = cell.querySelector('[data-cell-content]') || cell.querySelector('.trail-cell-content');
		if (content) {
			const value = parseInt(content.textContent.trim());
			grid[row][col] = Number.isNaN(value) ? 0 : value;
		}
	});

	return { size, cells: grid, walls: [] };
}

function scrapeSudoku() {
	const grid = document.querySelector('[data-sudoku-grid="true"]');
	if (!grid) return null;

	const cellEls = grid.querySelectorAll('.sudoku-cell, [data-cell-idx]');
	const size = 6;
	const board = Array.from({ length: size }, () => Array(size).fill(0));
	const prefilled = Array.from({ length: size }, () => Array(size).fill(false));

	cellEls.forEach((cell) => {
		const idx = parseInt(cell.dataset.cellIdx);
		if (isNaN(idx)) return;

		const row = Math.floor(idx / size);
		const col = idx % size;

		const content = cell.querySelector('.sudoku-cell-content, [data-cell-content], .trail-cell-content');
		const value = parseInt(content?.textContent?.trim());
		const v = Number.isNaN(value) ? 0 : value;
		board[row][col] = v;

		if (cell.classList.contains('sudoku-cell-prefilled') || cell.getAttribute('aria-disabled') === 'true' || cell.getAttribute('aria-readonly') === 'true' || cell.dataset.prefilled === 'true' || cell.dataset.prefilled === '1') {
			prefilled[row][col] = true;
		}
	});

	board._prefilled = prefilled;
	return board;
}

function solveGame(game, board) {
	if (game === 'queens') {
		const boardCopy = {
			size: board.size,
			regions: board.regions.map((r) => [...r]),
			queens: [...board.queens],
		};
		const solved = queensSolver.solve(boardCopy);
		if (!solved) return null;
		return {
			size: boardCopy.size,
			queens: [...boardCopy.queens],
		};
	}
	if (game === 'tango') {
		const boardCopy = {
			size: board.size,
			cells: board.cells.map((r) => [...r]),
			constraints: board.constraints,
		};
		return tangoSolver.solve(boardCopy);
	}
	if (game === 'zip') {
		const boardCopy = {
			size: board.size,
			cells: board.cells.map((r) => [...r]),
			walls: [...board.walls],
		};
		return zipSolver.solve(boardCopy);
	}
	if (game === 'sudoku') {
		const copy = board.map((r) => [...r]);
		const solved = sudokuSolver.solve(copy);
		return solved ? copy : null;
	}
}

function highlightSolution(game, result) {
	if (game === 'queens') {
		const queens = Array.isArray(result) ? result : result.queens;
		if (!queens) return;

		queens.forEach((col, row) => {
			if (col < 0) return;
			const cell = getCellElement(row, col);
			if (!cell) return;

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
			overlay.innerHTML = `<div style="font-size:20px; font-weight:700; color:#22c55e;">♛</div>`;
			cell.appendChild(overlay);
		});
	}
	if (game === 'tango') {
		const SUN = 1;
		const MOON = 2;

		for (let r = 0; r < result.size; r++) {
			for (let c = 0; c < result.size; c++) {
				const cell = getCellElement(r, c);
				if (!cell || cell.getAttribute('aria-disabled') === 'true') continue;

				const val = result.cells[r][c];
				if (!val) continue;

				cell.style.position = 'relative';
				const overlay = document.createElement('div');
				overlay.className = 'solver-highlight';
				Object.assign(overlay.style, {
					position: 'absolute',
					inset: '4px',
					borderRadius: '8px',
					pointerEvents: 'none',
					zIndex: '999',
				});

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
		for (let r = 0; r < 6; r++) {
			for (let c = 0; c < 6; c++) {
				const cell = getCellElement(r, c);
				if (!cell || cell.classList.contains('sudoku-cell-prefilled') || cell.getAttribute('aria-disabled') === 'true' || cell.getAttribute('aria-readonly') === 'true') {
					continue;
				}

				const solvedValue = result[r][c];
				if (!solvedValue) continue;

				cell.style.position = 'relative';
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

function queensCellHasQueen(cell) {
	if (!cell) return false;
	const label = cell.getAttribute('aria-label') || '';
	if (/^queen/i.test(label)) return true;
	if (cell.querySelector('.cell-input--queen')) return true;
	if (cell.querySelector('[data-testid*="queen" i]')) return true;
	return false;
}

async function applyQueens(board, settings) {
	for (let row = 0; row < board.size; row++) {
		const col = board.queens[row];
		const stepStart = performance.now();

		await clickCellWithVerify(row, col, (cell) => queensCellHasQueen(cell), settings);

		const elapsed = performance.now() - stepStart;
		await sleep(Math.max(0, settings.speed - elapsed));
	}
}

async function applyTango(board, settings) {
	// Re-verify matrix parameters directly to counter virtual DOM thrashing
	for (let row = 0; row < board.size; row++) {
		for (let col = 0; col < board.size; col++) {
			const target = board.cells[row][col];
			if (target === 0) continue;

			const cellEl = getCellElement(row, col);
			if (!cellEl || cellEl.getAttribute('aria-disabled') === 'true') continue;

			const cellStart = performance.now();
			let attempts = 0;
			while (attempts < 4) {
				const currentLabel = getTangoCellValue(cellEl);
				const currentState = currentLabel === 'Sun' ? 1 : currentLabel === 'Moon' ? 2 : 0;

				if (currentState === target) break;

				const rect = cellEl.getBoundingClientRect();
				const x = rect.left + rect.width / 2;
				const y = rect.top + rect.height / 2;

				let el = document.elementFromPoint(x, y) || cellEl;
				while (el && !el.hasAttribute('data-cell-idx') && el !== cellEl) el = el.parentElement;
				el = el || cellEl;

				const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true };

				el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, button: 0, buttons: 1 }));
				el.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0, buttons: 1 }));
				el.dispatchEvent(new PointerEvent('pointerup', opts));
				el.dispatchEvent(new MouseEvent('mouseup', { ...opts, button: 0, buttons: 0 }));
				el.dispatchEvent(new MouseEvent('click', { ...opts, button: 0, buttons: 0 }));

				await sleep(40);
				attempts++;
			}

			const elapsed = performance.now() - cellStart;
			await sleep(Math.max(0, settings.speed - elapsed));
		}
	}
}

async function applyZip(path, settings) {
	if (!path?.length) return;

	const grid = getZipGrid();
	if (!grid) return;

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

	grid.scrollIntoView({ block: 'center', inline: 'center' });
	await sleep(120);

	const start = getCellCenter(path[0][0], path[0][1]);
	if (!start) return;

	grid.focus?.();
	await sleep(60);

	fire('pointerdown', start.x, start.y, 1);
	fire('mousedown', start.x, start.y, 1);
	await sleep(60);

	let prevX = start.x;
	let prevY = start.y;

	for (let i = 1; i < path.length; i++) {
		const next = getCellCenter(path[i][0], path[i][1]);
		if (!next) continue;

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

	fire('pointerup', prevX, prevY, 0);
	fire('mouseup', prevX, prevY, 0);
	fire('click', prevX, prevY, 0);
}

function getSudokuCellValue(cell) {
	const content = cell.querySelector('.sudoku-cell-content');
	const v = parseInt(content?.textContent?.trim());
	return Number.isNaN(v) ? 0 : v;
}

async function applySudoku(board, settings, originalBoard) {
	const prefilled = originalBoard?._prefilled || board._prefilled || null;

	let buttonWait = 0;
	while (!document.querySelector('.sudoku-input-button[data-number]') && buttonWait < 3000) {
		await sleep(100);
		buttonWait += 100;
	}
	if (!document.querySelector('.sudoku-input-button[data-number]')) return;

	for (let r = 0; r < 6; r++) {
		for (let c = 0; c < 6; c++) {
			const cell = getCellElement(r, c);
			if (!cell) continue;

			const isPrefilledByMap = prefilled?.[r]?.[c] === true;
			const isPrefilledByClass = cell.classList.contains('sudoku-cell-prefilled') || cell.getAttribute('aria-disabled') === 'true' || cell.getAttribute('aria-readonly') === 'true' || cell.dataset.prefilled === 'true';

			if (isPrefilledByMap || isPrefilledByClass) continue;

			const value = board[r][c];
			if (!value) continue;
			if (getSudokuCellValue(cell) === value) continue;

			const stepStart = performance.now();

			const overlay = cell.querySelector('.solver-sudoku-overlay');
			if (overlay) overlay.remove();

			let selected = false;
			for (let attempt = 0; attempt < 3 && !selected; attempt++) {
				cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
				cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
				cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
				await sleep(25);
				selected = cell.getAttribute('aria-selected') === 'true' || cell.classList.contains('sudoku-cell-selected') || cell.classList.contains('selected');
				if (!selected) await sleep(15);
			}

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

			const elapsed = performance.now() - stepStart;
			await sleep(Math.max(0, settings.speed - elapsed));
		}
	}
}

function getCellElement(row, col) {
	const game = detectGame();

	if (game === 'tango') {
		const cell = document.querySelector(`[aria-describedby$="-${row}-${col}"][role="button"]`);
		if (cell) return cell;
		const a11y = document.querySelector(`[id$="a11y-text-${row}-${col}"]`);
		if (a11y) return a11y.closest('[role="button"]');
	}

	if (game === 'sudoku') {
		const idx = row * 6 + col;
		return document.querySelector(`.sudoku-cell[data-cell-idx="${idx}"]`) || document.querySelector(`[data-sudoku-grid="true"] [data-cell-idx="${idx}"]`);
	}

	if (game === 'zip' || game === 'queens') {
		const grid = game === 'queens' ? getQueensGrid() : getZipGrid();
		if (!grid) return null;

		const cells = grid.querySelectorAll('[data-cell-idx]');
		if (!cells.length) return null;
		const size = Math.sqrt(cells.length);
		const idx = row * size + col;
		const cell = grid.querySelector(`[data-cell-idx="${idx}"]`);

		if (cell) {
			cell.tabIndex = 0;
		}
		return cell;
	}

	return document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
}

async function clickCellWithVerify(row, col, verifyFn, settings, maxAttempts = 3) {
	const cell = getCellElement(row, col);
	if (!cell) return;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
		cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		await sleep(25);
		if (verifyFn(cell)) return;
		await sleep(20);
	}
	console.warn(`[Solver] Cell [${row},${col}] did not verify after ${maxAttempts} attempts`);
}

async function clickCell(row, col, settings) {
	const delay = settings.jitter ? settings.speed + Math.random() * 80 - 40 : settings.speed;
	await clickCellWithVerify(row, col, () => true, settings);
	await sleep(Math.max(0, delay - 45));
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
