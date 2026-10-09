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
      activity: {
        Row: {
          actor_id: string | null
          created_at: string
          deal_id: string | null
          id: number
          meta: Json
          project_id: string | null
          task_id: string | null
          verb: string
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: never
          meta?: Json
          project_id?: string | null
          task_id?: string | null
          verb: string
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: never
          meta?: Json
          project_id?: string | null
          task_id?: string | null
          verb?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_accounts: {
        Row: {
          company_id: string | null
          connection_id: string | null
          created_at: string
          currency: string
          external_id: string
          first_synced_at: string | null
          id: string
          last_synced_at: string | null
          login_customer_id: string | null
          name: string
          platform: string
          sync_error: string | null
          workspace_id: string
        }
        Insert: {
          company_id?: string | null
          connection_id?: string | null
          created_at?: string
          currency?: string
          external_id: string
          first_synced_at?: string | null
          id?: string
          last_synced_at?: string | null
          login_customer_id?: string | null
          name: string
          platform: string
          sync_error?: string | null
          workspace_id: string
        }
        Update: {
          company_id?: string | null
          connection_id?: string | null
          created_at?: string
          currency?: string
          external_id?: string
          first_synced_at?: string | null
          id?: string
          last_synced_at?: string | null
          login_customer_id?: string | null
          name?: string
          platform?: string
          sync_error?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_accounts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "ad_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_accounts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "ad_connections_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_ads: {
        Row: {
          ad_account_id: string
          ad_id: string
          adset_id: string | null
          adset_name: string
          campaign_id: string | null
          campaign_name: string
          format: string | null
          frequency_7d: number | null
          name: string
          reach_7d: number | null
          status: string | null
          synced_at: string
          thumbnail_url: string | null
          workspace_id: string
        }
        Insert: {
          ad_account_id: string
          ad_id: string
          adset_id?: string | null
          adset_name?: string
          campaign_id?: string | null
          campaign_name?: string
          format?: string | null
          frequency_7d?: number | null
          name?: string
          reach_7d?: number | null
          status?: string | null
          synced_at?: string
          thumbnail_url?: string | null
          workspace_id: string
        }
        Update: {
          ad_account_id?: string
          ad_id?: string
          adset_id?: string | null
          adset_name?: string
          campaign_id?: string | null
          campaign_name?: string
          format?: string | null
          frequency_7d?: number | null
          name?: string
          reach_7d?: number | null
          status?: string | null
          synced_at?: string
          thumbnail_url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_ads_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_ads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_connections: {
        Row: {
          access_token: string
          accounts: Json
          accounts_refreshed_at: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          external_user_id: string | null
          id: string
          label: string
          last_error: string | null
          platform: string
          refresh_token: string | null
          workspace_id: string
        }
        Insert: {
          access_token: string
          accounts?: Json
          accounts_refreshed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          external_user_id?: string | null
          id?: string
          label?: string
          last_error?: string | null
          platform: string
          refresh_token?: string | null
          workspace_id: string
        }
        Update: {
          access_token?: string
          accounts?: Json
          accounts_refreshed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          external_user_id?: string | null
          id?: string
          label?: string
          last_error?: string | null
          platform?: string
          refresh_token?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_metrics_ad_daily: {
        Row: {
          ad_account_id: string
          ad_id: string
          ad_name: string
          adset_id: string
          campaign_id: string
          clicks: number
          conversion_value: number
          conversions: number
          date: string
          impressions: number
          reach: number | null
          spend: number
          thruplay: number | null
          video_3s: number | null
          video_p100: number | null
          video_p25: number | null
          video_p50: number | null
          video_p75: number | null
          workspace_id: string
        }
        Insert: {
          ad_account_id: string
          ad_id: string
          ad_name?: string
          adset_id?: string
          campaign_id?: string
          clicks?: number
          conversion_value?: number
          conversions?: number
          date: string
          impressions?: number
          reach?: number | null
          spend?: number
          thruplay?: number | null
          video_3s?: number | null
          video_p100?: number | null
          video_p25?: number | null
          video_p50?: number | null
          video_p75?: number | null
          workspace_id: string
        }
        Update: {
          ad_account_id?: string
          ad_id?: string
          ad_name?: string
          adset_id?: string
          campaign_id?: string
          clicks?: number
          conversion_value?: number
          conversions?: number
          date?: string
          impressions?: number
          reach?: number | null
          spend?: number
          thruplay?: number | null
          video_3s?: number | null
          video_p100?: number | null
          video_p25?: number | null
          video_p50?: number | null
          video_p75?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_metrics_ad_daily_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_metrics_ad_daily_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_metrics_daily: {
        Row: {
          ad_account_id: string
          campaign_id: string
          campaign_name: string
          clicks: number
          conversion_value: number
          conversions: number
          date: string
          impressions: number
          spend: number
          workspace_id: string
        }
        Insert: {
          ad_account_id: string
          campaign_id: string
          campaign_name?: string
          clicks?: number
          conversion_value?: number
          conversions?: number
          date: string
          impressions?: number
          spend?: number
          workspace_id: string
        }
        Update: {
          ad_account_id?: string
          campaign_id?: string
          campaign_name?: string
          clicks?: number
          conversion_value?: number
          conversions?: number
          date?: string
          impressions?: number
          spend?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_metrics_daily_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_metrics_daily_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_secrets: {
        Row: {
          source_id: string
          token: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          source_id: string
          token: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          source_id?: string
          token?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_secrets_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: true
            referencedRelation: "analytics_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_secrets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_sources: {
        Row: {
          company_id: string | null
          connection_id: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          external_id: string
          first_synced_at: string | null
          id: string
          is_demo: boolean
          kind: string
          last_synced_at: string | null
          name: string
          settings: Json
          sync_error: string | null
          timezone: string | null
          workspace_id: string
        }
        Insert: {
          company_id?: string | null
          connection_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          external_id: string
          first_synced_at?: string | null
          id?: string
          is_demo?: boolean
          kind: string
          last_synced_at?: string | null
          name?: string
          settings?: Json
          sync_error?: string | null
          timezone?: string | null
          workspace_id: string
        }
        Update: {
          company_id?: string | null
          connection_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          external_id?: string
          first_synced_at?: string | null
          id?: string
          is_demo?: boolean
          kind?: string
          last_synced_at?: string | null
          name?: string
          settings?: Json
          sync_error?: string | null
          timezone?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_sources_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_sources_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "ad_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_sources_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "ad_connections_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      api_tokens: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          name: string
          prefix: string
          revoked_at: string | null
          scope: string
          token_hash: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          prefix: string
          revoked_at?: string | null
          scope?: string
          token_hash: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
          scope?: string
          token_hash?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_tokens_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          client_visible: boolean
          created_at: string
          id: string
          mime: string
          name: string
          path: string
          project_id: string | null
          size: number
          task_id: string | null
          uploaded_by: string | null
          workspace_id: string
        }
        Insert: {
          client_visible?: boolean
          created_at?: string
          id?: string
          mime?: string
          name: string
          path: string
          project_id?: string | null
          size?: number
          task_id?: string | null
          uploaded_by?: string | null
          workspace_id: string
        }
        Update: {
          client_visible?: boolean
          created_at?: string
          id?: string
          mime?: string
          name?: string
          path?: string
          project_id?: string | null
          size?: number
          task_id?: string | null
          uploaded_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_google: {
        Row: {
          access_token: string | null
          created_at: string
          email: string
          expires_at: string | null
          id: string
          last_error: string | null
          refresh_token: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          email?: string
          expires_at?: string | null
          id?: string
          last_error?: string | null
          refresh_token: string
          user_id: string
          workspace_id: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          email?: string
          expires_at?: string | null
          id?: string
          last_error?: string | null
          refresh_token?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_google_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_overrides: {
        Row: {
          created_at: string
          day_end: string
          day_start: string
          demo: boolean
          id: string
          label: string
          profile_id: string
          ranges: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          day_end: string
          day_start: string
          demo?: boolean
          id?: string
          label?: string
          profile_id: string
          ranges?: Json
          workspace_id: string
        }
        Update: {
          created_at?: string
          day_end?: string
          day_start?: string
          demo?: boolean
          id?: string
          label?: string
          profile_id?: string
          ranges?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_overrides_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "booking_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_overrides_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_profiles: {
        Row: {
          active: boolean
          busy_calendars: string[]
          created_at: string
          display_name: string
          event_calendar: string
          headline: string
          id: string
          slug: string
          timezone: string
          user_id: string
          weekly: Json
          welcome: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          busy_calendars?: string[]
          created_at?: string
          display_name?: string
          event_calendar?: string
          headline?: string
          id?: string
          slug: string
          timezone?: string
          user_id: string
          weekly?: Json
          welcome?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          busy_calendars?: string[]
          created_at?: string
          display_name?: string
          event_calendar?: string
          headline?: string
          id?: string
          slug?: string
          timezone?: string
          user_id?: string
          weekly?: Json
          welcome?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_settings: {
        Row: {
          calcom_last_at: string | null
          calcom_secret: string
          calcom_user_id: string | null
          created_at: string
          workspace_id: string
        }
        Insert: {
          calcom_last_at?: string | null
          calcom_secret?: string
          calcom_user_id?: string | null
          created_at?: string
          workspace_id: string
        }
        Update: {
          calcom_last_at?: string | null
          calcom_secret?: string
          calcom_user_id?: string | null
          created_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_types: {
        Row: {
          active: boolean
          buffer_after_min: number
          buffer_before_min: number
          color: string
          create_deal: boolean
          created_at: string
          daily_limit: number | null
          demo: boolean
          description: string
          duration_min: number
          horizon_days: number
          id: string
          location_kind: string
          location_value: string
          min_notice_min: number
          name: string
          position: number
          profile_id: string
          questions: Json
          slot_interval_min: number | null
          slug: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          buffer_after_min?: number
          buffer_before_min?: number
          color?: string
          create_deal?: boolean
          created_at?: string
          daily_limit?: number | null
          demo?: boolean
          description?: string
          duration_min?: number
          horizon_days?: number
          id?: string
          location_kind?: string
          location_value?: string
          min_notice_min?: number
          name: string
          position?: number
          profile_id: string
          questions?: Json
          slot_interval_min?: number | null
          slug: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          buffer_after_min?: number
          buffer_before_min?: number
          color?: string
          create_deal?: boolean
          created_at?: string
          daily_limit?: number | null
          demo?: boolean
          description?: string
          duration_min?: number
          horizon_days?: number
          id?: string
          location_kind?: string
          location_value?: string
          min_notice_min?: number
          name?: string
          position?: number
          profile_id?: string
          questions?: Json
          slot_interval_min?: number | null
          slug?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_types_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "booking_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_types_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          activity_id: string | null
          answers: Json
          buffer_after_min: number
          buffer_before_min: number
          cancel_reason: string
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string | null
          company_name: string
          contact_id: string | null
          created_at: string
          deal_id: string | null
          demo: boolean
          email: string
          end_at: string
          external_id: string | null
          google_calendar_id: string | null
          google_event_id: string | null
          id: string
          location: string
          location_kind: string
          meet_url: string
          name: string
          owner_id: string | null
          page_url: string
          phone: string
          profile_id: string | null
          reminded_1h_at: string | null
          reminded_24h_at: string | null
          reschedule_count: number
          source: string
          start_at: string
          status: string
          timezone: string
          title: string
          token: string
          type_id: string | null
          updated_at: string
          utm: Json
          workspace_id: string
        }
        Insert: {
          activity_id?: string | null
          answers?: Json
          buffer_after_min?: number
          buffer_before_min?: number
          cancel_reason?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string | null
          company_name?: string
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          demo?: boolean
          email?: string
          end_at: string
          external_id?: string | null
          google_calendar_id?: string | null
          google_event_id?: string | null
          id?: string
          location?: string
          location_kind?: string
          meet_url?: string
          name?: string
          owner_id?: string | null
          page_url?: string
          phone?: string
          profile_id?: string | null
          reminded_1h_at?: string | null
          reminded_24h_at?: string | null
          reschedule_count?: number
          source?: string
          start_at: string
          status?: string
          timezone?: string
          title?: string
          token?: string
          type_id?: string | null
          updated_at?: string
          utm?: Json
          workspace_id: string
        }
        Update: {
          activity_id?: string | null
          answers?: Json
          buffer_after_min?: number
          buffer_before_min?: number
          cancel_reason?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string | null
          company_name?: string
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          demo?: boolean
          email?: string
          end_at?: string
          external_id?: string | null
          google_calendar_id?: string | null
          google_event_id?: string | null
          id?: string
          location?: string
          location_kind?: string
          meet_url?: string
          name?: string
          owner_id?: string | null
          page_url?: string
          phone?: string
          profile_id?: string | null
          reminded_1h_at?: string | null
          reminded_24h_at?: string | null
          reschedule_count?: number
          source?: string
          start_at?: string
          status?: string
          timezone?: string
          title?: string
          token?: string
          type_id?: string | null
          updated_at?: string
          utm?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "crm_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "booking_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "booking_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      clarity_daily: {
        Row: {
          active_time: number | null
          bot_sessions: number
          date: string
          dead_clicks: number
          dead_sessions: number
          device: string
          error_click_sessions: number
          error_clicks: number
          excessive_scrolls: number
          excessive_sessions: number
          key: string
          pages_per_session: number | null
          quickback_sessions: number
          quickbacks: number
          rage_clicks: number
          rage_sessions: number
          scope: string
          script_error_sessions: number
          script_errors: number
          scroll_depth: number | null
          sessions: number
          source_id: string
          total_time: number | null
          users: number
          window_days: number
          workspace_id: string
        }
        Insert: {
          active_time?: number | null
          bot_sessions?: number
          date: string
          dead_clicks?: number
          dead_sessions?: number
          device?: string
          error_click_sessions?: number
          error_clicks?: number
          excessive_scrolls?: number
          excessive_sessions?: number
          key?: string
          pages_per_session?: number | null
          quickback_sessions?: number
          quickbacks?: number
          rage_clicks?: number
          rage_sessions?: number
          scope: string
          script_error_sessions?: number
          script_errors?: number
          scroll_depth?: number | null
          sessions?: number
          source_id: string
          total_time?: number | null
          users?: number
          window_days?: number
          workspace_id: string
        }
        Update: {
          active_time?: number | null
          bot_sessions?: number
          date?: string
          dead_clicks?: number
          dead_sessions?: number
          device?: string
          error_click_sessions?: number
          error_clicks?: number
          excessive_scrolls?: number
          excessive_sessions?: number
          key?: string
          pages_per_session?: number | null
          quickback_sessions?: number
          quickbacks?: number
          rage_clicks?: number
          rage_sessions?: number
          scope?: string
          script_error_sessions?: number
          script_errors?: number
          scroll_depth?: number | null
          sessions?: number
          source_id?: string
          total_time?: number | null
          users?: number
          window_days?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clarity_daily_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "analytics_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clarity_daily_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_invitations: {
        Row: {
          accepted_at: string | null
          company_id: string
          contact_id: string | null
          created_at: string
          email: string
          features: string[] | null
          id: string
          invited_by: string | null
          revoked_at: string | null
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          company_id: string
          contact_id?: string | null
          created_at?: string
          email: string
          features?: string[] | null
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          token?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          company_id?: string
          contact_id?: string | null
          created_at?: string
          email?: string
          features?: string[] | null
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invitations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portals: {
        Row: {
          company_id: string
          enabled: boolean
          features: string[]
          updated_at: string
          welcome: string
          workspace_id: string
        }
        Insert: {
          company_id: string
          enabled?: boolean
          features?: string[]
          updated_at?: string
          welcome?: string
          workspace_id: string
        }
        Update: {
          company_id?: string
          enabled?: boolean
          features?: string[]
          updated_at?: string
          welcome?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_users: {
        Row: {
          company_id: string
          contact_id: string | null
          created_at: string
          features: string[] | null
          id: string
          invited_by: string | null
          last_seen_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          company_id: string
          contact_id?: string | null
          created_at?: string
          features?: string[] | null
          id?: string
          invited_by?: string | null
          last_seen_at?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          company_id?: string
          contact_id?: string | null
          created_at?: string
          features?: string[] | null
          id?: string
          invited_by?: string | null
          last_seen_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_users_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_users_profile_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_users_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          edited_at: string | null
          id: string
          task_id: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          task_id: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          task_id?: string
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          color: string
          created_at: string
          id: string
          industry: string
          monthly_retainer: number | null
          name: string
          notes: string
          owner_id: string | null
          status: string
          website: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          industry?: string
          monthly_retainer?: number | null
          name: string
          notes?: string
          owner_id?: string | null
          status?: string
          website?: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          industry?: string
          monthly_retainer?: number | null
          name?: string
          notes?: string
          owner_id?: string | null
          status?: string
          website?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_ads: {
        Row: {
          ai_tagged_at: string | null
          ai_tags: Json | null
          ai_tags_hash: string | null
          archive_id: string
          bodies: string[]
          captions: string[]
          concept_id: string | null
          descriptions: string[]
          eu_reach: number | null
          first_seen: string
          id: string
          is_active: boolean
          is_demo: boolean
          languages: string[]
          last_seen: string
          page_id: string
          page_name: string
          platforms: string[]
          snapshot_url: string | null
          start_time: string | null
          stop_time: string | null
          target_ages: string | null
          target_gender: string | null
          target_locations: Json | null
          titles: string[]
          watch_id: string | null
          workspace_id: string
        }
        Insert: {
          ai_tagged_at?: string | null
          ai_tags?: Json | null
          ai_tags_hash?: string | null
          archive_id: string
          bodies?: string[]
          captions?: string[]
          concept_id?: string | null
          descriptions?: string[]
          eu_reach?: number | null
          first_seen?: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
          languages?: string[]
          last_seen?: string
          page_id?: string
          page_name?: string
          platforms?: string[]
          snapshot_url?: string | null
          start_time?: string | null
          stop_time?: string | null
          target_ages?: string | null
          target_gender?: string | null
          target_locations?: Json | null
          titles?: string[]
          watch_id?: string | null
          workspace_id: string
        }
        Update: {
          ai_tagged_at?: string | null
          ai_tags?: Json | null
          ai_tags_hash?: string | null
          archive_id?: string
          bodies?: string[]
          captions?: string[]
          concept_id?: string | null
          descriptions?: string[]
          eu_reach?: number | null
          first_seen?: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
          languages?: string[]
          last_seen?: string
          page_id?: string
          page_name?: string
          platforms?: string[]
          snapshot_url?: string | null
          start_time?: string | null
          stop_time?: string | null
          target_ages?: string | null
          target_gender?: string | null
          target_locations?: Json | null
          titles?: string[]
          watch_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_ads_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "creative_concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_ads_watch_id_fkey"
            columns: ["watch_id"]
            isOneToOne: false
            referencedRelation: "competitor_watches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_ads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_watches: {
        Row: {
          active_only: boolean
          company_id: string | null
          countries: string[]
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          is_demo: boolean
          kind: string
          last_error: string | null
          last_notified_at: string | null
          last_synced_at: string | null
          page_id: string | null
          page_name: string
          search_terms: string
          workspace_id: string
        }
        Insert: {
          active_only?: boolean
          company_id?: string | null
          countries?: string[]
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          is_demo?: boolean
          kind?: string
          last_error?: string | null
          last_notified_at?: string | null
          last_synced_at?: string | null
          page_id?: string | null
          page_name?: string
          search_terms?: string
          workspace_id: string
        }
        Update: {
          active_only?: boolean
          company_id?: string | null
          countries?: string[]
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          is_demo?: boolean
          kind?: string
          last_error?: string | null
          last_notified_at?: string | null
          last_synced_at?: string | null
          page_id?: string | null
          page_name?: string
          search_terms?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_watches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_watches_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company_id: string | null
          created_at: string
          email: string
          first_name: string
          id: string
          job_title: string
          last_name: string
          notes: string
          phone: string
          workspace_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          job_title?: string
          last_name?: string
          notes?: string
          phone?: string
          workspace_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          job_title?: string
          last_name?: string
          notes?: string
          phone?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_ads: {
        Row: {
          ad_id: string
          concept_id: string
          created_at: string
          id: string
          platform: string
          variant_id: string | null
          workspace_id: string
        }
        Insert: {
          ad_id: string
          concept_id: string
          created_at?: string
          id?: string
          platform?: string
          variant_id?: string | null
          workspace_id: string
        }
        Update: {
          ad_id?: string
          concept_id?: string
          created_at?: string
          id?: string
          platform?: string
          variant_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_ads_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "creative_concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_ads_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "creative_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_ads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_assets: {
        Row: {
          concept_id: string
          created_at: string
          id: string
          mime: string
          name: string
          path: string
          size: number
          uploaded_by: string | null
          variant_id: string | null
          workspace_id: string
        }
        Insert: {
          concept_id: string
          created_at?: string
          id?: string
          mime?: string
          name: string
          path: string
          size?: number
          uploaded_by?: string | null
          variant_id?: string | null
          workspace_id: string
        }
        Update: {
          concept_id?: string
          created_at?: string
          id?: string
          mime?: string
          name?: string
          path?: string
          size?: number
          uploaded_by?: string | null
          variant_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_assets_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "creative_concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_assets_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "creative_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_concepts: {
        Row: {
          ai_tagged_at: string | null
          ai_tags: Json | null
          ai_tags_hash: string | null
          angle: string
          awareness: string | null
          brief: Json
          client_feedback: string
          client_review: string | null
          client_reviewed_at: string | null
          client_reviewed_by: string | null
          company_id: string | null
          cover_path: string | null
          created_at: string
          created_by: string | null
          format: string
          hook: string
          id: string
          is_demo: boolean
          launched_at: string | null
          owner_id: string | null
          persona: string
          platforms: string[]
          position: number
          project_id: string | null
          source: Json | null
          status: string
          tags: string[]
          task_id: string | null
          title: string
          updated_at: string
          verdict: string
          workspace_id: string
        }
        Insert: {
          ai_tagged_at?: string | null
          ai_tags?: Json | null
          ai_tags_hash?: string | null
          angle?: string
          awareness?: string | null
          brief?: Json
          client_feedback?: string
          client_review?: string | null
          client_reviewed_at?: string | null
          client_reviewed_by?: string | null
          company_id?: string | null
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
          format?: string
          hook?: string
          id?: string
          is_demo?: boolean
          launched_at?: string | null
          owner_id?: string | null
          persona?: string
          platforms?: string[]
          position?: number
          project_id?: string | null
          source?: Json | null
          status?: string
          tags?: string[]
          task_id?: string | null
          title: string
          updated_at?: string
          verdict?: string
          workspace_id: string
        }
        Update: {
          ai_tagged_at?: string | null
          ai_tags?: Json | null
          ai_tags_hash?: string | null
          angle?: string
          awareness?: string | null
          brief?: Json
          client_feedback?: string
          client_review?: string | null
          client_reviewed_at?: string | null
          client_reviewed_by?: string | null
          company_id?: string | null
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
          format?: string
          hook?: string
          id?: string
          is_demo?: boolean
          launched_at?: string | null
          owner_id?: string | null
          persona?: string
          platforms?: string[]
          position?: number
          project_id?: string | null
          source?: Json | null
          status?: string
          tags?: string[]
          task_id?: string | null
          title?: string
          updated_at?: string
          verdict?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_concepts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_concepts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_concepts_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_concepts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_intel_settings: {
        Row: {
          access_token: string | null
          token_checked_at: string | null
          token_error: string | null
          token_expires_at: string | null
          token_label: string | null
          token_ok: boolean | null
          token_user_id: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          access_token?: string | null
          token_checked_at?: string | null
          token_error?: string | null
          token_expires_at?: string | null
          token_label?: string | null
          token_ok?: boolean | null
          token_user_id?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          access_token?: string | null
          token_checked_at?: string | null
          token_error?: string | null
          token_expires_at?: string | null
          token_label?: string | null
          token_ok?: boolean | null
          token_user_id?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_intel_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_recommendations: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          created_concepts: Json
          id: string
          is_demo: boolean
          model: string
          output: Json
          stats: Json
          usage: Json | null
          workspace_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          created_concepts?: Json
          id?: string
          is_demo?: boolean
          model?: string
          output?: Json
          stats?: Json
          usage?: Json | null
          workspace_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          created_concepts?: Json
          id?: string
          is_demo?: boolean
          model?: string
          output?: Json
          stats?: Json
          usage?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_recommendations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_recommendations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_variants: {
        Row: {
          concept_id: string
          created_at: string
          hook: string
          id: string
          name: string
          notes: string
          position: number
          workspace_id: string
        }
        Insert: {
          concept_id: string
          created_at?: string
          hook?: string
          id?: string
          name: string
          notes?: string
          position?: number
          workspace_id: string
        }
        Update: {
          concept_id?: string
          created_at?: string
          hook?: string
          id?: string
          name?: string
          notes?: string
          position?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_variants_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "creative_concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_variants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_activities: {
        Row: {
          author_id: string | null
          body: string
          company_id: string | null
          contact_id: string | null
          created_at: string
          deal_id: string | null
          done: boolean
          due_at: string | null
          id: string
          kind: string
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          body?: string
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          done?: boolean
          due_at?: string | null
          id?: string
          kind?: string
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          done?: boolean
          due_at?: string | null
          id?: string
          kind?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          billing: string
          closed_at: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string
          expected_close: string | null
          id: string
          lost_reason: string
          owner_id: string | null
          position: number
          services: string[]
          source: string
          stage_id: string | null
          title: string
          value: number
          workspace_id: string
        }
        Insert: {
          billing?: string
          closed_at?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          expected_close?: string | null
          id?: string
          lost_reason?: string
          owner_id?: string | null
          position?: number
          services?: string[]
          source?: string
          stage_id?: string | null
          title: string
          value?: number
          workspace_id: string
        }
        Update: {
          billing?: string
          closed_at?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          expected_close?: string | null
          id?: string
          lost_reason?: string
          owner_id?: string | null
          position?: number
          services?: string[]
          source?: string
          stage_id?: string | null
          title?: string
          value?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ga4_channels_daily: {
        Row: {
          channel: string
          date: string
          engaged_sessions: number
          engagement_seconds: number
          key_events: number
          medium: string
          new_users: number
          purchases: number
          revenue: number
          sessions: number
          source: string
          source_id: string
          users: number
          workspace_id: string
        }
        Insert: {
          channel?: string
          date: string
          engaged_sessions?: number
          engagement_seconds?: number
          key_events?: number
          medium?: string
          new_users?: number
          purchases?: number
          revenue?: number
          sessions?: number
          source?: string
          source_id: string
          users?: number
          workspace_id: string
        }
        Update: {
          channel?: string
          date?: string
          engaged_sessions?: number
          engagement_seconds?: number
          key_events?: number
          medium?: string
          new_users?: number
          purchases?: number
          revenue?: number
          sessions?: number
          source?: string
          source_id?: string
          users?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ga4_channels_daily_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "analytics_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ga4_channels_daily_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ga4_dims_daily: {
        Row: {
          date: string
          dim: string
          engaged_sessions: number
          engagement_seconds: number
          key_events: number
          new_users: number
          pageviews: number
          purchases: number
          revenue: number
          sessions: number
          source_id: string
          users: number
          value: string
          workspace_id: string
        }
        Insert: {
          date: string
          dim: string
          engaged_sessions?: number
          engagement_seconds?: number
          key_events?: number
          new_users?: number
          pageviews?: number
          purchases?: number
          revenue?: number
          sessions?: number
          source_id: string
          users?: number
          value?: string
          workspace_id: string
        }
        Update: {
          date?: string
          dim?: string
          engaged_sessions?: number
          engagement_seconds?: number
          key_events?: number
          new_users?: number
          pageviews?: number
          purchases?: number
          revenue?: number
          sessions?: number
          source_id?: string
          users?: number
          value?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ga4_dims_daily_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "analytics_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ga4_dims_daily_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ga4_pages_daily: {
        Row: {
          date: string
          engaged_sessions: number
          key_events: number
          page: string
          sessions: number
          source_id: string
          workspace_id: string
        }
        Insert: {
          date: string
          engaged_sessions?: number
          key_events?: number
          page: string
          sessions?: number
          source_id: string
          workspace_id: string
        }
        Update: {
          date?: string
          engaged_sessions?: number
          key_events?: number
          page?: string
          sessions?: number
          source_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ga4_pages_daily_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "analytics_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ga4_pages_daily_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["member_role"]
          team_id: string | null
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          team_id?: string | null
          token?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          team_id?: string | null
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_targets: {
        Row: {
          company_id: string
          id: string
          metric: string
          target: number
          workspace_id: string
        }
        Insert: {
          company_id: string
          id?: string
          metric: string
          target: number
          workspace_id: string
        }
        Update: {
          company_id?: string
          id?: string
          metric?: string
          target?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_targets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_targets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      labels: {
        Row: {
          color: string
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          color?: string
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          color?: string
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "labels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      link_clicks: {
        Row: {
          browser: string | null
          country: string | null
          device: string | null
          id: number
          is_bot: boolean
          link_id: string
          os: string | null
          referrer: string
          token: string
          ts: string
          workspace_id: string
        }
        Insert: {
          browser?: string | null
          country?: string | null
          device?: string | null
          id?: never
          is_bot?: boolean
          link_id: string
          os?: string | null
          referrer?: string
          token?: string
          ts?: string
          workspace_id: string
        }
        Update: {
          browser?: string | null
          country?: string | null
          device?: string | null
          id?: never
          is_bot?: boolean
          link_id?: string
          os?: string | null
          referrer?: string
          token?: string
          ts?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_clicks_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "link_clicks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      link_settings: {
        Row: {
          naming_help: string
          naming_rule: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          naming_help?: string
          naming_rule?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          naming_help?: string
          naming_rule?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      links: {
        Row: {
          active: boolean
          clicks: number
          code: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          destination: string
          expires_at: string | null
          final_url: string
          id: string
          is_demo: boolean
          last_click_at: string | null
          name: string
          site_id: string | null
          tags: string[]
          utm: Json
          workspace_id: string
        }
        Insert: {
          active?: boolean
          clicks?: number
          code?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          destination: string
          expires_at?: string | null
          final_url: string
          id?: string
          is_demo?: boolean
          last_click_at?: string | null
          name?: string
          site_id?: string | null
          tags?: string[]
          utm?: Json
          workspace_id: string
        }
        Update: {
          active?: boolean
          clicks?: number
          code?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          destination?: string
          expires_at?: string | null
          final_url?: string
          id?: string
          is_demo?: boolean
          last_click_at?: string | null
          name?: string
          site_id?: string | null
          tags?: string[]
          utm?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "links_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "tracking_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          archived_at: string | null
          body: string
          concept_id: string | null
          created_at: string
          deal_id: string | null
          id: string
          kind: string
          portal_link: string | null
          project_id: string | null
          proposal_id: string | null
          read_at: string | null
          task_id: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          archived_at?: string | null
          body?: string
          concept_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          kind: string
          portal_link?: string | null
          project_id?: string | null
          proposal_id?: string | null
          read_at?: string | null
          task_id?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          archived_at?: string | null
          body?: string
          concept_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          kind?: string
          portal_link?: string | null
          project_id?: string | null
          proposal_id?: string | null
          read_at?: string | null
          task_id?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "creative_concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_files: {
        Row: {
          created_at: string
          form_id: string
          id: string
          mime: string
          name: string
          path: string
          question_id: string
          size: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          form_id: string
          id?: string
          mime?: string
          name: string
          path: string
          question_id: string
          size?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          form_id?: string
          id?: string
          mime?: string
          name?: string
          path?: string
          question_id?: string
          size?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_files_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "onboarding_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_files_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_forms: {
        Row: {
          answers: Json
          automation: Json
          company_id: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          email_sent_at: string | null
          id: string
          intro: string
          is_demo: boolean
          last_activity_at: string | null
          opened_at: string | null
          options: Json
          progress: number
          project_id: string | null
          remind_count: number
          reminded_at: string | null
          sections: Json
          sent_at: string
          status: string
          template_id: string | null
          title: string
          token: string
          updated_at: string
          verified: Json
          workspace_id: string
        }
        Insert: {
          answers?: Json
          automation?: Json
          company_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          email_sent_at?: string | null
          id?: string
          intro?: string
          is_demo?: boolean
          last_activity_at?: string | null
          opened_at?: string | null
          options?: Json
          progress?: number
          project_id?: string | null
          remind_count?: number
          reminded_at?: string | null
          sections?: Json
          sent_at?: string
          status?: string
          template_id?: string | null
          title: string
          token?: string
          updated_at?: string
          verified?: Json
          workspace_id: string
        }
        Update: {
          answers?: Json
          automation?: Json
          company_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          email_sent_at?: string | null
          id?: string
          intro?: string
          is_demo?: boolean
          last_activity_at?: string | null
          opened_at?: string | null
          options?: Json
          progress?: number
          project_id?: string | null
          remind_count?: number
          reminded_at?: string | null
          sections?: Json
          sent_at?: string
          status?: string
          template_id?: string | null
          title?: string
          token?: string
          updated_at?: string
          verified?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_forms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_forms_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_forms_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_forms_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "onboarding_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_forms_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_settings: {
        Row: {
          access_email: string
          auto_company: boolean
          auto_kpis: boolean
          auto_project: boolean
          google_mcc_id: string
          intro: string
          meta_business_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          access_email?: string
          auto_company?: boolean
          auto_kpis?: boolean
          auto_project?: boolean
          google_mcc_id?: string
          intro?: string
          meta_business_id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          access_email?: string
          auto_company?: boolean
          auto_kpis?: boolean
          auto_project?: boolean
          google_mcc_id?: string
          intro?: string
          meta_business_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_templates: {
        Row: {
          archived: boolean
          created_at: string
          created_by: string | null
          description: string
          icon: string
          id: string
          key: string | null
          name: string
          position: number
          sections: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          created_by?: string | null
          description?: string
          icon?: string
          id?: string
          key?: string | null
          name: string
          position?: number
          sections?: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          created_by?: string | null
          description?: string
          icon?: string
          id?: string
          key?: string | null
          name?: string
          position?: number
          sections?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string
          id: string
          kind: string
          name: string
          position: number
          probability: number
          workspace_id: string
        }
        Insert: {
          color?: string
          id?: string
          kind?: string
          name: string
          position?: number
          probability?: number
          workspace_id: string
        }
        Update: {
          color?: string
          id?: string
          kind?: string
          name?: string
          position?: number
          probability?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          color: string
          created_at: string
          email: string
          full_name: string
          id: string
          prefs: Json
          title: string
        }
        Insert: {
          color?: string
          created_at?: string
          email: string
          full_name?: string
          id: string
          prefs?: Json
          title?: string
        }
        Update: {
          color?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          prefs?: Json
          title?: string
        }
        Relationships: []
      }
      project_favorites: {
        Row: {
          position: number
          project_id: string
          user_id: string
        }
        Insert: {
          position?: number
          project_id: string
          user_id?: string
        }
        Update: {
          position?: number
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_favorites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          project_id: string
          user_id: string
        }
        Insert: {
          project_id: string
          user_id: string
        }
        Update: {
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          color: string
          company_id: string | null
          created_at: string
          description: string
          due_date: string | null
          icon: string
          id: string
          key: string
          lead_id: string | null
          monthly_budget: number | null
          name: string
          platforms: string[]
          portal_mode: string
          seq: number
          start_date: string | null
          status: string
          team_id: string | null
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          color?: string
          company_id?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          icon?: string
          id?: string
          key: string
          lead_id?: string | null
          monthly_budget?: number | null
          name: string
          platforms?: string[]
          portal_mode?: string
          seq?: number
          start_date?: string | null
          status?: string
          team_id?: string | null
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          color?: string
          company_id?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          icon?: string
          id?: string
          key?: string
          lead_id?: string | null
          monthly_budget?: number | null
          name?: string
          platforms?: string[]
          portal_mode?: string
          seq?: number
          start_date?: string | null
          status?: string
          team_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_items: {
        Row: {
          billing: string
          description: string
          id: string
          name: string
          optional: boolean
          position: number
          proposal_id: string
          quantity: number
          selected: boolean
          service_id: string | null
          unit_price: number
        }
        Insert: {
          billing?: string
          description?: string
          id?: string
          name: string
          optional?: boolean
          position?: number
          proposal_id: string
          quantity?: number
          selected?: boolean
          service_id?: string | null
          unit_price?: number
        }
        Update: {
          billing?: string
          description?: string
          id?: string
          name?: string
          optional?: boolean
          position?: number
          proposal_id?: string
          quantity?: number
          selected?: boolean
          service_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "proposal_items_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_otps: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          email: string
          expires_at: string
          id: string
          proof_hash: string | null
          proposal_id: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          proof_hash?: string | null
          proposal_id: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          proof_hash?: string | null
          proposal_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposal_otps_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_signature_events: {
        Row: {
          at: string
          id: number
          ip_hash: string | null
          ip_trunc: string | null
          kind: string
          meta: Json
          proposal_id: string
          user_agent: string | null
          workspace_id: string
        }
        Insert: {
          at?: string
          id?: never
          ip_hash?: string | null
          ip_trunc?: string | null
          kind: string
          meta?: Json
          proposal_id: string
          user_agent?: string | null
          workspace_id: string
        }
        Update: {
          at?: string
          id?: never
          ip_hash?: string | null
          ip_trunc?: string | null
          kind?: string
          meta?: Json
          proposal_id?: string
          user_agent?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_signature_events_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_signature_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_signatures: {
        Row: {
          consent_text: string
          countersign_hash: string | null
          countersign_ip_trunc: string | null
          countersign_method: string | null
          countersign_path: string | null
          countersign_required: boolean
          countersign_user_agent: string | null
          countersigned_at: string | null
          countersigner_id: string | null
          countersigner_name: string | null
          countersigner_role: string | null
          created_at: string
          document_hash: string
          email_verified: boolean
          email_verified_at: string | null
          id: string
          ip_hash: string | null
          ip_trunc: string | null
          mention: string
          pdf_generated_at: string | null
          pdf_hash: string | null
          pdf_path: string | null
          proposal_id: string
          signature_hash: string
          signature_method: string
          signature_path: string
          signed_at: string
          signer_company: string
          signer_email: string
          signer_first_name: string
          signer_last_name: string
          signer_role: string
          snapshot: Json
          user_agent: string | null
          workspace_id: string
        }
        Insert: {
          consent_text: string
          countersign_hash?: string | null
          countersign_ip_trunc?: string | null
          countersign_method?: string | null
          countersign_path?: string | null
          countersign_required?: boolean
          countersign_user_agent?: string | null
          countersigned_at?: string | null
          countersigner_id?: string | null
          countersigner_name?: string | null
          countersigner_role?: string | null
          created_at?: string
          document_hash: string
          email_verified?: boolean
          email_verified_at?: string | null
          id?: string
          ip_hash?: string | null
          ip_trunc?: string | null
          mention?: string
          pdf_generated_at?: string | null
          pdf_hash?: string | null
          pdf_path?: string | null
          proposal_id: string
          signature_hash: string
          signature_method: string
          signature_path: string
          signed_at: string
          signer_company?: string
          signer_email: string
          signer_first_name: string
          signer_last_name: string
          signer_role?: string
          snapshot: Json
          user_agent?: string | null
          workspace_id: string
        }
        Update: {
          consent_text?: string
          countersign_hash?: string | null
          countersign_ip_trunc?: string | null
          countersign_method?: string | null
          countersign_path?: string | null
          countersign_required?: boolean
          countersign_user_agent?: string | null
          countersigned_at?: string | null
          countersigner_id?: string | null
          countersigner_name?: string | null
          countersigner_role?: string | null
          created_at?: string
          document_hash?: string
          email_verified?: boolean
          email_verified_at?: string | null
          id?: string
          ip_hash?: string | null
          ip_trunc?: string | null
          mention?: string
          pdf_generated_at?: string | null
          pdf_hash?: string | null
          pdf_path?: string | null
          proposal_id?: string
          signature_hash?: string
          signature_method?: string
          signature_path?: string
          signed_at?: string
          signer_company?: string
          signer_email?: string
          signer_first_name?: string
          signer_last_name?: string
          signer_role?: string
          snapshot?: Json
          user_agent?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_signatures_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: true
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_signatures_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          accepted_at: string | null
          accepted_name: string | null
          blocks: Json
          company_id: string | null
          contact_id: string | null
          countersign: boolean
          created_at: string
          currency: string
          deal_id: string | null
          declined_reason: string | null
          discount_pct: number
          id: string
          number: number
          owner_id: string | null
          public_token: string
          sent_at: string | null
          status: string
          tax_pct: number
          title: string
          updated_at: string
          valid_until: string | null
          viewed_at: string | null
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_name?: string | null
          blocks?: Json
          company_id?: string | null
          contact_id?: string | null
          countersign?: boolean
          created_at?: string
          currency?: string
          deal_id?: string | null
          declined_reason?: string | null
          discount_pct?: number
          id?: string
          number: number
          owner_id?: string | null
          public_token?: string
          sent_at?: string | null
          status?: string
          tax_pct?: number
          title: string
          updated_at?: string
          valid_until?: string | null
          viewed_at?: string | null
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_name?: string | null
          blocks?: Json
          company_id?: string | null
          contact_id?: string | null
          countersign?: boolean
          created_at?: string
          currency?: string
          deal_id?: string | null
          declined_reason?: string | null
          discount_pct?: number
          id?: string
          number?: number
          owner_id?: string | null
          public_token?: string
          sent_at?: string | null
          status?: string
          tax_pct?: number
          title?: string
          updated_at?: string
          valid_until?: string | null
          viewed_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          commentary: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          next_steps: string
          period_end: string
          period_start: string
          public_token: string
          sections: string[]
          shared: boolean
          title: string
          workspace_id: string
        }
        Insert: {
          commentary?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          next_steps?: string
          period_end: string
          period_start: string
          public_token?: string
          sections?: string[]
          shared?: boolean
          title: string
          workspace_id: string
        }
        Update: {
          commentary?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          next_steps?: string
          period_end?: string
          period_start?: string
          public_token?: string
          sections?: string[]
          shared?: boolean
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_views: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          icon: string
          id: string
          name: string
          project_id: string | null
          workspace_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          icon?: string
          id?: string
          name: string
          project_id?: string | null
          workspace_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          icon?: string
          id?: string
          name?: string
          project_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_views_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_views_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          archived: boolean
          billing: string
          description: string
          id: string
          name: string
          position: number
          unit_price: number
          workspace_id: string
        }
        Insert: {
          archived?: boolean
          billing?: string
          description?: string
          id?: string
          name: string
          position?: number
          unit_price?: number
          workspace_id: string
        }
        Update: {
          archived?: boolean
          billing?: string
          description?: string
          id?: string
          name?: string
          position?: number
          unit_price?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      subtasks: {
        Row: {
          assignee_id: string | null
          created_at: string
          done: boolean
          id: string
          position: number
          task_id: string
          title: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          done?: boolean
          id?: string
          position?: number
          task_id: string
          title: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          done?: boolean
          id?: string
          position?: number
          task_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "subtasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          depends_on_id: string
          task_id: string
        }
        Insert: {
          depends_on_id: string
          task_id: string
        }
        Update: {
          depends_on_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_id_fkey"
            columns: ["depends_on_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_labels: {
        Row: {
          label_id: string
          task_id: string
        }
        Insert: {
          label_id: string
          task_id: string
        }
        Update: {
          label_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_labels_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived_at: string | null
          assignee_id: string | null
          client_visible: boolean
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string
          due_date: string | null
          id: string
          milestone: boolean
          number: number
          position: number
          priority: string
          project_id: string
          recurrence: string | null
          start_date: string | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          assignee_id?: string | null
          client_visible?: boolean
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          id?: string
          milestone?: boolean
          number: number
          position?: number
          priority?: string
          project_id: string
          recurrence?: string | null
          start_date?: string | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          assignee_id?: string | null
          client_visible?: boolean
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          id?: string
          milestone?: boolean
          number?: number
          position?: number
          priority?: string
          project_id?: string
          recurrence?: string | null
          start_date?: string | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          color: string
          created_at: string
          description: string
          icon: string
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string
          icon?: string
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string
          icon?: string
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      touchpoints: {
        Row: {
          ad_key: string | null
          adset_key: string | null
          campaign_key: string | null
          channel: string
          click_id: string | null
          click_id_type: string | null
          id: number
          landing_url: string
          link_click_id: number | null
          link_id: string | null
          platform: string | null
          referrer: string
          site_id: string
          ts: string
          utm_campaign: string | null
          utm_content: string | null
          utm_id: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          visitor_id: string
          workspace_id: string
        }
        Insert: {
          ad_key?: string | null
          adset_key?: string | null
          campaign_key?: string | null
          channel?: string
          click_id?: string | null
          click_id_type?: string | null
          id?: never
          landing_url?: string
          link_click_id?: number | null
          link_id?: string | null
          platform?: string | null
          referrer?: string
          site_id: string
          ts?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_id?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id: string
          workspace_id: string
        }
        Update: {
          ad_key?: string | null
          adset_key?: string | null
          campaign_key?: string | null
          channel?: string
          click_id?: string | null
          click_id_type?: string | null
          id?: never
          landing_url?: string
          link_click_id?: number | null
          link_id?: string | null
          platform?: string | null
          referrer?: string
          site_id?: string
          ts?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_id?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "touchpoints_link_fk"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "touchpoints_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "tracking_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "touchpoints_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "touchpoints_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_events: {
        Row: {
          currency: string | null
          id: number
          name: string | null
          order_id: string | null
          props: Json
          site_id: string
          source: string
          ts: string
          type: string
          url: string | null
          value: number | null
          visitor_id: string | null
          workspace_id: string
        }
        Insert: {
          currency?: string | null
          id?: never
          name?: string | null
          order_id?: string | null
          props?: Json
          site_id: string
          source?: string
          ts?: string
          type: string
          url?: string | null
          value?: number | null
          visitor_id?: string | null
          workspace_id: string
        }
        Update: {
          currency?: string | null
          id?: never
          name?: string | null
          order_id?: string | null
          props?: Json
          site_id?: string
          source?: string
          ts?: string
          type?: string
          url?: string | null
          value?: number | null
          visitor_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_events_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "tracking_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_events_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          prefix: string
          revoked_at: string | null
          site_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          last_used_at?: string | null
          name: string
          prefix: string
          revoked_at?: string | null
          site_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
          site_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_keys_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "tracking_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_keys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_sites: {
        Row: {
          company_id: string | null
          created_at: string
          domains: string[]
          id: string
          last_event_at: string | null
          name: string
          public_key: string
          settings: Json
          workspace_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          domains?: string[]
          id?: string
          last_event_at?: string | null
          name: string
          public_key?: string
          settings?: Json
          workspace_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          domains?: string[]
          id?: string
          last_event_at?: string | null
          name?: string
          public_key?: string
          settings?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_sites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_sites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_stages: {
        Row: {
          aliases: string[]
          has_value: boolean
          id: string
          key: string
          kind: string
          label: string
          position: number
          site_id: string
          workspace_id: string
        }
        Insert: {
          aliases?: string[]
          has_value?: boolean
          id?: string
          key: string
          kind?: string
          label: string
          position?: number
          site_id: string
          workspace_id: string
        }
        Update: {
          aliases?: string[]
          has_value?: boolean
          id?: string
          key?: string
          kind?: string
          label?: string
          position?: number
          site_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_stages_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "tracking_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_stages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      utm_presets: {
        Row: {
          extra_params: string
          id: string
          name: string
          position: number
          utm_campaign: string
          utm_content: string
          utm_medium: string
          utm_source: string
          utm_term: string
          workspace_id: string
        }
        Insert: {
          extra_params?: string
          id?: string
          name: string
          position?: number
          utm_campaign?: string
          utm_content?: string
          utm_medium?: string
          utm_source?: string
          utm_term?: string
          workspace_id: string
        }
        Update: {
          extra_params?: string
          id?: string
          name?: string
          position?: number
          utm_campaign?: string
          utm_content?: string
          utm_medium?: string
          utm_source?: string
          utm_term?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "utm_presets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      visitor_signals: {
        Row: {
          fbc: string | null
          fbp: string | null
          ga_cid: string | null
          ip: unknown
          seen_at: string
          site_id: string
          ua: string | null
          visitor_id: string
          workspace_id: string
        }
        Insert: {
          fbc?: string | null
          fbp?: string | null
          ga_cid?: string | null
          ip?: unknown
          seen_at?: string
          site_id: string
          ua?: string | null
          visitor_id: string
          workspace_id: string
        }
        Update: {
          fbc?: string | null
          fbp?: string | null
          ga_cid?: string | null
          ip?: unknown
          seen_at?: string
          site_id?: string
          ua?: string | null
          visitor_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visitor_signals_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "tracking_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitor_signals_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: true
            referencedRelation: "visitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitor_signals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      visitors: {
        Row: {
          anon_id: string
          contact_id: string | null
          country: string | null
          device: string | null
          email: string | null
          first_seen: string
          id: string
          identified_at: string | null
          last_seen: string
          name: string | null
          person_id: string | null
          phone: string | null
          phone_e164: string | null
          site_id: string
          workspace_id: string
        }
        Insert: {
          anon_id: string
          contact_id?: string | null
          country?: string | null
          device?: string | null
          email?: string | null
          first_seen?: string
          id?: string
          identified_at?: string | null
          last_seen?: string
          name?: string | null
          person_id?: string | null
          phone?: string | null
          phone_e164?: string | null
          site_id: string
          workspace_id: string
        }
        Update: {
          anon_id?: string
          contact_id?: string | null
          country?: string | null
          device?: string | null
          email?: string | null
          first_seen?: string
          id?: string
          identified_at?: string | null
          last_seen?: string
          name?: string | null
          person_id?: string | null
          phone?: string | null
          phone_e164?: string | null
          site_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visitors_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitors_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "tracking_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitors_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          joined_at: string
          role: Database["public"]["Enums"]["member_role"]
          team_id: string | null
          title: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          team_id?: string | null
          title?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          team_id?: string | null
          title?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_profile_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          accent: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          modules: string[] | null
          name: string
          slug: string
        }
        Insert: {
          accent?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          modules?: string[] | null
          name: string
          slug: string
        }
        Update: {
          accent?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          modules?: string[] | null
          name?: string
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      ad_connections_public: {
        Row: {
          accounts: Json | null
          accounts_refreshed_at: string | null
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          id: string | null
          label: string | null
          last_error: string | null
          platform: string | null
          workspace_id: string | null
        }
        Insert: {
          accounts?: Json | null
          accounts_refreshed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string | null
          label?: string | null
          last_error?: string | null
          platform?: string | null
          workspace_id?: string | null
        }
        Update: {
          accounts?: Json | null
          accounts_refreshed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string | null
          label?: string | null
          last_error?: string | null
          platform?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_google_public: {
        Row: {
          created_at: string | null
          email: string | null
          last_error: string | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          last_error?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          last_error?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_google_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _clear_demo_analytics: { Args: { ws: string }; Returns: undefined }
      _clear_demo_booking: { Args: { ws: string }; Returns: undefined }
      _clear_demo_creatives: { Args: { ws: string }; Returns: undefined }
      _clear_demo_intel: { Args: { ws: string }; Returns: undefined }
      _clear_demo_links: { Args: { ws: string }; Returns: undefined }
      _clear_demo_onboarding: { Args: { ws: string }; Returns: undefined }
      _clear_demo_portal: { Args: { ws: string }; Returns: undefined }
      _demo_analytics: { Args: { ws: string }; Returns: number }
      _demo_bk_day: { Args: { n: number }; Returns: string }
      _demo_booking: { Args: { uid: string; ws: string }; Returns: number }
      _demo_creatives: { Args: { ws: string }; Returns: number }
      _demo_intel: { Args: { ws: string }; Returns: number }
      _demo_links: { Args: { ws: string }; Returns: undefined }
      _demo_onboarding: { Args: { ws: string }; Returns: undefined }
      _demo_portal: { Args: { ws: string }; Returns: number }
      _demo_portal_texts: { Args: never; Returns: string[] }
      _report_analytics: {
        Args: {
          p_company: string
          p_end: string
          p_sections: string[]
          p_start: string
        }
        Returns: Json
      }
      _site_analytics: {
        Args: {
          p_client?: boolean
          p_company: string
          p_end: string
          p_parts?: string[]
          p_prev_end?: string
          p_prev_start?: string
          p_start: string
        }
        Returns: Json
      }
      _tracking_template: {
        Args: { p_template: string }
        Returns: {
          aliases: string[]
          has_value: boolean
          key: string
          kind: string
          label: string
          pos: number
        }[]
      }
      accept_client_invitation: { Args: { p_token: string }; Returns: Json }
      accept_invitation: { Args: { p_token: string }; Returns: string }
      ad_campaigns: {
        Args: {
          p_company: string
          p_end: string
          p_start: string
          p_ws: string
        }
        Returns: {
          ad_account_id: string
          campaign_id: string
          campaign_name: string
          clicks: number
          conversion_value: number
          conversions: number
          impressions: number
          spend: number
        }[]
      }
      ad_daily: {
        Args: {
          p_company?: string
          p_end: string
          p_start: string
          p_ws: string
        }
        Returns: {
          ad_account_id: string
          clicks: number
          conversion_value: number
          conversions: number
          date: string
          impressions: number
          spend: number
        }[]
      }
      analytics_overview: {
        Args: { p_end: string; p_start: string; p_ws: string }
        Returns: {
          company_id: string
          key_events: number
          purchases: number
          revenue: number
          sessions: number
        }[]
      }
      booking_ensure_profile: {
        Args: { uid: string; ws: string }
        Returns: string
      }
      booking_my_profile: { Args: { ws: string }; Returns: string }
      booking_profile_editable: {
        Args: { p: string; ws: string }
        Returns: boolean
      }
      booking_slugify: { Args: { t: string }; Returns: string }
      bump_link: { Args: { p_link: string }; Returns: undefined }
      can_write: { Args: { ws: string }; Returns: boolean }
      clear_demo_analytics: { Args: { ws: string }; Returns: undefined }
      clear_demo_booking: { Args: { ws: string }; Returns: undefined }
      clear_demo_creatives: { Args: { ws: string }; Returns: undefined }
      clear_demo_data: { Args: { ws: string }; Returns: undefined }
      clear_demo_intel: { Args: { ws: string }; Returns: undefined }
      clear_demo_links: { Args: { ws: string }; Returns: undefined }
      clear_demo_onboarding: { Args: { ws: string }; Returns: undefined }
      clear_demo_portal: { Args: { ws: string }; Returns: undefined }
      clear_demo_tracking: { Args: { ws: string }; Returns: undefined }
      client_invitation_info: { Args: { p_token: string }; Returns: Json }
      create_api_token: {
        Args: {
          p_expires_at?: string
          p_name: string
          p_scope?: string
          p_ws: string
        }
        Returns: Json
      }
      create_tracking_key: {
        Args: { p_name: string; p_site: string }
        Returns: Json
      }
      create_workspace: {
        Args: { p_name: string; p_slug: string }
        Returns: string
      }
      creative_ad_attribution: {
        Args: {
          p_ad_keys?: string[]
          p_end: string
          p_start: string
          p_ws: string
        }
        Returns: {
          ad_key: string
          revenue: number
          sales: number
        }[]
      }
      creative_ad_daily: {
        Args: {
          p_company?: string
          p_end: string
          p_start: string
          p_ws: string
        }
        Returns: {
          ad_account_id: string
          ad_id: string
          ad_name: string
          adset_id: string
          campaign_id: string
          clicks: number
          company_id: string
          conversion_value: number
          conversions: number
          date: string
          impressions: number
          platform: string
          spend: number
          thruplay: number
          video_3s: number
          video_p100: number
          video_p25: number
          video_p50: number
          video_p75: number
        }[]
      }
      creative_intel_status: {
        Args: { ws: string }
        Returns: {
          connection_expires_at: string
          connection_label: string
          has_connection: boolean
          has_manual: boolean
          manual_checked_at: string
          manual_error: string
          manual_expires_at: string
          manual_label: string
          manual_ok: boolean
        }[]
      }
      demo_task: {
        Args: {
          descr?: string
          due_off: number
          labs?: string[]
          p: string
          prio: string
          st: string
          start_off: number
          subs?: string[]
          subs_done?: number
          title: string
          who: string
        }
        Returns: string
      }
      demo_tracking_seed: { Args: { ws: string }; Returns: number }
      demo_tracking_seed_part: {
        Args: { p_company: string; p_from: number; p_to: number; ws: string }
        Returns: number
      }
      demo_tracking_touch: {
        Args: {
          p_ad: string
          p_adset: string
          p_camp: string
          p_ch: string
          p_domain: string
          p_pages: string[]
          p_site: string
          p_ts: string
          p_vis: string
          p_ws: string
        }
        Returns: undefined
      }
      has_role: {
        Args: {
          roles: Database["public"]["Enums"]["member_role"][]
          ws: string
        }
        Returns: boolean
      }
      is_admin: { Args: { ws: string }; Returns: boolean }
      is_member: { Args: { ws: string }; Returns: boolean }
      link_attribution: {
        Args: { p_from?: string; p_link?: string; p_to?: string; p_ws: string }
        Returns: {
          leads: number
          link_id: string
          revenue: number
          sales: number
          visitors: number
        }[]
      }
      link_code_available: { Args: { p_code: string }; Returns: boolean }
      link_stats: {
        Args: {
          p_from: string
          p_link: string
          p_prev_from?: string
          p_prev_to?: string
          p_to: string
          p_tz?: string
        }
        Returns: Json
      }
      load_demo_analytics: { Args: { ws: string }; Returns: number }
      load_demo_booking: { Args: { ws: string }; Returns: number }
      load_demo_creatives: { Args: { ws: string }; Returns: number }
      load_demo_data: { Args: { ws: string }; Returns: undefined }
      load_demo_intel: { Args: { ws: string }; Returns: number }
      load_demo_links: { Args: { ws: string }; Returns: undefined }
      load_demo_onboarding: { Args: { ws: string }; Returns: undefined }
      load_demo_portal: { Args: { ws: string }; Returns: number }
      load_demo_tracking: { Args: { ws: string }; Returns: undefined }
      mcp_act_as: { Args: { p_user: string; p_ws: string }; Returns: undefined }
      mcp_tracking_conversions: {
        Args: {
          p_end: string
          p_site: string
          p_start: string
          p_types: string[]
          p_user: string
          p_window: number
          p_ws: string
        }
        Returns: Json
      }
      mcp_tracking_stats: {
        Args: {
          p_end: string
          p_site: string
          p_start: string
          p_user: string
          p_ws: string
        }
        Returns: Json
      }
      notify_portal_clients: {
        Args: {
          p_body: string
          p_company: string
          p_concept?: string
          p_dedupe?: string
          p_feature: string
          p_link: string
          p_project?: string
          p_task?: string
        }
        Returns: number
      }
      onboarding_default_templates: {
        Args: never
        Returns: {
          description: string
          icon: string
          key: string
          name: string
          position: number
          sections: Json
        }[]
      }
      portal_all_features: { Args: never; Returns: string[] }
      portal_asset_path: {
        Args: { p_asset: string; p_company: string }
        Returns: Json
      }
      portal_booking: { Args: { p_company: string }; Returns: Json }
      portal_can: {
        Args: { p_company: string; p_feature: string }
        Returns: boolean
      }
      portal_company_files: {
        Args: { p_company: string }
        Returns: {
          client_visible: boolean
          created_at: string
          id: string
          mime: string
          name: string
          path: string
          project_id: string | null
          size: number
          task_id: string | null
          uploaded_by: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "attachments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      portal_company_tasks: {
        Args: { p_company: string }
        Returns: {
          archived_at: string | null
          assignee_id: string | null
          client_visible: boolean
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string
          due_date: string | null
          id: string
          milestone: boolean
          number: number
          position: number
          priority: string
          project_id: string
          recurrence: string | null
          start_date: string | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      portal_context: { Args: { p_slug: string }; Returns: Json }
      portal_creative: {
        Args: { p_company: string; p_concept: string }
        Returns: Json
      }
      portal_creative_review: {
        Args: {
          p_approve: boolean
          p_company: string
          p_concept: string
          p_feedback?: string
        }
        Returns: Json
      }
      portal_creatives: { Args: { p_company: string }; Returns: Json }
      portal_documents: { Args: { p_company: string }; Returns: Json }
      portal_effective_features: {
        Args: { p_company: string }
        Returns: string[]
      }
      portal_feature_module: { Args: { p_feature: string }; Returns: string }
      portal_features: { Args: { p_company: string }; Returns: string[] }
      portal_file_add: {
        Args: {
          p_company: string
          p_mime?: string
          p_name: string
          p_path: string
          p_project: string
        }
        Returns: Json
      }
      portal_file_path: {
        Args: { p_company: string; p_file: string }
        Returns: Json
      }
      portal_file_remove: {
        Args: { p_company: string; p_file: string }
        Returns: Json
      }
      portal_files: { Args: { p_company: string }; Returns: Json }
      portal_has_access: { Args: { p_company: string }; Returns: boolean }
      portal_home: { Args: { p_company: string }; Returns: Json }
      portal_is_preview: { Args: { p_company: string }; Returns: boolean }
      portal_me: { Args: never; Returns: Json }
      portal_module_require: {
        Args: { p_company: string; p_feature: string }
        Returns: undefined
      }
      portal_onboarding: { Args: { p_company: string }; Returns: Json }
      portal_person: {
        Args: { p_company: string; p_user: string }
        Returns: Json
      }
      portal_report: {
        Args: { p_company: string; p_report: string }
        Returns: Json
      }
      portal_reporting: {
        Args: {
          p_company: string
          p_end: string
          p_prev_start?: string
          p_start: string
        }
        Returns: Json
      }
      portal_require: {
        Args: { p_company: string; p_feature: string }
        Returns: undefined
      }
      portal_require_write: { Args: { p_company: string }; Returns: undefined }
      portal_site_analytics: {
        Args: {
          p_company: string
          p_end: string
          p_prev_end?: string
          p_prev_start?: string
          p_start: string
        }
        Returns: Json
      }
      portal_task: {
        Args: { p_company: string; p_task: string }
        Returns: Json
      }
      portal_task_comment: {
        Args: { p_body: string; p_company: string; p_task: string }
        Returns: Json
      }
      portal_task_file_path: {
        Args: { p_company: string; p_file: string; p_task: string }
        Returns: Json
      }
      portal_task_review: {
        Args: {
          p_approve: boolean
          p_comment?: string
          p_company: string
          p_task: string
        }
        Returns: Json
      }
      portal_task_visible: {
        Args: { p_company: string; p_task: string }
        Returns: boolean
      }
      portal_tasks: { Args: { p_company: string }; Returns: Json }
      portal_touch: { Args: { p_company: string }; Returns: undefined }
      portal_upload_target: {
        Args: { p_company: string; p_project: string }
        Returns: Json
      }
      project_ws: { Args: { p: string }; Returns: string }
      proposal_ws: { Args: { p: string }; Returns: string }
      public_proposal: { Args: { p_token: string }; Returns: Json }
      public_report: { Args: { p_token: string }; Returns: Json }
      respond_proposal: {
        Args: {
          p_accept: boolean
          p_name: string
          p_reason: string
          p_selected: string[]
          p_token: string
        }
        Returns: undefined
      }
      restore_onboarding_templates: { Args: { ws: string }; Returns: undefined }
      revoke_api_token: { Args: { p_id: string }; Returns: undefined }
      revoke_tracking_key: { Args: { p_id: string }; Returns: undefined }
      seed_onboarding: { Args: { ws: string }; Returns: undefined }
      seed_utm_presets: { Args: { ws: string }; Returns: undefined }
      seed_workspace_defaults: { Args: { ws: string }; Returns: undefined }
      shares_workspace: { Args: { other: string }; Returns: boolean }
      sign_proposal_commit: {
        Args: {
          p_event: Json
          p_proposal: string
          p_selected: string[]
          p_sig: Json
          p_version: string
        }
        Returns: undefined
      }
      site_analytics: {
        Args: {
          p_company: string
          p_end: string
          p_prev_end?: string
          p_prev_start?: string
          p_start: string
        }
        Returns: Json
      }
      spend_summary: { Args: { days?: number; ws: string }; Returns: Json }
      task_ws: { Args: { t: string }; Returns: string }
      tracking_ad_referential: {
        Args: { p_accounts: string[] }
        Returns: {
          ad_account_id: string
          external_id: string
          level: string
          name: string
          parent_id: string
        }[]
      }
      tracking_apply_template: {
        Args: { p_site: string; p_template: string }
        Returns: undefined
      }
      tracking_conversions: {
        Args: {
          p_end: string
          p_site: string
          p_start: string
          p_types?: string[]
          p_window?: number
        }
        Returns: {
          currency: string
          email: string
          id: string
          name: string
          person: string
          source: string
          touches: Json
          ts: string
          type: string
          value: number
          visitor_id: string
        }[]
      }
      tracking_funnel: {
        Args: {
          p_end: string
          p_site: string
          p_start: string
          p_window?: number
        }
        Returns: {
          events: number
          people: number
          sourced: number
          stage_id: string
          type: string
          value: number
        }[]
      }
      tracking_link_person: {
        Args: { p_email: string; p_phone: string; p_visitor: string }
        Returns: Json
      }
      tracking_people: {
        Args: { p_limit?: number; p_q?: string; p_site: string }
        Returns: {
          contact_id: string
          email: string
          first_seen: string
          identified_at: string
          last_seen: string
          leads: number
          name: string
          person_id: string
          phone: string
          purchases: number
          revenue: number
          visitors: number
        }[]
      }
      tracking_person: {
        Args: { p_person: string; p_site: string }
        Returns: Json
      }
      tracking_purge_signals: { Args: never; Returns: number }
      tracking_stats: {
        Args: { p_end: string; p_site: string; p_start: string }
        Returns: Json
      }
    }
    Enums: {
      member_role: "owner" | "admin" | "member" | "guest"
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
      member_role: ["owner", "admin", "member", "guest"],
    },
  },
} as const
