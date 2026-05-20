function solve(board) {
	for (let row = 0; row < 6; row++) {
		for (let column = 0; column < 6; column++) {
			if (board[row][column] == 0) {
				// FIND EMPTY CELL
				for (var i = 1; i <= 6; i++) {
					if (isValid(board, row, column, i)) {
						board[row][column] = i;

						if (solve(board)) return true;

						// BACKTRACK IF NUMBER DOESNT LEAD TO A SOLUTION
						board[row][column] = 0;
					}
				}

				return false; // NO VALID NUMBER FOUND, TRIGGER BACKTRACK
			}
		}
	}

	return true; //PUZZLE SOLVED
}

function printBoard(board) {
	const rows = board.length;

	const top = '╔═══╤═══╤═══╦═══╤═══╤═══╗';
	const midThin = '╟───┼───┼───╫───┼───┼───╢';
	const midBold = '╠═══╪═══╪═══╬═══╪═══╪═══╣';
	const bottom = '╚═══╧═══╧═══╩═══╧═══╧═══╝';

	console.log(top);
	board.forEach((row, i) => {
		const line = '║ ' + row[0] + ' │ ' + row[1] + ' │ ' + row[2] + ' ║ ' + row[3] + ' │ ' + row[4] + ' │ ' + row[5] + ' ║';
		console.log(line);
		if (i < rows - 1) console.log(i === 1 || i === 3 ? midBold : midThin);
	});
	console.log(bottom);
}

function isValid(board, row, column, number) {
	// CHECK ROW AND COLUMN
	for (let i = 0; i < 6; i++) {
		if (board[row][i] == number || board[i][column] == number) return false;
	}

	// CHECK 3X2 BOX
	const startRow = row - (row % 2);
	const startColumn = column - (column % 3);

	for (let i = 0; i < 2; i++) {
		for (let j = 0; j < 3; j++) {
			if (board[i + startRow][j + startColumn] == number) return false;
		}
	}

	return true;
}

board = [
	[0, 1, 2, 3, 4, 0],
	[5, 0, 0, 0, 0, 6],
	[1, 0, 0, 0, 0, 2],
	[3, 0, 0, 0, 0, 1],
	[4, 0, 0, 0, 0, 3],
	[0, 3, 5, 6, 1, 0],
];

start = performance.now();
solve(board);
end = performance.now();

printBoard(board);
console.log('TIME TAKEN: ' + (end - start) + 'ms');
