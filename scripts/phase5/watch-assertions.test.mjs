/**
 * Regression test for the tri-state assertion logic in
 * `scripts/phase5/watch.mjs`.
 *
 * This exists because the defect it guards against is invisible in the happy
 * path. `docs/troubleshooting.md` sections 4.4 and 4.5 record a `watch` run that
 * reported `no-auto-pin` and `objectives-partition` as PASS against a host that
 * had received **no publisher at all**: with no data, neither bad thing had been
 * observed, and the old two-state report had nowhere to put "never checked". A
 * regression here would be silent, because a vacuous PASS looks exactly like a
 * real one in the report.
 *
 * It imports the script's real exported helpers rather than restating the rule,
 * so the assertion is on shipped code. That is what the entry-point guard in
 * `watch.mjs` exists to make possible.
 *
 * Usage:
 *   node scripts/phase5/watch-assertions.test.mjs
 *
 * Exit codes:
 *   0  every case behaved as documented
 *   1  a case failed
 */
import {
  ASSERTIONS,
  NOT_OBSERVED,
  PASS,
  FAIL,
  createLedger,
  evaluate,
  exitCodeFor,
  hasData,
} from "./watch.mjs";

const cases = [];
let failures = 0;

function check(name, condition, detail) {
  const passed = Boolean(condition);
  if (!passed) {
    failures += 1;
  }
  cases.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function statusOf(checks, name) {
  return checks.find((check) => check.name === name)?.status;
}

/** Every assertion name the script knows about. */
const ALL_ASSERTIONS = Object.keys(ASSERTIONS);

// ---- 1. The session-2 scenario: no publisher at all ----------------------

// This is the exact ledger state session 2 ended with: no ready connection, no
// chapters, so no objective content was ever observed.
const emptyLedger = createLedger();

const emptyChecks = evaluate(emptyLedger, ALL_ASSERTIONS);

check(
  "no assertion passes on an empty ledger",
  emptyChecks.every((check) => check.status !== PASS),
  emptyChecks
    .filter((check) => check.status === PASS)
    .map((check) => check.name)
    .join(", ") || "none passed",
);

check(
  "every content assertion is not observed on an empty ledger",
  emptyChecks
    .filter((check) => check.name !== "ready")
    .every((check) => check.status === NOT_OBSERVED),
  emptyChecks
    .filter((check) => check.name !== "ready" && check.status !== NOT_OBSERVED)
    .map((check) => `${check.name}=${check.status}`)
    .join(", ") || "all not observed",
);

check(
  "the two previously vacuous assertions are not observed",
  statusOf(emptyChecks, "no-auto-pin") === NOT_OBSERVED &&
    statusOf(emptyChecks, "objectives-partition") === NOT_OBSERVED,
  `no-auto-pin=${statusOf(emptyChecks, "no-auto-pin")}, ` +
    `objectives-partition=${statusOf(emptyChecks, "objectives-partition")}`,
);

check(
  "ready itself fails rather than being not observed",
  // `ready` has no precondition: it is a positive claim that is simply false.
  statusOf(emptyChecks, "ready") === FAIL,
  `ready=${statusOf(emptyChecks, "ready")}`,
);

check(
  "an empty-ledger run does not exit 0",
  exitCodeFor(emptyChecks) !== 0,
  `exitCode=${exitCodeFor(emptyChecks)}`,
);

// ---- 2. A healthy ledger still passes ------------------------------------

const healthyLedger = createLedger();
healthyLedger.reported.ready = true;
healthyLedger.maxChapters = 55;
healthyLedger.expectedChaptersResolved = [
  "3B0302DB5E77C3A2",
  "28BCA5042050B140",
  "67E7552FDA3245F5",
  "634794CB36D61302",
  "571D32BADC77CDD0",
];
healthyLedger.reported.sawNumericTask = true;
healthyLedger.reported.sawCompletedChapter = true;

check("hasData is false for the empty ledger", hasData(emptyLedger) === false);
check("hasData is true for the healthy ledger", hasData(healthyLedger) === true);

const healthyChecks = evaluate(healthyLedger, [
  "ready",
  "no-auto-pin",
  "objectives-partition",
  "chapter-mapping",
  "numeric-task",
  "null-or-complete",
]);

check(
  "a healthy ledger passes the checks it satisfies",
  healthyChecks.every((check) => check.status === PASS),
  healthyChecks
    .filter((check) => check.status !== PASS)
    .map((check) => `${check.name}=${check.status}`)
    .join(", ") || "all passed",
);

check(
  "a healthy ledger exits 0",
  exitCodeFor(healthyChecks) === 0,
  `exitCode=${exitCodeFor(healthyChecks)}`,
);

// ---- 3. A genuine violation still fails ----------------------------------

const autoPinLedger = createLedger();
autoPinLedger.reported.ready = true;
autoPinLedger.maxChapters = 55;
autoPinLedger.reported.sawAutoPin = true;

const autoPinChecks = evaluate(autoPinLedger, ["no-auto-pin"]);
check(
  "a real auto-pin sighting fails, not merely is observed",
  statusOf(autoPinChecks, "no-auto-pin") === FAIL,
  `status=${statusOf(autoPinChecks, "no-auto-pin")}`,
);
check(
  "a failure exits 1",
  exitCodeFor(autoPinChecks) === 1,
  `exitCode=${exitCodeFor(autoPinChecks)}`,
);

const partitionLedger = createLedger();
partitionLedger.reported.ready = true;
partitionLedger.maxChapters = 55;
partitionLedger.reported.sawPartitionViolation = true;

check(
  "a real partition violation fails",
  statusOf(evaluate(partitionLedger, ["objectives-partition"]), "objectives-partition") === FAIL,
);

// ---- 4. Mixed states: the exit code precedence ---------------------------

const mixedChecks = [
  { name: "ready", status: PASS, passed: true },
  { name: "numeric-task", status: NOT_OBSERVED, passed: null },
];
check(
  "a failure outranks a not-observed",
  exitCodeFor([...mixedChecks, { name: "x", status: FAIL, passed: false }]) === 1,
  `exitCode=${exitCodeFor([...mixedChecks, { name: "x", status: FAIL, passed: false }])}`,
);
check(
  "not observed alone is a non-zero exit",
  exitCodeFor(mixedChecks) === 2,
  `exitCode=${exitCodeFor(mixedChecks)}`,
);

// ---- 5. Every assertion is shape-correct ---------------------------------

check(
  "every assertion has a precondition and a check",
  ALL_ASSERTIONS.every(
    (name) =>
      typeof ASSERTIONS[name].precondition === "function" &&
      typeof ASSERTIONS[name].check === "function",
  ),
  ALL_ASSERTIONS.filter(
    (name) =>
      typeof ASSERTIONS[name].precondition !== "function" ||
      typeof ASSERTIONS[name].check !== "function",
  ).join(", ") || "all well-formed",
);

check(
  "only ready is precondition-free",
  ALL_ASSERTIONS.filter((name) => ASSERTIONS[name].precondition(emptyLedger)).join(",") ===
    "ready",
  ALL_ASSERTIONS.filter((name) => ASSERTIONS[name].precondition(emptyLedger)).join(", "),
);

check(
  "an unknown assertion name is a failure, not a pass",
  evaluate(healthyLedger, ["not-a-real-check"])[0].status === FAIL,
);

// ---- Report ---------------------------------------------------------------

for (const entry of cases) {
  const detail = entry.detail === undefined ? "" : `  (${entry.detail})`;
  process.stdout.write(`  ${entry.passed ? "PASS" : "FAIL"}  ${entry.name}${detail}\n`);
}
process.stdout.write(`\n${cases.length - failures}/${cases.length} checks passed\n`);
process.stdout.write(
  failures === 0
    ? "watch assertion tri-state behaves as documented\n"
    : `${failures} check(s) failed\n`,
);

process.exitCode = failures === 0 ? 0 : 1;
