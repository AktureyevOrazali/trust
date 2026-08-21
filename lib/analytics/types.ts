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

export interface AnalyticsFilters {
  branch?: string;
  teacher?: string;
  group?: string;
  status?: string;
}

export interface DataFreshness {
  fetchedAt: number | null;
  status: "stored" | "stale" | "unavailable";
}

export interface DataQualityWarning {
  code: string;
  message: string;
  count: number;
}

export interface FilterOption {
  value: string;
  label: string;
}

export interface AnalyticsFilterOptions {
  branches: FilterOption[];
  teachers: string[];
  groups: string[];
  statuses: string[];
}

export type StudentRegistryRow = Pick<
  StudentFormulaRow,
  | "id"
  | "name"
  | "attendedLessons"
  | "paymentCount"
  | "ltv"
  | "group"
  | "teacher"
  | "startDate"
  | "endDate"
  | "status"
  | "months"
  | "renewals"
  | "subscriptionAmount"
> & {
  lessonBalance: number;
  activeTariff: string;
};

export interface StudentRiskRow {
  id: string;
  name: string;
  group: string;
  tariffEndDate: string | null;
  lessonBalance: number;
  reasons: string[];
}

export interface StudentTrendPoint {
  date: string;
  active: number;
  total: number;
}

export interface StudentsDashboardData {
  metrics: StudentMetrics;
  trend: StudentTrendPoint[];
  risks: StudentRiskRow[];
  filters: AnalyticsFilterOptions;
  rows: StudentRegistryRow[];
  warnings: DataQualityWarning[];
  freshness: DataFreshness;
}

export interface TeacherRollupRow {
  teacher: string;
  groups: number;
  students: number;
  hours: number;
  revenue: number;
  expense: number;
  grossProfit: number;
}

export interface GroupsDashboardData {
  metrics: GroupMetrics;
  teacherRollups: TeacherRollupRow[];
  teacherRates: Array<{
    branchId: string;
    teacherId: string;
    teacher: string;
    rate: number;
    source: "sheet_seed" | "manual";
  }>;
  filters: AnalyticsFilterOptions;
  warnings: DataQualityWarning[];
  freshness: DataFreshness;
}
