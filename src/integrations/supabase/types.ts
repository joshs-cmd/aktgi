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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_emails: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      cache_settings: {
        Row: {
          distributor: string
          notes: string | null
          pre_warm_enabled: boolean
          ttl_hours: number
        }
        Insert: {
          distributor: string
          notes?: string | null
          pre_warm_enabled?: boolean
          ttl_hours?: number
        }
        Update: {
          distributor?: string
          notes?: string | null
          pre_warm_enabled?: boolean
          ttl_hours?: number
        }
        Relationships: []
      }
      catalog_products: {
        Row: {
          base_price: number | null
          brand: string
          description: string | null
          distributor: string
          id: string
          image_url: string | null
          search_vector: unknown
          style_number: string
          title: string
          updated_at: string
        }
        Insert: {
          base_price?: number | null
          brand: string
          description?: string | null
          distributor: string
          id?: string
          image_url?: string | null
          search_vector?: unknown
          style_number: string
          title: string
          updated_at?: string
        }
        Update: {
          base_price?: number | null
          brand?: string
          description?: string | null
          distributor?: string
          id?: string
          image_url?: string | null
          search_vector?: unknown
          style_number?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      distributors: {
        Row: {
          api_base_url: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          api_base_url?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          api_base_url?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      inventory: {
        Row: {
          distributor_id: string
          id: string
          product_id: string
          quantity: number
          size_code: string
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          distributor_id: string
          id?: string
          product_id: string
          quantity?: number
          size_code: string
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          distributor_id?: string
          id?: string
          product_id?: string
          quantity?: number
          size_code?: string
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      onestop_aliases: {
        Row: {
          created_at: string | null
          id: string
          internal_code: string
          notes: string | null
          query: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          internal_code: string
          notes?: string | null
          query: string
        }
        Update: {
          created_at?: string | null
          id?: string
          internal_code?: string
          notes?: string | null
          query?: string
        }
        Relationships: []
      }
      popular_skus: {
        Row: {
          active: boolean
          annual_units: number | null
          brand: string | null
          created_at: string
          display_name: string | null
          id: string
          style_number: string
        }
        Insert: {
          active?: boolean
          annual_units?: number | null
          brand?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          style_number: string
        }
        Update: {
          active?: boolean
          annual_units?: number | null
          brand?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          style_number?: string
        }
        Relationships: []
      }
      price_history: {
        Row: {
          distributor_id: string
          id: string
          price: number
          product_id: string
          recorded_at: string
          size_code: string
        }
        Insert: {
          distributor_id: string
          id?: string
          price: number
          product_id: string
          recorded_at?: string
          size_code: string
        }
        Update: {
          distributor_id?: string
          id?: string
          price?: number
          product_id?: string
          recorded_at?: string
          size_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_history_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      prices: {
        Row: {
          distributor_id: string
          id: string
          price: number
          product_id: string
          size_code: string
          updated_at: string
        }
        Insert: {
          distributor_id: string
          id?: string
          price: number
          product_id: string
          size_code: string
          updated_at?: string
        }
        Update: {
          distributor_id?: string
          id?: string
          price?: number
          product_id?: string
          size_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prices_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_cache: {
        Row: {
          cached_at: string
          distributor: string
          expires_at: string
          id: string
          response_data: Json
          style_number: string
        }
        Insert: {
          cached_at?: string
          distributor: string
          expires_at: string
          id?: string
          response_data: Json
          style_number: string
        }
        Update: {
          cached_at?: string
          distributor?: string
          expires_at?: string
          id?: string
          response_data?: Json
          style_number?: string
        }
        Relationships: []
      }
      product_sizes: {
        Row: {
          created_at: string
          id: string
          product_id: string
          size_code: string
          size_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          size_code: string
          size_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          size_code?: string
          size_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_sizes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand: string | null
          category: string | null
          created_at: string
          id: string
          image_url: string | null
          name: string
          style_number: string
          updated_at: string
        }
        Insert: {
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          name: string
          style_number: string
          updated_at?: string
        }
        Update: {
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          name?: string
          style_number?: string
          updated_at?: string
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          completed_at: string | null
          distributor_id: string
          error_message: string | null
          id: string
          started_at: string
          status: string
          sync_type: string
        }
        Insert: {
          completed_at?: string | null
          distributor_id: string
          error_message?: string | null
          id?: string
          started_at?: string
          status?: string
          sync_type: string
        }
        Update: {
          completed_at?: string | null
          distributor_id?: string
          error_message?: string | null
          id?: string
          started_at?: string
          status?: string
          sync_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_logs_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          city: string | null
          code: string
          created_at: string
          distributor_id: string
          id: string
          name: string
          state: string | null
        }
        Insert: {
          city?: string | null
          code: string
          created_at?: string
          distributor_id: string
          id?: string
          name: string
          state?: string | null
        }
        Update: {
          city?: string | null
          code?: string
          created_at?: string
          distributor_id?: string
          id?: string
          name?: string
          state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      catalog_search_deduped: {
        Args: { query_text: string }
        Returns: {
          all_distributors: Json
          base_price: number
          brand: string
          description: string
          distributor: string
          id: string
          image_url: string
          rank: number
          style_number: string
          title: string
        }[]
      }
      catalog_search_fts: {
        Args: { query_text: string }
        Returns: {
          base_price: number
          brand: string
          description: string
          distributor: string
          id: string
          image_url: string
          rank: number
          style_number: string
          title: string
        }[]
      }
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
