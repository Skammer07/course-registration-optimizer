# Course Registration Optimization System

**B.Tech Final-Year Project | Three-Member Team | One-Semester Project**

## 1. Project Overview

We are developing a course registration and elective allocation system for a college environment where students submit ranked course preferences, courses have limited seats, and CGPA or other institutional rules determine allocation priority.

The system will provide:
- A student interface for submitting ranked elective preferences.
- An administrator interface for managing registration data and running allocation.
- An allocation engine implementing the existing college allocation method and proposed optimization algorithms.
- Validation to ensure allocations obey course capacities and institutional rules.
- An evaluation framework to compare algorithms using measurable metrics.
- Reports that help administrators inspect and review allocation outcomes.

**This is an algorithm-optimization project, not merely a course registration website.** The primary academic contribution is the design, implementation, validation, and comparison of allocation algorithms.

The system is initially a prototype. It must not be treated as an official registration system until the college approves the allocation policy, security, data handling, and deployment.

---

## 2. Problem Statement

Students submit ranked preferences for elective courses, but courses have limited capacities. When demand exceeds capacity, some students cannot receive their preferred courses.

The allocation problem is to assign eligible courses to students while satisfying:
- Required elective-group allocations.
- Course seat capacities.
- CGPA-based priority and other mandatory institutional rules.
- Eligibility and department restrictions, if applicable.
- Preference-list validity.
- Any additional constraints confirmed by the college.

We will investigate whether an optimization algorithm can improve student preference satisfaction without violating mandatory institutional rules.

### Research question

Can a preference-aware allocation algorithm improve course allocation outcomes compared with the college's existing allocation method while preserving required policy constraints?

---

## 3. Current Understanding of the College Process

Based on our initial understanding:

1. Students have compulsory courses assigned to them.
2. Students must obtain courses from multiple elective groups.
3. Students submit ranked preferences, potentially up to 15 choices per group.
4. Each course has a limited number of seats.
5. CGPA affects which students receive oversubscribed courses.
6. The system must allocate the required electives or explicitly report unallocated slots.

**These are preliminary assumptions, not confirmed specifications.**

Before implementing the final algorithms, we must verify:
- The exact allocation procedure.
- CGPA priority and tie-breaking rules.
- Whether allocation happens in multiple rounds.
- How incomplete preferences are handled.
- Eligibility, quotas, and course restrictions.
- Whether timetable conflicts must be considered.
- Whether course capacities can change during allocation.

The existing allocation method must be reproduced accurately before it is used as the baseline for comparison.

---

## 4. Project Objectives

### Functional objectives
1. Accept student, course, capacity, and preference data.
2. Validate input data before allocation.
3. Allow students to submit preferences.
4. Allow administrators to manage data and initiate allocation.
5. Generate student-course assignments.
6. Display allocated courses and their preference ranks.
7. Report unallocated slots and validation failures.
8. Export allocation results.
9. Compare the existing method with the proposed algorithm.

### Algorithmic objectives
1. Formalize the allocation problem mathematically.
2. Implement the existing allocation procedure as the baseline.
3. Implement a preference-optimization algorithm.
4. Validate every allocation independently.
5. Compare preference satisfaction, allocation completeness, policy compliance, seat utilization, and runtime.
6. Analyze trade-offs and scalability.

### Non-goals for the initial prototype
- Replacing the college's official registration system.
- Integrating institute credentials or the official ERP.
- Implementing every possible timetable, room, or faculty constraint.
- Using machine learning without a clear technical need.
- Deploying a production system before institutional approval.

---

## 5. Team Structure and Ownership

Each member owns a primary module but must coordinate through shared interfaces.

### Member 1 — Algorithm and Optimization Lead

**Primary responsibility:** allocation logic, mathematical formulation, testing, and performance evaluation.

Tasks:
- Document the actual allocation rules.
- Formalize the optimization objective and constraints.
- Implement the existing allocation method.
- Implement minimum-cost maximum-flow or the selected optimization algorithm.
- Develop an independent allocation validator.
- Implement preference-satisfaction and runtime metrics.
- Create synthetic datasets and benchmark experiments.
- Document pseudocode, complexity, assumptions, and limitations.
- Integrate the allocation engine with the backend.

Deliverables:
- Working baseline algorithm.
- Working optimization algorithm.
- Allocation validation module.
- Metrics and comparison framework.
- Automated tests and experimental results.
- Algorithm documentation.

