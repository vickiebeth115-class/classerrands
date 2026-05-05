export type Role = 'TEACHER' | 'OFFICER' | 'STUDENT';

export interface Student {
  id: string;
  name: string;
  seatNumber: string;
}

export type ErrandStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';

export interface Errand {
  id: string;
  studentId: string;
  studentName: string;
  date: string;
  reason: string;
  description: string;
  photoUrl?: string; // Base64 or mock URL
  status: ErrandStatus;
  
  // Assignment info
  assignedTask?: string;
  assignmentDate?: string;
  
  // Review info
  reviewedBy?: Role;
  reviewTimestamp?: string;
  reviewProofUrl?: string;
  isReviewed: boolean;
}

export const PRESET_TASKS = [
  '拿午餐',
  '資源回收',
  '各處室遞送公文',
  '教室佈置',
  '抬餐桶',
  '環境整潔',
  '其他'
];
