"use client";

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { Employee, RosterData, Shift } from "./types";
import { buildSeed } from "./seed";
import { uid } from "./utils";

const STORAGE_KEY = "altazah-roster-v1";

export type Role = "admin" | "employee";
export interface Session {
  role: Role | null;
  employeeId: string | null; // active employee in the employee view
}

interface State {
  data: RosterData;
  session: Session;
  hydrated: boolean;
}

type Action =
  | { type: "HYDRATE"; payload: { data: RosterData; session: Session } }
  | { type: "ADD_EMPLOYEE"; employee: Employee }
  | { type: "UPDATE_EMPLOYEE"; id: string; patch: Partial<Employee> }
  | { type: "ADD_SHIFT"; shift: Shift }
  | { type: "UPDATE_SHIFT"; id: string; patch: Partial<Shift> }
  | { type: "REMOVE_SHIFT"; id: string }
  | { type: "ADD_SHIFTS"; shifts: Shift[] }
  | { type: "SET_SCHEDULE_STATUS"; id: string; status: "draft" | "published" }
  | { type: "LOGIN"; role: Role; employeeId?: string | null }
  | { type: "SET_CURRENT_EMPLOYEE"; employeeId: string }
  | { type: "LOGOUT" }
  | { type: "RESET" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "HYDRATE":
      return { ...state, ...action.payload, hydrated: true };

    case "ADD_EMPLOYEE":
      return {
        ...state,
        data: { ...state.data, employees: [...state.data.employees, action.employee] },
      };

    case "UPDATE_EMPLOYEE":
      return {
        ...state,
        data: {
          ...state.data,
          employees: state.data.employees.map((e) =>
            e.id === action.id ? { ...e, ...action.patch } : e
          ),
        },
      };

    case "ADD_SHIFT":
      return {
        ...state,
        data: { ...state.data, shifts: [...state.data.shifts, action.shift] },
      };

    case "ADD_SHIFTS":
      return {
        ...state,
        data: { ...state.data, shifts: [...state.data.shifts, ...action.shifts] },
      };

    case "UPDATE_SHIFT":
      return {
        ...state,
        data: {
          ...state.data,
          shifts: state.data.shifts.map((s) =>
            s.id === action.id ? { ...s, ...action.patch } : s
          ),
        },
      };

    case "REMOVE_SHIFT":
      return {
        ...state,
        data: { ...state.data, shifts: state.data.shifts.filter((s) => s.id !== action.id) },
      };

    case "SET_SCHEDULE_STATUS":
      return {
        ...state,
        data: {
          ...state.data,
          schedules: state.data.schedules.map((s) =>
            s.id === action.id ? { ...s, status: action.status } : s
          ),
        },
      };

    case "LOGIN":
      return {
        ...state,
        session: {
          role: action.role,
          employeeId:
            action.employeeId ??
            (action.role === "employee"
              ? state.data.employees.find((e) => e.isActive)?.id ?? null
              : null),
        },
      };

    case "SET_CURRENT_EMPLOYEE":
      return { ...state, session: { ...state.session, employeeId: action.employeeId } };

    case "LOGOUT":
      return { ...state, session: { role: null, employeeId: null } };

    case "RESET":
      return { ...state, data: buildSeed(), session: { role: null, employeeId: null } };

    default:
      return state;
  }
}

interface StoreApi {
  data: RosterData;
  session: Session;
  hydrated: boolean;
  addEmployee: (input: Omit<Employee, "id" | "createdAt">) => Employee;
  updateEmployee: (id: string, patch: Partial<Employee>) => void;
  setEmployeeActive: (id: string, isActive: boolean) => void;
  addShift: (input: Omit<Shift, "id" | "createdAt">) => void;
  updateShift: (id: string, patch: Partial<Shift>) => void;
  removeShift: (id: string) => void;
  copyShifts: (shifts: Omit<Shift, "id" | "createdAt">[]) => void;
  setScheduleStatus: (id: string, status: "draft" | "published") => void;
  login: (role: Role, employeeId?: string | null) => void;
  setCurrentEmployee: (employeeId: string) => void;
  logout: () => void;
  reset: () => void;
}

const StoreContext = createContext<StoreApi | null>(null);

function initState(): State {
  return { data: buildSeed(), session: { role: null, employeeId: null }, hydrated: false };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);
  const didLoad = useRef(false);

  // Load from localStorage once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { data: RosterData; session: Session };
        dispatch({ type: "HYDRATE", payload: { data: parsed.data, session: parsed.session } });
      } else {
        dispatch({ type: "HYDRATE", payload: { data: state.data, session: state.session } });
      }
    } catch {
      dispatch({ type: "HYDRATE", payload: { data: state.data, session: state.session } });
    }
    didLoad.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist after every change (once loaded).
  useEffect(() => {
    if (!didLoad.current || !state.hydrated) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ data: state.data, session: state.session })
      );
    } catch {
      // ignore quota / private-mode errors
    }
  }, [state.data, state.session, state.hydrated]);

  const api: StoreApi = {
    data: state.data,
    session: state.session,
    hydrated: state.hydrated,
    addEmployee: (input) => {
      const employee: Employee = { ...input, id: uid("emp"), createdAt: new Date().toISOString() };
      dispatch({ type: "ADD_EMPLOYEE", employee });
      return employee;
    },
    updateEmployee: (id, patch) => dispatch({ type: "UPDATE_EMPLOYEE", id, patch }),
    setEmployeeActive: (id, isActive) =>
      dispatch({ type: "UPDATE_EMPLOYEE", id, patch: { isActive } }),
    addShift: (input) =>
      dispatch({
        type: "ADD_SHIFT",
        shift: { ...input, id: uid("shf"), createdAt: new Date().toISOString() },
      }),
    updateShift: (id, patch) => dispatch({ type: "UPDATE_SHIFT", id, patch }),
    removeShift: (id) => dispatch({ type: "REMOVE_SHIFT", id }),
    copyShifts: (shifts) =>
      dispatch({
        type: "ADD_SHIFTS",
        shifts: shifts.map((s) => ({ ...s, id: uid("shf"), createdAt: new Date().toISOString() })),
      }),
    setScheduleStatus: (id, status) => dispatch({ type: "SET_SCHEDULE_STATUS", id, status }),
    login: (role, employeeId) => dispatch({ type: "LOGIN", role, employeeId }),
    setCurrentEmployee: (employeeId) => dispatch({ type: "SET_CURRENT_EMPLOYEE", employeeId }),
    logout: () => dispatch({ type: "LOGOUT" }),
    reset: () => dispatch({ type: "RESET" }),
  };

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
