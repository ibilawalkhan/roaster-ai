"use client";

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { Employee, RosterData, Schedule, Shift } from "./types";
import { getSupabaseClient } from "./supabase/client";
import { normalisePhone, onAuthStateChange, signOut as authSignOut } from "./supabase/auth";
import {
  mapEmployee,
  mapSchedule,
  mapShift,
  type LocationNamer,
  type LocationRow,
} from "./mappers";
import { addDays, mondayOf } from "./utils";
import type { TablesUpdate } from "./supabase/database.types";

export type Role = "admin" | "employee";

export interface Session {
  role: Role | null;
  employeeId: string | null; // the viewing user's app_user id
  appUserId: string | null;
  businessId: string | null;
}

const EMPTY_SESSION: Session = {
  role: null,
  employeeId: null,
  appUserId: null,
  businessId: null,
};
const EMPTY_DATA: RosterData = { employees: [], shifts: [], schedules: [] };

interface State {
  data: RosterData;
  locations: LocationRow[];
  session: Session;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
}

type Action = { type: "SET"; patch: Partial<State> };

function reducer(state: State, action: Action): State {
  return action.type === "SET" ? { ...state, ...action.patch } : state;
}

function initState(): State {
  return {
    data: EMPTY_DATA,
    locations: [],
    session: EMPTY_SESSION,
    hydrated: false,
    loading: false,
    error: null,
  };
}

/** A synthetic current-fortnight schedule so screens never crash before a roster exists. */
function syntheticSchedule(): Schedule {
  const start = mondayOf(new Date());
  return {
    id: "",
    name: "Current fortnight",
    startDate: start,
    endDate: addDays(start, 13),
    status: "draft",
    createdAt: new Date().toISOString(),
  };
}

