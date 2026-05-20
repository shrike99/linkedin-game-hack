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

function solve(board) {
	const n = board.size;
	const wallSet = buildWallSet(board.walls);

	// FIND CHECKPOINTS IN ORDER: {1: [row, column], 2: [row, column], ...}
	const checkpoints = {};
	for (let row = 0; row < n; row++) {
		for (let column = 0; column < n; column++) {
			if (board.cells[row][column] !== 0) checkpoints[board.cells[row][column]] = [row, column];
		}
	}

	const numCheckpoints = Object.keys(checkpoints).length;
	const totalCells = n * n;

	// PATH = ORDERED LIST OF [row, column] VISITED SO FAR
	// VISITED = SET OF "ROW, COLUMN" STRINGS FOR O(1) LOOKUP
	const [startRow, startColumn] = checkpoints[1];
	const path = [[startRow, startColumn]];
	const visited = new Set([`${startRow},${startColumn}`]);

	const directions = [
		[-1, 0],
		[1, 0],
		[0, -1],
		[0, 1],
	]; // UP DOWN LEFT RIGHT

	function backtrack(r, c, nextWaypoint) {
		// IF ALL CELLS VISITED AND WE HAVE HIT ALL CHECKPOINTS ITS SOLVED
		if (path.length === totalCells) {
			return nextWaypoint > numCheckpoints;
		}

		for (const [dr, dc] of directions) {
			const newRow = r + dr;
			const newColumn = c + dc;
			const key = `${newRow},${newColumn}`;

			// OUT OF BOUNDS
			if (newRow < 0 || newRow >= n || newColumn < 0 || newColumn >= n) continue;

			// ALREADY VISITED
			if (visited.has(key)) continue;

			// WALL BLOCKS THIS MOVE
			if (hasWall(wallSet, r, c, newRow, newColumn)) continue;

			const cellVal = board.cells[newRow][newColumn];

			// IF CELL IS A CHECKPOINT, IT MUST BE THE NEXT ONE IN SEQUENCE
			if (cellVal !== 0 && cellVal !== nextWaypoint) continue;

			visited.add(key);
			path.push([newRow, newColumn]);

			const newNext = cellVal === nextWaypoint ? nextWaypoint + 1 : nextWaypoint;

			if (backtrack(newRow, newColumn, newNext)) return true;

			visited.delete(key);
			path.pop();
		}

		return false;
	}

	const solved = backtrack(startRow, startColumn, 2);

	if (solved) return path;
	return null;
}

function printSolved(board) {
	// build a direction map for pretty printing
	const arrows = { '-1,0': '↑', '1,0': '↓', '0,-1': '←', '0,1': '→' };
	const pathMap = new Map();
	for (let i = 0; i < result.length - 1; i++) {
		const [r, c] = result[i];
		const [nr, nc] = result[i + 1];
		pathMap.set(`${r},${c}`, arrows[`${nr - r},${nc - c}`]);
	}
	// last cell
	const [lr, lc] = result[result.length - 1];
	pathMap.set(`${lr},${lc}`, '■');

	// override printBoard to show path arrows
	const boardWithPath = {
		...board,
		cells: board.cells.map((row, r) =>
			row.map((val, c) => {
				if (val == 1) return val; // only keep start
				return pathMap.get(`${r},${c}`) ?? '.';
			}),
		),
	};

	console.log(printBoard(boardWithPath));
}

printBoard(board);

const result = solve(board);

console.log('Solved! Path:');

printSolved(board);
