"use client";

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { Business, Location, NewTeamMember, Role, TeamMember } from "./types";
import { getSupabaseClient } from "./supabase/client";
import { normalisePhone, onAuthStateChange, signOut as authSignOut } from "./supabase/auth";
import { mapBusiness, mapLocation, mapRole, mapTeamMember } from "./mappers";
import { notify } from "./notify";
import type { TablesInsert, TablesUpdate } from "./supabase/database.types";

export type AccessRole = "admin" | "employee";

export interface Session {
  role: AccessRole | null; // admin = manager, employee = staff (layout gating)
  appUserId: string | null;
  businessId: string | null;
  isManager: boolean;
}

const EMPTY_SESSION: Session = { role: null, appUserId: null, businessId: null, isManager: false };

interface State {
  business: Business | null;
  locations: Location[];
  roles: Role[];
  team: TeamMember[];
  session: Session;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
}

function initState(): State {
  return {
    business: null,
    locations: [],
    roles: [],
    team: [],
    session: EMPTY_SESSION,
    hydrated: false,
    loading: false,
    error: null,
  };
}

type Action = { type: "SET"; patch: Partial<State> };
function reducer(state: State, action: Action): State {
  return action.type === "SET" ? { ...state, ...action.patch } : state;
}

export interface StoreApi {
  business: Business | null;
  locations: Location[];
  roles: Role[];
  team: TeamMember[];
  /** The signed-in user's own record (staff or manager). */
  me: TeamMember | null;
  session: Session;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  addMember: (input: NewTeamMember) => Promise<void>;
  updateMember: (id: string, patch: Partial<TeamMember>) => Promise<void>;
  setMemberActive: (id: string, active: boolean) => Promise<void>;
  inviteMember: (id: string) => Promise<void>;
  updateOwnContact: (patch: { phone?: string; email?: string }) => Promise<void>;
  /** Re-read business/locations/roles/team — used after Settings writes (M1). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const inFlight = useRef(false);
  const set = (patch: Partial<State>) => dispatch({ type: "SET", patch });

  // ---- data loading ----
  const reloadTeam = async () => {
    const supabase = getSupabaseClient();
    const [{ data: users, error: uErr }, { data: links, error: lErr }] = await Promise.all([
      supabase.from("app_user").select("*").order("name"),
      supabase.from("user_role").select("user_id, role_id"),
    ]);
    if (uErr) throw uErr;
    if (lErr) throw lErr;
    const rolesByUser = new Map<string, string[]>();
    for (const l of links ?? []) {
      const arr = rolesByUser.get(l.user_id) ?? [];
      arr.push(l.role_id);
      rolesByUser.set(l.user_id, arr);
    }
    set({ team: (users ?? []).map((u) => mapTeamMember(u, rolesByUser.get(u.id) ?? [])) });
  };

  const loadAll = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    set({ loading: true, error: null });
    try {
      const supabase = getSupabaseClient();
      const { data: me, error: linkErr } = await supabase.rpc("link_current_user");
      if (linkErr) throw linkErr;

      const role: AccessRole = me.is_manager ? "admin" : "employee";

      const [{ data: biz }, { data: locs }, { data: roleRows }] = await Promise.all([
        supabase.from("business").select("*").limit(1).maybeSingle(),
        supabase.from("location").select("*").order("name"),
        supabase.from("role").select("*").order("name"),
      ]);

      set({
        session: {
          role,
          appUserId: me.id,
          businessId: me.business_id,
          isManager: me.is_manager,
        },
        business: biz ? mapBusiness(biz) : null,
        locations: (locs ?? []).map(mapLocation),
        roles: (roleRows ?? []).map(mapRole),
      });
      await reloadTeam();
      set({ hydrated: true, loading: false });
    } catch (e) {
      set({
        session: EMPTY_SESSION,
        error: e instanceof Error ? e.message : "Could not load your account.",
        hydrated: true,
        loading: false,
      });
      await authSignOut().catch(() => {});
    } finally {
      inFlight.current = false;
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChange((session) => {
      if (session) {
        setTimeout(() => void loadAll(), 0);
      } else {
        set({
          session: EMPTY_SESSION,
          business: null,
          locations: [],
          roles: [],
          team: [],
          hydrated: true,
          loading: false,
        });
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- role-link helpers ----
  const replaceRoles = async (userId: string, roleIds: string[]) => {
    const supabase = getSupabaseClient();
    const businessId = stateRef.current.session.businessId!;
    const unique = Array.from(new Set(roleIds));
    const { error: delErr } = await supabase.from("user_role").delete().eq("user_id", userId);
    if (delErr) throw delErr;
    if (unique.length) {
      const rows = unique.map((role_id) => ({ business_id: businessId, user_id: userId, role_id }));
      const { error: insErr } = await supabase.from("user_role").insert(rows);
      if (insErr) throw insErr;
    }
  };

  const api: StoreApi = {
    business: state.business,
    locations: state.locations,
    roles: state.roles,
    team: state.team,
    me: state.team.find((m) => m.id === state.session.appUserId) ?? null,
    session: state.session,
    hydrated: state.hydrated,
    loading: state.loading,
    error: state.error,

    addMember: async (input) => {
      const supabase = getSupabaseClient();
      const businessId = stateRef.current.session.businessId!;
      const primary = input.primaryRoleId ?? input.roleIds?.[0] ?? null;
      const insert: TablesInsert<"app_user"> = {
        business_id: businessId,
        name: input.name.trim(),
        phone: input.phone ? normalisePhone(input.phone) : null,
        email: input.email?.trim() || null,
        colour: input.colour ?? "ember",
        level: input.level ?? "mid",
        employment_type: input.employmentType ?? "casual",
        primary_role_id: primary,
        home_location_id: input.homeLocationId ?? null,
        can_work_other_locations: input.canWorkOtherLocations ?? false,
        pay_rate: input.payRate ?? 0,
        max_hours_week: input.maxHoursWeek ?? null,
        min_hours_week: input.minHoursWeek ?? 0,
        max_shifts_week: input.maxShiftsWeek ?? null,
        is_manager: input.isManager ?? false,
      };
      const { data: created, error } = await supabase
        .from("app_user")
        .insert(insert)
        .select("id")
        .single();
      if (error) throw error;
      const roleIds = input.roleIds ?? (primary ? [primary] : []);
      if (roleIds.length) await replaceRoles(created.id, roleIds);
      await reloadTeam();
    },

    updateMember: async (id, patch) => {
      const supabase = getSupabaseClient();
      const upd: TablesUpdate<"app_user"> = {};
      if (patch.name !== undefined) upd.name = patch.name.trim();
      if (patch.phone !== undefined) upd.phone = patch.phone ? normalisePhone(patch.phone) : null;
      if (patch.email !== undefined) upd.email = patch.email.trim() || null;
      if (patch.colour !== undefined) upd.colour = patch.colour;
      if (patch.level !== undefined) upd.level = patch.level;
      if (patch.employmentType !== undefined) upd.employment_type = patch.employmentType;
      if (patch.primaryRoleId !== undefined) upd.primary_role_id = patch.primaryRoleId;
      if (patch.homeLocationId !== undefined) upd.home_location_id = patch.homeLocationId;
      if (patch.canWorkOtherLocations !== undefined)
        upd.can_work_other_locations = patch.canWorkOtherLocations;
      if (patch.payRate !== undefined) upd.pay_rate = patch.payRate;
      if (patch.maxHoursWeek !== undefined) upd.max_hours_week = patch.maxHoursWeek;
      if (patch.minHoursWeek !== undefined) upd.min_hours_week = patch.minHoursWeek;
      if (patch.maxShiftsWeek !== undefined) upd.max_shifts_week = patch.maxShiftsWeek;
      if (patch.isManager !== undefined) upd.is_manager = patch.isManager;
      if (Object.keys(upd).length) {
        const { error } = await supabase.from("app_user").update(upd).eq("id", id);
        if (error) throw error;
      }
      if (patch.roleIds !== undefined) await replaceRoles(id, patch.roleIds);
      await reloadTeam();
    },

    setMemberActive: async (id, active) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("app_user").update({ active }).eq("id", id);
      if (error) throw error;
      await reloadTeam();
    },

    inviteMember: async (id) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from("app_user")
        .update({ invite_status: "invited" })
        .eq("id", id);
      if (error) throw error;
      await reloadTeam();

      // M9 E16 — the invite text. SMS-only by catalogue: there is no in-app for
      // them yet, which is the entire point of inviting them.
      //
      // No invite TOKEN is minted, deliberately. Login is phone-OTP against a
      // record the manager already created (M11 §3.2), so the link only has to
      // reach the sign-in page — a bearer token in an SMS would be a second,
      // weaker way in, and a security liability for no gain.
      const member = stateRef.current.team.find((m) => m.id === id);
      const businessName = stateRef.current.business?.name;
      if (member && businessName) {
        void notify({
          event: "E16",
          businessId: stateRef.current.session.businessId!,
          timezone: stateRef.current.business?.timezone ?? "Australia/Sydney",
          recipients: [{ userId: member.id }],
          payload: { inviteToken: "", businessName },
        });
      }
    },

    updateOwnContact: async (patch) => {
      const supabase = getSupabaseClient();
      const id = stateRef.current.session.appUserId!;
      const upd: TablesUpdate<"app_user"> = {};
      if (patch.phone !== undefined) upd.phone = patch.phone ? normalisePhone(patch.phone) : null;
      if (patch.email !== undefined) upd.email = patch.email.trim() || null;
      const { error } = await supabase.from("app_user").update(upd).eq("id", id);
      if (error) throw error;
      await reloadTeam();
    },

    refresh: async () => {
      await loadAll();
    },

    logout: async () => {
      await authSignOut().catch(() => {});
      set({ session: EMPTY_SESSION, business: null, locations: [], roles: [], team: [], error: null });
    },
  };

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