### Member 2 — Backend and Database Lead

**Primary responsibility:** application APIs, persistence, input processing, and integration.

Tasks:
- Initialize the Express backend.
- Design student, course, preference, and allocation data models.
- Implement CSV/JSON import and validation.
- Implement APIs for student preferences and administrator operations.
- Integrate the allocation engine.
- Store allocation runs and their configuration.
- Provide allocation results and reports to the frontend.
- Handle errors, permissions, and input validation.
- Coordinate the API contract with Members 1 and 3.

Deliverables:
- Working backend.
- Data models and API endpoints.
- Allocation-engine integration.
- Data import/export.
- Error handling and integration tests.

### Member 3 — Frontend and Evaluation Dashboard Lead

**Primary responsibility:** student/admin interfaces, visualization, and demonstration experience.

Tasks:
- Initialize the React frontend.
- Build the student preference form.
- Build the administrator data-management screen.
- Build the allocation execution screen.
- Display student allocation results and preference ranks.
- Visualize course capacity and allocation metrics.
- Display comparisons between allocation algorithms.
- Implement loading states and error messages.
- Prepare the demo workflow and coordinate usability testing.

Deliverables:
- Student preference interface.
- Administrator dashboard.
- Allocation-results screen.
- Metrics and comparison visualizations.
- Presentation-ready demonstration.

### Shared responsibilities

All members participate in:
- Requirements clarification.
- Architecture and API decisions.
- GitHub code review.
- Testing and bug fixing.
- Weekly progress reviews.
- Presentation and report preparation.

No member should independently change the agreed input/output schema without informing the other two.

---

## 6. Technology Stack

### Frontend
- React
- Vite
- Tailwind CSS
- A React charting library such as Recharts

### Backend
- Node.js
- Express
- MongoDB with Mongoose

### Algorithm engine
- JavaScript/Node.js initially, so the backend can invoke it directly.
- Vitest for automated testing.
- A custom minimum-cost maximum-flow implementation or a verified optimization library, depending on implementation complexity.

### Development tools
- Git and GitHub
- VS Code
- Postman
- CSV/JSON test datasets

We will prefer technologies the team already knows. Additional infrastructure should be introduced only when necessary.

---

## 7. Repository Structure

```text
course-registration-optimizer/
│
├── README.md
├── .gitignore
├── .env.example
│
├── docs/
│   ├── problem-statement.md
│   ├── allocation-rules.md
│   ├── algorithm-design.md
│   ├── api-contract.md
│   └── meeting-notes.md
│
├── data/
│   ├── samples/
│   │   ├── students.json
│   │   ├── courses.json
│   │   └── preferences.json
│   ├── generated/
│   ├── raw/                 # Local only; never commit
│   └── private/             # Local only; never commit
│
├── algorithm/
│   ├── package.json
│   ├── src/
│   │   ├── models/
│   │   │   └── validateInput.js
│   │   ├── algorithms/
│   │   │   ├── baseline.js              # merit phase
│   │   │   ├── randomAllocation.js      # lottery phase
│   │   │   ├── allocationPipeline.js    # merit then lottery
│   │   │   ├── optimizedAllocation.js   # min-cost max-flow + timetable search
│   │   │   └── minCostMaxFlow.js
│   │   ├── timetable/
│   │   │   └── checkClash.js
│   │   ├── services/                    # runSingleAllocation, runAllocationComparison
│   │   ├── validation/
│   │   │   └── validateAllocation.js
│   │   ├── evaluation/
│   │   │   ├── metrics.js
│   │   │   └── compare.js
│   │   └── index.js
│   ├── tests/
│   └── scripts/
│
├── backend/
│   ├── package.json
│   └── src/
│       ├── models/
│       ├── routes/
│       ├── controllers/
│       ├── services/
│       └── server.js
│
├── frontend/
│   ├── package.json
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── services/
│       └── App.jsx
│
└── experiments/
    ├── README.md
    └── results/
```

The tree above is the original plan. The repository now contains the working algorithm package, the backend API and the React frontend; see `docs/project-status-report.md` for what exists and what is left, and each folder's own README for how to run it.

---

## 8. Data Model and Input Contract

The algorithm must remain independent of the database and UI.

### Student

```json
{
  "id": "S001",
  "cgpa": 9.2,
  "program": "CSE"
}
```

### Course

```json
{
  "id": "C101",
  "name": "Machine Learning",
  "group": "A",
  "capacity": 60
}
```

