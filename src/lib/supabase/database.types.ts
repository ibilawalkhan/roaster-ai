export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_user: {
        Row: {
          active: boolean
          auth_user_id: string | null
          business_id: string
          can_work_other_locations: boolean
          colour: string | null
          created_at: string
          email: string | null
          employment_type: Database["public"]["Enums"]["employment_type"]
          home_location_id: string | null
          id: string
          invite_status: Database["public"]["Enums"]["invite_status"]
          is_manager: boolean
          level: Database["public"]["Enums"]["user_level"]
          max_hours_week: number | null
          max_shifts_week: number | null
          min_hours_week: number | null
          name: string
          notes: string | null
          pay_rate: number
          phone: string | null
          preferred_days: number[] | null
          preferred_time_of_day:
            | Database["public"]["Enums"]["time_of_day"]
            | null
          primary_role_id: string | null
        }
        Insert: {
          active?: boolean
          auth_user_id?: string | null
          business_id: string
          can_work_other_locations?: boolean
          colour?: string | null
          created_at?: string
          email?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          home_location_id?: string | null
          id?: string
          invite_status?: Database["public"]["Enums"]["invite_status"]
          is_manager?: boolean
          level?: Database["public"]["Enums"]["user_level"]
          max_hours_week?: number | null
          max_shifts_week?: number | null
          min_hours_week?: number | null
          name: string
          notes?: string | null
          pay_rate?: number
          phone?: string | null
          preferred_days?: number[] | null
          preferred_time_of_day?:
            | Database["public"]["Enums"]["time_of_day"]
            | null
          primary_role_id?: string | null
        }
        Update: {
          active?: boolean
          auth_user_id?: string | null
          business_id?: string
          can_work_other_locations?: boolean
          colour?: string | null
          created_at?: string
          email?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          home_location_id?: string | null
          id?: string
          invite_status?: Database["public"]["Enums"]["invite_status"]
          is_manager?: boolean
          level?: Database["public"]["Enums"]["user_level"]
          max_hours_week?: number | null
          max_shifts_week?: number | null
          min_hours_week?: number | null
          name?: string
          notes?: string | null
          pay_rate?: number
          phone?: string | null
          preferred_days?: number[] | null
          preferred_time_of_day?:
            | Database["public"]["Enums"]["time_of_day"]
            | null
          primary_role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_user_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_user_home_location_id_fkey"
            columns: ["home_location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_user_primary_role_id_fkey"
            columns: ["primary_role_id"]
            isOneToOne: false
            referencedRelation: "role"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_exception: {
        Row: {
          business_id: string
          created_at: string
          created_by_user_id: string | null
          date: string
          from_time: string | null
          id: string
          is_available: boolean
          reason: string | null
          source: string
          to_time: string | null
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by_user_id?: string | null
          date: string
          from_time?: string | null
          id?: string
          is_available: boolean
          reason?: string | null
          source?: string
          to_time?: string | null
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by_user_id?: string | null
          date?: string
          from_time?: string | null
          id?: string
          is_available?: boolean
          reason?: string | null
          source?: string
          to_time?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_exception_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_exception_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_exception_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_pattern: {
        Row: {
          business_id: string
          day_of_week: number
          from_time: string | null
          id: string
          is_available: boolean
          to_time: string | null
          updated_at: string
          updated_by_user_id: string | null
          user_id: string
        }
        Insert: {
          business_id: string
          day_of_week: number
          from_time?: string | null
          id?: string
          is_available?: boolean
          to_time?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          user_id: string
        }
        Update: {
          business_id?: string
          day_of_week?: number
          from_time?: string | null
          id?: string
          is_available?: boolean
          to_time?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_pattern_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_pattern_updated_by_user_id_fkey"
            columns: ["updated_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_pattern_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      break_rule: {
        Row: {
          break_minutes: number
          business_id: string
          created_at: string
          id: string
          max_hours: number | null
          min_hours: number
        }
        Insert: {
          break_minutes?: number
          business_id: string
          created_at?: string
          id?: string
          max_hours?: number | null
          min_hours: number
        }
        Update: {
          break_minutes?: number
          business_id?: string
          created_at?: string
          id?: string
          max_hours?: number | null
          min_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "break_rule_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
        ]
      }
      business: {
        Row: {
          created_at: string
          currency: string
          id: string
          logo_initial: string | null
          name: string
          roster_period: Database["public"]["Enums"]["roster_period"]
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          timezone: string
          week_start_day: number
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          logo_initial?: string | null
          name: string
          roster_period?: Database["public"]["Enums"]["roster_period"]
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          timezone?: string
          week_start_day?: number
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          logo_initial?: string | null
          name?: string
          roster_period?: Database["public"]["Enums"]["roster_period"]
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          timezone?: string
          week_start_day?: number
        }
        Relationships: []
      }
      location: {
        Row: {
          active: boolean
          address: string | null
          business_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          business_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          address?: string | null
          business_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
        ]
      }
      notification: {
        Row: {
          attempts: number
          business_id: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          event_type: string
          id: string
          last_error: string | null
          payload_json: Json
          read_at: string | null
          scheduled_for: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          suppressed_reason: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          business_id: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          event_type: string
          id?: string
          last_error?: string | null
          payload_json?: Json
          read_at?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          suppressed_reason?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          business_id?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          event_type?: string
          id?: string
          last_error?: string | null
          payload_json?: Json
          read_at?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          suppressed_reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_batch: {
        Row: {
          business_id: string
          created_at: string
          id: string
          key: string
          sent: boolean
          window_ends_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          key: string
          sent?: boolean
          window_ends_at: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          key?: string
          sent?: boolean
          window_ends_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_batch_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
        ]
      }
      role: {
        Row: {
          active: boolean
          business_id: string
          colour: string | null
          created_at: string
          id: string
          name: string
          short_code: string | null
        }
        Insert: {
          active?: boolean
          business_id: string
          colour?: string | null
          created_at?: string
          id?: string
          name: string
          short_code?: string | null
        }
        Update: {
          active?: boolean
          business_id?: string
          colour?: string | null
          created_at?: string
          id?: string
          name?: string
          short_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
        ]
      }
      roster: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          days: number
          id: string
          location_scope: string | null
          published_at: string | null
          published_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["roster_status"]
          template_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          days: number
          id?: string
          location_scope?: string | null
          published_at?: string | null
          published_by?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["roster_status"]
          template_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          days?: number
          id?: string
          location_scope?: string | null
          published_at?: string | null
          published_by?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["roster_status"]
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "week_template"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_change_log: {
        Row: {
          action: string
          after_json: Json | null
          before_json: Json | null
          business_id: string
          changed_at: string
          changed_by_user_id: string | null
          id: string
          notified: boolean
          roster_id: string
          shift_id: string | null
        }
        Insert: {
          action: string
          after_json?: Json | null
          before_json?: Json | null
          business_id: string
          changed_at?: string
          changed_by_user_id?: string | null
          id?: string
          notified?: boolean
          roster_id: string
          shift_id?: string | null
        }
        Update: {
          action?: string
          after_json?: Json | null
          before_json?: Json | null
          business_id?: string
          changed_at?: string
          changed_by_user_id?: string | null
          id?: string
          notified?: boolean
          roster_id?: string
          shift_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_change_log_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_change_log_changed_by_user_id_fkey"
            columns: ["changed_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_change_log_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "roster"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_change_log_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_position: {
        Row: {
          business_id: string
          date: string
          end_at: string
          id: string
          label: string | null
          location_id: string
          required_level: Database["public"]["Enums"]["user_level"] | null
          role_id: string
          roster_id: string
          source: Database["public"]["Enums"]["position_source"]
          start_at: string
        }
        Insert: {
          business_id: string
          date: string
          end_at: string
          id?: string
          label?: string | null
          location_id: string
          required_level?: Database["public"]["Enums"]["user_level"] | null
          role_id: string
          roster_id: string
          source?: Database["public"]["Enums"]["position_source"]
          start_at: string
        }
        Update: {
          business_id?: string
          date?: string
          end_at?: string
          id?: string
          label?: string | null
          location_id?: string
          required_level?: Database["public"]["Enums"]["user_level"] | null
          role_id?: string
          roster_id?: string
          source?: Database["public"]["Enums"]["position_source"]
          start_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_position_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_position_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_position_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "role"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_position_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "roster"
            referencedColumns: ["id"]
          },
        ]
      }
      roster_warning: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          business_id: string
          created_at: string
          detail: string | null
          id: string
          resolved: boolean
          roster_id: string
          rule: string
          shift_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          business_id: string
          created_at?: string
          detail?: string | null
          id?: string
          resolved?: boolean
          roster_id: string
          rule: string
          shift_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          business_id?: string
          created_at?: string
          detail?: string | null
          id?: string
          resolved?: boolean
          roster_id?: string
          rule?: string
          shift_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_warning_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_warning_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_warning_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "roster"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_warning_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduling_rule: {
        Row: {
          allow_overnight: boolean
          business_id: string
          created_at: string
          id: string
          max_consecutive_days: number
          max_hours_casual: number
          max_hours_full_time: number
          max_hours_part_time: number
          max_shift_hours: number
          min_rest_hours: number
          min_shift_hours: number
          one_shift_per_day: boolean
          senior_coverage_enabled: boolean
          senior_min_count: number
          senior_qualifying_levels: Database["public"]["Enums"]["user_level"][]
          soft_priority_order: string[]
          updated_at: string
        }
        Insert: {
          allow_overnight?: boolean
          business_id: string
          created_at?: string
          id?: string
          max_consecutive_days?: number
          max_hours_casual?: number
          max_hours_full_time?: number
          max_hours_part_time?: number
          max_shift_hours?: number
          min_rest_hours?: number
          min_shift_hours?: number
          one_shift_per_day?: boolean
          senior_coverage_enabled?: boolean
          senior_min_count?: number
          senior_qualifying_levels?: Database["public"]["Enums"]["user_level"][]
          soft_priority_order?: string[]
          updated_at?: string
        }
        Update: {
          allow_overnight?: boolean
          business_id?: string
          created_at?: string
          id?: string
          max_consecutive_days?: number
          max_hours_casual?: number
          max_hours_full_time?: number
          max_hours_part_time?: number
          max_shift_hours?: number
          min_rest_hours?: number
          min_shift_hours?: number
          one_shift_per_day?: boolean
          senior_coverage_enabled?: boolean
          senior_min_count?: number
          senior_qualifying_levels?: Database["public"]["Enums"]["user_level"][]
          soft_priority_order?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduling_rule_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
        ]
      }
      shift: {
        Row: {
          assigned_user_id: string | null
          break_minutes: number
          business_id: string
          created_at: string
          date: string
          drop_reason: string | null
          drop_requested_at: string | null
          drop_requested_by: string | null
          end_at: string
          id: string
          location_id: string
          locked: boolean
          origin: Database["public"]["Enums"]["shift_origin"]
          original_user_id: string | null
          pay_rate_snapshot: number | null
          role_id: string
          roster_id: string
          roster_position_id: string | null
          start_at: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }
        Insert: {
          assigned_user_id?: string | null
          break_minutes?: number
          business_id: string
          created_at?: string
          date: string
          drop_reason?: string | null
          drop_requested_at?: string | null
          drop_requested_by?: string | null
          end_at: string
          id?: string
          location_id: string
          locked?: boolean
          origin?: Database["public"]["Enums"]["shift_origin"]
          original_user_id?: string | null
          pay_rate_snapshot?: number | null
          role_id: string
          roster_id: string
          roster_position_id?: string | null
          start_at: string
          status?: Database["public"]["Enums"]["shift_status"]
          updated_at?: string
        }
        Update: {
          assigned_user_id?: string | null
          break_minutes?: number
          business_id?: string
          created_at?: string
          date?: string
          drop_reason?: string | null
          drop_requested_at?: string | null
          drop_requested_by?: string | null
          end_at?: string
          id?: string
          location_id?: string
          locked?: boolean
          origin?: Database["public"]["Enums"]["shift_origin"]
          original_user_id?: string | null
          pay_rate_snapshot?: number | null
          role_id?: string
          roster_id?: string
          roster_position_id?: string | null
          start_at?: string
          status?: Database["public"]["Enums"]["shift_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_drop_requested_by_fkey"
            columns: ["drop_requested_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_original_user_id_fkey"
            columns: ["original_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "role"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "roster"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_roster_position_id_fkey"
            columns: ["roster_position_id"]
            isOneToOne: false
            referencedRelation: "roster_position"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_claim: {
        Row: {
          business_id: string
          claimant_user_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          outcome: Database["public"]["Enums"]["claim_outcome"]
          shift_id: string
        }
        Insert: {
          business_id: string
          claimant_user_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          outcome?: Database["public"]["Enums"]["claim_outcome"]
          shift_id: string
        }
        Update: {
          business_id?: string
          claimant_user_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          outcome?: Database["public"]["Enums"]["claim_outcome"]
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_claim_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_claim_claimant_user_id_fkey"
            columns: ["claimant_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_claim_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_claim_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_swap_event: {
        Row: {
          action: string
          actor_user_id: string | null
          business_id: string
          created_at: string
          from_status: Database["public"]["Enums"]["shift_status"] | null
          id: string
          note: string | null
          shift_id: string
          target_user_id: string | null
          to_status: Database["public"]["Enums"]["shift_status"]
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          business_id: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["shift_status"] | null
          id?: string
          note?: string | null
          shift_id: string
          target_user_id?: string | null
          to_status: Database["public"]["Enums"]["shift_status"]
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          business_id?: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["shift_status"] | null
          id?: string
          note?: string | null
          shift_id?: string
          target_user_id?: string | null
          to_status?: Database["public"]["Enums"]["shift_status"]
        }
        Relationships: [
          {
            foreignKeyName: "shift_swap_event_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_event_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_event_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_event_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      solve_run: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          request_json: Json | null
          response_json: Json | null
          roster_id: string
          seed: number | null
          solve_seconds: number | null
          status: Database["public"]["Enums"]["solve_status"]
          time_limit: number | null
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          request_json?: Json | null
          response_json?: Json | null
          roster_id: string
          seed?: number | null
          solve_seconds?: number | null
          status: Database["public"]["Enums"]["solve_status"]
          time_limit?: number | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          request_json?: Json | null
          response_json?: Json | null
          roster_id?: string
          seed?: number | null
          solve_seconds?: number | null
          status?: Database["public"]["Enums"]["solve_status"]
          time_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "solve_run_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solve_run_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solve_run_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "roster"
            referencedColumns: ["id"]
          },
        ]
      }
      template_slot: {
        Row: {
          active: boolean
          business_id: string
          count: number
          crosses_midnight: boolean
          day_of_week: number
          end_time: string
          id: string
          label: string | null
          location_id: string
          required_level: Database["public"]["Enums"]["user_level"] | null
          role_id: string
          start_time: string
          template_id: string
        }
        Insert: {
          active?: boolean
          business_id: string
          count?: number
          crosses_midnight?: boolean
          day_of_week: number
          end_time: string
          id?: string
          label?: string | null
          location_id: string
          required_level?: Database["public"]["Enums"]["user_level"] | null
          role_id: string
          start_time: string
          template_id: string
        }
        Update: {
          active?: boolean
          business_id?: string
          count?: number
          crosses_midnight?: boolean
          day_of_week?: number
          end_time?: string
          id?: string
          label?: string | null
          location_id?: string
          required_level?: Database["public"]["Enums"]["user_level"] | null
          role_id?: string
          start_time?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_slot_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_slot_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_slot_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "role"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_slot_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "week_template"
            referencedColumns: ["id"]
          },
        ]
      }
      trading_hours: {
        Row: {
          business_id: string
          closes_at: string | null
          day_of_week: number
          id: string
          is_24h: boolean
          is_open: boolean
          location_id: string
          opens_at: string | null
        }
        Insert: {
          business_id: string
          closes_at?: string | null
          day_of_week: number
          id?: string
          is_24h?: boolean
          is_open?: boolean
          location_id: string
          opens_at?: string | null
        }
        Update: {
          business_id?: string
          closes_at?: string | null
          day_of_week?: number
          id?: string
          is_24h?: boolean
          is_open?: boolean
          location_id?: string
          opens_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trading_hours_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trading_hours_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
        ]
      }
      user_role: {
        Row: {
          business_id: string
          role_id: string
          user_id: string
        }
        Insert: {
          business_id: string
          role_id: string
          user_id: string
        }
        Update: {
          business_id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_role_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_role_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "role"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_role_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      week_template: {
        Row: {
          active: boolean
          business_id: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "week_template_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_claim: {
        Args: { p_claim_id: string; p_shift_id: string }
        Returns: {
          assigned_user_id: string | null
          break_minutes: number
          business_id: string
          created_at: string
          date: string
          drop_reason: string | null
          drop_requested_at: string | null
          drop_requested_by: string | null
          end_at: string
          id: string
          location_id: string
          locked: boolean
          origin: Database["public"]["Enums"]["shift_origin"]
          original_user_id: string | null
          pay_rate_snapshot: number | null
          role_id: string
          roster_id: string
          roster_position_id: string | null
          start_at: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shift"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_open_shift: {
        Args: { p_shift_id: string }
        Returns: {
          assigned_user_id: string | null
          break_minutes: number
          business_id: string
          created_at: string
          date: string
          drop_reason: string | null
          drop_requested_at: string | null
          drop_requested_by: string | null
          end_at: string
          id: string
          location_id: string
          locked: boolean
          origin: Database["public"]["Enums"]["shift_origin"]
          original_user_id: string | null
          pay_rate_snapshot: number | null
          role_id: string
          roster_id: string
          roster_position_id: string | null
          start_at: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shift"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_shift: {
        Args: { p_shift_id: string }
        Returns: {
          business_id: string
          claimant_user_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          outcome: Database["public"]["Enums"]["claim_outcome"]
          shift_id: string
        }
        SetofOptions: {
          from: "*"
          to: "shift_claim"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      colleagues_on_shift: {
        Args: { p_shift_id: string }
        Returns: {
          name: string
          role_id: string
          user_id: string
        }[]
      }
      current_app_user_id: { Args: never; Returns: string }
      current_business_id: { Args: never; Returns: string }
      decline_drop: {
        Args: { p_shift_id: string }
        Returns: {
          assigned_user_id: string | null
          break_minutes: number
          business_id: string
          created_at: string
          date: string
          drop_reason: string | null
          drop_requested_at: string | null
          drop_requested_by: string | null
          end_at: string
          id: string
          location_id: string
          locked: boolean
          origin: Database["public"]["Enums"]["shift_origin"]
          original_user_id: string | null
          pay_rate_snapshot: number | null
          role_id: string
          roster_id: string
          roster_position_id: string | null
          start_at: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shift"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_manager: { Args: never; Returns: boolean }
      link_current_user: {
        Args: never
        Returns: {
          active: boolean
          auth_user_id: string | null
          business_id: string
          can_work_other_locations: boolean
          colour: string | null
          created_at: string
          email: string | null
          employment_type: Database["public"]["Enums"]["employment_type"]
          home_location_id: string | null
          id: string
          invite_status: Database["public"]["Enums"]["invite_status"]
          is_manager: boolean
          level: Database["public"]["Enums"]["user_level"]
          max_hours_week: number | null
          max_shifts_week: number | null
          min_hours_week: number | null
          name: string
          notes: string | null
          pay_rate: number
          phone: string | null
          preferred_days: number[] | null
          preferred_time_of_day:
            | Database["public"]["Enums"]["time_of_day"]
            | null
          primary_role_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "app_user"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      open_shift_to_team: {
        Args: { p_shift_id: string }
        Returns: {
          assigned_user_id: string | null
          break_minutes: number
          business_id: string
          created_at: string
          date: string
          drop_reason: string | null
          drop_requested_at: string | null
          drop_requested_by: string | null
          end_at: string
          id: string
          location_id: string
          locked: boolean
          origin: Database["public"]["Enums"]["shift_origin"]
          original_user_id: string | null
          pay_rate_snapshot: number | null
          role_id: string
          roster_id: string
          roster_position_id: string | null
          start_at: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shift"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reassign_shift: {
        Args: { p_shift_id: string; p_user_id: string }
        Returns: {
          assigned_user_id: string | null
          break_minutes: number
          business_id: string
          created_at: string
          date: string
          drop_reason: string | null
          drop_requested_at: string | null
          drop_requested_by: string | null
          end_at: string
          id: string
          location_id: string
          locked: boolean
          origin: Database["public"]["Enums"]["shift_origin"]
          original_user_id: string | null
          pay_rate_snapshot: number | null
          role_id: string
          roster_id: string
          roster_position_id: string | null
          start_at: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shift"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_drop: {
        Args: { p_reason?: string; p_shift_id: string }
        Returns: {
          assigned_user_id: string | null
          break_minutes: number
          business_id: string
          created_at: string
          date: string
          drop_reason: string | null
          drop_requested_at: string | null
          drop_requested_by: string | null
          end_at: string
          id: string
          location_id: string
          locked: boolean
          origin: Database["public"]["Enums"]["shift_origin"]
          original_user_id: string | null
          pay_rate_snapshot: number | null
          role_id: string
          roster_id: string
          roster_position_id: string | null
          start_at: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shift"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      claim_outcome: "pending" | "approved" | "rejected" | "withdrawn"
      employment_type: "casual" | "part_time" | "full_time"
      invite_status: "not_invited" | "invited" | "active"
      notification_channel: "inapp" | "sms"
      notification_status: "pending" | "sent" | "failed" | "suppressed"
      position_source: "template" | "manual"
      roster_period: "week" | "fortnight"
      roster_status: "draft" | "published"
      shift_origin: "auto" | "manual"
      shift_status: "assigned" | "drop_requested" | "open" | "claimed_pending"
      solve_status: "ok" | "partial" | "failed"
      subscription_status: "trial" | "active" | "past_due" | "suspended"
      time_of_day:
        | "morning"
        | "afternoon"
        | "evening"
        | "night"
        | "no_preference"
      user_level: "junior" | "mid" | "senior"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      claim_outcome: ["pending", "approved", "rejected", "withdrawn"],
      employment_type: ["casual", "part_time", "full_time"],
      invite_status: ["not_invited", "invited", "active"],
      notification_channel: ["inapp", "sms"],
      notification_status: ["pending", "sent", "failed", "suppressed"],
      position_source: ["template", "manual"],
      roster_period: ["week", "fortnight"],
      roster_status: ["draft", "published"],
      shift_origin: ["auto", "manual"],
      shift_status: ["assigned", "drop_requested", "open", "claimed_pending"],
      solve_status: ["ok", "partial", "failed"],
      subscription_status: ["trial", "active", "past_due", "suspended"],
      time_of_day: [
        "morning",
        "afternoon",
        "evening",
        "night",
        "no_preference",
      ],
      user_level: ["junior", "mid", "senior"],
    },
  },
} as const
