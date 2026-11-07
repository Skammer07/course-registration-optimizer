# Allocation Rules Followed by the Project

Compiled on 2026-11-01 from the IIT (ISM) Dhanbad **Manual for Undergraduate Programs: Procedures and Requirements** (https://people.iitism.ac.in/~academics/Academic/public/pdf/UG%20Manaul.pdf), mainly section 2.3 (course components), 3.4.1 (pre-registration and elective allotment), 3.5.2 (cancellation), 6.5 (class size). The edition and date of that file are not stated in the text, and the manual does not describe the portal's internal logic.

Each rule below is marked **Manual** (the manual states it) or **Project decision** (the manual is silent or not specific, so the team fixed a behaviour and implemented it). The project decisions have not been reviewed by the college. This is a prototype, not the official allotment procedure.

## 1. Registration Structure
- **Manual.** Semester: B.Tech semesters I to VIII. Each student pre-registers online for the next semester through the institute's MIS portal in Window 1 of the academic calendar (late windows 2 and 3 exist, with a fine).
- **Manual.** Student population: all UG students. Institute Core (IC) courses are compulsory for everyone.
- **Manual.** Each program has a semester template of Institute Core (IC), Department Core (DC) and Department Practical (DP) courses; there is no single number of compulsory courses.
- **Project decision.** The templates are loaded as compulsory course records (`kind: "compulsory"`, with the departments that take them and their weekly slots), through the course form or the CSV import. The mock data has 2 institute-wide and 2 per-department compulsory courses.
- **Manual.** Each semester template lists elective slots (for example DE1, OE1 to OE5, ESO4 in the B.Tech templates).
- **Project decision.** Every slot is one **elective group** with its own priority list. Open electives are offered in every slot, so the lists draw from one shared pool of courses. The same course may appear in two lists, but a student is given it only once.
- **Manual.** One course per elective slot.
- **Project decision.** A student receives **at most one course per group**. Both algorithms try to fill every group a student ranked, but a group stays empty when no seat or clash-free slot is left; the system does not guarantee a course for every slot and reports the students who are left short.
- **Manual.** At most 15 choices per elective slot ("a priority list of up to 15 courses of their choice against each elective course", 3.4.1 a). **Implemented:** a list holds at most 15 courses, and a *submitted* list must be full (15, or every course the group can choose from when fewer exist). Drafts may be shorter but are never allocated.

## 2. Student Priority
- **Manual.** CGPA is used for allocation priority. Allotment of elective courses (ESO, DE, OE) is based on the CGPA at the time of pre-registration (3.4.1 b).
- **Manual.** Priority is not strictly CGPA-based. If a course has more interested students than seats, the **first 70% of seats go by CGPA and the remaining 30% in random order** (3.4.1 c). If a course is not oversubscribed everyone interested gets it.
- **Project decision (team).** The manual says "CGPA of the current semester" in one place and "current CGPA" in another. The project uses the **cumulative CGPA up to the previous semester, as it stands at pre-registration**. The student's `cgpa` field holds exactly this value, and a run stores it in its snapshot.
- **Project decision.** Equal CGPAs are ordered by student id, and students with the same CGPA as the last merit-seat winner share that seat if the course has room.
- **Project decision.** No other factor is used. Students registering in the late windows are not modelled.

## 3. Course Rules
- **Manual.** A minimum of 10 students is needed to run an elective course; the maximum "may be one hundred or more depending on the need" (6.5). **Project decision:** seats are a number per course and are fixed during an allocation. The 10-student minimum is not modelled, and the realistic mock data (`seed-realistic.js`) gives every elective at least 10 seats.
- **Manual.** Department Electives (DE) are offered by a department for its own students. Open Electives (OE) are offered by the institute and include ESO and DE courses. Every UG student must clear two mandatory OE courses, one from Management Studies and one from Humanities and Social Sciences. In principle a student cannot take two courses with similar content under different codes (3.4.1).
- **Project decision.** None of these restrictions is modelled: electives have no department or programme eligibility field, no category (such as Management or Humanities), and no similar-content check.
- **Manual.** Dual Degree, Double Major and Minor students have a separate add/drop window. **Project decision:** not modelled, and no reserved seats or quotas.

## 4. Allocation Procedure
- **Manual.** Processing: per course, CGPA order for 70% of the seats, then random for the other 30%, using each student's priority list. A student is considered for the highest-ranked course of their list that still has a seat; if it is unavailable, the next preference is used.
- **Project decision.** The 70/30 split is configurable per run (default 70/30). The merit share is the rounded seat count and the lottery gets the rest, so no seat is lost to rounding. With elective groups the merit phase serves students strictly in CGPA order, each taking the best available course of every group's own list, and the lottery draws per group.
- **Manual.** One allotment after Window 1 closes; students left without a course choose from vacant seats in the add/drop window. **Project decision:** one round only. A student who gets nothing is reported as unallocated; the second round is not modelled.
- **Manual.** If no course is allotted and the student gave fewer than 15 choices, a random allotment takes place. **Project decision:** not modelled. A submitted list must be full, and a student whose choices are all unavailable stays unallocated.
- **Project decision (purpose of the optimizer).** The optimizer is not a reproduction of the official procedure. It is held to the baseline's own result, so no student ends worse than under the baseline in any group, and it uses CGPA only to decide between equal results. The comparison therefore reports differences and declares no winner.

## 5. Additional Constraints
- **Manual.** Students register for their template's IC, DC and DP courses.
- **Project decision.** Compulsory courses are fixed timetable slots per student, matched by department, that no elective may overlap. Matching by section or study semester is not modelled.
- **Manual.** Timetable conflicts: a student must choose courses with no clash; a course in a clash is rejected from the registration form (3.4.1) and a registration can be cancelled for a clash (3.5.2). **Implemented** for elective-to-elective and elective-to-compulsory clashes.
- **Project decision.** Prerequisites and course combination rules are not modelled. Modular (half-semester) courses, which the manual describes (2.5), are not modelled either; the academic load per semester follows the program template (2.7) and is represented by the maximum number of courses per student (default 2).

## 6. Data
- **Project decision.** All data is generated mock data (see `backend/README.md`, "Mock Data and Experiments"). No real student records, historical allocations or institutional data source are used, so no anonymization or access permission is involved.
- Fields the project uses: student id, name, CGPA, department, semester; course code, title, kind, seats, departments (for compulsory courses), weekly timetable slots; ranked preferences per elective group.

## 7. Decisions and Scope

These points were open during the project and are now settled for the prototype:

| Point | Decision |
|---|---|
| CGPA used for the 70% merit seats | Cumulative CGPA up to the previous semester, as at pre-registration (confirmed by the project team, 2026-11-01). |
| Equal CGPAs | Ordered by student id; students tied with the last merit-seat winner share that seat while the course has room. |
| One course in every slot, or "at most one" | At most one per group; the system tries to fill every group but does not guarantee it. |
| Compulsory courses and their timetables | Entered per department as compulsory courses with weekly slots; they block overlapping electives for that department's students. |
| Second round, minimum course size (10 students) | Not modelled; a student left without a course is reported as unallocated. |
| Prerequisites, reserved seats, eligibility by department, similar-content exclusions, half-semester courses | Not modelled. |
| Should the optimizer reproduce the official procedure | No. It is an optimization benchmark held to the baseline's result (never worse for any student), with no winner declared. |

Anything in the "not modelled" rows would have to be decided with the college before the system could be used as the real allotment procedure.