### Preference

```json
{
  "studentId": "S001",
  "group": "A",
  "courseId": "C101",
  "rank": 1
}
```

### Registration configuration

```json
{
  "requiredGroups": ["A", "B"],
  "algorithm": "baseline"
}
```

These examples are synthetic and provisional. The final schema must reflect the actual institutional rules.

### Required output

Each allocation run should return:
- Algorithm name and version.
- Student ID.
- Elective group.
- Allocated course ID.
- Preference rank.
- Explicitly unallocated slots.
- Summary metrics.
- Validation results.

The algorithm must not depend on MongoDB documents or React state. It should receive plain structured data and return a structured result.

---

## 9. Allocation Algorithms

### Algorithm A — Existing allocation method

This is the baseline.

We must reproduce the official process exactly, including:
- Student processing order.
- CGPA priority.
- Tie-breaking.
- Preference handling.
- Allocation rounds.
- Course capacity and eligibility rules.

We must not claim that a guessed greedy algorithm represents the existing system.

### Algorithm B — Preference optimization

The initial candidate is minimum-cost maximum-flow.

Network:
- Source to student-elective-group slots.
- Student-group slots to eligible courses.
- Courses to sink.

Capacities:
- One unit per required student-group slot.
- One unit per student-course preference edge.
- Course capacity on the course-to-sink edge.

Cost:
- Preference rank minus one on each student-to-course edge.

Objective:
1. Maximize the number of assigned slots.
2. Among maximum-cardinality assignments, minimize total preference penalty.

This model supports course capacities and separate elective groups.

**Important limitation:** pure preference optimization does not automatically preserve strict CGPA precedence. The final formulation must explicitly enforce any mandatory institutional priority rules. If strict precedence is required, we must adapt the model rather than assume that a preference-only flow objective is sufficient.

### Optional future extension

If the first two algorithms work reliably, investigate a CGPA-aware or lexicographic optimization model. Add timetable, prerequisite, or room constraints only if the initial scope is complete and the constraints are genuinely required.

---

## 10. Allocation Validation

Every algorithm's output must be independently validated.

Required checks:
- No course exceeds its capacity.
- No student receives more than one course per required elective group.
- Every assigned course belongs to the appropriate group.
- Every assignment corresponds to a valid submitted preference.
- Every student and course ID exists.
- Assigned and unallocated slots are accounted for.
- Mandatory CGPA, eligibility, quota, and other rules are satisfied.

Invalid output must be rejected or reported explicitly. The validator must not silently modify allocations.

The same validator should be used for the baseline and proposed algorithm.

---

## 11. Evaluation Metrics

We will compare the algorithms on identical datasets.

### Preference satisfaction
- Average preference rank among assigned slots.
- Percentage of assigned slots receiving the first choice.
- Percentage receiving a top-3 or top-5 choice.

Lower average rank and higher top-choice rates generally indicate better preference satisfaction.

### Allocation completeness
- Total required elective slots.
- Number of assigned slots.
- Number and percentage of unallocated slots.

### Capacity utilization
- Filled seats divided by total available seats.
- Capacity violations, which must be zero.

### Policy compliance and fairness
- CGPA-priority violations, according to the official policy.
- Allocation outcomes across CGPA bands, where relevant.
- Unallocated rates across student groups, where appropriate and permitted.

### Performance
- Runtime.
- Memory usage when relevant.
- Scaling behavior as students, courses, and preference edges increase.

Preference satisfaction must not be reported in isolation. An algorithm is not better for the college if it achieves better preference ranks by violating mandatory allocation rules.

No experimental improvement figures should be invented. All reported results must come from actual runs.

---

## 12. Testing Strategy

We will test:
1. Cases where every student can receive their first choice.
2. Oversubscribed courses.
3. Multiple elective groups.
4. Zero-capacity courses.
5. Missing and incomplete preferences.
6. Duplicate student IDs, course IDs, and ranks.
7. Equal CGPAs and official tie-breaking.
8. Invalid or ineligible course choices.
9. Allocation correctness and capacity constraints.
10. Larger synthetic datasets.
11. Repeated runs on identical inputs.
12. Cases with a known optimum that can be verified independently.

The algorithm must pass small hand-calculated tests before being used for large experiments.

---

## 13. Four-Week Prototype Plan

