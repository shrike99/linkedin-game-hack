const EMPTY = 0,
	SUN = 1,
	MOON = 2;

const board = {
	cells: [
		[0, 0, 0, 0, 0, 0],
		[0, 2, 2, 0, 0, 0],
		[0, 2, 0, 0, 0, 0],
		[0, 0, 0, 2, 1, 0],
		[0, 0, 0, 2, 0, 0],
		[0, 0, 0, 0, 0, 1],
	],

	size: 6,

	// type 0 = same (=), type 1 = different (x)
	constraints: [
		{ a: [0, 0], b: [0, 1], type: 0 },
		{ a: [0, 0], b: [1, 0], type: 0 },
		{ a: [2, 2], b: [2, 3], type: 0 },
		{ a: [2, 2], b: [3, 2], type: 1 },
		{ a: [4, 4], b: [4, 5], type: 1 },
		{ a: [4, 4], b: [5, 4], type: 0 },
	],
};

function cloneBoard(board) {
	return {
		size: board.size,
		cells: board.cells.map((row) => [...row]),
		constraints: board.constraints, // SAFE TO SHARE
	};
}

function isFull(board) {
	return board.cells.every((row) => row.every((c) => c !== EMPTY));
}

function printBoard(board) {
	const symbols = { 0: '.', 1: '☀', 2: '☾' };
	console.log('┌' + '───┬'.repeat(board.size - 1) + '───┐');
	board.cells.forEach((row, i) => {
		console.log('│ ' + row.map((c) => symbols[c]).join(' │ ') + ' │');
		if (i < board.size - 1) console.log('├' + '───┼'.repeat(board.size - 1) + '───┤');
	});
	console.log('└' + '───┴'.repeat(board.size - 1) + '───┘');
}

// CONTRADICTION DETECTION
function isContradiction(board) {
	const half = board.size / 2;

	for (let i = 0; i < board.size; i++) {
		const row = board.cells[i];
		const col = board.cells.map((r) => r[i]);

		for (const line of [row, col]) {
			// too many of either symbol
			if (line.filter((c) => c === SUN).length > half) return true;
			if (line.filter((c) => c === MOON).length > half) return true;

			// three in a row
			for (let j = 0; j < board.size - 2; j++) {
				if (line[j] !== EMPTY && line[j] === line[j + 1] && line[j] === line[j + 2]) return true;
			}
		}
	}

	// CONSTRAINTS VIOLATED
	for (const constraint of board.constraints) {
		const [ar, ac] = constraint.a;
		const [br, bc] = constraint.b;
		const cellA = board.cells[ar][ac];
		const cellB = board.cells[br][bc];
		if (cellA === EMPTY || cellB === EMPTY) continue;

		if (constraint.type === 0 && cellA !== cellB) return true;
		if (constraint.type === 1 && cellA === cellB) return true;
	}

	return false;
}

// PROPAGATION

// IF ROW/COLUMN HAS 3 SYMBOLS, FILL THE REST WITH THE OTHER
function propagateBalance(board) {
	let changed = false;
	const half = board.size / 2;

	for (let i = 0; i < board.size; i++) {
		const row = board.cells[i];
		const rowSuns = row.filter((c) => c === SUN).length;
		const rowMoons = row.filter((c) => c === MOON).length;

		if (rowSuns === half) {
			for (let col = 0; col < board.size; col++) {
				if (board.cells[i][col] === EMPTY) {
					board.cells[i][col] = MOON;
					changed = true;
				}
			}
		} else if (rowMoons === half) {
			for (let col = 0; col < board.size; col++) {
				if (board.cells[i][col] === EMPTY) {
					board.cells[i][col] = SUN;
					changed = true;
				}
			}
		}

		const colVals = board.cells.map((r) => r[i]);
		const colSuns = colVals.filter((c) => c === SUN).length;
		const colMoons = colVals.filter((c) => c === MOON).length;

		if (colSuns === half) {
			for (let row = 0; row < board.size; row++) {
				if (board.cells[row][i] === EMPTY) {
					board.cells[row][i] = MOON;
					changed = true;
				}
			}
		} else if (colMoons === half) {
			for (let row = 0; row < board.size; row++) {
				if (board.cells[row][i] === EMPTY) {
					board.cells[row][i] = SUN;
					changed = true;
				}
			}
		}
	}

	return changed;
}

