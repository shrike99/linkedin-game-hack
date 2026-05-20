// ── TANGO SOLVER ─────────────────────────────────────────────────────────────
const tangoSolver = (() => {
	const EMPTY = 0, SUN = 1, MOON = 2;

	function cloneBoard(board) {
		return { size: board.size, cells: board.cells.map((row) => [...row]), constraints: board.constraints };
	}

	function isFull(board) {
		return board.cells.every((row) => row.every((c) => c !== EMPTY));
	}

	function isContradiction(board) {
		const half = board.size / 2;
		for (let i = 0; i < board.size; i++) {
			const row = board.cells[i];
			const col = board.cells.map((r) => r[i]);
			for (const line of [row, col]) {
				if (line.filter((c) => c === SUN).length > half) return true;
				if (line.filter((c) => c === MOON).length > half) return true;
				for (let j = 0; j < board.size - 2; j++) {
					if (line[j] !== EMPTY && line[j] === line[j + 1] && line[j] === line[j + 2]) return true;
				}
			}
		}
		for (const constraint of board.constraints) {
			const [ar, ac] = constraint.a, [br, bc] = constraint.b;
			const cellA = board.cells[ar][ac], cellB = board.cells[br][bc];
			if (cellA === EMPTY || cellB === EMPTY) continue;
			if (constraint.type === 0 && cellA !== cellB) return true;
			if (constraint.type === 1 && cellA === cellB) return true;
		}
		return false;
	}

	function propagateBalance(board) {
		let changed = false;
		const half = board.size / 2;
		for (let i = 0; i < board.size; i++) {
			const row = board.cells[i];
			const rowSuns = row.filter((c) => c === SUN).length;
			const rowMoons = row.filter((c) => c === MOON).length;
			if (rowSuns === half) { for (let col = 0; col < board.size; col++) { if (board.cells[i][col] === EMPTY) { board.cells[i][col] = MOON; changed = true; } } }
			else if (rowMoons === half) { for (let col = 0; col < board.size; col++) { if (board.cells[i][col] === EMPTY) { board.cells[i][col] = SUN; changed = true; } } }
			const colVals = board.cells.map((r) => r[i]);
			const colSuns = colVals.filter((c) => c === SUN).length;
			const colMoons = colVals.filter((c) => c === MOON).length;
			if (colSuns === half) { for (let row = 0; row < board.size; row++) { if (board.cells[row][i] === EMPTY) { board.cells[row][i] = MOON; changed = true; } } }
			else if (colMoons === half) { for (let row = 0; row < board.size; row++) { if (board.cells[row][i] === EMPTY) { board.cells[row][i] = SUN; changed = true; } } }
		}
		return changed;
	}

	function propagateTwoRule(board) {
		let changed = false;
		for (let i = 0; i < board.size; i++) {
			for (let j = 0; j < board.size - 1; j++) {
				if (board.cells[i][j] !== EMPTY && board.cells[i][j] === board.cells[i][j + 1]) {
					const fill = board.cells[i][j] === SUN ? MOON : SUN;
					if (j - 1 >= 0 && board.cells[i][j - 1] === EMPTY) { board.cells[i][j - 1] = fill; changed = true; }
					if (j + 2 < board.size && board.cells[i][j + 2] === EMPTY) { board.cells[i][j + 2] = fill; changed = true; }
				}
				if (j + 2 < board.size && board.cells[i][j] !== EMPTY && board.cells[i][j] === board.cells[i][j + 2] && board.cells[i][j + 1] === EMPTY) {
					board.cells[i][j + 1] = board.cells[i][j] === SUN ? MOON : SUN; changed = true;
				}
				if (board.cells[j][i] !== EMPTY && board.cells[j][i] === board.cells[j + 1][i]) {
					const fill = board.cells[j][i] === SUN ? MOON : SUN;
					if (j - 1 >= 0 && board.cells[j - 1][i] === EMPTY) { board.cells[j - 1][i] = fill; changed = true; }
					if (j + 2 < board.size && board.cells[j + 2][i] === EMPTY) { board.cells[j + 2][i] = fill; changed = true; }
				}
				if (j + 2 < board.size && board.cells[j][i] !== EMPTY && board.cells[j][i] === board.cells[j + 2][i] && board.cells[j + 1][i] === EMPTY) {
					board.cells[j + 1][i] = board.cells[j][i] === SUN ? MOON : SUN; changed = true;
				}
			}
		}
		return changed;
	}

	function applyConstraints(board) {
		let changed = false;
		for (const constraint of board.constraints) {
			const [ar, ac] = constraint.a, [br, bc] = constraint.b;
			const cellA = board.cells[ar][ac], cellB = board.cells[br][bc];
			if (constraint.type === 0) {
				if (cellA === EMPTY && cellB !== EMPTY) { board.cells[ar][ac] = cellB; changed = true; }
				if (cellB === EMPTY && cellA !== EMPTY) { board.cells[br][bc] = cellA; changed = true; }
			}
			if (constraint.type === 1) {
				if (cellA === EMPTY && cellB !== EMPTY) { board.cells[ar][ac] = cellB === SUN ? MOON : SUN; changed = true; }
				if (cellB === EMPTY && cellA !== EMPTY) { board.cells[br][bc] = cellA === SUN ? MOON : SUN; changed = true; }
			}
		}
		return changed;
	}

	function propagate(board) {
		let changed = true;
		while (changed) { changed = false; changed |= propagateBalance(board); changed |= propagateTwoRule(board); changed |= applyConstraints(board); }
	}

	function findBestEmptyCell(board) {
		let bestCell = null, bestScore = -1;
		for (let row = 0; row < board.size; row++) {
			for (let col = 0; col < board.size; col++) {
				if (board.cells[row][col] !== EMPTY) continue;
				const score = board.cells[row].filter((c) => c !== EMPTY).length + board.cells.map((r) => r[col]).filter((c) => c !== EMPTY).length;
				if (score > bestScore) { bestScore = score; bestCell = [row, col]; }
			}
		}
		return bestCell;
	}

	function solve(board) {
		propagate(board);
		if (isContradiction(board)) return null;
		if (isFull(board)) return board;
		const [row, col] = findBestEmptyCell(board);
		for (const symbol of [SUN, MOON]) {
			const copy = cloneBoard(board);
			copy.cells[row][col] = symbol;
			const result = solve(copy);
			if (result) return result;
		}
		return null;
	}

	return { solve };
})();
