const board = {
	size: 8,
	regions: [
		[1, 1, 1, 1, 1, 1, 2, 2],
		[1, 1, 1, 1, 1, 1, 2, 2],
		[1, 1, 1, 1, 1, 3, 4, 4],
		[1, 1, 1, 5, 5, 4, 4, 4],
		[1, 1, 1, 5, 5, 4, 6, 6],
		[1, 1, 7, 4, 4, 4, 6, 6],
		[8, 8, 4, 4, 6, 4, 6, 6],
		[8, 8, 4, 6, 6, 6, 6, 6],
	],

	// QUEENS[ROW] = COLUMN
	queens: [-1, -1, -1, -1, -1, -1, -1, -1],
};

function isValid(board, row, col) {
	for (let r = 0; r < row; r++) {
		const c = board.queens[r];
		if (c === -1) continue;

		// SAME COLUMN
		if (c === col) return false;

		// TOUCHING
		if (Math.abs(r - row) <= 1 && Math.abs(c - col) <= 1) return false;

		// SAME REGION
		if (board.regions[r][c] === board.regions[row][col]) return false;
	}
	return true;
}

function getCandidates(board, row) {
	const candidates = [];
	for (let col = 0; col < board.size; col++) {
		if (isValid(board, row, col)) candidates.push(col);
	}
	return candidates;
}

// RETURNS THE COLUMN IF ONLY ONE CANDIDATE EXISTS FOR THIS ROW, ELSE -1
function forcedPlacement(board, row) {
	const candidates = getCandidates(board, row);
	if (candidates.length === 1) return candidates[0];
	return -1;
}

function solve(board, row = 0) {
	if (row === board.size) return true; // ALL QUEENS PLACED

	// PROPAGATION: IF ONLY ONE CANDIDATE, PLACE IT
	const forced = forcedPlacement(board, row);
	if (forced !== -1) {
		board.queens[row] = forced;
		if (solve(board, row + 1)) return true;
		board.queens[row] = -1;
		return false;
	}

	// BACKTRACKING
	const candidates = getCandidates(board, row);
	if (candidates.length === 0) return false; // DEAD END

	for (const col of candidates) {
		board.queens[row] = col;
		if (solve(board, row + 1)) return true;
		board.queens[row] = -1;
	}

	return false;
}

// MAPS REGION INDEX WITH COLOUR
const REGION_COLOURS = [
	'\x1b[41m', // red
	'\x1b[42m', // green
	'\x1b[43m', // yellow
	'\x1b[44m', // blue
	'\x1b[45m', // magenta
	'\x1b[46m', // cyan
	'\x1b[103m', // bright yellow
	'\x1b[47m', // white
];
const RESET = '\x1b[0m';
const QUEEN = 'Q';
const EMPTY = '.';

function printBoard(board) {
	const n = board.size;
	const queenSet = new Set(board.queens.map((col, row) => (col !== -1 ? `${row},${col}` : null)).filter(Boolean));

	const top = '┌' + '───┬'.repeat(n - 1) + '───┐';
	const mid = '├' + '───┼'.repeat(n - 1) + '───┤';
	const bottom = '└' + '───┴'.repeat(n - 1) + '───┘';

	console.log(top);
	board.regions.forEach((row, r) => {
		const line = row.map((region, c) => {
			const colour = REGION_COLOURS[region] || '';
			const symbol = queenSet.has(`${r},${c}`) ? QUEEN : EMPTY;
			return `${colour} ${symbol} ${RESET}`;
		});
		console.log('│' + line.join('│') + '│');
		if (r < n - 1) console.log(mid);
	});
	console.log(bottom);
}

//console.log('Initial board:');
//printBoard(board);

//const start = performance.now();
//const solved = solve(board);
//const end = performance.now();

//if (solved) {
//	console.log('\nSolved!');
//	printBoard(board);
//} else {
//	console.log('\nNo solution found.');
//}

//console.log('TIME TAKEN: ' + (end - start).toFixed(3) + 'ms');
