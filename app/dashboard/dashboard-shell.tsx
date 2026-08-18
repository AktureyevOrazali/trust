"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { DashboardData } from "@/lib/dashboard";
import type {
  AnalyticsFilters,
  GroupsDashboardData,
  StudentsDashboardData,
} from "@/lib/analytics/types";
import { GroupsDashboard } from "./groups-dashboard";
import { SalesDashboard } from "./sales-dashboard";
import { StudentsDashboard } from "./students-dashboard";
import styles from "./dashboard.module.css";

type DashboardTab = "sales" | "students" | "groups";
type AsyncState<T> = {
  data: T | null;
  error: string;
  loading: boolean;
};

const emptyState = <T,>(): AsyncState<T> => ({
  data: null,
  error: "",
  loading: false,
});

function queryString(filters: AnalyticsFilters): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value) search.set(name, value);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

function LoadingPanel() {
  return (
    <div className={styles.loadingPanel} aria-live="polite" aria-label="Загрузка данных">
      <div />
      <div />
      <div />
      <p>Загружаем данные AlphaCRM</p>
    </div>
  );
}

function ErrorPanel({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className={styles.errorPanel} role="alert">
      <strong>Не удалось загрузить вкладку</strong>
      <p>{message}</p>
      <button type="button" onClick={retry}>Повторить</button>
    </div>
  );
}

export function DashboardShell({ salesData }: { salesData: DashboardData }) {
  const [activeTab, setActiveTab] = useState<DashboardTab>("sales");
  const [students, setStudents] = useState<AsyncState<StudentsDashboardData>>(emptyState);
  const [groups, setGroups] = useState<AsyncState<GroupsDashboardData>>(emptyState);
  const [studentFilters, setStudentFilters] = useState<AnalyticsFilters>({});
  const [groupFilters, setGroupFilters] = useState<AnalyticsFilters>({});
  const studentRequest = useRef(0);
  const groupRequest = useRef(0);

  const loadStudents = useCallback(async (filters: AnalyticsFilters) => {
    const requestId = ++studentRequest.current;
    setStudents((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch(`/api/students${queryString(filters)}`, { cache: "no-store" });
      const result = await response.json() as StudentsDashboardData & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Данные учеников недоступны");
      if (requestId === studentRequest.current) {
        setStudents({ data: result, loading: false, error: "" });
      }
    } catch (error) {
      if (requestId !== studentRequest.current) return;
      setStudents((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Данные учеников недоступны",
      }));
    }
  }, []);

  const loadGroups = useCallback(async (filters: AnalyticsFilters) => {
    const requestId = ++groupRequest.current;
    setGroups((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch(`/api/groups${queryString(filters)}`, { cache: "no-store" });
      const result = await response.json() as GroupsDashboardData & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Данные групп недоступны");
      if (requestId === groupRequest.current) {
        setGroups({ data: result, loading: false, error: "" });
      }
    } catch (error) {
      if (requestId !== groupRequest.current) return;
      setGroups((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Данные групп недоступны",
      }));
    }
  }, []);

  useEffect(() => {
    if (activeTab === "students" && !students.data && !students.loading && !students.error) {
      void loadStudents(studentFilters);
    }
    if (activeTab === "groups" && !groups.data && !groups.loading && !groups.error) {
      void loadGroups(groupFilters);
    }
  }, [
    activeTab,
    groupFilters,
    groups.data,
    groups.error,
    groups.loading,
    loadGroups,
    loadStudents,
    studentFilters,
    students.data,
    students.error,
    students.loading,
  ]);

  const updateStudentFilters = (filters: AnalyticsFilters) => {
    setStudentFilters(filters);
    void loadStudents(filters);
  };
  const updateGroupFilters = (filters: AnalyticsFilters) => {
    setGroupFilters(filters);
    void loadGroups(filters);
  };
  const selectTabFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs: DashboardTab[] = ["sales", "students", "groups"];
    const current = tabs.indexOf(activeTab);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setActiveTab(tabs[next]);
    requestAnimationFrame(() => document.getElementById(`tab-${tabs[next]}`)?.focus());
  };

  return (
    <>
      <nav className={styles.tabsWrap} aria-label="Разделы аналитики">
        <div
          className={styles.tabs}
          role="tablist"
          aria-label="Дэшборды"
          onKeyDown={selectTabFromKeyboard}
        >
          <button
            id="tab-sales"
            type="button"
            role="tab"
            aria-selected={activeTab === "sales"}
            aria-controls="panel-sales"
            tabIndex={activeTab === "sales" ? 0 : -1}
            onClick={() => setActiveTab("sales")}
          >Продажи</button>
          <button
            id="tab-students"
            type="button"
            role="tab"
            aria-selected={activeTab === "students"}
            aria-controls="panel-students"
            tabIndex={activeTab === "students" ? 0 : -1}
            onClick={() => setActiveTab("students")}
          >Ученики</button>
          <button
            id="tab-groups"
            type="button"
            role="tab"
            aria-selected={activeTab === "groups"}
            aria-controls="panel-groups"
            tabIndex={activeTab === "groups" ? 0 : -1}
            onClick={() => setActiveTab("groups")}
          >Группы</button>
        </div>
        {activeTab !== "sales" && (
          <button
            className={styles.tabRefresh}
            type="button"
            disabled={activeTab === "students" ? students.loading : groups.loading}
            onClick={() => activeTab === "students"
              ? void loadStudents(studentFilters)
              : void loadGroups(groupFilters)}
          >Обновить вкладку</button>
        )}
      </nav>

      <div
        id="panel-sales"
        role="tabpanel"
        aria-labelledby="tab-sales"
        hidden={activeTab !== "sales"}
      >
        {activeTab === "sales" && <SalesDashboard data={salesData} />}
      </div>
      <div
        id="panel-students"
        role="tabpanel"
        aria-labelledby="tab-students"
        hidden={activeTab !== "students"}
      >
        {activeTab === "students" && (
          students.error && !students.data
            ? <ErrorPanel message={students.error} retry={() => void loadStudents(studentFilters)} />
            : students.data
              ? <StudentsDashboard
                  data={students.data}
                  filters={studentFilters}
                  refreshing={students.loading}
                  onFiltersChange={updateStudentFilters}
                />
              : <LoadingPanel />
        )}
      </div>
      <div
        id="panel-groups"
        role="tabpanel"
        aria-labelledby="tab-groups"
        hidden={activeTab !== "groups"}
      >
        {activeTab === "groups" && (
          groups.error && !groups.data
            ? <ErrorPanel message={groups.error} retry={() => void loadGroups(groupFilters)} />
            : groups.data
              ? <GroupsDashboard
                  data={groups.data}
                  filters={groupFilters}
                  refreshing={groups.loading}
                  onFiltersChange={updateGroupFilters}
                  onRatesSaved={() => void loadGroups(groupFilters)}
                />
              : <LoadingPanel />
        )}
      </div>
    </>
  );
}
