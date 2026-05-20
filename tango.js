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

	// 0 MEANS =
	// 1 MEANS x
	constraints: [
		{ a: [0, 0], b: [0, 1], type: 0 },
		{ a: [0, 0], b: [1, 0], type: 0 },
		{ a: [2, 2], b: [2, 3], type: 0 },
		{ a: [2, 2], b: [3, 2], type: 1 },
		{ a: [4, 4], b: [4, 5], type: 1 },
		{ a: [4, 4], b: [5, 4], type: 0 },
	],
};

function solve(board) {
	return applyRules(board);
}

// APPLIES BASIC RULES TO THE BOARD (DEDUCE EVERYTHING POSSIBLE FROM CURRENT POSITION)
function applyRules(board) {
	let changed = false;

	while ((changed = false)) {
		changed = false;

		// IF A ROW/COLUMN ALREADY HAS 3 SUNS/MOONS, FILL THE REST WITH THE OPPOSITE
		changed = propagateBalance(board);

		// IF TWO CONSECUTIVE CELLS ARE THE SAME, THE ADJACENT CELLS MUST BE THE OPPOSITE
		changed = changed || propogateTwoRule(board);

		changed = changed || applyConstraints(board);
	}

	return board;
}

function applyConstraints(board) {
	let changed = false;

	for (const constraint of board.constraints) {
		const [ar, ac] = constraint.a;
		const [br, bc] = constraint.b;

		const cellA = board.cells[ar][ac];
		const cellB = board.cells[br][bc];

		if (constraint.type === 0) {
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

function propagateTwoRule(board) {
	let changed = false;

	for (let i = 0; i < board.size; i++) {
		for (let j = 0; j < board.size - 1; j++) {
			// ROWS
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

			// COLUMNS
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
		}
	}

	return changed;
}

function propagateBalance(board) {
	let changed = false;

	for (let i = 0; i < board.size; i++) {
		// ROW
		const row = board.cells[i];
		const rowSuns = row.filter((c) => c === SUN).length;
		const rowMoons = row.filter((c) => c === MOON).length;

		if (rowSuns === 3) {
			// FILL REMAINING WITH MOON
			for (let col = 0; col < board.size; col++) {
				if (board.cells[i][col] === EMPTY) {
					board.cells[i][col] = MOON;
					changed = true;
				}
			}
		} else if (rowMoons === 3) {
			// FILL REMAINING WITH SUNS
			for (let col = 0; col < board.size; col++) {
				if (board.cells[i][col] === EMPTY) {
					board.cells[i][col] = SUN;
					changed = true;
				}
			}
		}

		// COLUMN
		const colVals = board.cells.map((r) => r[i]);
		const colSuns = colVals.filter((c) => c === SUN).length;
		const colMoons = colVals.filter((c) => c === MOON).length;

		if (colSuns === 3) {
			for (let row = 0; row < board.size; row++) {
				if (board.cells[row][i] === EMPTY) {
					board.cells[row][i] = MOON;
					changed = true;
				}
			}
		} else if (colMoons === 3) {
			for (let row = 0; row < board.size; row++) {
				if (board.cells[row][i] === EMPTY) {
					board.cells[row][i] = SUN;
					changed = true;
				}
			}
		}
	}

	return changed; // TELLS THE PROPOGATION LOOP WHETHER TO KEEP GOING
}

console.log(solve(board));
