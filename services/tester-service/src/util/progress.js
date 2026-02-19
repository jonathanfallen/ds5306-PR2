"use strict";

const readline = require("readline");

// ------------------------------------------------------------
// Spinner
// ------------------------------------------------------------
function startSpinner(text = "Running") {
  const frames = ["|", "/", "-", "\\"];
  let i = 0;
  let stopped = false;

  // Only animate if we're in a TTY; otherwise just log once.
  const isTTY = !!process.stdout.isTTY;

  if (!isTTY) {
    process.stdout.write(`${text}\n`);
    return {
      stop: (finalText) => finalText && process.stdout.write(`${finalText}\n`),
      fail: (finalText) => finalText && process.stderr.write(`${finalText}\n`),
    };
  }

  process.stdout.write(`${frames[0]} ${text}`);

  const timer = setInterval(() => {
    if (stopped) return;
    i = (i + 1) % frames.length;
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`${frames[i]} ${text}`);
  }, 120);

  function end(prefix, finalText) {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(`${prefix} ${finalText || text}\n`);
  }

  return {
    stop: (finalText) => end("✓", finalText),
    fail: (finalText) => end("✗", finalText),
  };
}

// ------------------------------------------------------------
// Progress bar (time-based)
// - Intended for "run for N seconds" style scenarios
// - Safe no-op animation when not in TTY
// ------------------------------------------------------------
function startProgressBar(opts = {}) {
  const label = opts.label || "Running";
  const totalSec = Number(opts.totalSec || 0);
  const width = Number(opts.width || 28);

  const isTTY = !!process.stdout.isTTY;
  let stopped = false;
  let startMs = Date.now();
  let lastRenderMs = 0;

  function render(elapsedSec) {
    if (!isTTY) return; // don't spam non-interactive logs

    const pct = totalSec > 0 ? Math.min(1, Math.max(0, elapsedSec / totalSec)) : 0;
    const filled = Math.round(pct * width);
    const empty = Math.max(0, width - filled);

    const bar = `[${"#".repeat(filled)}${".".repeat(empty)}]`;
    const pctText = totalSec > 0 ? `${Math.round(pct * 100)}%` : "";
    const timeText =
      totalSec > 0
        ? `${Math.floor(elapsedSec)}s/${Math.floor(totalSec)}s`
        : `${Math.floor(elapsedSec)}s`;

    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`${bar} ${pctText} ${timeText}  ${label}`.trim());
  }

  function tick() {
    if (stopped) return;
    const now = Date.now();
    if (now - lastRenderMs < 200) return; // throttle
    lastRenderMs = now;

    const elapsedSec = (now - startMs) / 1000;
    render(elapsedSec);
  }

  function stopLine(prefix, finalText) {
    if (stopped) return;
    stopped = true;

    if (isTTY) {
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
    }

    const msg = finalText || label;
    process.stdout.write(`${prefix} ${msg}\n`);
  }

  // Initial render
  tick();

  return {
    tick,
    stop: (finalText) => stopLine("✓", finalText),
    fail: (finalText) => stopLine("✗", finalText || label),
  };
}

module.exports = {
  startSpinner,
  startProgressBar,
};
