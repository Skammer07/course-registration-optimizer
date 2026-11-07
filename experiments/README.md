# Experiments

How to reproduce the measurements and comparisons used in the project. Nothing in this folder is a result yet: `results/` is empty, and every figure quoted in `docs/algorithm-design.md` comes from single runs on one developer machine, so it is indicative only. Real student data is not available, so all experiments use deterministic generated mock data (the same options and seed always give the same data).

## 1. Optimizer benchmark (algorithm only, no database)

```bash
cd algorithm
node scripts/benchmarkOptimizer.js balanced:200:1 many-ties:200:1 many-clashes:60:2 --out ../experiments/results/benchmark.json
```

Each case is `scenario:size:seed` (scenarios `balanced`, `scarce-seats`, `many-ties`, `many-clashes`; see `backend/src/seed/generateDataset.js`). With no cases a small default set runs. The script prints the time, the number of flow solves and clash branches, the assignments, the preference cost, and a fingerprint of the result, so that a change to the optimizer can be checked for identical output. It treats every course as ungrouped, so it measures the timetable search without the elective-group rule.

## 2. Baseline against optimizer on realistic data (through the backend)

This is the comparison the dashboard shows, on data with elective groups, compulsory courses and tight seats.

```bash
cd backend
# load semesters of different sizes (see backend/README.md, "Realistic multi-semester data")
node scripts/seed-realistic.js --semesters SEM-1:500,SEM-2:1000,SEM-3:1500 --seed 11
npm run dev
```

Then, as an admin in the frontend (`cd frontend && npm run dev`), open **New run**, pick a semester and compare both algorithms. The run page shows the headline numbers, the better / same / worse count against the baseline, the student-by-student comparison, and whether the optimizer's search finished (`optimal`) or stopped at its limit. Useful variations to record:

- the optimizer held to the baseline (default) against `optimizerFloor: "none"` (no student protected), to measure what the guarantee costs;
- CGPA priority on and off;
- the same semester with different seeds (the baseline lottery changes);
- the three semester sizes, to see how time, the share of students with one course, and the average rank change.

## 3. Recording a result

Save anything worth keeping in `results/` with the options used (scenario or semester, size, seed, algorithm version, options) and the date, so it can be repeated. The algorithm version is shown on every run page. Report only numbers that come from an actual run.
