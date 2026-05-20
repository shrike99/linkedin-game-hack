// ── SUDOKU SOLVER ────────────────────────────────────────────────────────────
const sudokuSolver = (() => {
	function isValid(board, row, column, number) {
		for (let i = 0; i < 6; i++) {
			if (board[row][i] == number || board[i][column] == number) return false;
		}
		const startRow = row - (row % 2);
		const startColumn = column - (column % 3);
		for (let i = 0; i < 2; i++) {
			for (let j = 0; j < 3; j++) {
				if (board[i + startRow][j + startColumn] == number) return false;
			}
		}
		return true;
	}

	function solve(board) {
		for (let row = 0; row < 6; row++) {
			for (let column = 0; column < 6; column++) {
				if (board[row][column] == 0) {
					for (let i = 1; i <= 6; i++) {
						if (isValid(board, row, column, i)) {
							board[row][column] = i;
							if (solve(board)) return true;
							board[row][column] = 0;
						}
					}
					return false;
				}
			}
		}
		return true;
	}

	return { solve };
})();
