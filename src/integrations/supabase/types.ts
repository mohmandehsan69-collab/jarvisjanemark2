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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      briefings: {
        Row: {
          created_at: string
          day: string
          id: string
          trends_blurb: string
          user_id: string
          weather: Json
        }
        Insert: {
          created_at?: string
          day?: string
          id?: string
          trends_blurb?: string
          user_id: string
          weather?: Json
        }
        Update: {
          created_at?: string
          day?: string
          id?: string
          trends_blurb?: string
          user_id?: string
          weather?: Json
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          provider: string | null
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          provider?: string | null
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          provider?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      flashcards: {
        Row: {
          back: string
          created_at: string
          deck: string
          due_date: string
          ease: number
          front: string
          id: string
          interval_days: number
          updated_at: string
          user_id: string
        }
        Insert: {
          back: string
          created_at?: string
          deck?: string
          due_date?: string
          ease?: number
          front: string
          id?: string
          interval_days?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          back?: string
          created_at?: string
          deck?: string
          due_date?: string
          ease?: number
          front?: string
          id?: string
          interval_days?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      habit_logs: {
        Row: {
          created_at: string
          habit_id: string
          id: string
          log_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          habit_id: string
          id?: string
          log_date?: string
          user_id: string
        }
        Update: {
          created_at?: string
          habit_id?: string
          id?: string
          log_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_logs_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
        ]
      }
      habits: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      memory_notes: {
        Row: {
          created_at: string
          id: string
          key: string
          source: string
          updated_at: string
          user_id: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          source?: string
          updated_at?: string
          user_id: string
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          source?: string
          updated_at?: string
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      product_radar: {
        Row: {
          created_at: string
          direction: string
          id: string
          notes: string
          product: string
          target_price: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          direction?: string
          id?: string
          notes?: string
          product: string
          target_price?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          direction?: string
          id?: string
          notes?: string
          product?: string
          target_price?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_tasks: {
        Row: {
          created_at: string
          done: boolean
          id: string
          project_id: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          done?: boolean
          id?: string
          project_id: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          done?: boolean
          id?: string
          project_id?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          id: string
          source_report_id: string | null
          status: string
          summary: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          source_report_id?: string | null
          status?: string
          summary?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          source_report_id?: string | null
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_source_report_id_fkey"
            columns: ["source_report_id"]
            isOneToOne: false
            referencedRelation: "research_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      research_reports: {
        Row: {
          body: string
          created_at: string
          id: string
          output_type: string
          sources: Json
          topic: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          output_type?: string
          sources?: Json
          topic: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          output_type?: string
          sources?: Json
          topic?: string
          user_id?: string
        }
        Relationships: []
      }
      training_progress: {
        Row: {
          completed_at: string | null
          created_at: string
          drill_type: string
          id: string
          prompt: string
          recall_due: string | null
          response: string | null
          score: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          drill_type: string
          id?: string
          prompt: string
          recall_due?: string | null
          response?: string | null
          score?: number | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          drill_type?: string
          id?: string
          prompt?: string
          recall_due?: string | null
          response?: string | null
          score?: number | null
          user_id?: string
        }
        Relationships: []
      }
      trend_queries: {
        Row: {
          created_at: string
          id: string
          keyword: string
          results: Json
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          keyword: string
          results?: Json
          source?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          keyword?: string
          results?: Json
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      trip_items: {
        Row: {
          created_at: string
          id: string
          label: string
          packed: boolean
          trip_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          packed?: boolean
          trip_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          packed?: boolean
          trip_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_items_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          created_at: string
          end_date: string
          id: string
          latitude: number | null
          location: string
          longitude: number | null
          name: string
          start_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          end_date?: string
          id?: string
          latitude?: number | null
          location?: string
          longitude?: number | null
          name: string
          start_date?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          latitude?: number | null
          location?: string
          longitude?: number | null
          name?: string
          start_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          ai_provider: string
          created_at: string
          latitude: number | null
          longitude: number | null
          prayer_method: string
          updated_at: string
          user_id: string
          voice_enabled: boolean
        }
        Insert: {
          ai_provider?: string
          created_at?: string
          latitude?: number | null
          longitude?: number | null
          prayer_method?: string
          updated_at?: string
          user_id: string
          voice_enabled?: boolean
        }
        Update: {
          ai_provider?: string
          created_at?: string
          latitude?: number | null
          longitude?: number | null
          prayer_method?: string
          updated_at?: string
          user_id?: string
          voice_enabled?: boolean
        }
        Relationships: []
      }
      workout_logs: {
        Row: {
          created_at: string
          exercise: string
          hold_seconds: number
          id: string
          reps: number
          sets: number
          user_id: string
          workout_id: string
        }
        Insert: {
          created_at?: string
          exercise: string
          hold_seconds?: number
          id?: string
          reps?: number
          sets?: number
          user_id: string
          workout_id: string
        }
        Update: {
          created_at?: string
          exercise?: string
          hold_seconds?: number
          id?: string
          reps?: number
          sets?: number
          user_id?: string
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_logs_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workouts: {
        Row: {
          created_at: string
          day_index: number
          day_name: string
          id: string
          notes: string
          performed_on: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day_index?: number
          day_name: string
          id?: string
          notes?: string
          performed_on?: string
          user_id: string
        }
        Update: {
          created_at?: string
          day_index?: number
          day_name?: string
          id?: string
          notes?: string
          performed_on?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