export interface StoreApi {
  data: RosterData;
  locations: LocationRow[];
  session: Session;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  addEmployee: (input: Omit<Employee, "id" | "createdAt">) => Promise<void>;
  updateEmployee: (id: string, patch: Partial<Employee>) => Promise<void>;
  setEmployeeActive: (id: string, isActive: boolean) => Promise<void>;
  addShift: (input: Omit<Shift, "id" | "createdAt">) => Promise<void>;
  updateShift: (id: string, patch: Partial<Shift>) => Promise<void>;
  removeShift: (id: string) => Promise<void>;
  copyShifts: (shifts: Omit<Shift, "id" | "createdAt">[]) => Promise<void>;
  setScheduleStatus: (id: string, status: "draft" | "published") => Promise<void>;
  logout: () => Promise<void>;
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);
  // Async handlers/reloads read the latest state through this ref. Updated in an
  // effect (not during render) so it's always current by the time a handler runs.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const inFlight = useRef(false);

  const set = (patch: Partial<State>) => dispatch({ type: "SET", patch });

  // ---- helpers reading the latest state ----
  const locationNamer = (): LocationNamer => {
    const locs = stateRef.current.locations;
    return (id) => locs.find((l) => l.id === id)?.name ?? "";
  };
  const locationIdByName = (name: string): string | null =>
    stateRef.current.locations.find((l) => l.name === name)?.id ?? null;

  const currentRosterId = (): string => stateRef.current.data.schedules[0]?.id ?? "";

  /** Ensure a real roster row exists (managers), returning its id. */
  const ensureRosterId = async (): Promise<string> => {
    const existing = currentRosterId();
    if (existing) return existing;
    const supabase = getSupabaseClient();
    const businessId = stateRef.current.session.businessId;
    const { data, error } = await supabase
      .from("roster")
      .insert({
        business_id: businessId!,
        fortnight_start: mondayOf(new Date()),
        status: "draft",
      })
      .select()
      .single();
    if (error) throw error;
    set({
      data: { ...stateRef.current.data, schedules: [mapSchedule(data)] },
    });
    return data.id;
  };

  // ---- reloads (source of truth = DB) ----
  const reloadEmployees = async () => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from("app_user").select("*").order("name");
    if (error) throw error;
    const name = locationNamer();
    set({
      data: {
        ...stateRef.current.data,
        employees: (data ?? []).map((r) => mapEmployee(r, name)),
      },
    });
  };

  const reloadShifts = async () => {
    const rosterId = currentRosterId();
    const supabase = getSupabaseClient();
    const { data, error } = rosterId
      ? await supabase.from("shift").select("*").eq("roster_id", rosterId)
      : { data: [], error: null };
    if (error) throw error;
    const name = locationNamer();
    set({
      data: {
        ...stateRef.current.data,
        shifts: (data ?? []).map((r) => mapShift(r, name)),
      },
    });
  };

  const reloadSchedule = async () => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("roster")
      .select("*")
      .order("fortnight_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    set({
      data: {
        ...stateRef.current.data,
        schedules: [data ? mapSchedule(data) : syntheticSchedule()],
      },
    });
  };

  // ---- full load after sign-in ----
  const loadAll = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    set({ loading: true, error: null });
    try {
      const supabase = getSupabaseClient();

      // Ensure the auth user is linked to a staff record (§4).
      const { data: me, error: linkErr } = await supabase.rpc("link_current_user");
      if (linkErr) throw linkErr;

      const role: Role = me.role === "manager" ? "admin" : "employee";
      const businessId = me.business_id;

      const [{ data: locs }, { data: users }, { data: roster }] = await Promise.all([
        supabase.from("location").select("*").order("name"),
        supabase.from("app_user").select("*").order("name"),
        supabase
          .from("roster")
          .select("*")
          .order("fortnight_start", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const locations = locs ?? [];
      const name: LocationNamer = (id) => locations.find((l) => l.id === id)?.name ?? "";

      // Managers always get a real roster to write into; staff use what exists.
      let schedule: Schedule;
      let rosterId = "";
      if (roster) {
        schedule = mapSchedule(roster);
        rosterId = roster.id;
      } else if (role === "admin") {
        const { data: created, error: createErr } = await supabase
          .from("roster")
          .insert({ business_id: businessId, fortnight_start: mondayOf(new Date()), status: "draft" })
          .select()
          .single();
        if (createErr) throw createErr;
        schedule = mapSchedule(created);
        rosterId = created.id;
      } else {
        schedule = syntheticSchedule();
      }

      const { data: shifts } = rosterId
        ? await supabase.from("shift").select("*").eq("roster_id", rosterId)
        : { data: [] as never[] };

      set({
        session: { role, employeeId: me.id, appUserId: me.id, businessId },
        locations,
        data: {
          employees: (users ?? []).map((r) => mapEmployee(r, name)),
          shifts: (shifts ?? []).map((r) => mapShift(r, name)),
          schedules: [schedule],
        },
        hydrated: true,
        loading: false,
      });
    } catch (e) {
      // e.g. no staff record for this phone → sign the user back out with a message.
      set({
        session: EMPTY_SESSION,
        data: EMPTY_DATA,
        error: e instanceof Error ? e.message : "Could not load your account.",
        hydrated: true,
        loading: false,
      });
      await authSignOut().catch(() => {});
    } finally {
      inFlight.current = false;
    }
  };

  // ---- auth lifecycle ----
  useEffect(() => {
    const unsub = onAuthStateChange((session) => {
      if (session) {
        // Defer: calling supabase inside the auth callback can deadlock (v2).
        setTimeout(() => void loadAll(), 0);
      } else {
        set({ session: EMPTY_SESSION, data: EMPTY_DATA, locations: [], hydrated: true, loading: false });
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api: StoreApi = {
    data: state.data,
    locations: state.locations,
    session: state.session,
    hydrated: state.hydrated,
    loading: state.loading,
    error: state.error,

    addEmployee: async (input) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("app_user").insert({
        business_id: stateRef.current.session.businessId!,
        name: input.name,
        email: input.email || null,
        phone: input.phone ? normalisePhone(input.phone) : null,
        position: input.role,
        employment_type: input.employmentType,
        pay_rate: input.hourlyRate,
        home_location_id: locationIdByName(input.location),
        colour: input.accent,
        active: input.isActive,
      });
      if (error) throw error;
      await reloadEmployees();
    },

    updateEmployee: async (id, patch) => {
      const supabase = getSupabaseClient();
      const upd: TablesUpdate<"app_user"> = {};
      if (patch.name !== undefined) upd.name = patch.name;
      if (patch.email !== undefined) upd.email = patch.email || null;
      if (patch.phone !== undefined) upd.phone = patch.phone ? normalisePhone(patch.phone) : null;
      if (patch.role !== undefined) upd.position = patch.role;
      if (patch.employmentType !== undefined) upd.employment_type = patch.employmentType;
      if (patch.hourlyRate !== undefined) upd.pay_rate = patch.hourlyRate;
      if (patch.location !== undefined) upd.home_location_id = locationIdByName(patch.location);
      if (patch.accent !== undefined) upd.colour = patch.accent;
      if (patch.isActive !== undefined) upd.active = patch.isActive;
      const { error } = await supabase.from("app_user").update(upd).eq("id", id);
      if (error) throw error;
      await reloadEmployees();
    },

    setEmployeeActive: async (id, isActive) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("app_user").update({ active: isActive }).eq("id", id);
      if (error) throw error;
      await reloadEmployees();
    },

    addShift: async (input) => {
      const supabase = getSupabaseClient();
      const rosterId = await ensureRosterId();
      const { error } = await supabase.from("shift").insert({
        business_id: stateRef.current.session.businessId!,
        roster_id: rosterId,
        location_id: locationIdByName(input.location),
        assigned_user_id: input.employeeId || null,
        date: input.date,
        start_time: input.startTime,
        end_time: input.endTime,
        break_minutes: input.breakMinutes,
        role: input.role,
        note: input.notes ?? null,
        status: "ASSIGNED",
      });
      if (error) throw error;
      await reloadShifts();
    },

    updateShift: async (id, patch) => {
      const supabase = getSupabaseClient();
      const upd: TablesUpdate<"shift"> = {};
      if (patch.employeeId !== undefined) upd.assigned_user_id = patch.employeeId || null;
      if (patch.date !== undefined) upd.date = patch.date;
      if (patch.startTime !== undefined) upd.start_time = patch.startTime;
      if (patch.endTime !== undefined) upd.end_time = patch.endTime;
      if (patch.role !== undefined) upd.role = patch.role;
      if (patch.location !== undefined) upd.location_id = locationIdByName(patch.location);
      if (patch.breakMinutes !== undefined) upd.break_minutes = patch.breakMinutes;
      if (patch.notes !== undefined) upd.note = patch.notes ?? null;
      const { error } = await supabase.from("shift").update(upd).eq("id", id);
      if (error) throw error;
      await reloadShifts();
    },

    removeShift: async (id) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("shift").delete().eq("id", id);
      if (error) throw error;
      await reloadShifts();
    },

    copyShifts: async (shifts) => {
      const supabase = getSupabaseClient();
      const rosterId = await ensureRosterId();
      const businessId = stateRef.current.session.businessId!;
      const rows = shifts.map((s) => ({
        business_id: businessId,
        roster_id: rosterId,
        location_id: locationIdByName(s.location),
        assigned_user_id: s.employeeId || null,
        date: s.date,
        start_time: s.startTime,
        end_time: s.endTime,
        break_minutes: s.breakMinutes,
        role: s.role,
        note: s.notes ?? null,
        status: "ASSIGNED" as const,
      }));
      if (rows.length) {
        const { error } = await supabase.from("shift").insert(rows);
        if (error) throw error;
      }
      await reloadShifts();
    },

    setScheduleStatus: async (_id, status) => {
      const supabase = getSupabaseClient();
      const rosterId = await ensureRosterId();
      const { error } = await supabase.from("roster").update({ status }).eq("id", rosterId);
      if (error) throw error;
      await reloadSchedule();
    },

    logout: async () => {
      await authSignOut().catch(() => {});
      set({ session: EMPTY_SESSION, data: EMPTY_DATA, locations: [], error: null });
    },
  };

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
