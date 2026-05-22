# LinkedIn Game Solver

<p align="center">
  <img src="https://github.com/user-attachments/assets/651164a7-f79d-4fa5-8e63-04c89bf12321" width="260" />
  <img src="https://github.com/user-attachments/assets/c010a6ef-5403-497f-955f-172abd5438b1" width="260" />
</p>

<p align="center">
  A lightweight Chrome extension that automatically solves LinkedIn Games directly in the browser.
</p>

<p align="center">
  Supports Queens • Tango • Zip • Sudoku
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-Extension-green" />
  <img src="https://img.shields.io/badge/Manifest-V3-blue" />
  <img src="https://img.shields.io/badge/License-MIT-purple" />
  <img src="https://img.shields.io/badge/Status-Active-success" />
</p>

---

# Demo
<p align="center">
  <img src="https://github.com/user-attachments/assets/0ace77f9-53b7-4e4d-9e2a-f0f284c590ee" width="850" />
</p>

---

# Features

| Feature | Description |
|---|---|
| Auto Detection | Automatically detects the current LinkedIn game |
| Instant Solving | Solves puzzles in milliseconds |
| Highlight Mode | Preview the solution before solving |
| Human-like Delay | Adds randomized click timing |
| Adjustable Speed | Configure solving playback speed |
| Per-Game Controls | Enable or disable individual solvers |
| Cached Boards | Previously solved boards load instantly |
| Auto Solve | Automatically solve puzzles on page load |

---

# Supported Games

| Game | Status |
|---|---|
| Queens | ✅ Supported |
| Tango | ✅ Supported |
| Zip | ✅ Supported |
| Sudoku | ✅ Supported |

---

# Quick Start

## 1. Clone the Repository

```bash
git clone https://github.com/yourusername/linkedin-game-solver.git
cd linkedin-game-solver
```

## 2. Open Chrome Extensions

Navigate to:

```text
chrome://extensions/
```

Enable:

- Developer Mode

## 3. Load the Extension

Click:

```text
Load unpacked
```

Then select the project folder.

---

# Interface

## Main Control Panel

<p align="center">
  <img src="https://github.com/user-attachments/assets/651164a7-f79d-4fa5-8e63-04c89bf12321" width="320" />
</p>

The main panel lets you:

- Enable or disable the extension
- Toggle game-specific solvers
- Solve the current puzzle instantly
- View active solver status

---

## Settings Panel

<p align="center">
  <img src="https://github.com/user-attachments/assets/c010a6ef-5403-497f-955f-172abd5438b1" width="320" />
</p>

Settings include:

- Solve speed adjustment
- Auto-solve on page load
- Highlight solution mode
- Human-like click delays

---

# How It Works

## 1. Game Detection

`content.js` automatically detects supported LinkedIn games using:

- URL patterns
- DOM selectors
- Grid analysis

---

## 2. Board Scraping

The extension extracts the active board state directly from the page.

---

## 3. Solver Execution

Each game uses a dedicated solving engine:

- Constraint propagation
- Recursive backtracking
- Rule-based deduction
- Pathfinding algorithms

---

## 4. Solution Playback

The extension can either:

- Highlight the correct solution
- Automatically simulate puzzle completion

---

# Solver Implementations

<details>
<summary><strong>Queens Solver</strong></summary>

Uses constraint satisfaction and placement validation to ensure:

- One queen per row
- One queen per column
- No adjacent queens
- Region constraints

</details>

<details>
<summary><strong>Tango Solver</strong></summary>

Implements:

- Constraint propagation
- Balance rules
- Adjacent duplication prevention
- Recursive backtracking

</details>

<details>
<summary><strong>Zip Solver</strong></summary>

Uses depth-first search and pathfinding to:

- Visit all cells
- Respect wall constraints
- Traverse checkpoints in order

</details>

<details>
<summary><strong>Sudoku Solver</strong></summary>

Solves Sudoku boards using:

- Candidate elimination
- Recursive backtracking
- Row/column/subgrid validation

</details>

---

# Project Structure

```text
linkedin-game-solver/
│
├── manifest.json
├── content.js
├── popup.js
├── index.html
│
├── queens.js
├── tango.js
├── zip.js
├── sudoku.js
│
└── icons/
```

---

# Configuration

| Setting | Description |
|---|---|
| Master Toggle | Enable or disable the extension |
| Auto Solve | Automatically solve puzzles on load |
| Highlight Solution | Preview solutions before clicking |
| Human-like Delay | Add randomized timing between clicks |
| Solve Speed | Adjust playback speed |
| Per-Game Toggles | Enable or disable specific solvers |

Settings are stored using Chrome Sync Storage.

---

# Permissions

| Permission | Purpose |
|---|---|
| activeTab | Access active LinkedIn game tabs |
| scripting | Inject solving scripts |
| storage | Save extension settings |

Host permissions:

```text
https://www.linkedin.com/*
https://*.linkedin.com/*
```

---

# Development

## Manifest Version

```text
Manifest V3
```

## Built With

- Vanilla JavaScript
- Chrome Extension APIs
- DOM Manipulation
- Backtracking Algorithms
- Constraint Propagation

---

# Debugging

To inspect extension logs:

1. Open Chrome DevTools
2. Navigate to the Console tab
3. Look for:

```text
[Solver Log]
```

---

# Limitations

- Only works on supported LinkedIn games
- LinkedIn DOM changes may require selector updates
- Large puzzle boards may solve slower

---

# Future Improvements

Planned enhancements:

- Additional LinkedIn game support
- Faster heuristic solvers
- Animated solve playback
- Better mobile support
- Solver benchmarks and analytics
- Puzzle import/export

---

# Contributing

Contributions are welcome.

Potential contribution areas:

- Improve solving performance
- Add support for new games
- Refactor UI components
- Improve DOM resilience
- Add testing and benchmarking

---

# Disclaimer

This project is intended for educational and entertainment purposes only.

LinkedIn and all associated games are property of their respective owners.

---

# License

MIT License

---

<p align="center">
  Built with JavaScript • Chrome Extensions API • Puzzle Solvers
</p>
