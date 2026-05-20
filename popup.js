const speedSteps = [50, 100, 250, 500, 1000];
const speedLabels = ['50 ms', '100 ms', '250 ms', '500 ms', '1000 ms'];

const masterToggle = document.getElementById('masterToggle');
const headerDot = document.getElementById('headerDot');
const gamesSection = document.getElementById('gamesSection');
const settingsSection = document.getElementById('settingsSection');
const solveBtn = document.getElementById('solveBtn');
const speedSlider = document.getElementById('speedSlider');
const speedLabel = document.getElementById('speedLabel');
const statusText = document.getElementById('statusText');
const statusMsg = document.getElementById('statusMsg');

// ── LOAD SAVED SETTINGS ──
chrome.storage.sync.get(
	{
		enabled: true,
		autoSolve: false,
		highlight: true,
		jitter: true,
		speed: 2,
		games: { queens: true, tango: true, zip: true, sudoku: true },
	},
	(s) => {
		masterToggle.checked = s.enabled;
		document.getElementById('autoSolve').checked = s.autoSolve;
		document.getElementById('highlight').checked = s.highlight;
		document.getElementById('jitter').checked = s.jitter;
		document.getElementById('toggleQueens').checked = s.games.queens;
		document.getElementById('toggleTango').checked = s.games.tango;
		document.getElementById('toggleZip').checked = s.games.zip;
		document.getElementById('toggleSudoku').checked = s.games.sudoku;
		speedSlider.value = s.speed;
		speedLabel.textContent = speedLabels[s.speed];
		if (!s.enabled) {
			headerDot.classList.add('off');
			gamesSection.classList.add('games-overlay');
			settingsSection.classList.add('games-overlay');
			solveBtn.disabled = true;
		}
		setStatus('idle');
	},
);

// ── SAVE ON CHANGE ──
function saveSettings() {
	chrome.storage.sync.set({
		enabled: masterToggle.checked,
		autoSolve: document.getElementById('autoSolve').checked,
		highlight: document.getElementById('highlight').checked,
		jitter: document.getElementById('jitter').checked,
		speed: parseInt(speedSlider.value),
		games: {
			queens: document.getElementById('toggleQueens').checked,
			tango: document.getElementById('toggleTango').checked,
			zip: document.getElementById('toggleZip').checked,
			sudoku: document.getElementById('toggleSudoku').checked,
		},
	});
}

document.querySelectorAll('input').forEach((el) => el.addEventListener('change', saveSettings));

masterToggle.addEventListener('change', () => {
	const on = masterToggle.checked;
	headerDot.classList.toggle('off', !on);
	gamesSection.classList.toggle('games-overlay', !on);
	settingsSection.classList.toggle('games-overlay', !on);
	solveBtn.disabled = !on;
	setStatus(on ? 'idle' : 'off');
});

speedSlider.addEventListener('input', () => {
	speedLabel.textContent = speedLabels[speedSlider.value];
});

// ── SOLVE BUTTON ──
solveBtn.addEventListener('click', () => {
	setStatus('solving');
	solveBtn.disabled = true;
	solveBtn.innerHTML = `
        <svg viewBox="0 0 13 13" fill="none" style="animation:spin 0.7s linear infinite">
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="20" stroke-dashoffset="10"/>
        </svg>Solving…`;

	chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
		chrome.tabs.sendMessage(tab.id, { type: 'SOLVE' }, (response) => {
			const ok = response?.success;
			setStatus(ok ? 'success' : 'error');
			solveBtn.disabled = false;
			solveBtn.innerHTML = `
            <svg viewBox="0 0 13 13" fill="none">
              <path d="M2 6.5L5 9.5L11 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>Solve Current Game`;
		});
	});
});

function setStatus(state) {
	statusText.className = 'status-text';
	if (state === 'idle') statusMsg.textContent = 'Waiting for game…';
	if (state === 'off') statusMsg.textContent = 'Solver disabled';
	if (state === 'solving') {
		statusText.classList.add('solving');
		statusMsg.textContent = 'Solving…';
	}
	if (state === 'success') {
		statusText.classList.add('success');
		statusMsg.textContent = 'Solved!';
		setTimeout(() => setStatus('idle'), 3000);
	}
	if (state === 'error') {
		statusText.classList.add('error');
		statusMsg.textContent = 'No solution found';
		setTimeout(() => setStatus('idle'), 3000);
	}
}
