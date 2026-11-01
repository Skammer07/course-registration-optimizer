# Existing Course Allocation Rules

Pre-filled on 2026-11-01 from the IIT (ISM) Dhanbad **Manual for Undergraduate Programs: Procedures and Requirements** (https://people.iitism.ac.in/~academics/Academic/public/pdf/UG%20Manaul.pdf), mainly section 2.3 (course components), 3.4.1 (pre-registration and elective allotment), 3.5.2 (cancellation), 6.5 (class size). The edition and date of that file are not stated in the text, and the manual does not describe the portal's internal logic. Everything marked **To confirm** needs the Academic Section (or the current notice) before the system can be called the official procedure.

## 1. Registration Structure
- Semester: B.Tech semesters I to VIII. Each student pre-registers online for the next semester through the institute's MIS portal in Window 1 of the academic calendar (late windows 2 and 3 exist, with a fine).
- Student population: all UG students. Institute Core (IC) courses are compulsory for everyone.
- Number of compulsory courses: not one number. Each program has a semester template of Institute Core (IC), Department Core (DC) and Department Practical (DP) courses. **To confirm** how the templates should be loaded into the system.
- Number of elective groups: each semester template lists elective slots (for example DE1, OE1 to OE5, ESO4 in the B.Tech templates). The project treats every slot as one **elective group** with its own priority list; open electives are offered in every slot, so the lists draw from the same pool of courses (the project lets the same course be in two lists but gives it to a student only once; **To confirm**).
- Required electives per group: one course per elective slot. **To confirm** whether a student must receive one for every slot (the project tries to fill every group but cannot when no seat or clash-free slot is left).
- Maximum preferences per group: **15** ("a priority list of up to 15 courses of their choice against each elective course", 3.4.1 a). The project does not limit the list to 15 yet.

## 2. Student Priority
- Is CGPA used for allocation priority? Yes. Allotment of elective courses (ESO, DE, OE) is based on the CGPA at the time of pre-registration (3.4.1 b).
- Is priority strictly CGPA-based? No. If a course has more interested students than seats, the **first 70% of seats go by CGPA and the remaining 30% in random order** (3.4.1 c). If a course is not oversubscribed everyone interested gets it. The manual says "CGPA of the current semester" in one place and "current CGPA" in another. **Confirmed by the project team (2026-11-01):** the CGPA is the **cumulative CGPA up to the previous semester, as it stands at pre-registration**, not the current semester's own grade average. The student's `cgpa` field holds exactly this value, and a run stores it in its snapshot.
- How are equal CGPAs resolved? Not stated. **To confirm** (the project orders them by student id and lets equal-CGPA students share the last merit seat).
- Are other factors considered? Not stated for allotment. Students registering late (windows 2 and 3) can only choose electives that still have seats.

## 3. Course Rules
- Seat capacity definition: a minimum of 10 students is needed to run an elective course and the maximum "may be one hundred or more depending on the need" (6.5). The project has seats per course; the 10-student minimum is not modelled.
- Eligibility restrictions: Department Electives (DE) are offered by a department for its own students. Open Electives (OE) are offered by the institute and include ESO and DE courses. Every UG student must clear two mandatory OE courses, one from Management Studies and one from Humanities and Social Sciences. In principle a student cannot take two courses with similar content under different codes (3.4.1).
- Department/program restrictions: as above; the project has no eligibility field on electives yet.
- Reserved seats or quotas: not stated. Students of Dual Degree, Double Major and Minor programmes have a separate add/drop window.
- Can course capacity change during allocation? Not stated. **To confirm.**

## 4. Allocation Procedure
- Processing order: per course, CGPA order for 70% of the seats, then random for the other 30%, using each student's priority list.
- Preference selection procedure: a student is considered for the highest-ranked course of their list that still has a seat.
- Number of allocation rounds: one allotment after Window 1 closes, then students left without a course choose from the remaining courses that have vacant seats, in the add/drop window. The project runs one round only.
- Handling of unavailable preferences: the next preference in the list.
- Handling of unallocated students: they choose from courses with vacant seats in the later window.
- Handling of incomplete preference lists: if no course is allotted and the student gave fewer than 15 choices, a random allotment takes place.

## 5. Additional Constraints
- Compulsory course handling: students register for their template's IC, DC and DP courses. The project models them as fixed timetable slots per student (matched by department) that no elective may overlap.
- Timetable conflicts: a student must choose courses with no clash; a course in a clash is rejected from the registration form (3.4.1) and a registration can be cancelled for a clash (3.5.2).
- Prerequisites: not stated in the sections read. **To confirm.**
- Course combinations or exclusions: no two courses with similar content (see above).
- Other institutional rules: modular courses run for half a semester (before or after the mid-semester exam) and are registered together with the other courses (2.5); the academic load per semester follows the program template (2.7).

## 6. Data Availability
- Approved data source: **To confirm.**
- Available fields: the project uses student id, name, CGPA, department, semester; course code, title, seats, group, weekly timetable slots; ranked preferences per group.
- Historical allocations available: **To confirm.**
- Data anonymization requirements: **To confirm.** The prototype uses generated mock data only.
- Permission or access restrictions: **To confirm.**

## 7. Open Questions
- Question: Is the CGPA used for the 70% merit seats the current CGPA at pre-registration or the current semester's? Answer: the cumulative CGPA up to the previous semester, as at pre-registration (confirmed by the project team, 2026-11-01).
- Question: How are equal CGPAs resolved? Answer:
- Question: Must every student receive a course for every elective slot, or is "at most one" enough? Answer:
- Question: How are the compulsory (IC, DC, DP) courses and their timetables supplied per student (department, semester, section)? Answer:
- Question: Does the second round (vacant seats) follow the same CGPA/random rule? What happens to courses with fewer than 10 students? Answer:
- Question: Are there prerequisites or reserved seats that the allocation must respect? Answer:
- Question: Should the optimizer reproduce the official procedure, or is it a benchmark that must only never do worse than it? Answer:
