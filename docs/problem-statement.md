# Problem Statement

*Draft for the team and project guide. The college's real rules are not yet confirmed; see `allocation-rules.md`. The full project charter is in the root `README.md`.*

## Context

Students at the college submit ranked preferences for elective courses, but each course has limited seats. When demand exceeds seats, some students cannot get their preferred courses. The allocation procedure decides who gets what.

## Problem

Given students (with CGPA), courses (with capacities and timetable slots) and each student's ranked preferences, assign courses to students so that:

- no course exceeds its capacity;
- no student exceeds the allowed number of courses and no student gets the same course twice;
- every assignment comes from a real preference of that student;
- a student is not given two courses that clash in the timetable, or a course that overlaps one of their compulsory classes;
- a student gets at most one course from each elective group;
- any further rule the college confirms is respected (CGPA priority, elective-group requirements, eligibility).

## Research question

Can a preference-aware allocation algorithm improve the outcome for students compared with the baseline merit-plus-random allocation, while still producing valid allocations?

"Improve" is measured, not assumed: number of students and assignments served, preference satisfaction (rank-1 count, average rank), seat utilization, unallocated students, rule violations (must be zero), and runtime.

## Approach

1. **Baseline:** per course, 70% of the seats go by CGPA and 30% by lottery (the split in the IIT (ISM) UG manual); with elective groups the merit seats are given in one round per group, each group being an independent priority list.
2. **Optimized:** minimum-cost maximum-flow, which maximizes the number of assignments (at most one course per elective group) and then minimizes total preference cost, with timetable clashes resolved by search. Students' compulsory classes are fixed slots that no elective may overlap.
3. **Independent validation** of every result, and a **comparison** of the two on identical input.
4. A **web system** around it: students submit preferences and see their published result; administrators import data, run and compare the algorithms, inspect results and publish one.

Design details are in `algorithm-design.md`; the HTTP interface is in `api-contract.md`.

## Constraints and assumptions

- Real student data is not available. Experiments use deterministic generated mock data (allowed for this project).
- The allocation policy is not confirmed. The two algorithms follow different policies (the baseline keeps merit/lottery quotas; the optimizer ignores the quotas but is held to the baseline's result and uses CGPA among equal results), so the comparison reports differences and **does not declare a winner**.
- The system is a prototype and must not be presented as the official registration system.

## Scope

In scope: both algorithms, validation, metrics and comparison, the API (accounts, semesters and deadlines, CSV import, runs, results, export, publishing), and a frontend for students and administrators.

Out of scope: replacing the official registration system, institute single sign-on, rooms and faculty constraints, production deployment.

## Open questions for the college

Listed in `allocation-rules.md`: how CGPA priority and ties work, whether there are allocation rounds, how many electives per group are required, how incomplete preference lists are handled, and any eligibility rules.
