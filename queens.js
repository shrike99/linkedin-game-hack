const queensSolver = (() => {
	function isValid(board, row, col) {
		for (let r = 0; r < row; r++) {
			const c = board.queens[r];
			if (c === -1) continue;
			if (c === col) return false;
			if (Math.abs(r - row) <= 1 && Math.abs(c - col) <= 1) return false;
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

	function forcedPlacement(board, row) {
		const candidates = getCandidates(board, row);
		if (candidates.length === 1) return candidates[0];
		return -1;
	}

	function solve(board, row = 0) {
		if (row === board.size) return true;
		const forced = forcedPlacement(board, row);
		if (forced !== -1) {
			board.queens[row] = forced;
			if (solve(board, row + 1)) return true;
			board.queens[row] = -1;
			return false;
		}
		const candidates = getCandidates(board, row);
		if (candidates.length === 0) return false;
		for (const col of candidates) {
			board.queens[row] = col;
			if (solve(board, row + 1)) return true;
			board.queens[row] = -1;
		}
		return false;
	}

	return { solve };
})();
