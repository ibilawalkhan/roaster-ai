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
          colour: string | null
          created_at: string
          email: string | null
          employment_type: Database["public"]["Enums"]["employment_type"]
          home_location_id: string | null
          id: string
          name: string
          pay_rate: number
          phone: string | null
          position: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          active?: boolean
          auth_user_id?: string | null
          business_id: string
          colour?: string | null
          created_at?: string
          email?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          home_location_id?: string | null
          id?: string
          name: string
          pay_rate?: number
          phone?: string | null
          position?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          active?: boolean
          auth_user_id?: string | null
          business_id?: string
          colour?: string | null
          created_at?: string
          email?: string | null
          employment_type?: Database["public"]["Enums"]["employment_type"]
          home_location_id?: string | null
          id?: string
          name?: string
          pay_rate?: number
          phone?: string | null
          position?: string | null
          role?: Database["public"]["Enums"]["app_role"]
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
        ]
      }
      availability: {
        Row: {
          available: boolean
          business_id: string
          created_at: string
          date: string
          id: string
          note: string | null
          user_id: string
        }
        Insert: {
          available?: boolean
          business_id: string
          created_at?: string
          date: string
          id?: string
          note?: string | null
          user_id: string
        }
        Update: {
          available?: boolean
          business_id?: string
          created_at?: string
          date?: string
          id?: string
          note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["id"]
          },
        ]
      }
      business: {
        Row: {
          created_at: string
          id: string
          logo_initial: string | null
          name: string
          subscription_status: Database["public"]["Enums"]["subscription_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          logo_initial?: string | null
          name: string
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
        }
        Update: {
          created_at?: string
          id?: string
          logo_initial?: string | null
          name?: string
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
        }
        Relationships: []
      }
      location: {
        Row: {
          business_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
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
          business_id: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          delivery_status: string
          id: string
          payload_json: Json
          read: boolean
          type: string
          user_id: string
        }
        Insert: {
          business_id: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          delivery_status?: string
          id?: string
          payload_json?: Json
          read?: boolean
          type: string
          user_id: string
        }
        Update: {
          business_id?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          delivery_status?: string
          id?: string
          payload_json?: Json
          read?: boolean
          type?: string
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
      roster: {
        Row: {
          business_id: string
          created_at: string
          fortnight_start: string
          id: string
          status: Database["public"]["Enums"]["roster_status"]
        }
        Insert: {
          business_id: string
          created_at?: string
          fortnight_start: string
          id?: string
          status?: Database["public"]["Enums"]["roster_status"]
        }
        Update: {
          business_id?: string
          created_at?: string
          fortnight_start?: string
          id?: string
          status?: Database["public"]["Enums"]["roster_status"]
        }
        Relationships: [
          {
            foreignKeyName: "roster_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
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
          end_time: string
          id: string
          location_id: string | null
          note: string | null
          role: string | null
          roster_id: string
          start_time: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }
        Insert: {
          assigned_user_id?: string | null
          break_minutes?: number
          business_id: string
          created_at?: string
          date: string
          end_time: string
          id?: string
          location_id?: string | null
          note?: string | null
          role?: string | null
          roster_id: string
          start_time: string
          status?: Database["public"]["Enums"]["shift_status"]
          updated_at?: string
        }
        Update: {
          assigned_user_id?: string | null
          break_minutes?: number
          business_id?: string
          created_at?: string
          date?: string
          end_time?: string
          id?: string
          location_id?: string | null
          note?: string | null
          role?: string | null
          roster_id?: string
          start_time?: string
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
            foreignKeyName: "shift_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "roster"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_claim: {
        Row: {
          business_id: string
          claimant_user_id: string
          created_at: string
          id: string
          outcome: Database["public"]["Enums"]["claim_outcome"]
          shift_id: string
        }
        Insert: {
          business_id: string
          claimant_user_id: string
          created_at?: string
          id?: string
          outcome?: Database["public"]["Enums"]["claim_outcome"]
          shift_id: string
        }
        Update: {
          business_id?: string
          claimant_user_id?: string
          created_at?: string
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
            foreignKeyName: "shift_claim_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_app_user_id: { Args: never; Returns: string }
      current_business_id: { Args: never; Returns: string }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      is_manager: { Args: never; Returns: boolean }
      link_current_user: {
        Args: Record<PropertyKey, never>
        Returns: Database["public"]["Tables"]["app_user"]["Row"]
      }
    }
    Enums: {
      app_role: "manager" | "staff"
      claim_outcome: "pending" | "approved" | "rejected"
      employment_type: "casual" | "part-time" | "full-time"
      notification_channel: "inapp" | "sms"
      roster_status: "draft" | "published"
      shift_status:
        | "ASSIGNED"
        | "DROP_REQUESTED"
        | "OPEN"
        | "CLAIMED_PENDING"
        | "REASSIGNED"
      subscription_status: "trial" | "active" | "past_due" | "suspended"
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
      app_role: ["manager", "staff"],
      claim_outcome: ["pending", "approved", "rejected"],
      employment_type: ["casual", "part-time", "full-time"],
      notification_channel: ["inapp", "sms"],
      roster_status: ["draft", "published"],
      shift_status: [
        "ASSIGNED",
        "DROP_REQUESTED",
        "OPEN",
        "CLAIMED_PENDING",
        "REASSIGNED",
      ],
      subscription_status: ["trial", "active", "past_due", "suspended"],
    },
  },
} as const