// [X, X, ?] → fill ? with opposite
// [?, X, X] → fill ? with opposite
// [X, ?, X] → fill ? with opposite  (sandwich rule)
function propagateTwoRule(board) {
	let changed = false;

	for (let i = 0; i < board.size; i++) {
		for (let j = 0; j < board.size - 1; j++) {
			// ROWS
			// XX? and ?XX pattern
			if (board.cells[i][j] !== EMPTY && board.cells[i][j] === board.cells[i][j + 1]) {
				const fill = board.cells[i][j] === SUN ? MOON : SUN;
				if (j - 1 >= 0 && board.cells[i][j - 1] === EMPTY) {
					board.cells[i][j - 1] = fill;
					changed = true;
				}
				if (j + 2 < board.size && board.cells[i][j + 2] === EMPTY) {
					board.cells[i][j + 2] = fill;
					changed = true;
				}
			}

			// X?X sandwich pattern
			if (j + 2 < board.size && board.cells[i][j] !== EMPTY && board.cells[i][j] === board.cells[i][j + 2] && board.cells[i][j + 1] === EMPTY) {
				board.cells[i][j + 1] = board.cells[i][j] === SUN ? MOON : SUN;
				changed = true;
			}

			// COLUMNS
			// XX? and ?XX pattern
			if (board.cells[j][i] !== EMPTY && board.cells[j][i] === board.cells[j + 1][i]) {
				const fill = board.cells[j][i] === SUN ? MOON : SUN;
				if (j - 1 >= 0 && board.cells[j - 1][i] === EMPTY) {
					board.cells[j - 1][i] = fill;
					changed = true;
				}
				if (j + 2 < board.size && board.cells[j + 2][i] === EMPTY) {
					board.cells[j + 2][i] = fill;
					changed = true;
				}
			}

			// X?X sandwich pattern
			if (j + 2 < board.size && board.cells[j][i] !== EMPTY && board.cells[j][i] === board.cells[j + 2][i] && board.cells[j + 1][i] === EMPTY) {
				board.cells[j + 1][i] = board.cells[j][i] === SUN ? MOON : SUN;
				changed = true;
			}
		}
	}

	return changed;
}

// APPLY CONSTRAINTS
function applyConstraints(board) {
	let changed = false;

	for (const constraint of board.constraints) {
		const [ar, ac] = constraint.a;
		const [br, bc] = constraint.b;
		const cellA = board.cells[ar][ac];
		const cellB = board.cells[br][bc];

		if (constraint.type === 0) {
			// = : must be same
			if (cellA === EMPTY && cellB !== EMPTY) {
				board.cells[ar][ac] = cellB;
				changed = true;
			}
			if (cellB === EMPTY && cellA !== EMPTY) {
				board.cells[br][bc] = cellA;
				changed = true;
			}
		}

		if (constraint.type === 1) {
			// x : must be different
			if (cellA === EMPTY && cellB !== EMPTY) {
				board.cells[ar][ac] = cellB === SUN ? MOON : SUN;
				changed = true;
			}
			if (cellB === EMPTY && cellA !== EMPTY) {
				board.cells[br][bc] = cellA === SUN ? MOON : SUN;
				changed = true;
			}
		}
	}

	return changed;
}

function propagate(board) {
	let changed = true;
	while (changed) {
		changed = false;
		changed |= propagateBalance(board);
		changed |= propagateTwoRule(board);
		changed |= applyConstraints(board);
	}
}

// BACKTRACKING
// PICK THE EMPTY CELL IN TEH MOST CONSTRAINED ROW OR COLUMN (MRV HEURISTIC)
function findBestEmptyCell(board) {
	const half = board.size / 2;
	let bestCell = null;
	let bestScore = -1;

	for (let row = 0; row < board.size; row++) {
		for (let col = 0; col < board.size; col++) {
			if (board.cells[row][col] !== EMPTY) continue;

			const rowFilled = board.cells[row].filter((c) => c !== EMPTY).length;
			const colFilled = board.cells.map((r) => r[col]).filter((c) => c !== EMPTY).length;
			const score = rowFilled + colFilled;

			if (score > bestScore) {
				bestScore = score;
				bestCell = [row, col];
			}
		}
	}

	return bestCell;
}

function solve(board) {
	// 1. DEDUCE EVERYTHING POSSIBLE
	propagate(board);

	// 2. CHECK IF WE'VE HIT A CONTRADICTION
	if (isContradiction(board)) return null;

	// 3. CHECK IF SOLVED
	if (isFull(board)) return board;

	// 4. PICK BEST EMPTY CELL AND TRY BOTH SYMBOLS
	const [row, col] = findBestEmptyCell(board);

	for (const symbol of [SUN, MOON]) {
		const copy = cloneBoard(board);
		copy.cells[row][col] = symbol;
		const result = solve(copy);
		if (result) return result;
	}

	return null; // BOTH GUESSES LED TO CONTRADICTION, TRIGGER BACKTRACK
}

console.log('Initial board:');
printBoard(board);

start = performance.now();
const result = solve(cloneBoard(board));
end = performance.now();

if (result) {
	console.log('\nSolved!');
	printBoard(result);
	console.log('TIME TAKEN: ' + (end - start) + 'ms');
} else {
	console.log('\nNo solution found.');
}
