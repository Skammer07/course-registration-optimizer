/**
 * tests/fixtures/sampleData.js
 * Synthetic test data aligned with the algorithm's expected format.
 */

export const sampleStudents = [
  { studentId: "S001", name: "Aarav Kumar", cgpa: 9.5, department: "CSE", semesterId: "SEM2026A", electiveGroups: ["A"], isActive: true },
  { studentId: "S002", name: "Priya Singh", cgpa: 9.0, department: "CSE", semesterId: "SEM2026A", electiveGroups: ["A"], isActive: true },
  { studentId: "S003", name: "Rahul Verma", cgpa: 8.5, department: "CSE", semesterId: "SEM2026A", electiveGroups: ["A"], isActive: true },
  { studentId: "S004", name: "Sneha Patel", cgpa: 8.0, department: "CSE", semesterId: "SEM2026A", electiveGroups: ["A"], isActive: true },
];

export const sampleCourses = [
  {
    courseCode: "CS301",
    title: "Data Structures",
    capacity: 3,
    semesterId: "SEM2026A",
    electiveGroup: "A",
    timetableSlots: [{ day: "Monday", start: "09:00", end: "09:50" }],
    isActive: true,
  },
  {
    courseCode: "CS302",
    title: "Database Systems",
    capacity: 3,
    semesterId: "SEM2026A",
    electiveGroup: "A",
    timetableSlots: [{ day: "Tuesday", start: "10:00", end: "10:50" }],
    isActive: true,
  },
  {
    courseCode: "CS303",
    title: "Operating Systems",
    capacity: 3,
    semesterId: "SEM2026A",
    electiveGroup: "A",
    timetableSlots: [{ day: "Wednesday", start: "11:00", end: "11:50" }],
    isActive: true,
  },
];

// For algorithm input (flat format)
export const algStudents = sampleStudents.map(s => ({
  id: s.studentId,
  name: s.name,
  cgpa: s.cgpa,
}));

export const algCourses = sampleCourses.map(c => ({
  id: c.courseCode,
  name: c.title,
  capacity: c.capacity,
}));

export const algPreferences = [
  { studentId: "S001", courseId: "CS301", rank: 1 },
  { studentId: "S001", courseId: "CS302", rank: 2 },
  { studentId: "S002", courseId: "CS301", rank: 1 },
  { studentId: "S002", courseId: "CS303", rank: 2 },
  { studentId: "S003", courseId: "CS302", rank: 1 },
  { studentId: "S003", courseId: "CS301", rank: 2 },
  { studentId: "S004", courseId: "CS303", rank: 1 },
  { studentId: "S004", courseId: "CS302", rank: 2 },
];

