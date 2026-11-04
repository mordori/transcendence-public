// backend/src/utils/DB-test-reporter.js
//
// Runs src/utils/DB-testers.js through node:test's programmatic runner and
// translates the result events into two outputs:
//
//   1. a two-line summary on stdout (the container log)
//   2. a Markdown report, overwritten on every run:
//        src/utils/test_reports/DB-test-report.md
//      (set TEST_REPORT_DIR to point it at a mounted volume, e.g. ./logs)
//
//   node src/utils/DB-test-reporter.js
//
// Always exits 0: failures are reported, never fatal, so the container starts.

import { run } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TEST_FILE = join(here, 'DB-testers.js');
const REPORT_DIR = resolve(process.env.TEST_REPORT_DIR || join(here, 'test_reports'));
const REPORT_PATH = join(REPORT_DIR, 'DB-test-report.md');

const PASS = '\u2705';
const FAIL = '\u274C';
const SKIP = '\u23ED\uFE0F';
const MAX_ERROR_LENGTH = 100;

const ANSI = /\u001b\[[0-9;]*m/g;

function shortError(error) {
	if (!error) return '';
	const raw = String(error.cause?.message ?? error.message ?? error)
		.replace(ANSI, '')
		.split('\n')
		.map((line) => line.trim())
		.find((line) => line.length > 0) ?? 'Unknown error';
	const clean = raw.replaceAll('|', '\\|').replaceAll('`', "'");
	return clean.length > MAX_ERROR_LENGTH
		? `${clean.slice(0, MAX_ERROR_LENGTH - 1)}\u2026`
		: clean;
}

function formatDuration(ms) {
	return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`;
}

function escapeCell(text) {
	return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function buildReport(results, elapsedMs) {
	const total = results.length;
	const passed = results.filter((r) => r.status === 'pass').length;
	const failed = results.filter((r) => r.status === 'fail').length;
	const skipped = total - passed - failed;

	const lines = [
		'# DB Test Report',
		'',
		`- **Generated:** ${new Date().toISOString()}`,
		`- **Suite:** \`src/utils/DB-testers.js\``,
		`- **Total time:** ${formatDuration(elapsedMs)}`,
		'',
		'## Results',
		'',
		'| Status | Test | Duration | Error |',
		'| :----: | :--- | -------: | :---- |',
	];

	for (const r of results) {
		const icon = r.status === 'pass' ? PASS : r.status === 'fail' ? FAIL : SKIP;
		const name = escapeCell(r.path);
		lines.push(`| ${icon} | ${name} | ${formatDuration(r.duration)} | ${r.error} |`);
	}

	lines.push(
		'',
		'## Summary',
		'',
		'| Metric | Count |',
		'| :----- | ----: |',
		`| Total tests run | ${total} |`,
		`| ${PASS} Passed | ${passed} |`,
		`| ${FAIL} Failed | ${failed} |`,
		`| ${SKIP} Skipped | ${skipped} |`,
		'',
	);
	return lines.join('\n');
}

async function main() {
	const started = performance.now();
	const results = [];
	const suiteStack = new Map(); // nesting level -> suite name, to build full test paths

	const stream = run({ files: [TEST_FILE], concurrency: false });

	stream.on('test:start', (data) => {
		suiteStack.set(data.nesting, data.name);
	});

	const record = (status) => (data) => {
		// Suites are containers; only leaf tests are reported.
		if (data.details?.type === 'suite') return;
		const parents = [];
		for (let level = 0; level < data.nesting; level++) {
			const name = suiteStack.get(level);
			if (name) parents.push(name);
		}
		const skipped = status === 'pass' && (data.skip !== undefined || data.todo !== undefined);
		results.push({
			status: skipped ? 'skip' : status,
			path: [...parents, data.name].join(' \u203A '),
			duration: data.details?.duration_ms ?? 0,
			error: status === 'fail' ? shortError(data.details?.error) : '',
		});
	};
	stream.on('test:pass', record('pass'));
	stream.on('test:fail', record('fail'));

	// Drain the stream so the runner completes.
	stream.on('data', () => {});
	await new Promise((done, fail) => {
		stream.on('end', done);
		stream.on('error', fail);
	});

	const total = results.length;
	const passed = results.filter((r) => r.status === 'pass').length;
	const failed = results.filter((r) => r.status === 'fail').length;

	mkdirSync(REPORT_DIR, { recursive: true });
	writeFileSync(REPORT_PATH, buildReport(results, performance.now() - started), 'utf8');

	console.log(`${PASS} DB Tests passed: ${passed}/${total}\n${FAIL} DB Tests failed: ${failed}/${total}\n`);
	console.log(`Full report: ${REPORT_PATH}`);
}

main().catch((err) => {
	console.error(`${FAIL} DB Test reporter crashed: ${err.message}`);
});
