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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      adjustments: {
        Row: {
          created_at: string | null
          created_by: string | null
          created_by_email: string | null
          id: string
          note: string | null
          product_id: string
          qty: number
          reason: string
          receipt_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          note?: string | null
          product_id: string
          qty: number
          reason: string
          receipt_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          note?: string | null
          product_id?: string
          qty?: number
          reason?: string
          receipt_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adjustments_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          data: Json
          id: number
          updated_at: string | null
        }
        Insert: {
          data?: Json
          id?: number
          updated_at?: string | null
        }
        Update: {
          data?: Json
          id?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      bill_submissions: {
        Row: {
          bill_date: string | null
          bill_no: string | null
          bill_total: number | null
          created_at: string
          draft: Json
          id: string
          line_count: number | null
          new_codes: number | null
          payload: Json
          receipt_id: string | null
          receipt_type: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by_email: string | null
          status: string
          submitted_by: string | null
          submitted_by_email: string | null
          units: number | null
          value: number | null
          vendor_id: string | null
          vendor_name: string | null
        }
        Insert: {
          bill_date?: string | null
          bill_no?: string | null
          bill_total?: number | null
          created_at?: string
          draft: Json
          id?: string
          line_count?: number | null
          new_codes?: number | null
          payload: Json
          receipt_id?: string | null
          receipt_type: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_email?: string | null
          status?: string
          submitted_by?: string | null
          submitted_by_email?: string | null
          units?: number | null
          value?: number | null
          vendor_id?: string | null
          vendor_name?: string | null
        }
        Update: {
          bill_date?: string | null
          bill_no?: string | null
          bill_total?: number | null
          created_at?: string
          draft?: Json
          id?: string
          line_count?: number | null
          new_codes?: number | null
          payload?: Json
          receipt_id?: string | null
          receipt_type?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_email?: string | null
          status?: string
          submitted_by?: string | null
          submitted_by_email?: string | null
          units?: number | null
          value?: number | null
          vendor_id?: string | null
          vendor_name?: string | null
        }
        Relationships: []
      }
      bill_payments: {
        Row: {
          amount: number
          created_at: string
          created_by_email: string | null
          id: string
          mode: string | null
          note: string | null
          paid_on: string
          receipt_id: string
          reference: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by_email?: string | null
          id?: string
          mode?: string | null
          note?: string | null
          paid_on?: string
          receipt_id: string
          reference?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by_email?: string | null
          id?: string
          mode?: string | null
          note?: string | null
          paid_on?: string
          receipt_id?: string
          reference?: string | null
        }
        Relationships: []
      }
      vendor_reviews: {
        Row: {
          comment: string | null
          created_at: string
          created_by: string | null
          created_by_email: string | null
          delivery: number | null
          id: string
          pricing: number | null
          quality: number | null
          receipt_id: string | null
          vendor_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          delivery?: number | null
          id?: string
          pricing?: number | null
          quality?: number | null
          receipt_id?: string | null
          vendor_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          delivery?: number | null
          id?: string
          pricing?: number | null
          quality?: number | null
          receipt_id?: string | null
          vendor_id?: string
        }
        Relationships: []
      }
      sales_lines: {
        Row: {
          amount: number | null
          applied_qty: number
          customer: string | null
          doc_date: string | null
          doc_id: string
          doc_kind: string
          doc_no: string | null
          doc_status: string | null
          id: string
          item_name: string | null
          line_key: string
          product_id: string | null
          qty: number
          rate: number | null
          sku: string | null
          source: string
          updated_at: string
          zoho_item_id: string | null
        }
        Insert: {
          amount?: number | null
          applied_qty?: number
          customer?: string | null
          doc_date?: string | null
          doc_id: string
          doc_kind: string
          doc_no?: string | null
          doc_status?: string | null
          id?: string
          item_name?: string | null
          line_key: string
          product_id?: string | null
          qty?: number
          rate?: number | null
          sku?: string | null
          source?: string
          updated_at?: string
          zoho_item_id?: string | null
        }
        Update: {
          amount?: number | null
          applied_qty?: number
          customer?: string | null
          doc_date?: string | null
          doc_id?: string
          doc_kind?: string
          doc_no?: string | null
          doc_status?: string | null
          id?: string
          item_name?: string | null
          line_key?: string
          product_id?: string | null
          qty?: number
          rate?: number | null
          sku?: string | null
          source?: string
          updated_at?: string
          zoho_item_id?: string | null
        }
        Relationships: []
      }
      zoho_item_map: {
        Row: {
          created_at: string
          product_id: string
          zoho_key: string
        }
        Insert: {
          created_at?: string
          product_id: string
          zoho_key: string
        }
        Update: {
          created_at?: string
          product_id?: string
          zoho_key?: string
        }
        Relationships: []
      }
      quote_requests: {
        Row: {
          city: string | null
          created_at: string
          email: string | null
          est_total: number | null
          handled_by_email: string | null
          id: string
          internal_notes: string | null
          items: Json
          name: string
          needed_by: string | null
          notes: string | null
          organisation: string | null
          phone: string
          ref: string
          status: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          email?: string | null
          est_total?: number | null
          handled_by_email?: string | null
          id?: string
          internal_notes?: string | null
          items?: Json
          name: string
          needed_by?: string | null
          notes?: string | null
          organisation?: string | null
          phone: string
          ref?: string
          status?: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          created_at?: string
          email?: string | null
          est_total?: number | null
          handled_by_email?: string | null
          id?: string
          internal_notes?: string | null
          items?: Json
          name?: string
          needed_by?: string | null
          notes?: string | null
          organisation?: string | null
          phone?: string
          ref?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      code_counters: {
        Row: {
          next_no: number
          prefix: string
        }
        Insert: {
          next_no?: number
          prefix: string
        }
        Update: {
          next_no?: number
          prefix?: string
        }
        Relationships: []
      }
      code_lists: {
        Row: {
          code: string
          kind: string
          name: string
          sort: number
        }
        Insert: {
          code: string
          kind: string
          name: string
          sort?: number
        }
        Update: {
          code?: string
          kind?: string
          name?: string
          sort?: number
        }
        Relationships: []
      }
      design_families: {
        Row: {
          code: string | null
          design_name: string | null
          design_no: number
          div: string
          id: string
          internal: boolean
          mat: string
          sport: string
          type: string
        }
        Insert: {
          code?: string | null
          design_name?: string | null
          design_no: number
          div: string
          id?: string
          internal?: boolean
          mat: string
          sport: string
          type: string
        }
        Update: {
          code?: string | null
          design_name?: string | null
          design_no?: number
          div?: string
          id?: string
          internal?: boolean
          mat?: string
          sport?: string
          type?: string
        }
        Relationships: []
      }
      divisions: {
        Row: {
          bulk_min_qty: number
          bulk_pct: number
          code: string
          floor_margin: number
          freight_pct: number
          letter: string
          name: string
          packaging: number
          pricing_mode: string
          rounding: number
          sort: number
          target_margin: number
        }
        Insert: {
          bulk_min_qty?: number
          bulk_pct?: number
          code: string
          floor_margin?: number
          freight_pct?: number
          letter: string
          name: string
          packaging?: number
          pricing_mode?: string
          rounding?: number
          sort?: number
          target_margin?: number
        }
        Update: {
          bulk_min_qty?: number
          bulk_pct?: number
          code?: string
          floor_margin?: number
          freight_pct?: number
          letter?: string
          name?: string
          packaging?: number
          pricing_mode?: string
          rounding?: number
          sort?: number
          target_margin?: number
        }
        Relationships: []
      }
      guide_progress: {
        Row: {
          done_at: string | null
          lesson_id: string
          user_id: string
        }
        Insert: {
          done_at?: string | null
          lesson_id: string
          user_id: string
        }
        Update: {
          done_at?: string | null
          lesson_id?: string
          user_id?: string
        }
        Relationships: []
      }
      product_photos: {
        Row: {
          created_at: string | null
          id: string
          is_main: boolean
          path: string | null
          product_id: string
          sort: number
          url: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_main?: boolean
          path?: string | null
          product_id: string
          sort?: number
          url: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_main?: boolean
          path?: string | null
          product_id?: string
          sort?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_photos_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          extra_cost: number | null
          award_class: string | null
          bulk_min_qty: number | null
          bulk_price: number | null
          code: string
          created_at: string | null
          customisable: boolean | null
          description: string | null
          div: string
          family_id: string
          finish: string
          floor_price: number | null
          friendly_name: string
          gst: number | null
          id: string
          is_sample: boolean
          landed: number | null
          location: string | null
          mat: string
          mrp: number | null
          preferred_vendor_id: string | null
          prefix: string
          price_mode: string
          price_rule: string | null
          price_value: number | null
          reorder_point: number | null
          selling: number | null
          size: string
          spec_code: string
          sport: string
          status: string
          stock: number
          type: string
          unit_cost: number | null
          updated_at: string | null
        }
        Insert: {
          extra_cost?: number | null
          award_class?: string | null
          bulk_min_qty?: number | null
          bulk_price?: number | null
          code: string
          created_at?: string | null
          customisable?: boolean | null
          description?: string | null
          div: string
          family_id: string
          finish?: string
          floor_price?: number | null
          friendly_name: string
          gst?: number | null
          id?: string
          is_sample?: boolean
          landed?: number | null
          location?: string | null
          mat: string
          mrp?: number | null
          preferred_vendor_id?: string | null
          prefix: string
          price_mode?: string
          price_rule?: string | null
          price_value?: number | null
          reorder_point?: number | null
          selling?: number | null
          size?: string
          spec_code: string
          sport: string
          status?: string
          stock?: number
          type: string
          unit_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          extra_cost?: number | null
          award_class?: string | null
          bulk_min_qty?: number | null
          bulk_price?: number | null
          code?: string
          created_at?: string | null
          customisable?: boolean | null
          description?: string | null
          div?: string
          family_id?: string
          finish?: string
          floor_price?: number | null
          friendly_name?: string
          gst?: number | null
          id?: string
          is_sample?: boolean
          landed?: number | null
          location?: string | null
          mat?: string
          mrp?: number | null
          preferred_vendor_id?: string | null
          prefix?: string
          price_mode?: string
          price_rule?: string | null
          price_value?: number | null
          reorder_point?: number | null
          selling?: number | null
          size?: string
          spec_code?: string
          sport?: string
          status?: string
          stock?: number
          type?: string
          unit_cost?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "design_families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_preferred_vendor_id_fkey"
            columns: ["preferred_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_lines: {
        Row: {
          gst_rate: number | null
          extra_cost: number | null
          billed_qty: number | null
          created_new: boolean
          description: string | null
          id: string
          line_no: number
          location: string | null
          product_id: string | null
          receipt_id: string
          received_qty: number
          unit_cost: number | null
          vendor_item_code: string | null
        }
        Insert: {
          gst_rate?: number | null
          extra_cost?: number | null
          billed_qty?: number | null
          created_new?: boolean
          description?: string | null
          id?: string
          line_no: number
          location?: string | null
          product_id?: string | null
          receipt_id: string
          received_qty?: number
          unit_cost?: number | null
          vendor_item_code?: string | null
        }
        Update: {
          gst_rate?: number | null
          extra_cost?: number | null
          billed_qty?: number | null
          created_new?: boolean
          description?: string | null
          id?: string
          line_no?: number
          location?: string | null
          product_id?: string | null
          receipt_id?: string
          received_qty?: number
          unit_cost?: number | null
          vendor_item_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          due_date: string | null
          gst_type: string | null
          gst_breakup: Json | null
          edited_by_email: string | null
          edited_at: string | null
          charges: Json | null
          goods_value: number | null
          charges_total: number | null
          gst_total: number | null
          total_cost: number | null
          approved_by_email: string | null
          bill_date: string | null
          bill_no: string | null
          bill_total: number | null
          created_at: string | null
          created_by: string | null
          created_by_email: string | null
          id: string
          notes: string | null
          receipt_type: string
          reversed_at: string | null
          reversed_by_email: string | null
          vendor_id: string | null
        }
        Insert: {
          due_date?: string | null
          gst_type?: string | null
          gst_breakup?: Json | null
          edited_by_email?: string | null
          edited_at?: string | null
          charges?: Json | null
          goods_value?: number | null
          charges_total?: number | null
          gst_total?: number | null
          total_cost?: number | null
          approved_by_email?: string | null
          bill_date?: string | null
          bill_no?: string | null
          bill_total?: number | null
          created_at?: string | null
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          notes?: string | null
          receipt_type: string
          reversed_at?: string | null
          reversed_by_email?: string | null
          vendor_id?: string | null
        }
        Update: {
          due_date?: string | null
          gst_type?: string | null
          gst_breakup?: Json | null
          edited_by_email?: string | null
          edited_at?: string | null
          charges?: Json | null
          goods_value?: number | null
          charges_total?: number | null
          gst_total?: number | null
          total_cost?: number | null
          approved_by_email?: string | null
          bill_date?: string | null
          bill_no?: string | null
          bill_total?: number | null
          created_at?: string | null
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          notes?: string | null
          receipt_type?: string
          reversed_at?: string | null
          reversed_by_email?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      types: {
        Row: {
          code: string
          div: string
          gst: number | null
          hsn: string | null
          id: string
          is_service: boolean
          letter: string
          margin_override: number | null
          name: string
          size_unit: string
          uom: string
        }
        Insert: {
          code: string
          div: string
          gst?: number | null
          hsn?: string | null
          id?: string
          is_service?: boolean
          letter: string
          margin_override?: number | null
          name: string
          size_unit?: string
          uom?: string
        }
        Update: {
          code?: string
          div?: string
          gst?: number | null
          hsn?: string | null
          id?: string
          is_service?: boolean
          letter?: string
          margin_override?: number | null
          name?: string
          size_unit?: string
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "types_div_fkey"
            columns: ["div"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["code"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          can_publish: boolean
          email: string | null
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          can_publish?: boolean
          email?: string | null
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          can_publish?: boolean
          email?: string | null
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vendor_codes: {
        Row: {
          description: string | null
          id: string
          last_cost: number | null
          match_key: string
          product_id: string
          updated_at: string | null
          vendor_id: string
          vendor_item_code: string | null
        }
        Insert: {
          description?: string | null
          id?: string
          last_cost?: number | null
          match_key: string
          product_id: string
          updated_at?: string | null
          vendor_id: string
          vendor_item_code?: string | null
        }
        Update: {
          description?: string | null
          id?: string
          last_cost?: number | null
          match_key?: string
          product_id?: string
          updated_at?: string | null
          vendor_id?: string
          vendor_item_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_codes_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          bank_account: string | null
          bank_holder: string | null
          bank_name: string | null
          billing_attention: string | null
          city: string | null
          code: string
          company: string | null
          country: string | null
          created_at: string | null
          currency: string | null
          display_name: string
          divisions: string[] | null
          email: string | null
          first_name: string | null
          gst_treatment: string
          gstin: string | null
          id: string
          ifsc: string | null
          is_sample: boolean
          last_name: string | null
          lead_time_days: number | null
          mobile: string | null
          moq: string | null
          msme: string | null
          notes: string | null
          pan: string | null
          payment_terms: string | null
          phone: string | null
          pin: string | null
          quality: number | null
          salutation: string | null
          source_of_supply: string | null
          state: string | null
          status: string
          street1: string | null
          street2: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          bank_account?: string | null
          bank_holder?: string | null
          bank_name?: string | null
          billing_attention?: string | null
          city?: string | null
          code?: string
          company?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          display_name: string
          divisions?: string[] | null
          email?: string | null
          first_name?: string | null
          gst_treatment?: string
          gstin?: string | null
          id?: string
          ifsc?: string | null
          is_sample?: boolean
          last_name?: string | null
          lead_time_days?: number | null
          mobile?: string | null
          moq?: string | null
          msme?: string | null
          notes?: string | null
          pan?: string | null
          payment_terms?: string | null
          phone?: string | null
          pin?: string | null
          quality?: number | null
          salutation?: string | null
          source_of_supply?: string | null
          state?: string | null
          status?: string
          street1?: string | null
          street2?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          bank_account?: string | null
          bank_holder?: string | null
          bank_name?: string | null
          billing_attention?: string | null
          city?: string | null
          code?: string
          company?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          display_name?: string
          divisions?: string[] | null
          email?: string | null
          first_name?: string | null
          gst_treatment?: string
          gstin?: string | null
          id?: string
          ifsc?: string | null
          is_sample?: boolean
          last_name?: string | null
          lead_time_days?: number | null
          mobile?: string | null
          moq?: string | null
          msme?: string | null
          notes?: string | null
          pan?: string | null
          payment_terms?: string | null
          phone?: string | null
          pin?: string | null
          quality?: number | null
          salutation?: string | null
          source_of_supply?: string | null
          state?: string | null
          status?: string
          street1?: string | null
          street2?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      zoho_exports: {
        Row: {
          created_at: string | null
          created_by_email: string | null
          id: string
          kind: string
          records: number | null
        }
        Insert: {
          created_at?: string | null
          created_by_email?: string | null
          id?: string
          kind: string
          records?: number | null
        }
        Update: {
          created_at?: string | null
          created_by_email?: string | null
          id?: string
          kind?: string
          records?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_bill: {
        Args: { p_id: string; p_payload?: Json; p_draft?: Json }
        Returns: Json
      }
      can_approve: { Args: never; Returns: boolean }
      can_publish: { Args: never; Returns: boolean }
      apply_sales: { Args: { p_docs: Json; p_source?: string }; Returns: Json }
      map_sale_item: { Args: { p_key: string; p_product: string }; Returns: number }
      set_bill_due: { Args: { p_receipt: string; p_due: string | null }; Returns: undefined }
      delete_bill: { Args: { p_receipt: string }; Returns: string[] }
      update_bill: { Args: { p_receipt: string; p_header: Json; p_lines: Json }; Returns: string[] }
      size_label: { Args: { p_size: string; p_unit: string }; Returns: string }
      size_tag: { Args: { p_size: string; p_unit: string }; Returns: string }
      clear_samples: { Args: never; Returns: string[] }
      delete_product: { Args: { p_product: string }; Returns: string[] }
      reject_bill: { Args: { p_id: string; p_note: string }; Returns: undefined }
      submit_bill: {
        Args: { p_payload: Json; p_draft: Json; p_meta: Json; p_replaces?: string }
        Returns: string
      }
      withdraw_bill: { Args: { p_id: string }; Returns: undefined }
      adjust_stock_bulk: {
        Args: { p_lines: Json; p_reason: string; p_note?: string }
        Returns: number
      }
      adjust_stock: {
        Args: {
          p_note: string
          p_product: string
          p_qty: number
          p_reason: string
        }
        Returns: undefined
      }
      can_contribute: { Args: never; Returns: boolean }
      can_edit: { Args: never; Returns: boolean }
      get_catalogue: {
        Args: never
        Returns: {
          code: string
          description: string
          name: string
          photos: string[]
          price: number
          type_name: string
          variants: Json
        }[]
      }
      get_catalogue_logo: { Args: never; Returns: string }
      is_member: { Args: never; Returns: boolean }
      my_role: { Args: never; Returns: Database["public"]["Enums"]["app_role"] }
      next_vendor_code: { Args: never; Returns: string }
      receive_stock: { Args: { payload: Json }; Returns: Json }
      rename_family: {
        Args: { p_family: string; p_name: string }
        Returns: undefined
      }
      reverse_receipt: { Args: { p_receipt: string }; Returns: undefined }
    }
    Enums: {
      app_role: "owner" | "editor" | "contributor" | "viewer"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["owner", "editor", "contributor", "viewer"],
    },
  },
} as const