### Week 1 — Requirements and baseline
- Confirm the actual college allocation rules.
- Document the mathematical problem and constraints.
- Define the input/output contract.
- Create synthetic sample data.
- Implement and test the baseline algorithm.
- Initialize the backend and frontend scaffolding.

**Milestone:** validated baseline and agreed architecture.

### Week 2 — End-to-end working prototype
- Implement the optimization algorithm.
- Complete input and allocation validation.
- Implement preference submission and admin data import.
- Integrate the allocation engine with the backend.
- Display allocation results in the frontend.

**Milestone:** the entire prototype works on synthetic data.

### Week 3 — Experiments and robustness
- Add evaluation metrics and result comparisons.
- Test difficult allocation scenarios.
- Generate reproducible datasets.
- Fix integration and algorithm bugs.
- Review the prototype with the professor or intended users.

**Milestone:** stable prototype with measured results.

### Week 4 — Presentation preparation
- Freeze core features.
- Run final benchmarks.
- Prepare architecture diagrams and pseudocode.
- Document results and limitations.
- Rehearse the live demo and prepare a backup.

**Milestone:** presentation-ready prototype and technical report.

---

## 14. Git and Team Collaboration Rules

- Use `main` for stable, reviewed code.
- Each member works on a separate feature branch.
- Submit changes through pull requests where practical.
- Do not commit `node_modules`, `.env` files, credentials, or confidential student data.
- Use synthetic datasets in shared examples.
- Run relevant tests before merging.
- Discuss changes to the data schema and algorithm contract before implementing them.
- Keep commits small and descriptive.

Suggested branch names:
- `feature/allocation-baseline`
- `feature/min-cost-flow`
- `feature/allocation-api`
- `feature/student-preferences`
- `feature/admin-dashboard`
- `feature/benchmark-metrics`

---

## 15. Rules for AI-Assisted Development

Any AI used by a team member must be given this README before being asked to implement a module.

AI-generated code must:
1. Respect the documented architecture and assigned ownership.
2. Use the agreed input/output contract.
3. Avoid changing unrelated modules.
4. Include tests for algorithmic or business logic.
5. Explain assumptions and edge cases.
6. Avoid hardcoding sample allocation results.
7. Never invent the college's actual allocation rules.
8. Avoid introducing unnecessary frameworks or dependencies.
9. Not claim that tests passed unless they were actually run.
10. Not introduce a new API schema without team agreement.

When the college's actual rules are confirmed, update this README and the allocation specification before asking AI to implement further changes.

This README is the shared project reference, but it is not a substitute for reviewing generated code, running tests, and verifying correctness.

---

## 16. Definition of Done

The prototype is ready for presentation when:
- The baseline matches the documented college rules.
- The optimization algorithm runs on the same input.
- The independent validator detects invalid allocations.
- The frontend and backend can complete the registration-to-allocation workflow.
- Results and metrics are reproducible.
- Algorithm comparisons use identical datasets.
- The team can explain the objective, constraints, trade-offs, and limitations.
- The demo uses approved synthetic or anonymized data.
- The presentation does not claim unmeasured improvements or production readiness.

---

## 17. Current Status and Next Actions

**Current status (2026-11-01):** a working prototype. Both algorithms, the validator, the backend API and the web frontend exist and are tested (algorithm 162, backend 693, frontend 273 tests, all passing). The college's official rules are still **unconfirmed**; the IIT (ISM) UG manual was used as the reference for what is known (see `docs/allocation-rules.md`).

**Implemented:** baseline (merit then lottery, default 70/30), min-cost max-flow optimizer with timetable-clash search and a deterministic search limit, held to the baseline's result (no student ends worse) and using CGPA, elective groups as independent priority lists of up to 15 choices drawing from one shared pool (one course per group, never the same course twice), compulsory courses as fixed timetable slots, independent validation, metrics and comparison, run storage with replay verification and publishing, CSV import, student preference and result pages.

**Not done yet:** strict CGPA order everywhere (the lottery and the floor keep some lower-CGPA winners), a second allocation round, minimum course size, department eligibility for electives, half-semester courses, semester/deadline and user-management screens, a repeatable benchmark and results chapter. Details and feasibility are in `docs/project-status-report.md`.

### Next actions
1. Confirm the open rules with the Academic Section (list in `docs/allocation-rules.md`, section 7).
2. Decide how the optimizer should use CGPA.
3. Build the remaining screens and the experiment write-up.

**The first priority is correctness and institutional applicability, followed by optimization, evaluation, and interface polish.**
