export interface StudentFormulaRow {
  id: string;
  name: string;
  attendedLessons: number;
  paymentCount: number;
  ltv: number;
  group: string;
  teacher: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  months: number;
  renewals: number | null;
  subscriptionAmount: number;
}

export interface StudentMetrics {
  total: number;
  active: number;
  frozen: number;
  finished: number;
  booking: number;
  activeShare: number;
  frozenShare: number;
  finishedShare: number;
  bookingShare: number;
  renewalRate: number;
  churnRate: number;
  averageLifetime: number;
  maximumLifetime: number;
  averageRenewals: number;
  maximumRenewals: number;
  averageLtv: number;
  maximumLtv: number;
}

export interface GroupHours {
  group: string;
  hours: number;
}

export interface TeacherRate {
  teacher: string;
  rate: number;
}

export interface GroupMetricRow {
  group: string;
  teacher: string;
  studentCount: number;
  revenue: number;
  hours: number;
  expense: number;
  grossProfit: number;
  comment: string;
}

export interface GroupMetrics {
  rows: GroupMetricRow[];
  averageRevenue: number;
  maximumRevenue: number;
  averageGrossProfit: number;
  maximumGrossProfit: number;
}
