const zipSolver = (() => {
	function buildWallSet(walls) {
		const set = new Set();
		for (const { from, to } of walls) {
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
		const checkpoints = {};
		for (let row = 0; row < n; row++) {
			for (let column = 0; column < n; column++) {
				if (board.cells[row][column] !== 0) checkpoints[board.cells[row][column]] = [row, column];
			}
		}
		const numCheckpoints = Object.keys(checkpoints).length;
		const totalCells = n * n;
		const [startRow, startColumn] = checkpoints[1];
		const path = [[startRow, startColumn]];
		const visited = new Set([`${startRow},${startColumn}`]);
		const directions = [
			[-1, 0],
			[1, 0],
			[0, -1],
			[0, 1],
		];

		function backtrack(r, c, nextWaypoint) {
			if (path.length === totalCells) return nextWaypoint > numCheckpoints;
			for (const [dr, dc] of directions) {
				const newRow = r + dr,
					newColumn = c + dc;
				const key = `${newRow},${newColumn}`;
				if (newRow < 0 || newRow >= n || newColumn < 0 || newColumn >= n) continue;
				if (visited.has(key)) continue;
				if (hasWall(wallSet, r, c, newRow, newColumn)) continue;
				const cellVal = board.cells[newRow][newColumn];
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

		return backtrack(startRow, startColumn, 2) ? path : null;
	}

	return { solve };
})();
