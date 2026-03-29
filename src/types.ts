import { Timestamp } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  rollNumber: string;
  branch: string;
  joinedAt: Timestamp;
  role?: 'admin' | 'student';
  deleted?: boolean;
}

export interface AttendanceEntry {
  uid: string;
  rollNumber: string;
  name: string;
  markedAt: Timestamp;
}

export interface AttendanceRecord {
  date: string;
  dayName: string;
  classHeld: boolean;
  presentStudents: AttendanceEntry[];
}

export interface ClassStats {
  totalClassesHeld: number;
  lastUpdated: Timestamp;
}

export interface NetworkConfig {
  allowedIp: string;
  restrictionEnabled: boolean;
  lastUpdated: Timestamp;
}

export interface LeaveRequest {
  id?: string;
  uid: string;
  name: string;
  rollNumber: string;
  date: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: Timestamp;
}

export const CLASS_SCHEDULE = {
  subject: "Data Structures Lecture",
  branch: "BEE",
  classDays: [1, 3, 5],  // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  classSlot: {
    startTime: "9:00",   // 24hr format
    endTime: "10:00",
    graceMinutes: 10      // allow marking ±15 min around start
  },
  semester: "Even 2025",
  totalWeeks: 16
};
