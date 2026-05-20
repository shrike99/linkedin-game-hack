const board = {
	size: 6,

	// 0 = EMPTY, N = NUMBERED CHECKPOINT THE PATH MUST GO THROUGH
	cells: [
		[0, 0, 0, 0, 0, 0],
		[0, 0, 5, 0, 0, 0],
		[3, 0, 1, 0, 0, 0],
		[0, 0, 0, 2, 0, 4],
		[0, 0, 0, 6, 0, 0],
		[0, 0, 0, 0, 0, 0],
	],

	walls: [
		{ from: [0, 1], to: [1, 1] },
		{ from: [0, 2], to: [1, 2] },

		{ from: [2, 1], to: [2, 2] },
		{ from: [3, 1], to: [3, 2] },

		{ from: [2, 3], to: [2, 4] },
		{ from: [3, 3], to: [3, 4] },

		{ from: [4, 3], to: [5, 3] },
		{ from: [4, 4], to: [5, 4] },
	],
};

function printBoard(board) {
	const n = board.size;

	// build wall set for O(1) lookup
	const wallSet = buildWallSet(board.walls);

	// top border
	let top = '┌';
	for (let c = 0; c < n; c++) {
		top += '───';
		top += c < n - 1 ? '┬' : '┐';
	}
	console.log(top);

	for (let r = 0; r < n; r++) {
		// cell row
		let row = '│';
		for (let c = 0; c < n; c++) {
			const val = board.cells[r][c];
			row += val !== 0 ? ` ${val} ` : ' . ';
			if (c < n - 1) {
				// vertical wall between (r,c) and (r,c+1)
				row += hasWall(wallSet, r, c, r, c + 1) ? '┃' : '│';
			}
		}
		row += '│';
		console.log(row);

		// horizontal separator row
		if (r < n - 1) {
			let sep = '├';
			for (let c = 0; c < n; c++) {
				// horizontal wall between (r,c) and (r+1,c)
				sep += hasWall(wallSet, r, c, r + 1, c) ? '━━━' : '───';
				if (c < n - 1) sep += '┼';
			}
			sep += '┤';
			console.log(sep);
		}
	}

	// bottom border
	let bottom = '└';
	for (let c = 0; c < n; c++) {
		bottom += '───';
		bottom += c < n - 1 ? '┴' : '┘';
	}
	console.log(bottom);
}

function buildWallSet(walls) {
	const set = new Set();
	for (const { from, to } of walls) {
		// store both directions
		set.add(`${from}-${to}`);
		set.add(`${to}-${from}`);
	}
	return set;
}

function hasWall(wallSet, r1, c1, r2, c2) {
	return wallSet.has(`${r1},${c1}-${r2},${c2}`);
}

function solve(board) {}

printBoard(board);
