// Hand-maintained to match supabase/migrations (M1 foundation + M2 spine).
// Regenerate with `supabase gen types typescript --linked` after the next
// db push / db reset to keep this authoritative.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      business: {
        Row: {
          id: string;
          name: string;
          timezone: string;
          week_start_day: number;
          roster_period: Database["public"]["Enums"]["roster_period"];
          currency: string;
          subscription_status: Database["public"]["Enums"]["subscription_status"];
          logo_initial: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          timezone?: string;
          week_start_day?: number;
          roster_period?: Database["public"]["Enums"]["roster_period"];
          currency?: string;
          subscription_status?: Database["public"]["Enums"]["subscription_status"];
          logo_initial?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          timezone?: string;
          week_start_day?: number;
          roster_period?: Database["public"]["Enums"]["roster_period"];
          currency?: string;
          subscription_status?: Database["public"]["Enums"]["subscription_status"];
          logo_initial?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      location: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          address: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          name: string;
          address?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          name?: string;
          address?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      role: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          short_code: string | null;
          colour: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          name: string;
          short_code?: string | null;
          colour?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          name?: string;
          short_code?: string | null;
          colour?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      trading_hours: {
        Row: {
          id: string;
          business_id: string;
          location_id: string;
          day_of_week: number;
          is_open: boolean;
          opens_at: string | null;
          closes_at: string | null;
          is_24h: boolean;
        };
        Insert: {
          id?: string;
          business_id: string;
          location_id: string;
          day_of_week: number;
          is_open?: boolean;
          opens_at?: string | null;
          closes_at?: string | null;
          is_24h?: boolean;
        };
        Update: {
          id?: string;
          business_id?: string;
          location_id?: string;
          day_of_week?: number;
          is_open?: boolean;
          opens_at?: string | null;
          closes_at?: string | null;
          is_24h?: boolean;
        };
        Relationships: [];
      };
      scheduling_rule: {
        Row: {
          id: string;
          business_id: string;
          senior_coverage_enabled: boolean;
          senior_min_count: number;
          senior_qualifying_levels: Database["public"]["Enums"]["user_level"][];
          max_hours_casual: number;
          max_hours_part_time: number;
          max_hours_full_time: number;
          max_consecutive_days: number;
          min_rest_hours: number;
          max_shift_hours: number;
          min_shift_hours: number;
          one_shift_per_day: boolean;
          allow_overnight: boolean;
          soft_priority_order: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          senior_coverage_enabled?: boolean;
          senior_min_count?: number;
          senior_qualifying_levels?: Database["public"]["Enums"]["user_level"][];
          max_hours_casual?: number;
          max_hours_part_time?: number;
          max_hours_full_time?: number;
          max_consecutive_days?: number;
          min_rest_hours?: number;
          max_shift_hours?: number;
          min_shift_hours?: number;
          one_shift_per_day?: boolean;
          allow_overnight?: boolean;
          soft_priority_order?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          senior_coverage_enabled?: boolean;
          senior_min_count?: number;
          senior_qualifying_levels?: Database["public"]["Enums"]["user_level"][];
          max_hours_casual?: number;
          max_hours_part_time?: number;
          max_hours_full_time?: number;
          max_consecutive_days?: number;
          min_rest_hours?: number;
          max_shift_hours?: number;
          min_shift_hours?: number;
          one_shift_per_day?: boolean;
          allow_overnight?: boolean;
          soft_priority_order?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      break_rule: {
        Row: {
          id: string;
          business_id: string;
          min_hours: number;
          max_hours: number | null;
          break_minutes: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          min_hours: number;
          max_hours?: number | null;
          break_minutes?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          min_hours?: number;
          max_hours?: number | null;
          break_minutes?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      app_user: {
        Row: {
          id: string;
          business_id: string;
          auth_user_id: string | null;
          name: string;
          phone: string | null;
          email: string | null;
          colour: string | null;
          level: Database["public"]["Enums"]["user_level"];
          employment_type: Database["public"]["Enums"]["employment_type"];
          primary_role_id: string | null;
          home_location_id: string | null;
          can_work_other_locations: boolean;
          pay_rate: number;
          max_hours_week: number | null;
          min_hours_week: number | null;
          max_shifts_week: number | null;
          preferred_days: number[] | null;
          preferred_time_of_day: Database["public"]["Enums"]["time_of_day"] | null;
          notes: string | null;
          is_manager: boolean;
          invite_status: Database["public"]["Enums"]["invite_status"];
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          auth_user_id?: string | null;
          name: string;
          phone?: string | null;
          email?: string | null;
          colour?: string | null;
          level?: Database["public"]["Enums"]["user_level"];
          employment_type?: Database["public"]["Enums"]["employment_type"];
          primary_role_id?: string | null;
          home_location_id?: string | null;
          can_work_other_locations?: boolean;
          pay_rate?: number;
          max_hours_week?: number | null;
          min_hours_week?: number | null;
          max_shifts_week?: number | null;
          preferred_days?: number[] | null;
          preferred_time_of_day?: Database["public"]["Enums"]["time_of_day"] | null;
          notes?: string | null;
          is_manager?: boolean;
          invite_status?: Database["public"]["Enums"]["invite_status"];
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          auth_user_id?: string | null;
          name?: string;
          phone?: string | null;
          email?: string | null;
          colour?: string | null;
          level?: Database["public"]["Enums"]["user_level"];
          employment_type?: Database["public"]["Enums"]["employment_type"];
          primary_role_id?: string | null;
          home_location_id?: string | null;
          can_work_other_locations?: boolean;
          pay_rate?: number;
          max_hours_week?: number | null;
          min_hours_week?: number | null;
          max_shifts_week?: number | null;
          preferred_days?: number[] | null;
          preferred_time_of_day?: Database["public"]["Enums"]["time_of_day"] | null;
          notes?: string | null;
          is_manager?: boolean;
          invite_status?: Database["public"]["Enums"]["invite_status"];
          active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      user_role: {
        Row: {
          business_id: string;
          user_id: string;
          role_id: string;
        };
        Insert: {
          business_id: string;
          user_id: string;
          role_id: string;
        };
        Update: {
          business_id?: string;
          user_id?: string;
          role_id?: string;
        };
        Relationships: [];
      };
      availability_pattern: {
        Row: {
          id: string;
          business_id: string;
          user_id: string;
          day_of_week: number;
          is_available: boolean;
          from_time: string | null;
          to_time: string | null;
          updated_by_user_id: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          user_id: string;
          day_of_week: number;
          is_available?: boolean;
          from_time?: string | null;
          to_time?: string | null;
          updated_by_user_id?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          user_id?: string;
          day_of_week?: number;
          is_available?: boolean;
          from_time?: string | null;
          to_time?: string | null;
          updated_by_user_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      availability_exception: {
        Row: {
          id: string;
          business_id: string;
          user_id: string;
          date: string;
          is_available: boolean;
          from_time: string | null;
          to_time: string | null;
          reason: string | null;
          source: string;
          created_by_user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          user_id: string;
          date: string;
          is_available: boolean;
          from_time?: string | null;
          to_time?: string | null;
          reason?: string | null;
          source?: string;
          created_by_user_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          user_id?: string;
          date?: string;
          is_available?: boolean;
          from_time?: string | null;
          to_time?: string | null;
          reason?: string | null;
          source?: string;
          created_by_user_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      week_template: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          is_default: boolean;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          name?: string;
          is_default?: boolean;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          name?: string;
          is_default?: boolean;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      template_slot: {
        Row: {
          id: string;
          business_id: string;
          template_id: string;
          location_id: string;
          day_of_week: number;
          role_id: string;
          start_time: string;
          end_time: string;
          crosses_midnight: boolean;
          count: number;
          required_level: Database["public"]["Enums"]["user_level"] | null;
          label: string | null;
          active: boolean;
        };
        Insert: {
          id?: string;
          business_id: string;
          template_id: string;
          location_id: string;
          day_of_week: number;
          role_id: string;
          start_time: string;
          end_time: string;
          crosses_midnight?: boolean;
          count?: number;
          required_level?: Database["public"]["Enums"]["user_level"] | null;
          label?: string | null;
          active?: boolean;
        };
        Update: {
          id?: string;
          business_id?: string;
          template_id?: string;
          location_id?: string;
          day_of_week?: number;
          role_id?: string;
          start_time?: string;
          end_time?: string;
          crosses_midnight?: boolean;
          count?: number;
          required_level?: Database["public"]["Enums"]["user_level"] | null;
          label?: string | null;
          active?: boolean;
        };
        Relationships: [];
      };
      roster: {
        Row: {
          id: string;
          business_id: string;
          location_scope: string | null;
          start_date: string;
          days: number;
          status: Database["public"]["Enums"]["roster_status"];
          template_id: string | null;
          created_by: string | null;
          created_at: string;
          published_at: string | null;
          published_by: string | null;
        };
        Insert: {
          id?: string;
          business_id: string;
          location_scope?: string | null;
          start_date: string;
          days: number;
          status?: Database["public"]["Enums"]["roster_status"];
          template_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          published_at?: string | null;
          published_by?: string | null;
        };
        Update: {
          id?: string;
          business_id?: string;
          location_scope?: string | null;
          start_date?: string;
          days?: number;
          status?: Database["public"]["Enums"]["roster_status"];
          template_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          published_at?: string | null;
          published_by?: string | null;
        };
        Relationships: [];
      };
      roster_position: {
        Row: {
          id: string;
          business_id: string;
          roster_id: string;
          location_id: string;
          date: string;
          role_id: string;
          start_at: string;
          end_at: string;
          required_level: Database["public"]["Enums"]["user_level"] | null;
          label: string | null;
          source: Database["public"]["Enums"]["position_source"];
        };
        Insert: {
          id?: string;
          business_id: string;
          roster_id: string;
          location_id: string;
          date: string;
          role_id: string;
          start_at: string;
          end_at: string;
          required_level?: Database["public"]["Enums"]["user_level"] | null;
          label?: string | null;
          source?: Database["public"]["Enums"]["position_source"];
        };
        Update: {
          id?: string;
          business_id?: string;
          roster_id?: string;
          location_id?: string;
          date?: string;
          role_id?: string;
          start_at?: string;
          end_at?: string;
          required_level?: Database["public"]["Enums"]["user_level"] | null;
          label?: string | null;
          source?: Database["public"]["Enums"]["position_source"];
        };
        Relationships: [];
      };
      shift: {
        Row: {
          id: string;
          business_id: string;
          roster_id: string;
          roster_position_id: string | null;
          location_id: string;
          date: string;
          start_at: string;
          end_at: string;
          break_minutes: number;
          role_id: string;
          assigned_user_id: string | null;
          origin: Database["public"]["Enums"]["shift_origin"];
          locked: boolean;
          status: Database["public"]["Enums"]["shift_status"];
          pay_rate_snapshot: number | null;
          created_at: string;
          updated_at: string;
          drop_requested_by: string | null;
          drop_reason: string | null;
          drop_requested_at: string | null;
          original_user_id: string | null;
        };
        Insert: {
          id?: string;
          business_id: string;
          roster_id: string;
          roster_position_id?: string | null;
          location_id: string;
          date: string;
          start_at: string;
          end_at: string;
          break_minutes?: number;
          role_id: string;
          assigned_user_id?: string | null;
          origin?: Database["public"]["Enums"]["shift_origin"];
          locked?: boolean;
          status?: Database["public"]["Enums"]["shift_status"];
          pay_rate_snapshot?: number | null;
          created_at?: string;
          updated_at?: string;
          drop_requested_by?: string | null;
          drop_reason?: string | null;
          drop_requested_at?: string | null;
          original_user_id?: string | null;
        };
        Update: {
          id?: string;
          business_id?: string;
          roster_id?: string;
          roster_position_id?: string | null;
          location_id?: string;
          date?: string;
          start_at?: string;
          end_at?: string;
          break_minutes?: number;
          role_id?: string;
          assigned_user_id?: string | null;
          origin?: Database["public"]["Enums"]["shift_origin"];
          locked?: boolean;
          status?: Database["public"]["Enums"]["shift_status"];
          pay_rate_snapshot?: number | null;
          created_at?: string;
          updated_at?: string;
          drop_requested_by?: string | null;
          drop_reason?: string | null;
          drop_requested_at?: string | null;
          original_user_id?: string | null;
        };
        Relationships: [];
      };
      solve_run: {
        Row: {
          id: string;
          business_id: string;
          roster_id: string;
          request_json: Json | null;
          response_json: Json | null;
          seed: number | null;
          time_limit: number | null;
          solve_seconds: number | null;
          status: Database["public"]["Enums"]["solve_status"];
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          roster_id: string;
          request_json?: Json | null;
          response_json?: Json | null;
          seed?: number | null;
          time_limit?: number | null;
          solve_seconds?: number | null;
          status: Database["public"]["Enums"]["solve_status"];
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          roster_id?: string;
          request_json?: Json | null;
          response_json?: Json | null;
          seed?: number | null;
          time_limit?: number | null;
          solve_seconds?: number | null;
          status?: Database["public"]["Enums"]["solve_status"];
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      shift_claim: {
        Row: {
          id: string;
          business_id: string;
          shift_id: string;
          claimant_user_id: string;
          outcome: Database["public"]["Enums"]["claim_outcome"];
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
        };
        Insert: {
          id?: string;
          business_id: string;
          shift_id: string;
          claimant_user_id: string;
          outcome?: Database["public"]["Enums"]["claim_outcome"];
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
        };
        Update: {
          id?: string;
          business_id?: string;
          shift_id?: string;
          claimant_user_id?: string;
          outcome?: Database["public"]["Enums"]["claim_outcome"];
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
        };
        Relationships: [];
      };
      shift_swap_event: {
        Row: {
          id: string;
          business_id: string;
          shift_id: string;
          from_status: Database["public"]["Enums"]["shift_status"] | null;
          to_status: Database["public"]["Enums"]["shift_status"];
          action: string;
          actor_user_id: string | null;
          target_user_id: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          shift_id: string;
          from_status?: Database["public"]["Enums"]["shift_status"] | null;
          to_status: Database["public"]["Enums"]["shift_status"];
          action: string;
          actor_user_id?: string | null;
          target_user_id?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          shift_id?: string;
          from_status?: Database["public"]["Enums"]["shift_status"] | null;
          to_status?: Database["public"]["Enums"]["shift_status"];
          action?: string;
          actor_user_id?: string | null;
          target_user_id?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      notification: {
        Row: {
          id: string;
          business_id: string;
          user_id: string;
          event_type: string;
          payload_json: Json;
          channel: Database["public"]["Enums"]["notification_channel"];
          status: Database["public"]["Enums"]["notification_status"];
          suppressed_reason: string | null;
          attempts: number;
          last_error: string | null;
          scheduled_for: string | null;
          sent_at: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          user_id: string;
          event_type: string;
          payload_json?: Json;
          channel: Database["public"]["Enums"]["notification_channel"];
          status?: Database["public"]["Enums"]["notification_status"];
          suppressed_reason?: string | null;
          attempts?: number;
          last_error?: string | null;
          scheduled_for?: string | null;
          sent_at?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          user_id?: string;
          event_type?: string;
          payload_json?: Json;
          channel?: Database["public"]["Enums"]["notification_channel"];
          status?: Database["public"]["Enums"]["notification_status"];
          suppressed_reason?: string | null;
          attempts?: number;
          last_error?: string | null;
          scheduled_for?: string | null;
          sent_at?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      notification_batch: {
        Row: {
          id: string;
          business_id: string;
          key: string;
          window_ends_at: string;
          sent: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          key: string;
          window_ends_at: string;
          sent?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          key?: string;
          window_ends_at?: string;
          sent?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      roster_change_log: {
        Row: {
          id: string;
          business_id: string;
          roster_id: string;
          shift_id: string | null;
          action: string;
          before_json: Json | null;
          after_json: Json | null;
          changed_by_user_id: string | null;
          changed_at: string;
          notified: boolean;
        };
        // Append-only: there is no client UPDATE/DELETE policy (M11 §8), so the
        // Update shape exists only for service_role/back-office use.
        Insert: {
          id?: string;
          business_id: string;
          roster_id: string;
          shift_id?: string | null;
          action: string;
          before_json?: Json | null;
          after_json?: Json | null;
          changed_by_user_id?: string | null;
          changed_at?: string;
          notified?: boolean;
        };
        Update: {
          id?: string;
          business_id?: string;
          roster_id?: string;
          shift_id?: string | null;
          action?: string;
          before_json?: Json | null;
          after_json?: Json | null;
          changed_by_user_id?: string | null;
          changed_at?: string;
          notified?: boolean;
        };
        Relationships: [];
      };
      roster_warning: {
        Row: {
          id: string;
          business_id: string;
          roster_id: string;
          shift_id: string | null;
          rule: string;
          detail: string | null;
          acknowledged_by: string | null;
          acknowledged_at: string | null;
          resolved: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          roster_id: string;
          shift_id?: string | null;
          rule: string;
          detail?: string | null;
          acknowledged_by?: string | null;
          acknowledged_at?: string | null;
          resolved?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          roster_id?: string;
          shift_id?: string | null;
          rule?: string;
          detail?: string | null;
          acknowledged_by?: string | null;
          acknowledged_at?: string | null;
          resolved?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      current_app_user_id: { Args: Record<PropertyKey, never>; Returns: string };
      current_business_id: { Args: Record<PropertyKey, never>; Returns: string };
      is_manager: { Args: Record<PropertyKey, never>; Returns: boolean };
      link_current_user: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Tables"]["app_user"]["Row"];
      };
      // M8 swap RPCs — SECURITY DEFINER; each authorises the caller explicitly.
      request_drop: {
        Args: { p_shift_id: string; p_reason?: string | null };
        Returns: Database["public"]["Tables"]["shift"]["Row"];
      };
      claim_shift: {
        Args: { p_shift_id: string };
        Returns: Database["public"]["Tables"]["shift_claim"]["Row"];
      };
      /** The critical section (M8 §5): concurrent approvals — exactly one wins. */
      approve_claim: {
        Args: { p_shift_id: string; p_claim_id: string };
        Returns: Database["public"]["Tables"]["shift"]["Row"];
      };
    };
    Enums: {
      subscription_status: "trial" | "active" | "past_due" | "suspended";
      roster_period: "week" | "fortnight";
      employment_type: "casual" | "part_time" | "full_time";
      user_level: "junior" | "mid" | "senior";
      time_of_day: "morning" | "afternoon" | "evening" | "night" | "no_preference";
      invite_status: "not_invited" | "invited" | "active";
      roster_status: "draft" | "published";
      position_source: "template" | "manual";
      shift_origin: "auto" | "manual";
      shift_status: "assigned" | "drop_requested" | "open" | "claimed_pending";
      solve_status: "ok" | "partial" | "failed";
      claim_outcome: "pending" | "approved" | "rejected" | "withdrawn";
      notification_channel: "inapp" | "sms";
      notification_status: "pending" | "sent" | "failed" | "suppressed";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
