# Security Specification

## Data Invariants
1. A Student must have a seat number and name.
2. An Errand must be linked to a valid Student.
3. Only specific roles can perform certain updates (Teacher can delete/register, Officer can assign/review, Student read-only).

## The Dirty Dozen Payloads
(Testing various unauthorized writes and deletions)

## The Test Runner
(Standard firestore.rules.test.ts template)
